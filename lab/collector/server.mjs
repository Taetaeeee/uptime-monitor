import http from 'node:http';
import { readFile, writeFile, rename, appendFile, mkdir, stat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { resolveErp, probeHttp, probeTcp, getJson } from './probes.mjs';
import { rates, isFresh } from './model.mjs';
import { createWorkflowStore } from './workflow-store.mjs';
import { createWorkflowTools } from './workflow-tools.mjs';
import { createWorkflowApi } from './workflow-api.mjs';

const interval = Number(process.env.INTERVAL_MS ?? 15000);
if (!Number.isInteger(interval) || interval < 5000 || interval > 60000) throw new Error('수집 주기는 5~60초입니다.');
const dir = process.env.DATA_DIR ?? '/data';
await mkdir(dir, { recursive: true });
const workflowStore = await createWorkflowStore({ dir: `${dir}/workflows`, tools: createWorkflowTools() });
const workflowApi = createWorkflowApi(workflowStore);
const viewer = await readFile(new URL('./viewer.html', import.meta.url));
const agentAssets = new Map();
for (const [file, type] of [['rules.html', 'text/html'], ['rules.css', 'text/css'], ['rules.js', 'text/javascript']]) {
  agentAssets.set(`/${file}`, { data: await readFile(new URL(`../ui/${file}`, import.meta.url)), type });
}
const configHash = createHash('sha256').update(JSON.stringify({ interval, target: 'erp.lab.test', version: 1 })).digest('hex');
let latest = null;
let previousMetrics = null;
try { latest = JSON.parse(await readFile(`${dir}/latest.json`, 'utf8')); } catch { /* 첫 실행에는 기록이 없습니다. */ }

async function collect() {
  try {
    const dns = await resolveErp();
    const [httpProbe, tcp, live] = await Promise.all([
      probeHttp(dns.address), probeTcp(), getJson('erp', 8080, '/health/live'),
    ]);
    // 이번 업무 조회의 로그가 생성된 뒤 가져와 요청 ID로 근거를 대조할 수 있게 합니다.
    const evidence = await getJson('erp', 8080, '/internal/evidence');
    const metrics = evidence.ok ? evidence.body : null;
    const next = {
      schema_version: 1, collection_id: randomUUID(), source: 'real', environment: 'lab',
      vantage_id: 'lab-collector', config_hash: configHash, interval_ms: interval,
      received_at: new Date().toISOString(),
      probes: [dns.observation, httpProbe, tcp],
      process_live: { ok: live.ok && live.body?.ok === true, check: 'direct_container_process_only' },
      metrics: metrics ? { ...metrics, rates: rates(previousMetrics, metrics) } : null,
      collection_errors: evidence.ok ? [] : [{ channel: 'erp_metrics_and_logs', code: evidence.error_code ?? 'unavailable' }],
    };
    // 데이터는 로컬 전용 볼륨에 저장하고 이력은 최대 약 10MiB로 순환합니다.
    try {
      if ((await stat(`${dir}/history.jsonl`)).size > 5 * 1024 * 1024) await rename(`${dir}/history.jsonl`, `${dir}/history.previous.jsonl`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await appendFile(`${dir}/history.jsonl`, `${JSON.stringify(next)}\n`);
    await writeFile(`${dir}/latest.tmp`, JSON.stringify(next));
    await rename(`${dir}/latest.tmp`, `${dir}/latest.json`);
    latest = next;
    previousMetrics = metrics;
  } catch {
    console.error('실측 데이터 수집 또는 저장 실패. 이전 값을 최신으로 취급하지 않습니다.');
  } finally { setTimeout(collect, interval); }
}
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}
http.createServer(async (req, res) => {
  try {
    if (await workflowApi(req, res)) return;
  } catch { return json(res, 500, { error: 'workflow_unavailable' }); }
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  if (req.url === '/agents' || req.url === '/agents.html') { res.writeHead(302, { location: 'http://127.0.0.1:18912/agents.html', 'cache-control': 'no-store' }); return res.end(); }
  const asset = agentAssets.get(req.url === '/rules' ? '/rules.html' : req.url);
  if (asset) {
    res.writeHead(200, { 'content-type': `${asset.type}; charset=utf-8`, 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
    return res.end(asset.data);
  }
  if (req.url === '/api/snapshot') return json(res, latest ? 200 : 503,
    latest ? { ...latest, fresh: isFresh(latest) } : { error: 'waiting_for_first_observation' });
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
    return res.end(viewer);
  }
  json(res, 404, { error: 'not_found' });
}).listen(8081, '0.0.0.0', () => console.log('실습 실측 수집기 준비 완료'));
collect();
