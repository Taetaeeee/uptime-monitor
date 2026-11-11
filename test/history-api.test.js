// 상세 팝업 그래프용 기록 API 테스트 — 가짜 D1 + 실제 시드(seed/sample.sql)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeD1 } from './helpers/fake-d1.js';
import { buildMonitorHistory } from '../src/api.js';
import worker from '../src/index.js';

const SEED_SQL = readFileSync(new URL('../seed/sample.sql', import.meta.url), 'utf8');

// 시드는 SQLite의 'now' 기준으로 시각을 만드므로 현재 시각으로 조회합니다.
function seeded() {
  const db = createFakeD1();
  db.sqlite.exec(SEED_SQL);
  return db;
}
const idOf = (db, url) => db.sqlite.prepare('SELECT id FROM monitors WHERE url = ?').get(url).id;
const get = (env, path) => worker.fetch(new Request(`https://example.invalid${path}`), env);

test('최근 24시간 기록: 오래된 → 최근 순서, 출처·실패 문구 포함, 점검 주소는 없음', async () => {
  const db = seeded();
  const id = idOf(db, 'https://erp.demo.invalid');
  const body = await buildMonitorHistory(db, id, 24, new Date());

  assert.equal(body.monitor.name, '사내 ERP');
  assert.equal(body.monitor.source, 'sample');
  assert.equal('url' in body.monitor, false);
  assert.equal(body.points.length, 24); // 시드 원본 = 최근 2시간 24회
  const times = body.points.map((p) => p.checkedAt);
  assert.deepEqual(times, [...times].sort());
  assert.ok(body.points.every((p) => p.source === 'sample'));

  const failed = body.points.find((p) => !p.isSuccess);
  assert.equal(failed.failureReason, 'timeout');
  assert.equal(failed.failureText, '응답 시간 초과');
  assert.equal(failed.responseMs, null);
});

test('기간을 줄이면 그 안의 기록만 (1시간 = 최대 12~13회)', async () => {
  const db = seeded();
  const id = idOf(db, 'https://erp.demo.invalid');
  const body = await buildMonitorHistory(db, id, 1, new Date());
  assert.ok(body.points.length >= 12 && body.points.length <= 13, String(body.points.length));
});

test('측정값 기록: 도메인 만료 데모는 value(남은 일수)가 들어 있음', async () => {
  const db = seeded();
  const body = await buildMonitorHistory(db, idOf(db, 'domain://demo.invalid'), 24, new Date());
  assert.equal(body.monitor.kind, 'domain');
  assert.equal(body.monitor.threshold, 30);
  assert.ok(body.points.every((p) => p.value === 41));
});

test('HTTP: 정상 200 + 60초 캐시, 없는 대상 404, 잘못된 기간 400, POST 405', async () => {
  const db = seeded();
  const env = { DB: db };
  const id = idOf(db, 'https://gw.demo.invalid');

  const ok = await get(env, `/api/monitors/${id}/history`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'public, max-age=60');
  assert.equal((await ok.json()).hours, 24); // 기본 24시간

  assert.equal((await get(env, '/api/monitors/99999/history')).status, 404);
  for (const bad of ['0', '49', 'abc', '1.5']) {
    assert.equal((await get(env, `/api/monitors/${id}/history?hours=${bad}`)).status, 400, bad);
  }
  const post = await worker.fetch(new Request(`https://example.invalid/api/monitors/${id}/history`, { method: 'POST' }), env);
  assert.equal(post.status, 405);
});
