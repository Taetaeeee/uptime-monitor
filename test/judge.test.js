// 판정 순수 함수 테스트 — 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeCheck, FAILURE_REASON } from '../src/judge.js';

// 테스트용 기본 대상: 200을 기대하고, '고쳐라'가 본문에 있어야 하고, 3초 넘으면 느림
const monitor = { expectedStatus: 200, keyword: '고쳐라', maxResponseMs: 3000 };

// 정상 응답 관측값. 각 테스트에서 필요한 부분만 덮어씁니다.
const okObservation = {
  timedOut: false,
  networkError: false,
  statusCode: 200,
  responseMs: 120,
  body: '<title>고쳐라! 웹게임</title>',
};

test('정상: 200 + 키워드 있음 + 빠름 → 성공', () => {
  assert.deepEqual(judgeCheck(monitor, okObservation), {
    isSuccess: true,
    isSlow: false,
    failureReason: null,
  });
});

test('시간 초과 → 실패(timeout)', () => {
  const r = judgeCheck(monitor, {
    ...okObservation,
    timedOut: true,
    statusCode: null,
    responseMs: null,
    body: '',
  });
  assert.equal(r.isSuccess, false);
  assert.equal(r.failureReason, FAILURE_REASON.TIMEOUT);
});

test('상태 코드 불일치(503) → 실패(status_mismatch)', () => {
  const r = judgeCheck(monitor, { ...okObservation, statusCode: 503 });
  assert.equal(r.isSuccess, false);
  assert.equal(r.failureReason, FAILURE_REASON.STATUS_MISMATCH);
});

test('키워드 없음 → 실패(keyword_missing)', () => {
  const r = judgeCheck(monitor, { ...okObservation, body: '<title>점검 중</title>' });
  assert.equal(r.isSuccess, false);
  assert.equal(r.failureReason, FAILURE_REASON.KEYWORD_MISSING);
});

test('느림: 성공이지만 허용 시간 초과 → 성공 + 느림', () => {
  const r = judgeCheck(monitor, { ...okObservation, responseMs: 4500 });
  assert.equal(r.isSuccess, true);
  assert.equal(r.isSlow, true);
});

// ── 경계 사례 ──

test('네트워크 오류 → 실패(network_error)', () => {
  const r = judgeCheck(monitor, {
    ...okObservation,
    networkError: true,
    statusCode: null,
    responseMs: null,
    body: '',
  });
  assert.equal(r.failureReason, FAILURE_REASON.NETWORK_ERROR);
});

test('실패한 점검에는 느림을 붙이지 않는다 (503이면서 5초)', () => {
  const r = judgeCheck(monitor, { ...okObservation, statusCode: 503, responseMs: 5000 });
  assert.equal(r.isSuccess, false);
  assert.equal(r.isSlow, false);
});

test('허용 시간과 정확히 같으면 느림이 아니다 (3000ms)', () => {
  const r = judgeCheck(monitor, { ...okObservation, responseMs: 3000 });
  assert.equal(r.isSlow, false);
});

test('키워드가 지정되지 않으면 본문을 검사하지 않는다', () => {
  const r = judgeCheck({ ...monitor, keyword: null }, { ...okObservation, body: '' });
  assert.equal(r.isSuccess, true);
});

test('상태 코드와 키워드가 둘 다 틀리면 상태 코드가 우선', () => {
  const r = judgeCheck(monitor, { ...okObservation, statusCode: 500, body: '에러' });
  assert.equal(r.failureReason, FAILURE_REASON.STATUS_MISMATCH);
});
