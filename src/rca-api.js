import demoCases from '../rca/data/demo-cases.json' with { type: 'json' };
import { createSyntheticTools } from '../rca/tools/synthetic-tools.js';
import { createSyntheticAdapter, createLiveAdapter } from '../rca/adapters/live.js';
import { createOpenAiTransport, readBoundedJson } from '../rca/adapters/openai-responses.js';
import { createLlmPolicy } from '../rca/policies/llm-policy.js';
import { runAsyncInvestigation } from '../rca/async-runner.js';
import { createCallBudget, readRcaConfig } from '../rca/lib/budget.js';
import { checkBearer } from './auth.js';
import { listRcaTargets, createHistoryReader } from './rca-context.js';
import { rcaStoreReady, reserveRun, settleRun, getRun, requestCancel, wasCancelled } from './rca-store.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const RUN = /^rca-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export async function handleRca(request, env, deps = {}) {
  const url = new URL(request.url);
  const config = readRcaConfig(env);
  const now = deps.now ?? (() => Date.now());
  const fetchFn = deps.fetchFn ?? fetch;
  if (url.pathname === '/api/rca/capabilities' && request.method === 'GET') {
    const storeReady = await rcaStoreReady(env.DB);
    let targets = [];
    try { targets = (await listRcaTargets(env.DB, env)).map(t => ({ id: t.id, alias: t.alias, channels: t.dns ? ['http', 'doh'] : ['http'] })); } catch { /* 준비 상태만 보고 */ }
    return json({ ready: config.ready && storeReady, model_configured: config.ready, storage_ready: storeReady,
      missing: config.missing, targets, cases: demoCases.map((c, i) => ({ id: c.case_id, label: `합성 사례 ${i + 1}` })),
      limits: config.limits, notice: 'RCAEval은 별도 오프라인 평가입니다. 이 페이지의 합성·실제 관측과 사건을 합치지 않습니다.' });
  }
  const parts = url.pathname.split('/');
  if (parts[3] === 'reports' && parts.length === 5 && RUN.test(parts[4]) && request.method === 'GET') {
    if (!await rcaStoreReady(env.DB)) return json({ error: 'storage_not_ready' }, 503);
    const row = await getRun(env.DB, parts[4]);
    return row ? json({ run_id: row.id, status: row.status, report: row.report_json ? JSON.parse(row.report_json) : null }) : json({ error: 'not_found' }, 404);
  }
  if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return json({ error: 'forbidden_origin' }, 403);
  const auth = await checkBearer(request, env.RCA_OPERATOR_TOKEN);
  if (auth !== 'ok') return json({ error: auth === 'disabled' ? 'operator_not_configured' : 'unauthorized' }, auth === 'disabled' ? 503 : 401);
  if (!await rcaStoreReady(env.DB)) return json({ error: 'storage_not_ready' }, 503);
  if (parts[3] === 'cancel' && parts.length === 5 && RUN.test(parts[4])) {
    return json({ accepted: await requestCancel(env.DB, parts[4]), notice: '추가 호출을 중단합니다. 이미 진행된 제공자 처리·과금 중단은 보장하지 않습니다.' });
  }
  if (url.pathname !== '/api/rca/analyze') return json({ error: 'not_found' }, 404);
  if (!config.ready) return json({ error: 'model_not_configured', missing: config.missing }, 503);
  let body;
  try { body = await readBoundedJson(request, 4096); } catch { return json({ error: 'invalid_request' }, 400); }
  if (!body || Object.keys(body).some(k => !['mode', 'case_id', 'monitor_id'].includes(k)) || !['live', 'synthetic'].includes(body.mode)) return json({ error: 'invalid_request' }, 400);
  const key = request.headers.get('idempotency-key');
  if (!key || !/^[a-zA-Z0-9_-]{16,80}$/.test(key)) return json({ error: 'idempotency_key_required' }, 400);
  const runId = `rca-${crypto.randomUUID()}`;
  let adapter;
  if (body.mode === 'synthetic') {
    const data = demoCases.find(c => c.case_id === body.case_id);
    if (!data || body.monitor_id !== undefined) return json({ error: 'invalid_case' }, 400);
    adapter = createSyntheticAdapter({ tools: createSyntheticTools({ caseData: data, runId: 'run-00000000' }),
      context: { target_alias: data.target_alias, mode: 'synthetic', channels: ['http', 'doh'], time_basis: 'relative seconds',
        notice: '별도 합성 DNS/HTTP 관측. 실제 서비스나 RCAEval의 사건이 아님.' } });
  } else {
    if (!Number.isSafeInteger(body.monitor_id) || body.case_id !== undefined) return json({ error: 'invalid_target' }, 400);
    const target = (await listRcaTargets(env.DB, env)).find(t => t.id === body.monitor_id);
    if (!target) return json({ error: 'target_not_allowed' }, 400);
    adapter = createLiveAdapter({ target, history: createHistoryReader(env.DB, target, now), fetchFn, now });
  }
  const timestamp = now();
  const reservation = await reserveRun(env.DB, { id: runId, key, day: new Date(timestamp).toISOString().slice(0, 10), now: timestamp, config });
  if (!reservation.accepted) return json(reservation, reservation.duplicate ? 200 : 429);
  const cancellation = new AbortController();
  const signal = AbortSignal.any([request.signal, cancellation.signal, AbortSignal.timeout(config.limits.elapsedMs)]);
  const budget = createCallBudget(config);
  const transport = createOpenAiTransport({ apiKey: env.OPENAI_API_KEY, model: config.model, limits: config.limits, budget, fetchFn });
  const policy = createLlmPolicy({ transport, context: adapter.context });
  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream({
    start(controller) {
      const emit = event => { if (open) { try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); } catch { open = false; cancellation.abort(); } } };
      emit({ type: 'started', run_id: runId, mode: body.mode, message: '분석을 시작했습니다. 이 연결 동안 한도 내에서 진행합니다.' });
      void (async () => {
        try {
          const report = await runAsyncInvestigation({ runId, mode: body.mode, adapter, policy, limits: config.limits,
            signal, isCancelled: () => wasCancelled(env.DB, runId), onEvent: emit });
          report.usage = budget.snapshot();
          // API 키/공급자 원문/추론 전문은 저장하거나 전송하지 않는다.
          await settleRun(env.DB, runId, report, report.usage);
          emit({ type: 'report', report });
        } catch {
          // Worker 중단 시 미정산 예약은 다음 인증된 실행에서 보수적으로 전액 정산한다.
          emit({ type: 'error', error: 'storage_or_execution_error', run_id: runId });
        } finally { if (open) { open = false; controller.close(); } }
      })();
    },
    cancel() { open = false; cancellation.abort(); },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
