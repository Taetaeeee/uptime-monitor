import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { rates, isFresh } from '../collector/model.mjs';
import { safeError, getJson } from '../collector/probes.mjs';

function sample(time, cpu, rx, id = 'a') {
  return { observed_at: time, instance_id: id, metrics: { process_cpu_seconds_total: cpu,
    network: [{ interface: 'eth0', rx_bytes_total: rx, tx_bytes_total: rx }] } };
}
test('CPU와 NIC 누적 실측값을 시간창 기준으로 변환한다', () => {
  const r = rates(sample('2026-11-17T00:00:00Z', 1, 100), sample('2026-11-17T00:00:10Z', 3, 2100));
  assert.equal(r.process_cpu_percent_one_core, 20);
  assert.equal(r.network[0].rx_bytes_per_second, 200);
});
test('첫 표본과 재시작은 변화율을 만들지 않는다', () => {
  const s = sample('2026-11-17T00:00:00Z', 1, 100);
  assert.equal(rates(null, s), null);
  assert.equal(rates(s, { ...s, instance_id: 'new' }), null);
});
test('누적 카운터 감소·역행 시각을 음수 사용률로 표시하지 않는다', () => {
  const a = sample('2026-11-17T00:00:00Z', 2, 100);
  const b = sample('2026-11-17T00:00:10Z', 1, 50);
  assert.equal(rates(a, b).process_cpu_percent_one_core, null);
  assert.equal(rates(a, b).network[0].rx_bytes_per_second, null);
  assert.equal(rates(b, a), null);
});
test('누락·잘못된·미래·오래된 시각을 최신으로 인정하지 않는다', () => {
  const now = Date.parse('2026-11-17T00:01:00Z');
  for (const received_at of [undefined, 'bad', '2026-11-17T00:02:00Z', '2026-11-16T23:59:59Z']) {
    assert.equal(isFresh({ received_at }, now), false);
  }
  assert.equal(isFresh({ received_at: '2026-11-17T00:00:30Z' }, now), true);
});
test('예외 원문은 코드에 섞이지 않는다', () => {
  assert.equal(safeError(new Error('password secret SQL url')), 'probe_failed');
  assert.equal(safeError({ code: 'ECONNREFUSED' }), 'ECONNREFUSED');
});
test('로컬 HTTP의 업무 오류·잘못된 JSON·과대 본문을 성공으로 읽지 않는다', async t => {
  const server = http.createServer((req, res) => {
    if (req.url === '/large') return res.end('x'.repeat(70000));
    if (req.url === '/invalid') return res.end('not json');
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, code: 'db_unavailable' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const response = await getJson('127.0.0.1', port, '/');
  assert.equal(response.ok, false);
  assert.equal(response.status, 503);
  assert.equal((await getJson('127.0.0.1', port, '/invalid')).error_code, 'invalid_response');
  assert.equal((await getJson('127.0.0.1', port, '/large')).ok, false);
});
