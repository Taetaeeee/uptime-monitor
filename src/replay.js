// 공개 데이터셋 재생 — 순수 함수 모음 (B-7b)
//
// "재생"이란? 다른 조직의 실제 운영 기록(과거)을 5분마다 한 칸씩 꺼내 보여 주는 것입니다.
// 이 파일은 그 계산만 맡습니다. DB·네트워크·시계를 건드리지 않아서 node --test로 검증할 수 있어요.
// (DB에서 값을 읽고 저장하는 것은 B-7d, 원본 파일을 자르는 스크립트는 B-7c에서 이 함수들을 가져다 씁니다)
//
// 이 파일이 하는 일
//   1) replayIndex      "지금 몇 번째 값을 보여 줄까?"        (시계 → 순번)
//   2) downsample       1분 간격 원본을 5분 간격으로 줄이기    (SMD용)
//   3) toPercent        0~1로 정규화된 값을 %로 환산           (SMD용, 상대값이라는 점은 화면에 표시)
//   4) countPerBin      로그 시각들을 5분 단위 건수로 집계      (Loghub용)
//   5) baselineOf       "평소 값" 구하기 (중앙값)
//   6) judgeReplay      값 하나를 성공/느림/실패로 판정
//   7) buildReplayRow   판정 결과를 기존 기록 경로(record.js)가 받는 모양으로 만들기

import { CHECK_INTERVAL_MINUTES } from './time.js';

const MS_PER_MINUTE = 60_000;

// ─────────────────────────────────────────────
// 실패 이유 (DB에 이 값 그대로 저장). 화면 문구는 REPLAY_REASON_TEXT
//   기존 notify.js의 REASON_TEXT에는 B-7d에서 이 문구를 합칩니다. (이번 단계에서는 기존 파일을 고치지 않음)
// ─────────────────────────────────────────────
export const REPLAY_FAILURE = Object.freeze({
  METRIC_HIGH: 'metric_high',           // 사용률 같은 값이 기준 이상
  METRIC_DEVIATION: 'metric_deviation', // 평소 값에서 너무 벗어남 (온도 등)
  METRIC_SPIKE: 'metric_spike',         // 평소 대비 몇 배로 급증 (오류·로그인 실패 건수)
  DISK_FAILURE: 'disk_failure',         // 디스크 고장 기록
});

export const REPLAY_REASON_TEXT = Object.freeze({
  metric_high: '지표가 기준치 이상',
  metric_deviation: '지표가 평소 값에서 크게 벗어남',
  metric_spike: '지표가 평소 대비 급증',
  disk_failure: '디스크 고장 기록',
});

// ─────────────────────────────────────────────
// 1) 순번 계산
// ─────────────────────────────────────────────

/**
 * 지금 보여 줄 값의 순번 (0부터)
 *   순번 = ((지금 − 기준 시각) ÷ 간격) 의 몫을, 전체 길이로 나눈 나머지
 *   끝까지 가면 처음으로 돌아가므로, 1주 분량만 있어도 계속 재생됩니다.
 *
 * @param {number} nowMs        지금 시각(ms). 보통 5분 회차로 내린 시각을 넣습니다
 * @param {number} anchorMs     재생을 시작한 기준 시각(ms). 이 시각의 순번이 0
 * @param {number} length       시계열의 전체 길이 (값의 개수)
 * @param {number} [stepMinutes=5]  값 한 칸이 몇 분인지 (하루 단위 데이터는 1440)
 */
export function replayIndex(nowMs, anchorMs, length, stepMinutes = CHECK_INTERVAL_MINUTES) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(anchorMs)) throw new RangeError('시각은 숫자여야 합니다');
  if (!Number.isInteger(length) || length <= 0) throw new RangeError('길이는 1 이상의 정수여야 합니다');
  if (!(stepMinutes > 0)) throw new RangeError('간격은 0보다 커야 합니다');

  const steps = Math.floor((nowMs - anchorMs) / (stepMinutes * MS_PER_MINUTE));
  // JS의 %는 음수일 때 음수가 나옵니다. 기준 시각보다 이전 시각이 들어와도 0~length-1 안에 있도록 보정.
  return ((steps % length) + length) % length;
}

// ─────────────────────────────────────────────
// 2) 간격 줄이기 (1분 → 5분)
// ─────────────────────────────────────────────

const REDUCERS = {
  mean: (v) => v.reduce((a, b) => a + b, 0) / v.length,
  max: (v) => Math.max(...v),
  min: (v) => Math.min(...v),
  last: (v) => v[v.length - 1],
};

/**
 * 시계열을 factor개씩 묶어 한 칸으로 줄인다.
 *   값: method(mean 평균 / max 최댓값 / min / last 마지막 값)로 묶음
 *   이상 라벨: 묶음 안에 1이 하나라도 있으면 1, 전부 라벨 없음(null)이면 null, 아니면 0
 *   끝에 factor개가 안 되는 자투리는 버립니다 (덜 채워진 칸이 평균을 왜곡하지 않게)
 *
 * 평균 vs 최댓값: 평균은 짧은 급등을 뭉개고, 최댓값은 급등을 살립니다.
 *   어느 쪽을 쓸지는 지표에 따라 다르고, 고른 방식은 datasets.processing에 기록합니다.
 *
 * @param {Array<{value:number, anomaly:(0|1|null)}>} points
 */
export function downsample(points, factor, method = 'mean') {
  if (!Number.isInteger(factor) || factor < 1) throw new RangeError('묶음 크기는 1 이상의 정수여야 합니다');
  const reduce = REDUCERS[method];
  if (!reduce) throw new RangeError(`알 수 없는 방식: ${method}`);

  const out = [];
  for (let i = 0; i + factor <= points.length; i += factor) {
    const win = points.slice(i, i + factor);
    const values = win.map((p) => p.value);
    if (!values.every(Number.isFinite)) throw new TypeError(`숫자가 아닌 값이 있습니다 (위치 ${i})`);

    const labels = win.map((p) => p.anomaly ?? null);
    const anomaly = labels.every((l) => l === null) ? null : labels.some((l) => l === 1) ? 1 : 0;
    out.push({ value: reduce(values), anomaly });
  }
  return out;
}

// ─────────────────────────────────────────────
// 3) 단위 환산
// ─────────────────────────────────────────────

/**
 * 0~1로 정규화된 값을 %로 환산한다. (소수 둘째 자리까지)
 * 주의: SMD의 값은 "정규화된 상대값"이라 실제 CPU 사용률(%)이 아닙니다.
 *       화면에는 '정규화 지표'라는 사실을 함께 표시해야 합니다 (표시 문구는 B-7e에서).
 */
export function toPercent(normalized) {
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
    throw new RangeError(`0~1 범위가 아닙니다: ${normalized}`);
  }
  return Math.round(normalized * 10000) / 100;
}

// ─────────────────────────────────────────────
// 4) 로그 시각 → 5분 단위 건수
// ─────────────────────────────────────────────

/**
 * 시각 목록을 [시작, 끝) 구간의 binMinutes 단위 칸에 나눠 센다.
 *   건수가 0인 칸도 0으로 채워서 돌려줍니다. (빈 칸이 빠지면 시간 간격이 어긋나요)
 *   구간 밖의 시각은 무시합니다. 원본 로그 본문은 저장하지 않고 건수만 남기는 용도입니다.
 */
export function countPerBin(timestampsMs, startMs, endMs, binMinutes = CHECK_INTERVAL_MINUTES) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new RangeError('구간이 올바르지 않습니다');
  if (!(binMinutes > 0)) throw new RangeError('칸 크기는 0보다 커야 합니다');

  const binMs = binMinutes * MS_PER_MINUTE;
  const counts = new Array(Math.ceil((endMs - startMs) / binMs)).fill(0);
  for (const t of timestampsMs) {
    if (t < startMs || t >= endMs) continue;
    counts[Math.floor((t - startMs) / binMs)] += 1;
  }
  return counts;
}

// ─────────────────────────────────────────────
// 5) 평소 값
// ─────────────────────────────────────────────

/**
 * 시계열의 "평소 값" = 중앙값
 *   평균 대신 중앙값을 쓰는 이유: 이상 구간의 큰 값 몇 개가 평소 값을 끌어올리지 못하게 하려고요.
 *   (평균을 쓰면 장애가 길수록 "평소"가 높아져서 장애를 못 잡게 됩니다)
 */
export function baselineOf(values) {
  if (!values.length) throw new RangeError('값이 없습니다');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─────────────────────────────────────────────
// 6) 판정
// ─────────────────────────────────────────────

/**
 * 값 하나를 판정한다.
 *   실패(장애 후보) = isSuccess false. "연속 2회 실패 → 장애"는 기존 state.js가 합니다. (여기서 또 세지 않음)
 *   느림(경고)      = 성공이지만 주의 구간. 실패에는 '느림'을 붙이지 않습니다 (DB 규칙: 실패면 is_slow = 0).
 *
 * 규칙 종류 (rule.type)
 *   high      사용률 계열: value >= failAt 이면 실패, >= slowAt 이면 느림           { slowAt, failAt }
 *   deviation 기준치(평소 값)에서 ±% 벗어남 (온도 등): |value−평소|/|평소|×100       { slowPct, failPct }
 *   ratio     평소 대비 몇 배 (오류·로그인 실패 건수): value / max(평소, minBaseline)   { slowX, failX, minBaseline=1 }
 *             minBaseline: 평소 값이 0인 시계열에서 0으로 나누지 않으려는 바닥값
 *   smart     디스크: 고장 기록이 있으면 실패, 불량 값이 0보다 크면 느림              { slowAbove=0 }  + extra.failed
 *
 * @param {object} rule
 * @param {number} value
 * @param {number} [baseline]  deviation·ratio에서 쓰는 평소 값 (baselineOf로 구함)
 * @param {{failed?: boolean}} [extra]  smart에서 쓰는 "고장 기록 있음" (데이터셋이 직접 기록한 사실)
 */
export function judgeReplay(rule, value, baseline, extra = {}) {
  if (!Number.isFinite(value)) throw new TypeError('값은 숫자여야 합니다');

  switch (rule.type) {
    case 'high':
      if (value >= rule.failAt) return fail(REPLAY_FAILURE.METRIC_HIGH);
      return ok(value >= rule.slowAt);

    case 'deviation': {
      if (!Number.isFinite(baseline) || baseline === 0) throw new RangeError('deviation에는 0이 아닌 평소 값이 필요합니다');
      const pct = (Math.abs(value - baseline) / Math.abs(baseline)) * 100;
      if (pct >= rule.failPct) return fail(REPLAY_FAILURE.METRIC_DEVIATION);
      return ok(pct >= rule.slowPct);
    }

    case 'ratio': {
      if (!Number.isFinite(baseline)) throw new RangeError('ratio에는 평소 값이 필요합니다');
      const x = value / Math.max(baseline, rule.minBaseline ?? 1);
      if (x >= rule.failX) return fail(REPLAY_FAILURE.METRIC_SPIKE);
      return ok(x >= rule.slowX);
    }

    case 'smart':
      if (extra.failed) return fail(REPLAY_FAILURE.DISK_FAILURE);
      return ok(value > (rule.slowAbove ?? 0));

    default:
      throw new RangeError(`알 수 없는 판정 규칙: ${rule.type}`);
  }
}

const ok = (isSlow) => ({ isSuccess: true, isSlow, failureReason: null });
const fail = (reason) => ({ isSuccess: false, isSlow: false, failureReason: reason });

// ─────────────────────────────────────────────
// 7) 기록용 행 만들기
// ─────────────────────────────────────────────

/**
 * 판정 결과를 recordResults(record.js)가 받는 행 모양으로 만든다.
 *   HTTP 점검과 같은 모양이라 장애 판정·알림·일별 집계를 그대로 탑니다.
 *   응답 코드·응답 시간은 재생 데이터에 없으므로 null, 읽은 값은 value에 남깁니다.
 */
export function buildReplayRow({ monitorId, checkedAt, value, rule, baseline, failed = false }) {
  const verdict = judgeReplay(rule, value, baseline, { failed });
  return {
    monitorId,
    checkedAt,
    isSuccess: verdict.isSuccess,
    isSlow: verdict.isSlow,
    statusCode: null,
    responseMs: null,
    failureReason: verdict.failureReason,
    value,
  };
}
