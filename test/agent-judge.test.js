// 에이전트 보고 검증·판정 순수 함수 테스트 — 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReport, judgeAgentCheck, AGENT_FAILURE, MAX_CHECKS_PER_REPORT } from '../src/agent-judge.js';

const NOW = new Date('2026-11-10T05:00:00Z');
const base = () => ({
  agent: 'test-pc',
  mode: 'simulator',
  observed_at: '2026-11-10T04:58:30Z',
  checks: [{ key: 'sim-db-tcp', ok: true, response_ms: 12 }],
});

// ── 검증 ──

test('정상 보고는 통과하고, 빠진 값은 null로 정리된다', () => {
  const v = validateReport(base(), NOW);
  assert.equal(v.ok, true);
  assert.deepEqual(v.report.checks[0], { key: 'sim-db-tcp', ok: true, responseMs: 12, value: null, error: null });
});

test('검증 실패 사례', () => {
  const cases = [
    [null, 'body_must_be_object'],
    [{ ...base(), mode: 'fake' }, 'invalid_mode'],
    [{ ...base(), observed_at: '2026-11-10 04:58:30' }, 'invalid_observed_at'], // Z 없는 시각 거부
    [{ ...base(), observed_at: '2026-11-09T04:00:00Z' }, 'observed_at_too_old'], // 25시간 전
    [{ ...base(), observed_at: '2026-11-10T05:10:00Z' }, 'observed_at_in_future'], // 10분 뒤
    [{ ...base(), checks: [] }, 'checks_required'],
    [{ ...base(), checks: [{ key: 'Bad Key!', ok: true }] }, 'invalid_check_key'],
    [{ ...base(), checks: [{ key: 'a', ok: 'yes' }] }, 'invalid_check_ok'],
    [{ ...base(), checks: [{ key: 'a', ok: true, response_ms: -1 }] }, 'invalid_response_ms'],
    [{ ...base(), checks: [{ key: 'a', ok: true }, { key: 'a', ok: true }] }, 'duplicate_check_key'],
    [{ ...base(), checks: Array.from({ length: MAX_CHECKS_PER_REPORT + 1 }, (_, i) => ({ key: `k${i}`, ok: true })) }, 'too_many_checks'],
  ];
  for (const [body, error] of cases) {
    assert.deepEqual(validateReport(body, NOW), { ok: false, error }, error);
  }
});

test('PC 시계가 조금(5분 이내) 빠른 것은 허용', () => {
  assert.equal(validateReport({ ...base(), observed_at: '2026-11-10T05:04:00Z' }, NOW).ok, true);
});

// ── 판정 ──

const tcp = { kind: 'tcp', maxResponseMs: 500, threshold: null };
const m = (o) => ({ ok: true, responseMs: null, value: null, ...o });

test('tcp/ping: 연결 실패는 각각 port_closed / unreachable, 기준 초과는 느림', () => {
  assert.equal(judgeAgentCheck(tcp, m({ ok: false })).failureReason, AGENT_FAILURE.PORT_CLOSED);
  assert.equal(judgeAgentCheck({ ...tcp, kind: 'ping' }, m({ ok: false })).failureReason, AGENT_FAILURE.UNREACHABLE);
  assert.deepEqual(
    [judgeAgentCheck(tcp, m({ responseMs: 501 })).isSlow, judgeAgentCheck(tcp, m({ responseMs: 500 })).isSlow],
    [true, false]
  );
});

test('disk: 사용률이 기준 이상이면 disk_full, 값을 못 읽으면 measure_error', () => {
  const disk = { kind: 'disk', maxResponseMs: 3000, threshold: 90 };
  assert.equal(judgeAgentCheck(disk, m({ value: 89.9 })).isSuccess, true);
  assert.equal(judgeAgentCheck(disk, m({ value: 90 })).failureReason, AGENT_FAILURE.DISK_FULL);
  assert.equal(judgeAgentCheck(disk, m({ ok: false })).failureReason, AGENT_FAILURE.MEASURE_ERROR);
  // 기준이 비어 있으면 기본값 90%
  assert.equal(judgeAgentCheck({ ...disk, threshold: null }, m({ value: 95 })).failureReason, AGENT_FAILURE.DISK_FULL);
});

test('ssl: 남은 일수가 기준 미만이면 ssl_expiring, 인증서를 못 읽으면 network_error', () => {
  const ssl = { kind: 'ssl', maxResponseMs: 3000, threshold: 14 };
  assert.equal(judgeAgentCheck(ssl, m({ value: 14 })).isSuccess, true);
  assert.equal(judgeAgentCheck(ssl, m({ value: 13 })).failureReason, AGENT_FAILURE.SSL_EXPIRING);
  assert.equal(judgeAgentCheck(ssl, m({ ok: false })).failureReason, 'network_error');
});

test('service: 실행 중이 아니면 service_stopped, 실패에는 느림이 붙지 않음', () => {
  const svc = { kind: 'service', maxResponseMs: 3000, threshold: null };
  const r = judgeAgentCheck(svc, m({ ok: false, responseMs: 99999 }));
  assert.equal(r.failureReason, AGENT_FAILURE.SERVICE_STOPPED);
  assert.equal(r.isSlow, false);
});

test('에이전트 대상이 아닌 종류(http)는 판정하지 않는다', () => {
  assert.throws(() => judgeAgentCheck({ kind: 'http' }, m({})));
});
