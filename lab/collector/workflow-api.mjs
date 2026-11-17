import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ROLES } from './workflow.mjs';
import { RUN_ID } from './workflow-store.mjs';

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0, done = false;
    const chunks = [];
    const timer = setTimeout(() => finish(new Error('invalid_request')), 5000);
    function finish(error, value) {
      if (done) return; done = true; clearTimeout(timer);
      error ? reject(error) : resolve(value);
    }
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 4096) return finish(new Error('payload_too_large'));
      if (!done) chunks.push(chunk);
    });
    req.on('end', () => {
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(new Error('invalid_request')); }
    });
    req.on('error', () => finish(new Error('invalid_request')));
  });
}
export function createWorkflowApi(store) {
  const token = randomBytes(24).toString('hex');
  return async function handleWorkflow(req, res) {
    if (!req.url.startsWith('/api/workflows')) return false;
    function send(status, body) {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify(body)); return true;
    }
    const host = req.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host)) return send(403, { error: 'local_host_required' });
    if (req.method === 'GET' && req.url === '/api/workflows/capabilities') return send(200, {
      ready: true, executor: 'rules', llm_configured: false, environment: 'lab', target_id: 'erp', csrf_token: token,
      roles: ROLES, limits: { concurrent: 1, retained_runs: 20, additional: 1, elapsed_seconds: 30 },
      notice: '실제 내부 검사를 정해진 규칙으로 연결합니다. LLM은 미연결이며 질문은 ERP 증상 설명으로만 기록됩니다.',
    });
    if (req.method === 'GET' && req.url === '/api/workflows/runs') return send(200, { runs: store.list() });
    const match = /^\/api\/workflows\/runs\/(wf-[a-f0-9-]{36})(\/cancel)?$/.exec(req.url);
    if (req.method === 'GET' && match && !match[2]) {
      const run = store.get(match[1]); return send(run ? 200 : 404, run ?? { error: 'not_found' });
    }
    if (req.method !== 'POST') return send(404, { error: 'not_found' });
    if (req.headers.origin && req.headers.origin !== `http://${host}` || req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'forbidden_origin' });
    const given = Buffer.from(String(req.headers['x-workflow-token'] ?? ''));
    const expected = Buffer.from(token);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return send(401, { error: 'session_required' });
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return send(415, { error: 'json_required' });
    try {
      const body = await readJson(req);
      if (!body || Array.isArray(body) || typeof body !== 'object') return send(400, { error: 'invalid_request' });
      if (match?.[2] && RUN_ID.test(match[1])) {
        if (Object.keys(body).length) return send(400, { error: 'invalid_request' });
        return send(200, { accepted: await store.cancel(match[1]) });
      }
      if (req.url !== '/api/workflows/runs') return send(404, { error: 'not_found' });
      if (Object.keys(body).some(key => !['question', 'target_id'].includes(key)) || body.target_id !== 'erp' || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 600) return send(400, { error: 'invalid_request' });
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(key)) return send(400, { error: 'idempotency_key_required' });
      const result = await store.start(body.question, key);
      return send(result.duplicate ? 200 : 202, result);
    } catch (error) {
      const code = ['already_running', 'idempotency_conflict'].includes(error.message) ? 409 : error.message === 'payload_too_large' ? 413 : error.message === 'invalid_request' ? 400 : 500;
      return send(code, { error: code === 500 ? 'workflow_storage_or_execution_error' : error.message });
    }
  };
}
