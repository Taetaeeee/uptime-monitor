import http from 'node:http';
import net from 'node:net';
import { lookup, Resolver } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';

const errors = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEOUT', 'ETIMEDOUT', 'EAI_AGAIN', 'ENODATA', 'ESERVFAIL']);
export function safeError(error) { return errors.has(error?.code) ? error.code : 'probe_failed'; }
function wrap(channel, facts, started) {
  return { id: randomUUID(), source: 'real', environment: 'lab', vantage_id: 'lab-collector',
    service_id: 'erp', channel, observed_at: new Date(started).toISOString(),
    received_at: new Date().toISOString(), ...facts };
}
export async function resolveErp() {
  const started = Date.now();
  try {
    const server = await lookup('dns');
    const resolver = new Resolver({ timeout: 1500, tries: 1 });
    resolver.setServers([server.address]);
    const rows = await resolver.resolve4('erp.lab.test');
    return { observation: wrap('dns', { ok: rows.length > 0, answer_count: rows.length,
      resolver_id: 'lab-coredns', duration_ms: Date.now() - started }, started), address: rows[0] };
  } catch (e) {
    return { observation: wrap('dns', { ok: false, error_code: safeError(e), resolver_id: 'lab-coredns' }, started), address: null };
  }
}
export function getJson(host, port, path, address) {
  // 호출자는 고정한 내부 대상뿐입니다. 임의 URL·리다이렉트·본문 로깅은 없습니다.
  return new Promise(resolve => {
    const started = Date.now();
    const options = { hostname: host, port, path, method: 'GET', agent: false, family: 4 };
    if (address) options.lookup = (_hostname, _options, callback) => callback(null, address, 4);
    const req = http.request(options, res => {
      let bytes = 0;
      const chunks = [];
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 65536) req.destroy(Object.assign(new Error(), { code: 'response_too_large' }));
        else chunks.push(chunk);
      });
      res.on('error', () => resolve({ ok: false, error_code: 'response_failed' }));
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve({ ok: res.statusCode === 200, status: res.statusCode,
            duration_ms: Date.now() - started, body });
        } catch { resolve({ ok: false, status: res.statusCode, error_code: 'invalid_response' }); }
      });
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error(), { code: 'ETIMEDOUT' })), 3500);
    req.once('close', () => clearTimeout(timer));
    req.on('error', error => resolve({ ok: false, error_code: safeError(error) }));
    req.end();
  });
}
export async function probeHttp(address) {
  const started = Date.now();
  if (!address) return wrap('http', { ok: false, skipped: true, error_code: 'dns_unavailable' }, started);
  const result = await getJson('erp.lab.test', 8080, '/api/orders', address);
  return wrap('http', { ok: result.ok && result.body?.ok === true, status: result.status ?? null,
    duration_ms: result.duration_ms ?? null, error_code: result.error_code ?? result.body?.code ?? null,
    request_id: result.body?.request_id ?? null, check: 'database_backed_read' }, started);
}
export async function probeTcp() {
  const started = Date.now();
  const facts = await new Promise(resolve => {
    const socket = net.createConnection({ host: 'db', port: 5432 });
    socket.setTimeout(2000);
    socket.once('connect', () => { resolve({ ok: true, duration_ms: Date.now() - started }); socket.destroy(); });
    socket.once('timeout', () => { resolve({ ok: false, error_code: 'ETIMEDOUT' }); socket.destroy(); });
    socket.once('error', e => { resolve({ ok: false, error_code: safeError(e) }); socket.destroy(); });
  });
  return wrap('tcp', { ...facts, target_id: 'erp-database', check: 'connect_only' }, started);
}
