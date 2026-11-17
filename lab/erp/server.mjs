import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { collectMetrics } from './metrics.mjs';

const password = (await readFile(process.env.DB_PASSWORD_FILE, 'utf8')).trim();
const pool = new pg.Pool({ password, max: 3, connectionTimeoutMillis: 2000,
  idleTimeoutMillis: 3000, query_timeout: 2000, statement_timeout: 2000 });
const logs = [];
const instanceId = randomUUID();
pool.on('error', () => {}); // 다음 실제 조회에서 고정 오류 코드로 보고합니다.
function event(requestId, status, code, ms) {
  // URL·SQL·사용자 내용·DB 주소·예외 원문은 저장하지 않습니다.
  const row = { id: randomUUID(), observed_at: new Date().toISOString(),
    request_id: requestId, event: 'erp_orders_read', status, code, duration_ms: ms };
  logs.push(row);
  if (logs.length > 100) logs.shift();
  console.log(JSON.stringify(row));
}
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
http.createServer(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  if (req.url === '/health/live') return send(res, 200, { ok: true, scope: 'process_only' });
  if (req.url === '/internal/evidence') {
    return send(res, 200, { source: 'real', environment: 'lab', service_id: 'erp', instance_id: instanceId,
      observed_at: new Date().toISOString(), metrics: await collectMetrics(), logs: logs.slice(-30) });
  }
  if (req.url === '/api/orders') {
    const started = performance.now();
    const requestId = randomUUID();
    try {
      const result = await pool.query('SELECT id, title, status FROM orders ORDER BY id LIMIT 10');
      event(requestId, 200, 'ok', Math.round(performance.now() - started));
      return send(res, 200, { ok: true, data_kind: 'fictional_business_records', request_id: requestId, orders: result.rows });
    } catch (e) {
      const code = ['53300', '57P01', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(e.code) ? e.code : 'db_unavailable';
      event(requestId, 503, code, Math.round(performance.now() - started));
      return send(res, 503, { ok: false, code, request_id: requestId });
    }
  }
  send(res, 404, { error: 'not_found' });
}).listen(8080, '0.0.0.0', () => console.log('ERP 실습 API 준비 완료'));
process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });
