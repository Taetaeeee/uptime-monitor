// B-9 판정 규칙 성능 측정 — 지표 계산 순수 함수
//
// 파일 읽기·출력은 run.mjs가 하고, "알림이 언제 울렸나 / 몇 개를 잡았나 / 얼마나 늦었나" 계산은 여기에 모아
// node --test로 검증합니다 (test/evaluate-rules.test.js).
//
// 용어
//   칸(slot)     5분 간격 점검 1회 (SMD는 1분 값을 5분 최댓값으로 줄인 것)
//   실패 표시    판정 함수(judgeReplay)가 isSuccess=false로 돌려준 칸
//   알림         "연속 N회 실패"가 채워진 그 칸 (운영에서 장애 알림이 기록되는 시점)
//   이상 구간    라벨이 1인 칸이 이어진 덩어리 [시작, 끝] (끝 포함)

import { quantile } from '../prepare-datasets/lib.mjs';

/**
 * 실패 표시 배열에서 "장애 알림"을 뽑는다 — 운영의 src/state.js와 같은 규칙, 단 연속 횟수 n을 바꿀 수 있게.
 *   실패가 n번 이어지면 알림(장애 시작), 장애 중에는 알림을 또 내지 않고, 성공 1번이면 복구.
 *   n=2일 때 src/state.js의 nextState와 똑같이 움직이는지는 테스트로 확인합니다.
 *   (state.js의 DOWN_AFTER_FAILURES는 상수라서, 운영 코드를 건드리지 않고 비교하려고 여기에 같은 규칙을 둠)
 *
 * @param {boolean[]} failFlags
 * @param {number} n  몇 번 연속 실패하면 장애로 볼까 (1 이상)
 * @returns {Array<{startIdx:number, alarmIdx:number, endIdx:(number|null)}>}
 *   startIdx 첫 실패 칸 / alarmIdx 알림이 울린 칸 / endIdx 복구된 칸(끝까지 안 끝났으면 null)
 */
export function alarmsFromFlags(failFlags, n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('연속 실패 횟수는 1 이상의 정수여야 합니다');
  const alarms = [];
  let run = 0;
  let firstFail = null;
  let current = null; // 장애 중이면 그 알림 객체
  failFlags.forEach((fail, i) => {
    if (fail) {
      run += 1;
      if (run === 1) firstFail = i;
      if (!current && run >= n) {
        current = { startIdx: firstFail, alarmIdx: i, endIdx: null };
        alarms.push(current);
      }
    } else {
      if (current) {
        current.endIdx = i;
        current = null;
      }
      run = 0;
      firstFail = null;
    }
  });
  return alarms;
}

/**
 * 알림을 라벨과 대조해 점수를 낸다.
 *   알림이 "맞다" = 어떤 이상 구간의 [시작−허용, 끝+허용] 안에서 울림 (허용: 라벨 경계가 칼같지 않아서 두는 여유)
 *   이상 "탐지" = 그 이상 구간의 같은 범위 안에서 알림이 한 번이라도 울림
 *   오탐 = 어떤 이상 구간과도 맞지 않는 알림
 *   지연 = (첫 알림 칸 − 이상 구간 시작 칸), 알림이 시작보다 먼저면 0
 *
 * 평가 범위 [from, to): 이 범위의 알림·이상 구간만 셉니다. 상태(연속 실패 수)는 앞부분에서 이어져 오지만
 *   앞부분(기준선·임계값을 정하는 데 쓴 구간)은 점수에 넣지 않습니다.
 *
 * @param {Array} alarms        alarmsFromFlags 결과
 * @param {object} labels
 * @param {Array<[number,number]>} labels.events       이 시계열이 잡아야 하는 이상 구간
 * @param {Array<[number,number]>} labels.allSegments  전체 이상 구간 (알림이 맞는지 가릴 때 씀. SMD는 지표마다 원인 구간이 달라 events ⊆ allSegments)
 * @param {{from:number, to:number, tolerance?:number}} range
 */
export function scoreAlarms(alarms, labels, { from, to, tolerance = 3 }) {
  const near = (i, [a, b]) => i >= a - tolerance && i <= b + tolerance;
  const events = labels.events.filter(([a]) => a >= from && a < to);
  const inRange = alarms.filter((x) => x.alarmIdx >= from && x.alarmIdx < to);

  const falseAlarms = inRange.filter((x) => !labels.allSegments.some((s) => near(x.alarmIdx, s))).length;
  const delays = [];
  let detected = 0;
  for (const ev of events) {
    const hits = inRange.filter((x) => near(x.alarmIdx, ev));
    if (hits.length) {
      detected += 1;
      delays.push(Math.max(0, Math.min(...hits.map((h) => h.alarmIdx)) - ev[0]));
    }
  }
  return { events: events.length, detected, alarms: inRange.length, falseAlarms, delays, slots: to - from };
}

/** 여러 시계열의 점수를 하나로 합친다 (탐지율은 이벤트 수 기준으로 합산 = 많이 가진 시계열이 더 크게 반영됨) */
export function mergeScores(list) {
  const sum = (key) => list.reduce((s, x) => s + x[key], 0);
  return {
    series: list.length,
    events: sum('events'),
    detected: sum('detected'),
    alarms: sum('alarms'),
    falseAlarms: sum('falseAlarms'),
    delays: list.flatMap((x) => x.delays),
    slots: sum('slots'),
  };
}

/** 합친 점수를 읽기 좋은 지표로 (stepMinutes: 한 칸이 몇 분인지) */
export function summarize(score, stepMinutes = 5) {
  const days = (score.slots * stepMinutes) / 1440;
  const d = [...score.delays].sort((a, b) => a - b);
  return {
    series: score.series,
    events: score.events,
    detected: score.detected,
    recall: score.events ? score.detected / score.events : null,
    alarms: score.alarms,
    falseAlarms: score.falseAlarms,
    // 시계열 1개가 하루 동안 낼 오탐 수의 평균 (시계열 수와 무관하게 비교하려고 "시계열·일"로 나눔)
    falseAlarmsPerSeriesDay: days ? score.falseAlarms / days : null,
    precision: score.alarms ? (score.alarms - score.falseAlarms) / score.alarms : null,
    delayMedianMin: d.length ? quantile(d, 0.5) * stepMinutes : null,
    delayP90Min: d.length ? quantile(d, 0.9) * stepMinutes : null,
  };
}
