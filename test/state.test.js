// 장애 판정(상태 전이) 순수 함수 테스트 — 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextState, initialState, STATE, TRANSITION } from '../src/state.js';

// 5분 간격 회차 시각 (T0, T1, T2 ...)
const T = (n) => new Date(Date.UTC(2026, 10, 10, 3, 0) + n * 5 * 60000).toISOString().replace('.000Z', 'Z');

// 결과 목록(true=성공, false=실패)을 차례로 넣고, 마지막 상태와 모든 전이를 돌려줍니다.
function run(results, start = initialState()) {
  let s = start;
  const transitions = [];
  results.forEach((ok, i) => {
    const { next, transition } = nextState(s, ok, T(i));
    if (transition) transitions.push({ at: i, transition });
    s = next;
  });
  return { state: s, transitions };
}

test('실패 1회로는 장애가 아니다 (unknown 유지, 알림 없음)', () => {
  const { state, transitions } = run([false]);
  assert.equal(state.state, STATE.UNKNOWN);
  assert.equal(state.consecutiveFailures, 1);
  assert.deepEqual(transitions, []);
});

test('2회 연속 실패 → 장애 + 알림, 장애 시작은 첫 실패 회차', () => {
  const { state, transitions } = run([false, false]);
  assert.equal(state.state, STATE.DOWN);
  assert.deepEqual(transitions, [{ at: 1, transition: TRANSITION.DOWN }]);
  assert.equal(state.failingSince, T(0)); // 실제 문제는 첫 실패부터
  assert.equal(state.changedAt, T(1));    // 판정은 두 번째 실패에서
});

test('정상(up)에서도 2회 연속 실패하면 장애', () => {
  const { state, transitions } = run([true, false, false]);
  assert.equal(state.state, STATE.DOWN);
  assert.deepEqual(transitions, [{ at: 2, transition: TRANSITION.DOWN }]);
});

test('이미 장애 중이면 실패가 계속돼도 알림을 다시 보내지 않는다', () => {
  const { state, transitions } = run([false, false, false, false, false]);
  assert.equal(state.state, STATE.DOWN);
  assert.equal(transitions.length, 1);
  assert.equal(state.consecutiveFailures, 5);
  assert.equal(state.failingSince, T(0)); // 시작 시각은 그대로
});

test('장애 중 성공 1회 → 복구 + 알림, 실패 기록 초기화', () => {
  const { state, transitions } = run([false, false, true]);
  assert.equal(state.state, STATE.UP);
  assert.deepEqual(transitions.map((t) => t.transition), [TRANSITION.DOWN, TRANSITION.RECOVERED]);
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.failingSince, null);
  assert.equal(state.changedAt, T(2));
});

test('처음(unknown) 성공 → 정상이 되지만 알림은 없다', () => {
  const { state, transitions } = run([true]);
  assert.equal(state.state, STATE.UP);
  assert.deepEqual(transitions, []);
  assert.equal(state.changedAt, T(0));
});

test('실패와 성공이 번갈아 나오면 장애로 판정하지 않는다', () => {
  const { state, transitions } = run([false, true, false, true, false]);
  assert.notEqual(state.state, STATE.DOWN);
  assert.deepEqual(transitions, []);
});

test('정상 상태에서 성공이 이어지면 상태 변경 시각은 그대로', () => {
  const { state } = run([true, true, true]);
  assert.equal(state.state, STATE.UP);
  assert.equal(state.changedAt, T(0));
  assert.equal(state.consecutiveSuccesses, 3);
});
