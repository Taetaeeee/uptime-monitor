import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAsyncInvestigation } from '../rca/async-runner.js';
import { HARD_LIMITS } from '../rca/lib/budget.js';
import { createLlmPolicy } from '../rca/policies/llm-policy.js';
import { validateModelReport } from '../rca/lib/report-v2.js';
import { createLiveAdapter } from '../rca/adapters/live.js';
const obs = { channel: 'http', observed_at: 600, provenance: 'synthetic', observation_kind: 'fixture_observation', facts: { outcome: 'status_mismatch', status_code: 500 } };
function report(id = 'r-e1') { return { outcome: 'candidate', summary: 'HTTP 오류가 관측되었습니다. 내부 원인은 미확정입니다.',
  hypotheses: [{ target_alias: 't', hypothesis: '서버 응답 오류 후보', evidence_ids: [id] }],
  citations: [{ evidence_id: id, observed_at: 600, fact_key: 'status_code', value: '500' }], unknowns: ['내부 로그 없음'], next_actions: ['운영자가 내부 로그 확인'] }; }
function setup(policy, call = async () => ({ ok: true, evidence: [obs] })) { return { runId: 'r', mode: 'synthetic', limits: HARD_LIMITS, policy, adapter: { context: { target_alias: 't' }, call } }; }

test('모델 선택→도구→반환된 근거로 모델 재판단→모델 보고 (규칙 보고로 덮지 않음)', async () => {
  let rounds = 0, tools = 0;
  const events = [];
  const policy = createLlmPolicy({ context: { target_alias: 't' }, transport: async ({ input }) => {
    rounds++;
    if (rounds === 2) assert.ok(input.at(-1).output.includes('r-e1'));
    return { output: [{ type: 'function_call', call_id: `c${rounds}`, name: rounds === 1 ? 'http_probe' : 'finish_report', arguments: JSON.stringify(rounds === 1 ? {} : report()) }] };
  } });
  const r = await runAsyncInvestigation({ ...setup(policy, async () => { tools++; return { ok: true, evidence: [obs] }; }), onEvent: e => events.push(e) });
  assert.equal(r.run_status, 'completed'); assert.equal(r.cause_outcome, 'candidate');
  assert.equal(r.model_report.hypotheses[0].certainty, 'unconfirmed'); assert.equal(tools, 1); assert.equal(rounds, 2);
  assert.ok(!JSON.stringify(events).includes('HTTP 오류가'));
});
test('모델이 요청하지 않으면 관측 도구를 미리 실행하지 않는다', async () => {
  let tools = 0;
  const r = await runAsyncInvestigation(setup({ next: async () => [{ name: 'finish_report', args: report() }] }, async () => { tools++; }));
  assert.equal(tools, 0); assert.equal(r.run_status, 'failed');
});
test('시각·수치·증거 id를 장부와 대조한다', () => {
  const ledger = [{ ...obs, evidence_id: 'r-e1' }];
  for (const replacement of [{ evidence_id: 'unknown' }, { observed_at: 601 }, { value: '200' }, { fact_key: 'invented' }]) {
    const r = report(); Object.assign(r.citations[0], replacement);
    assert.throws(() => validateModelReport(r, ledger, 't'), /invalid_evidence_reference/);
  }
  const r = report(); r.hypotheses[0].target_alias = 'other';
  assert.throws(() => validateModelReport(r, ledger, 't'), /unsupported_hypothesis/);
});
test('실패 관측을 정상 완료로 내지 않는다', () => {
  const r = report(); r.outcome = 'no_anomaly_observed'; r.hypotheses = [];
  assert.throws(() => validateModelReport(r, [{ ...obs, evidence_id: 'r-e1' }], 't'), /unsupported_outcome/);
});
test('추가관측 한도·모델 단계 한도는 incomplete로 끝난다', async () => {
  const r = await runAsyncInvestigation(setup({ next: async () => [{ name: 'request_additional_observation', args: { channel: 'http' } }] }));
  assert.equal(r.error_code, 'additional_limit'); assert.equal(r.run_status, 'incomplete');
  const s = await runAsyncInvestigation({ ...setup({ next: async () => [{ name: 'http_probe', args: {} }] }), limits: { ...HARD_LIMITS, steps: 1 } });
  assert.equal(s.error_code, 'step_limit');
});
test('취소 상태에서는 모델/도구를 실행하지 않는다', async () => {
  let called = false;
  const r = await runAsyncInvestigation({ ...setup({ next: async () => { called = true; } }), isCancelled: async () => true });
  assert.equal(called, false); assert.equal(r.llm_executed, false); assert.equal(r.error_code, 'cancelled');
});
test('라이브 기본 probe 8회가 추가 관측 한도를 우회해 새 측정 8회를 만들지 않는다', async () => {
  let measurements = 0, rounds = 0;
  const adapter = createLiveAdapter({ target: { alias: 't', host: 'owned.example', http: { url: 'https://owned.example/health', expected_status: 200 } },
    history: async () => [], now: () => 600000, fetchFn: async () => { measurements++; return new Response('', { status: 200 }); } });
  const policy = { next: async () => {
    if (++rounds <= 2) return Array.from({ length: 4 }, () => ({ name: 'http_probe', args: {} }));
    return [{ name: 'finish_report', args: { outcome: 'deferred', summary: '내부 원인을 알 수 없습니다.', hypotheses: [],
      citations: [{ evidence_id: 'r-e1', observed_at: 600, fact_key: 'status_code', value: '200' }], unknowns: ['내부 지표 없음'], next_actions: ['내부 로그 확인'] } }];
  } };
  const r = await runAsyncInvestigation({ runId: 'r', mode: 'live', adapter, policy, limits: HARD_LIMITS });
  assert.equal(r.run_status, 'completed'); assert.equal(r.tool_calls, 8); assert.equal(measurements, 1); assert.equal(r.observations.length, 1);
});
test('라이브 최초 probe 뒤 세 번째 새 관측 요청은 측정 전에 차단한다', async () => {
  let measurements = 0, rounds = 0;
  const adapter = createLiveAdapter({ target: { alias: 't', host: 'owned.example', http: { url: 'https://owned.example/health', expected_status: 200 } },
    history: async () => [], now: () => 600000, fetchFn: async () => { measurements++; return new Response('', { status: 200 }); } });
  const policy = { next: async () => [{ name: ++rounds === 1 ? 'http_probe' : 'request_additional_observation', args: rounds === 1 ? {} : { channel: 'http' } }] };
  const r = await runAsyncInvestigation({ runId: 'r', mode: 'live', adapter, policy, limits: HARD_LIMITS });
  assert.equal(r.run_status, 'incomplete'); assert.equal(r.error_code, 'additional_limit'); assert.equal(measurements, 3);
});
