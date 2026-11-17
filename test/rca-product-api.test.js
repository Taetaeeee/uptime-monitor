import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './helpers/fake-d1.js';
import { handleRca } from '../src/rca-api.js';
import worker from '../src/index.js';
import cases from '../rca/data/demo-cases.json' with { type: 'json' };
import { requestCancel } from '../src/rca-store.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { setImmediate as nextTurn } from 'node:timers/promises';

export function testEnv() { return { DB: createFakeD1(), OPENAI_API_KEY: 'transport-double-not-real', RCA_OPERATOR_TOKEN: 'operator-test-only', RCA_MODEL: 'test-model',
  RCA_INPUT_USD_PER_MILLION: '1', RCA_OUTPUT_USD_PER_MILLION: '2', RCA_DAILY_USD_LIMIT: '5', RCA_RUN_USD_LIMIT: '1' }; }
function request(body, token = 'operator-test-only', key = 'idempotency-test-0001') {
  return new Request('https://local.example/api/rca/analyze', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': key }, body: JSON.stringify(body) });
}
function modelReply(name, args, callId) { return Response.json({ status: 'completed', output: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: callId }], usage: { input_tokens: 100, output_tokens: 100 } }); }

test('키 없음·마이그레이션 없음 상태에서 통신 없이 명확한 준비 상태 응답', async () => {
  const env = { DB: createFakeD1() }; let sent = 0;
  const cap = await (await handleRca(new Request('https://local.example/api/rca/capabilities'), env)).json();
  assert.equal(cap.ready, false); assert.equal(cap.cases.length, 6); assert.ok(cap.missing.includes('OPENAI_API_KEY'));
  const response = await handleRca(request({ mode: 'synthetic', case_id: cases[0].case_id }), env, { fetchFn: async () => { sent++; } });
  assert.equal(response.status, 503); assert.equal(sent, 0);
  env.DB.sqlite.exec('DROP TABLE rca_runs');
  assert.equal((await (await handleRca(new Request('https://local.example/api/rca/capabilities'), env)).json()).storage_ready, false);
});
test('분석 유료 실행 인증·출처 검증·임의 대상 거부', async () => {
  const env = testEnv();
  assert.equal((await handleRca(request({ mode: 'synthetic', case_id: cases[0].case_id }, 'wrong'), env)).status, 401);
  assert.equal((await handleRca(request({ mode: 'live', monitor_id: 999 }), env)).status, 400);
  assert.equal((await handleRca(request({ mode: 'synthetic', case_id: cases[0].case_id, url: 'https://other.example' }), env)).status, 400);
  const crossOrigin = request({ mode: 'synthetic', case_id: cases[0].case_id }); crossOrigin.headers.set('origin', 'https://other.example');
  assert.equal((await handleRca(crossOrigin, env)).status, 403);
});
test('실제 API 라우팅→두 모델 턴→도구→저장→공개 보고가 연결되고 운영 DB는 불변', async () => {
  const env = testEnv();
  const before = JSON.stringify(env.DB.sqlite.prepare('SELECT * FROM check_results').all());
  let rounds = 0;
  const response = await handleRca(request({ mode: 'synthetic', case_id: cases[0].case_id }), env, { fetchFn: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); rounds++;
    const input = JSON.parse(options.body).input;
    if (rounds === 1) { assert.ok(!JSON.stringify(input).includes('observations')); return modelReply('http_probe', {}, 'c1'); }
    const ev = JSON.parse(input.at(-1).output).evidence[0];
    return modelReply('finish_report', { outcome: 'deferred', summary: '추가 정보가 필요합니다.', hypotheses: [],
      citations: [{ evidence_id: ev.evidence_id, observed_at: ev.observed_at, fact_key: 'outcome', value: ev.facts.outcome }], unknowns: ['내부 로그 미제공'], next_actions: ['로그 확인'] }, 'c2');
  } });
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  const report = events.at(-1).report;
  assert.equal(report.run_status, 'completed'); assert.equal(report.cause_outcome, 'deferred'); assert.equal(rounds, 2);
  assert.equal(report.observations.length, 2); assert.equal(report.usage.calls, 2);
  assert.equal(JSON.stringify(env.DB.sqlite.prepare('SELECT * FROM check_results').all()), before);
  const read = await handleRca(new Request(`https://local.example/api/rca/reports/${report.run_id}`), env);
  assert.equal((await read.json()).report.run_id, report.run_id);
  const duplicate = await handleRca(request({ mode: 'synthetic', case_id: cases[0].case_id }), env);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM rca_runs').get().n, 1);
});
test('진행 중 취소 요청은 후속 모델·도구 호출을 막고 불확정 사용량을 보존', async () => {
  const env = testEnv(); let rounds = 0;
  const response = await handleRca(request({ mode: 'synthetic', case_id: cases[0].case_id }), env, { fetchFn: async () => {
    rounds++;
    const id = env.DB.sqlite.prepare('SELECT id FROM rca_runs').get().id;
    await requestCancel(env.DB, id);
    throw new Error('lost connection with secret');
  } });
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(rounds, 1); assert.equal(events.at(-1).report.usage.usage_uncertain, true);
  assert.equal(env.DB.sqlite.prepare('SELECT spent_micros,reserved_micros FROM rca_budget').get().reserved_micros, 0);
  assert.ok(!JSON.stringify(events).includes('secret'));
});
test('상위 Worker의 기존 상태 API 경로와 RCA 준비 상태가 함께 동작', async () => {
  const env = { DB: createFakeD1() };
  const rca = await worker.fetch(new Request('https://local.example/api/rca/capabilities'), env);
  assert.equal(rca.status, 200); assert.equal((await rca.json()).ready, false);
  const status = await worker.fetch(new Request('https://local.example/api/status'), env);
  assert.equal(status.status, 200); assert.ok(Array.isArray((await status.json()).services));
});
test('취소 endpoint가 응답하지 않아도 화면 스크립트는 분석 연결을 먼저 끊고 캡처한 토큰으로 제한 시간 요청한다', async () => {
  // 브라우저 조작 검증이 아니다. 실제 public 스크립트의 이벤트 흐름만 격리된 DOM 대역에서 실행한다.
  const nodes = new Map();
  function node(id = '') {
    return { id, value: '', children: [], handlers: {}, textContent: '',
      addEventListener(type, handler) { this.handlers[type] = handler; },
      setAttribute() {}, focus() {}, replaceChildren(...children) { this.children = children; },
      append(...children) { this.children.push(...children); if (id === 'rca-target' && !this.value) this.value = children[0]?.value ?? ''; },
      get options() { return this.children; }, get firstChild() { return this.children[0]; },
    };
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); };
  const timeout = new AbortController();
  const order = [];
  let analysisSignal, cancelRequest, timeoutMs;
  const fakeFetch = async (url, options = {}) => {
    if (url.endsWith('capabilities')) return Response.json({ ready: true, targets: [], cases: [{ id: cases[0].case_id, label: 'test' }] });
    if (url.endsWith('analyze')) {
      analysisSignal = options.signal;
      return new Response(new ReadableStream({ start(stream) {
        stream.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'started', run_id: 'rca-00000000-0000-0000-0000-000000000001', message: 'test' }) + '\n'));
        options.signal.addEventListener('abort', () => { order.push('analysis_abort'); stream.error(new DOMException('aborted', 'AbortError')); }, { once: true });
      } }));
    }
    if (url.includes('/cancel/')) {
      order.push('cancel_fetch'); cancelRequest = options;
      assert.equal(analysisSignal.aborted, true);
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancel_timeout')), { once: true }));
    }
    throw new Error('unexpected test request');
  };
  const context = { document: { getElementById: get, createElement: () => node(), documentElement: { dataset: {} },
    querySelector: () => ({ value: 'synthetic' }), querySelectorAll: () => [] },
    location: { search: '' }, localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {},
    fetch: fakeFetch, AbortController, AbortSignal: { timeout(ms) { timeoutMs = ms; return timeout.signal; } },
    URLSearchParams, TextDecoder, crypto };
  runInNewContext(readFileSync(new URL('../public/rca.js', import.meta.url), 'utf8'), context);
  await nextTurn();
  get('rca-token').value = 'captured-test-token';
  const submit = get('rca-form').handlers.submit({ preventDefault() {} });
  await nextTurn();
  get('rca-cancel').handlers.click();
  assert.equal(analysisSignal.aborted, true);
  assert.deepEqual(order, ['analysis_abort', 'cancel_fetch']);
  assert.equal(timeoutMs, 3000);
  await submit;
  assert.equal(get('rca-token').value, '');
  assert.equal(cancelRequest.headers.Authorization, 'Bearer captured-test-token');
  timeout.abort();
  await nextTurn();
});
