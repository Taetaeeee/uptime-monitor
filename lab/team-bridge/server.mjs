import http from 'node:http';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createPaseoCli } from './paseo-cli.mjs';
import { createTeamService } from './service.mjs';
import { loadConfig } from './config.mjs';

export const DEFAULT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export function createHandler({ service, assets, csrf = randomBytes(32).toString('hex') }) {
  const send = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); };
  const matches = (a, b) => { const x = Buffer.from(String(a ?? '')); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
  return async (req, res) => {
    try {
      const host = req.headers.host ?? '';
      if (!/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host)) return send(res, 403, { error: 'local_host_required' });
      if (req.headers.origin && req.headers.origin !== `http://${host}` || req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: 'forbidden_origin' });
      if (req.method === 'GET') {
        const asset = assets.get(req.url === '/' ? '/agents.html' : req.url);
        if (asset) {
          res.writeHead(200, { 'content-type': `${asset.type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
          return res.end(asset.data);
        }
        if (req.url === '/api/teams') return send(res, 200, { ...service.snapshot(), csrf_token: csrf, executor: 'paseo', policy: 'read_only_plan', restriction: 'prompt_only' });
        if (req.url === '/api/team-tasks') return send(res, 200, { tasks: service.list() });
        if (/^\/api\/team-tasks\/task-[a-f0-9-]{36}$/.test(req.url)) {
          const task = service.get(req.url.split('/').at(-1)); return send(res, task ? 200 : 404, task ?? { error: 'not_found' });
        }
        return send(res, 404, { error: 'not_found' });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
      const report = /^\/api\/team-tasks\/(task-[a-f0-9-]{36})\/events$/.exec(req.url);
      if (!report && !matches(req.headers['x-team-token'], csrf)) return send(res, 401, { error: 'session_required' });
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'json_required' });
      const chunks = []; let size = 0;
      const body = await new Promise((accept, reject) => {
        const timer = setTimeout(() => reject(new Error('body_timeout')), 4000);
        req.on('data', chunk => { size += chunk.length; if (size > 24000) { clearTimeout(timer); reject(new Error('payload_too_large')); } else chunks.push(chunk); });
        req.on('error', () => { clearTimeout(timer); reject(new Error('invalid_request')); });
        req.on('end', () => { clearTimeout(timer); try { accept(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('invalid_request')); } });
      });
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('invalid_request');
      if (report) return send(res, 200, await service.report(report[1], req.headers['x-report-token'], body));
      if (req.url === '/api/team-tasks') {
        if (Object.keys(body).some(k => !['team_id', 'question'].includes(k))) throw new Error('invalid_request');
        const result = await service.start(body, req.headers['idempotency-key']); return send(res, result.duplicate ? 200 : 202, result);
      }
      const close = /^\/api\/team-tasks\/(task-[a-f0-9-]{36})\/close$/.exec(req.url);
      if (close) { if (Object.keys(body).length) throw new Error('invalid_request'); return send(res, 200, await service.close(close[1])); }
      send(res, 404, { error: 'not_found' });
    } catch (error) {
      const code = error.message;
      const status = ['team_not_idle', 'task_in_progress', 'idempotency_conflict', 'task_closed'].includes(code) ? 409 : code === 'report_unauthorized' ? 401 : code === 'not_found' ? 404 : ['task_capacity', 'event_capacity'].includes(code) ? 429 : ['invalid_request', 'invalid_report', 'invalid_idempotency_key', 'leader_result_required'].includes(code) ? 400 : code === 'payload_too_large' ? 413 : code === 'body_timeout' ? 408 : 503;
      send(res, status, { error: status === 503 ? 'bridge_unavailable' : code });
    }
  };
}
export async function startServer() {
  const dir = resolve(DEFAULT_ROOT, 'lab/.runtime/team-bridge');
  await mkdir(dir, { recursive: true });
  const port = Number(process.env.TEAM_BRIDGE_PORT ?? 18912);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_port');
  const config = await loadConfig(resolve(dir, 'bindings.json'));
  const cli = createPaseoCli({ cwd: DEFAULT_ROOT });
  const service = await createTeamService({ config, dir, cli, projectRoot: DEFAULT_ROOT });
  const assets = new Map();
  for (const [name, type] of [['agents.html', 'text/html'], ['agents.css', 'text/css'], ['agents.js', 'text/javascript']]) {
    assets.set(`/${name}`, { data: await readFile(resolve(DEFAULT_ROOT, 'public', name)), type });
  }
  const server = http.createServer(createHandler({ service, assets }));
  // 중복 실행 시 기존 인스턴스를 바꾸지 않고 bind 실패로 끝냅니다.
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
  await writeFile(resolve(dir, 'endpoint.json'), JSON.stringify({ url: `http://127.0.0.1:${port}`, pid: process.pid }), { mode: 0o600 });
  await service.refresh();
  let busy = false;
  const timer = setInterval(async () => { if (busy) return; busy = true; try { await service.refresh(); } catch { /* 다음 주기에 다시 조회합니다. */ } finally { busy = false; } }, 10000);
  const stop = () => { clearInterval(timer); server.close(() => process.exit(0)); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  console.log(`실제 팀 화면: http://127.0.0.1:${port}/agents.html`);
  return { server, service, timer };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer().catch(() => { console.error('팀 브리지 시작 실패: Paseo CLI·bindings.json·포트 상태를 확인하세요.'); process.exitCode = 1; });
