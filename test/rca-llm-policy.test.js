import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlmPolicy, RCA_TOOLS } from '../rca/policies/llm-policy.js';
import { createOpenAiTransport } from '../rca/adapters/openai-responses.js';
import { createCallBudget, HARD_LIMITS } from '../rca/lib/budget.js';

const call = (name, args = {}, id = 'c1') => ({ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id });
test('실제 도구 반환 규격·reasoning 항목을 다음 Responses 입력에 보존한다', async () => {
  const seen = [];
  const policy = createLlmPolicy({ context: { target_alias: 'test' }, transport: async p => {
    seen.push(structuredClone(p.input));
    return { output: seen.length === 1 ? [{ type: 'reasoning', id: 'r1', encrypted_content: 'private' }, call('http_probe')] : [call('dns_lookup', {}, 'c2')] };
  } });
  assert.equal((await policy.next({ results: [] }))[0].name, 'http_probe');
  await policy.next({ results: [{ ok: true, evidence: [] }] });
  assert.ok(seen[1].some(o => o.type === 'reasoning' && o.encrypted_content === 'private'));
  assert.deepEqual(seen[1].at(-1), { type: 'function_call_output', call_id: 'c1', output: '{"ok":true,"evidence":[]}' });
});
test('도구 스키마는 strict이고 모든 object 필드가 required다', () => {
  function check(s) { if (s.type === 'object') { assert.equal(s.additionalProperties, false); assert.deepEqual(s.required, Object.keys(s.properties)); Object.values(s.properties).forEach(check); } if (s.items) check(s.items); }
  for (const t of RCA_TOOLS) { assert.equal(t.strict, true); check(t.parameters); }
});
test('모델이 도구 없이 텍스트만 반환하면 완료로 처리하지 않는다', async () => {
  const policy = createLlmPolicy({ context: {}, transport: async () => ({ output: [{ type: 'message', content: [] }] }) });
  await assert.rejects(policy.next({ results: [] }), /invalid_model_calls/);
});
test('외부 모델 요청의 endpoint 고정·store false·최대 출력·인증 범위를 확인한다', async () => {
  const budget = createCallBudget({ limits: HARD_LIMITS, prices: { input: 1, output: 2 } });
  let sent;
  const transport = createOpenAiTransport({ apiKey: 'test-only-key', model: 'test-model', budget, limits: HARD_LIMITS,
    fetchFn: async (url, options) => { sent = { url, options }; return Response.json({ status: 'completed', usage: { input_tokens: 100, output_tokens: 10 }, output: [call('http_probe')] }); } });
  await transport({ input: [], tools: RCA_TOOLS });
  assert.equal(sent.url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(sent.options.body);
  assert.equal(body.store, false); assert.equal(body.max_output_tokens, HARD_LIMITS.outputTokens);
  assert.ok(!JSON.stringify(body).includes('test-only-key'));
  assert.equal(budget.snapshot().spent_micros, 120);
});
test('공급자 오류문은 노출하지 않고 불확정 사용량을 유지한다', async () => {
  const budget = createCallBudget({ limits: HARD_LIMITS, prices: { input: 1, output: 2 } });
  let count = 0;
  const transport = createOpenAiTransport({ apiKey: 'k', model: 'm', budget, limits: HARD_LIMITS,
    fetchFn: async () => { count++; return new Response('secret raw error', { status: 500 }); } });
  await assert.rejects(transport({ input: [], tools: [] }), /^Error: provider_error$/);
  assert.equal(count, 1); assert.equal(budget.snapshot().usage_uncertain, true);
});
