// B-9 지표 계산 테스트 — 손으로 계산한 작은 사례로 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alarmsFromFlags, scoreAlarms, mergeScores, summarize } from '../scripts/evaluate-rules/metrics.mjs';
import { initialState, nextState, TRANSITION, DOWN_AFTER_FAILURES } from '../src/state.js';

test('alarmsFromFlags: 연속 2회 실패에서 알림, 장애 중에는 또 울리지 않고, 성공 1회로 복구', () => {
  //            0      1     2     3     4     5     6     7
  const flags = [false, true, true, true, false, true, false, true];
  assert.deepEqual(alarmsFromFlags(flags, 2), [{ startIdx: 1, alarmIdx: 2, endIdx: 4 }]);
  // n=1이면 첫 실패에서 바로, 복구 뒤 실패(5)에서 또 알림, 마지막 실패(7)도 알림
  assert.deepEqual(alarmsFromFlags(flags, 1).map((a) => a.alarmIdx), [1, 5, 7]);
  // n=3이면 1~3의 3연속에서만
  assert.deepEqual(alarmsFromFlags(flags, 3), [{ startIdx: 1, alarmIdx: 3, endIdx: 4 }]);
  // 끝까지 안 끝난 장애는 endIdx null
  assert.equal(alarmsFromFlags([true, true], 2)[0].endIdx, null);
  assert.throws(() => alarmsFromFlags([true], 0), RangeError);
});

test('alarmsFromFlags(n=2)는 운영 src/state.js와 똑같이 움직인다 (무작위 흐름 비교)', () => {
  assert.equal(DOWN_AFTER_FAILURES, 2); // 이 비교는 운영 값이 2일 때만 의미가 있음
  let seed = 12345; // 재현 가능한 간단한 난수
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let t = 0; t < 50; t += 1) {
    const flags = Array.from({ length: 200 }, () => rnd() < 0.35);
    // 운영 상태 머신을 그대로 돌려 장애 알림이 울린 칸을 모음
    let st = initialState();
    const prod = [];
    flags.forEach((fail, i) => {
      const r = nextState(st, !fail, String(i));
      st = r.next;
      if (r.transition === TRANSITION.DOWN) prod.push(i);
    });
    assert.deepEqual(alarmsFromFlags(flags, 2).map((a) => a.alarmIdx), prod);
  }
});

test('scoreAlarms: 탐지·오탐·지연 (허용 0)', () => {
  // 이상 구간 [10,14], [30,32]. 알림: 11(구간1 안), 20(어디에도 안 맞음=오탐), 40(오탐)
  const alarms = [11, 20, 40].map((i) => ({ startIdx: i - 1, alarmIdx: i, endIdx: i + 1 }));
  const labels = { events: [[10, 14], [30, 32]], allSegments: [[10, 14], [30, 32]] };
  const s = scoreAlarms(alarms, labels, { from: 0, to: 50, tolerance: 0 });
  assert.equal(s.events, 2);
  assert.equal(s.detected, 1); // 구간2는 못 잡음
  assert.equal(s.alarms, 3);
  assert.equal(s.falseAlarms, 2);
  assert.deepEqual(s.delays, [1]); // 11 − 10
});

test('scoreAlarms: 허용 범위 안의 이른 알림은 지연 0, 범위 밖은 오탐', () => {
  const labels = { events: [[10, 14]], allSegments: [[10, 14]] };
  const at = (i) => [{ startIdx: i, alarmIdx: i, endIdx: null }];
  assert.deepEqual(scoreAlarms(at(8), labels, { from: 0, to: 50, tolerance: 3 }).delays, [0]); // 10−3=7 이상이라 맞음
  assert.equal(scoreAlarms(at(6), labels, { from: 0, to: 50, tolerance: 3 }).falseAlarms, 1);
  assert.equal(scoreAlarms(at(17), labels, { from: 0, to: 50, tolerance: 3 }).detected, 1); // 끝+3까지
  assert.equal(scoreAlarms(at(18), labels, { from: 0, to: 50, tolerance: 3 }).detected, 0);
});

test('scoreAlarms: 평가 범위 밖의 이벤트·알림은 세지 않고, 한 구간에 알림이 여러 번이어도 탐지는 1번', () => {
  const alarms = [5, 12, 13].map((i) => ({ startIdx: i, alarmIdx: i, endIdx: null }));
  const labels = { events: [[3, 6], [10, 14]], allSegments: [[3, 6], [10, 14]] };
  const s = scoreAlarms(alarms, labels, { from: 8, to: 50, tolerance: 0 });
  assert.equal(s.events, 1); // [3,6]은 범위 밖
  assert.equal(s.alarms, 2); // 5는 범위 밖
  assert.equal(s.detected, 1);
  assert.equal(s.falseAlarms, 0);
  assert.deepEqual(s.delays, [2]); // 첫 알림 12 − 10
});

test('scoreAlarms: events는 지표별로 다르지만 오탐 판정은 전체 이상 구간 기준', () => {
  // 이 지표가 잡아야 할 이벤트는 [10,14]뿐, 하지만 [30,32]에도 기계 전체가 이상이라 거기서 울린 알림은 오탐이 아님
  const alarms = [31].map((i) => ({ startIdx: i, alarmIdx: i, endIdx: null }));
  const labels = { events: [[10, 14]], allSegments: [[10, 14], [30, 32]] };
  const s = scoreAlarms(alarms, labels, { from: 0, to: 50, tolerance: 0 });
  assert.equal(s.falseAlarms, 0);
  assert.equal(s.detected, 0);
});

test('mergeScores·summarize: 합산, 일당 오탐, 지연 분위수', () => {
  const a = { events: 2, detected: 1, alarms: 3, falseAlarms: 2, delays: [1], slots: 288 }; // 288칸 × 5분 = 1일
  const b = { events: 2, detected: 2, alarms: 2, falseAlarms: 0, delays: [0, 4], slots: 288 };
  const m = mergeScores([a, b]);
  assert.equal(m.series, 2);
  const s = summarize(m, 5);
  assert.equal(s.events, 4);
  assert.equal(s.recall, 0.75);
  assert.equal(s.falseAlarmsPerSeriesDay, 1); // 오탐 2건 ÷ 2시계열·일
  assert.equal(s.precision, 3 / 5);
  assert.equal(s.delayMedianMin, 5); // [0,1,4]의 중앙값 1칸
  assert.equal(s.delayP90Min, 20); // 90% 지점 4칸
  // 이벤트가 하나도 없으면 탐지율은 null (0으로 속이지 않음)
  assert.equal(summarize(mergeScores([{ events: 0, detected: 0, alarms: 0, falseAlarms: 0, delays: [], slots: 10 }])).recall, null);
});
