// 공개 데이터셋 재생 순수 함수(src/replay.js) 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  replayIndex,
  downsample,
  toPercent,
  countPerBin,
  baselineOf,
  judgeReplay,
  buildReplayRow,
  REPLAY_FAILURE,
  REPLAY_REASON_TEXT,
} from '../src/replay.js';
import { initialState, nextState, TRANSITION } from '../src/state.js';

const MIN = 60_000;
const T0 = Date.parse('2026-11-12T00:00:00Z');

// ───────── replayIndex ─────────
test('replayIndex: 기준 시각이 0번, 5분마다 1씩 증가', () => {
  assert.equal(replayIndex(T0, T0, 100), 0);
  assert.equal(replayIndex(T0 + 5 * MIN, T0, 100), 1);
  assert.equal(replayIndex(T0 + 12 * MIN, T0, 100), 2); // 5분 칸 안에서는 같은 순번
  assert.equal(replayIndex(T0 + 4 * MIN + 59_000, T0, 100), 0);
});

test('replayIndex: 끝까지 가면 처음으로 돌아간다', () => {
  assert.equal(replayIndex(T0 + 5 * 99 * MIN, T0, 100), 99);
  assert.equal(replayIndex(T0 + 5 * 100 * MIN, T0, 100), 0);
  assert.equal(replayIndex(T0 + 5 * 250 * MIN, T0, 100), 50);
});

test('replayIndex: 기준 시각보다 이전이어도 0~길이-1 안에 있다', () => {
  assert.equal(replayIndex(T0 - 5 * MIN, T0, 100), 99);
  assert.equal(replayIndex(T0 - 1, T0, 100), 99);
  for (let k = -500; k < 500; k += 7) {
    const i = replayIndex(T0 + k * 5 * MIN, T0, 37);
    assert.ok(Number.isInteger(i) && i >= 0 && i < 37);
  }
});

test('replayIndex: 하루 단위 데이터(1440분)는 하루에 한 칸', () => {
  const day = 24 * 60 * MIN;
  assert.equal(replayIndex(T0 + day - 1, T0, 30, 1440), 0);
  assert.equal(replayIndex(T0 + day, T0, 30, 1440), 1);
  assert.equal(replayIndex(T0 + 31 * day, T0, 30, 1440), 1);
});

test('replayIndex: 잘못된 입력은 거부', () => {
  assert.throws(() => replayIndex(T0, T0, 0), RangeError);
  assert.throws(() => replayIndex(T0, T0, 1.5), RangeError);
  assert.throws(() => replayIndex(NaN, T0, 10), RangeError);
  assert.throws(() => replayIndex(T0, T0, 10, 0), RangeError);
});

// ───────── downsample ─────────
const pts = (arr) => arr.map(([value, anomaly]) => ({ value, anomaly }));

test('downsample: 평균 / 최댓값 / 마지막 값', () => {
  const p = pts([[1, 0], [2, 0], [3, 0], [4, 0], [10, 0], [20, 0]]);
  assert.deepEqual(downsample(p, 3, 'mean').map((x) => x.value), [2, 34 / 3]);
  assert.deepEqual(downsample(p, 3, 'max').map((x) => x.value), [3, 20]);
  assert.deepEqual(downsample(p, 3, 'last').map((x) => x.value), [3, 20]);
  assert.deepEqual(downsample(p, 3, 'min').map((x) => x.value), [1, 4]);
});

test('downsample: 이상 라벨은 하나라도 1이면 1, 전부 null이면 null', () => {
  const out = downsample(pts([[1, 0], [1, 1], [1, 0], [1, null], [1, null], [1, null], [1, 0], [1, null], [1, 0]]), 3, 'mean');
  assert.deepEqual(out.map((x) => x.anomaly), [1, null, 0]);
});

test('downsample: 끝의 자투리는 버린다', () => {
  assert.equal(downsample(pts([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]), 2, 'mean').length, 2);
  assert.equal(downsample(pts([[1, 0]]), 5, 'mean').length, 0);
});

test('downsample: 묶음 크기 1은 그대로, 잘못된 입력은 거부', () => {
  assert.deepEqual(downsample(pts([[3, 1], [4, null]]), 1, 'mean'), [{ value: 3, anomaly: 1 }, { value: 4, anomaly: null }]);
  assert.throws(() => downsample(pts([[1, 0]]), 0), RangeError);
  assert.throws(() => downsample(pts([[1, 0]]), 1, 'median'), RangeError);
  assert.throws(() => downsample(pts([[NaN, 0]]), 1), TypeError);
});

// ───────── toPercent ─────────
test('toPercent: 0~1 → %, 범위 밖은 거부', () => {
  assert.equal(toPercent(0), 0);
  assert.equal(toPercent(0.5), 50);
  assert.equal(toPercent(1), 100);
  assert.equal(toPercent(0.123456), 12.35);
  assert.throws(() => toPercent(-0.01), RangeError);
  assert.throws(() => toPercent(1.2), RangeError);
  assert.throws(() => toPercent(NaN), RangeError);
});

// ───────── countPerBin ─────────
test('countPerBin: 5분 칸에 나눠 세고, 빈 칸은 0, 구간 밖은 무시', () => {
  const ts = [T0, T0 + 1 * MIN, T0 + 4 * MIN + 59_000, T0 + 5 * MIN, T0 + 14 * MIN, T0 - 1, T0 + 15 * MIN];
  assert.deepEqual(countPerBin(ts, T0, T0 + 15 * MIN), [3, 1, 1]);
  assert.deepEqual(countPerBin([], T0, T0 + 10 * MIN), [0, 0]);
});

test('countPerBin: 끝이 칸 경계가 아니면 마지막 칸을 하나 더 둔다', () => {
  assert.equal(countPerBin([], T0, T0 + 11 * MIN).length, 3);
  assert.throws(() => countPerBin([], T0, T0), RangeError);
});

// ───────── baselineOf ─────────
test('baselineOf: 중앙값 (이상 구간의 큰 값에 끌려가지 않음)', () => {
  assert.equal(baselineOf([5, 1, 3]), 3);
  assert.equal(baselineOf([1, 2, 3, 4]), 2.5);
  assert.equal(baselineOf([10, 10, 10, 10, 10, 1000, 1000]), 10); // 평균이면 약 291
  assert.throws(() => baselineOf([]), RangeError);
});

// ───────── judgeReplay ─────────
test('judgeReplay high: 기준 "이상"에서 느림/실패 (경계값 포함)', () => {
  const rule = { type: 'high', slowAt: 80, failAt: 95 };
  assert.deepEqual(judgeReplay(rule, 79.99), { isSuccess: true, isSlow: false, failureReason: null });
  assert.deepEqual(judgeReplay(rule, 80), { isSuccess: true, isSlow: true, failureReason: null });
  assert.deepEqual(judgeReplay(rule, 94.9), { isSuccess: true, isSlow: true, failureReason: null });
  assert.deepEqual(judgeReplay(rule, 95), { isSuccess: false, isSlow: false, failureReason: REPLAY_FAILURE.METRIC_HIGH });
});

test('judgeReplay deviation: 평소 값에서 ±% (위·아래 모두)', () => {
  const rule = { type: 'deviation', slowPct: 10, failPct: 20 };
  assert.equal(judgeReplay(rule, 100, 100).isSlow, false);
  assert.equal(judgeReplay(rule, 110, 100).isSlow, true);
  assert.equal(judgeReplay(rule, 90, 100).isSlow, true);
  assert.equal(judgeReplay(rule, 119.9, 100).isSuccess, true);
  assert.equal(judgeReplay(rule, 120, 100).failureReason, REPLAY_FAILURE.METRIC_DEVIATION);
  assert.equal(judgeReplay(rule, 80, 100).failureReason, REPLAY_FAILURE.METRIC_DEVIATION);
  assert.throws(() => judgeReplay(rule, 1, 0), RangeError); // 평소 값 0이면 비율을 정의할 수 없음
  assert.throws(() => judgeReplay(rule, 1), RangeError);
});

test('judgeReplay ratio: 평소 대비 배수, 평소가 0이어도 바닥값으로 나눈다', () => {
  const rule = { type: 'ratio', slowX: 3, failX: 10 };
  assert.equal(judgeReplay(rule, 20, 10).isSlow, false);
  assert.equal(judgeReplay(rule, 30, 10).isSlow, true);
  assert.equal(judgeReplay(rule, 100, 10).failureReason, REPLAY_FAILURE.METRIC_SPIKE);
  // 평소 0건: 바닥값 1로 나눔 → 3건이면 3배(느림), 10건이면 10배(실패), 0건은 정상
  assert.equal(judgeReplay(rule, 0, 0).isSlow, false);
  assert.equal(judgeReplay(rule, 3, 0).isSlow, true);
  assert.equal(judgeReplay(rule, 10, 0).isSuccess, false);
  // 바닥값 조정
  assert.equal(judgeReplay({ ...rule, minBaseline: 5 }, 10, 0).isSlow, false);
});

test('judgeReplay smart: 고장 기록이면 실패, 불량 값이 0보다 크면 느림', () => {
  const rule = { type: 'smart' };
  assert.deepEqual(judgeReplay(rule, 0, undefined, { failed: false }), { isSuccess: true, isSlow: false, failureReason: null });
  assert.deepEqual(judgeReplay(rule, 3, undefined, { failed: false }), { isSuccess: true, isSlow: true, failureReason: null });
  assert.deepEqual(judgeReplay(rule, 3, undefined, { failed: true }), { isSuccess: false, isSlow: false, failureReason: REPLAY_FAILURE.DISK_FAILURE });
});

test('judgeReplay: 실패에는 절대 느림이 붙지 않는다 (DB 규칙 is_success=1 OR is_slow=0)', () => {
  const cases = [
    [{ type: 'high', slowAt: 80, failAt: 95 }, [0, 80, 95, 100], undefined],
    [{ type: 'deviation', slowPct: 10, failPct: 20 }, [50, 100, 150], 100],
    [{ type: 'ratio', slowX: 3, failX: 10 }, [0, 30, 500], 10],
  ];
  for (const [rule, values, baseline] of cases) {
    for (const v of values) {
      const r = judgeReplay(rule, v, baseline);
      assert.ok(r.isSuccess || !r.isSlow, `${rule.type} ${v}`);
      assert.equal(r.isSuccess, r.failureReason === null);
    }
  }
});

test('judgeReplay: 알 수 없는 규칙·숫자가 아닌 값은 거부', () => {
  assert.throws(() => judgeReplay({ type: 'magic' }, 1), RangeError);
  assert.throws(() => judgeReplay({ type: 'high', slowAt: 1, failAt: 2 }, NaN), TypeError);
});

test('모든 실패 이유에 화면 문구가 있다', () => {
  for (const code of Object.values(REPLAY_FAILURE)) assert.ok(REPLAY_REASON_TEXT[code], code);
});

// ───────── buildReplayRow + 기존 장애 판정 ─────────
test('buildReplayRow: record.js가 받는 행 모양 (HTTP 점검과 같은 필드)', () => {
  const row = buildReplayRow({
    monitorId: 7,
    checkedAt: '2026-11-12T00:05:00Z',
    value: 97,
    rule: { type: 'high', slowAt: 80, failAt: 95 },
  });
  assert.deepEqual(row, {
    monitorId: 7,
    checkedAt: '2026-11-12T00:05:00Z',
    isSuccess: false,
    isSlow: false,
    statusCode: null,
    responseMs: null,
    failureReason: 'metric_high',
    value: 97,
  });
});

test('재생 값이 기존 장애 판정을 탄다: 연속 2회 실패에 장애, 1회 성공에 복구', () => {
  const rule = { type: 'high', slowAt: 80, failAt: 95 };
  const series = [50, 96, 50, 96, 97, 98, 60]; // 96 한 번은 장애 아님 → 96,97,98 연속에서 장애
  let state = initialState();
  const events = [];
  series.forEach((value, i) => {
    const checkedAt = new Date(T0 + i * 5 * MIN).toISOString().replace('.000Z', 'Z');
    const row = buildReplayRow({ monitorId: 1, checkedAt, value, rule });
    const { next, transition } = nextState(state, row.isSuccess, checkedAt);
    state = next;
    if (transition) events.push([i, transition]);
  });
  assert.deepEqual(events, [[4, TRANSITION.DOWN], [6, TRANSITION.RECOVERED]]);
});

test('평소 대비 급증(ratio)도 기존 판정을 탄다: 한 번 튄 값은 장애가 아님', () => {
  const rule = { type: 'ratio', slowX: 3, failX: 10 };
  const values = [2, 2, 2, 60, 2, 2, 70, 80, 2];
  const baseline = baselineOf(values); // 2
  let state = initialState();
  const downs = [];
  values.forEach((value, i) => {
    const checkedAt = `2026-11-12T00:${String(i * 5).padStart(2, '0')}:00Z`;
    const row = buildReplayRow({ monitorId: 1, checkedAt, value, rule, baseline });
    const { next, transition } = nextState(state, row.isSuccess, checkedAt);
    state = next;
    if (transition === TRANSITION.DOWN) downs.push(i);
  });
  assert.deepEqual(downs, [7]); // 60 한 번(3번)은 무시, 70·80 연속(6~7번)에서 장애
});
