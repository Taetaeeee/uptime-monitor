// 관리자 API 테스트 (B-5) — 가짜 D1 + 실제 시드(seed/sample.sql)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeD1 } from './helpers/fake-d1.js';
import worker from '../src/index.js';

const SEED_SQL = readFileSync(new URL('../seed/sample.sql', import.meta.url), 'utf8');
const TOKEN = 'test-admin-token'; // 테스트 전용 값 (실제 토큰 아님)

function setup(env = {}) {
  const db = createFakeD1();
  db.sqlite.exec(SEED_SQL);
  return { db, env: { DB: db, ADMIN_TOKEN: TOKEN, ...env } };
}

function call(env, method, path, body, token = TOKEN) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const req = new Request(`https://example.invalid${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return quiet(() => worker.fetch(req, env));
}
async function quiet(fn) {
  const [log, err] = [console.log, console.error];
  console.log = console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = err;
  }
}
const openIncidentId = (db) => db.sqlite.prepare('SELECT id FROM incidents WHERE resolved_at IS NULL').get().id;

test('인증: 토큰이 없거나 틀리면 401, 서버에 토큰이 없으면 503, 에이전트 키로는 통과 못 함', async () => {
  const { db, env } = setup({ AGENT_API_KEY: 'agent-key' });
  const path = `/api/admin/incidents/${openIncidentId(db)}/report`;
  assert.equal((await call(env, 'PUT', path, { summary: 'x' }, null)).status, 401);
  assert.equal((await call(env, 'PUT', path, { summary: 'x' }, 'wrong')).status, 401);
  assert.equal((await call(env, 'PUT', path, { summary: 'x' }, 'agent-key')).status, 401); // 권한 분리
  assert.equal((await call({ DB: db }, 'PUT', path, { summary: 'x' })).status, 503);
});

test('보고서 작성 → 공개 상세 API에 반영, 보낸 항목만 바뀜', async () => {
  const { db, env } = setup();
  const id = openIncidentId(db);
  const r1 = await call(env, 'PUT', `/api/admin/incidents/${id}/report`, { summary: '첫 요약', impact: '영향' });
  assert.equal(r1.status, 200);
  await call(env, 'PUT', `/api/admin/incidents/${id}/report`, { summary: '고친 요약' });

  const detail = await (await call(env, 'GET', `/api/incidents/${id}`)).json();
  assert.equal(detail.report.summary, '고친 요약');
  assert.equal(detail.report.impact, '영향'); // 두 번째 요청에 없던 항목은 그대로
  assert.ok(detail.report.updatedAt);
});

test('보고서: 잘못된 입력 400, 없는 장애 404, 잘못된 JSON 400', async () => {
  const { db, env } = setup();
  const id = openIncidentId(db);
  assert.equal((await call(env, 'PUT', `/api/admin/incidents/${id}/report`, { sumary: 'x' })).status, 400);
  assert.equal((await call(env, 'PUT', '/api/admin/incidents/99999/report', { summary: 'x' })).status, 404);
  assert.equal((await call(env, 'PUT', `/api/admin/incidents/${id}/report`, '{bad')).status, 400);
  assert.equal((await call(env, 'POST', `/api/admin/incidents/${id}/report`, { summary: 'x' })).status, 405);
});

test('계획 작업 등록 → 상태 API에 표시 → 취소', async () => {
  const { db, env } = setup();
  const gw = db.sqlite.prepare("SELECT id FROM monitors WHERE url = 'https://gw.demo.invalid'").get().id;
  const starts = new Date(Date.now() + 3600_000).toISOString();
  const ends = new Date(Date.now() + 7200_000).toISOString();

  const created = await call(env, 'POST', '/api/admin/maintenance', { monitor_id: gw, title: '테스트 작업', starts_at: starts, ends_at: ends });
  assert.equal(created.status, 201);
  const { id } = await created.json();

  const status = await (await call(env, 'GET', '/api/status')).json();
  const w = status.maintenance.find((m) => m.id === id);
  assert.equal(w.title, '테스트 작업');
  assert.equal(w.source, 'sample'); // 시드(가상) 대상의 작업 → 대상의 출처를 따름
  assert.equal(w.active, false);

  assert.equal((await call(env, 'DELETE', `/api/admin/maintenance/${id}`)).status, 200);
  assert.equal((await call(env, 'DELETE', `/api/admin/maintenance/${id}`)).status, 404);
});

test('계획 작업 출처: 대상의 출처를 따르고, 모든 대상 작업은 real', async () => {
  const { db, env } = setup();
  db.sqlite.exec(`INSERT INTO monitors (name, kind, url, check_key, is_active, source)
                  VALUES ('시뮬 대상', 'tcp', 'tcp://x.invalid:1', 'sim-x', 1, 'simulator')`);
  const sim = db.sqlite.prepare("SELECT id FROM monitors WHERE check_key = 'sim-x'").get().id;
  const real = db.sqlite.prepare("SELECT id FROM monitors WHERE url = 'https://gochyeora.pages.dev'").get().id;
  const later = (h) => new Date(Date.now() + h * 3600_000).toISOString();
  const create = async (monitor_id) =>
    (await call(env, 'POST', '/api/admin/maintenance', { monitor_id, title: 't', starts_at: later(1), ends_at: later(2) })).json();

  assert.equal((await create(sim)).source, 'simulator');
  assert.equal((await create(real)).source, 'real');
  assert.equal((await create(null)).source, 'real');
});

test('계획 작업: 없는 대상 400, 시간대 없는 시각 400', async () => {
  const { env } = setup();
  const later = (h) => new Date(Date.now() + h * 3600_000).toISOString();
  const r1 = await call(env, 'POST', '/api/admin/maintenance', { monitor_id: 99999, title: 't', starts_at: later(1), ends_at: later(2) });
  assert.equal(r1.status, 400);
  assert.equal((await r1.json()).error, 'monitor_not_found');
  const r2 = await call(env, 'POST', '/api/admin/maintenance', { title: 't', starts_at: '2030-01-01T00:00:00', ends_at: '2030-01-01T01:00:00' });
  assert.equal((await r2.json()).error, 'invalid_time');
});

test('시드: 장애 7건(진행 중 1), 보고서 3건, 작업 2건(지난·예정) — 공개 응답에 예정 작업만', async () => {
  const { db, env } = setup();
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM incidents').get().n, 7);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM incidents WHERE report_summary IS NOT NULL').get().n, 3);
  const status = await (await call(env, 'GET', '/api/status')).json();
  assert.equal(status.maintenance.length, 1); // 지난 작업은 ends_at이 지나서 빠짐
  assert.equal(status.incidents.length, 7);
  assert.ok(status.incidents.every((i) => i.source === 'sample'));
  assert.equal(status.incidents[0].ongoing, true); // 가장 최근 = 진행 중인 고객센터
});
