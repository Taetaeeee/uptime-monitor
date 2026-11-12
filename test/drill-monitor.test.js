// 장애 훈련용 점검 대상(마이그레이션 0012) 테스트
// 에이전트 실제 모드 보고가 이 대상에 어떻게 기록·판정되는지, 계획 작업 중에는 장애로 보지 않는지 확인합니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './helpers/fake-d1.js';
import { handleAgentReport } from '../src/ingest.js';

const KEY = 'test-agent-key'; // 테스트 전용 값 (실제 키 아님)
const NOW = new Date('2026-11-12T05:00:00Z');
const DRILL = 'drill-local-tcp';

function setup({ active = true } = {}) {
  const db = createFakeD1();
  if (active) db.sqlite.exec(`UPDATE monitors SET is_active = 1 WHERE check_key = '${DRILL}'`);
  return { db, env: { DB: db, AGENT_API_KEY: KEY } };
}

const ago = (n) => new Date(NOW.getTime() - n * 300000 + 7000).toISOString().replace('.000Z', 'Z');
const report = (n, ok, mode = 'real') => ({ agent: 'my-pc', mode, observed_at: ago(n), checks: [{ key: DRILL, ok, response_ms: ok ? 3 : null, value: null, error: null }] });

async function send(env, body) {
  const log = console.log;
  console.log = () => {};
  try {
    const req = new Request('https://example.invalid/api/agent/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
    const res = await handleAgentReport(req, env, { now: NOW });
    return { status: res.status, json: await res.json() };
  } finally {
    console.log = log;
  }
}

const q = (db, sql, ...p) => db.sqlite.prepare(sql).all(...p);

test('0012: 훈련 대상이 실제(real)·tcp·비활성으로 등록되고 주소는 로컬 테스트 포트다', () => {
  const { db } = setup({ active: false });
  const m = db.sqlite.prepare("SELECT * FROM monitors WHERE check_key = ?").get(DRILL);
  assert.equal(m.name, '장애 훈련 · 내 PC 테스트 포트');
  assert.deepEqual([m.kind, m.source, m.is_active, m.url, m.threshold], ['tcp', 'real', 0, 'tcp://127.0.0.1:18080', null]);
});

test('에이전트 실제 모드 보고는 이 대상에 real로 기록된다', async () => {
  const { db, env } = setup();
  const { status } = await send(env, report(0, true));
  assert.equal(status, 200);
  const rows = q(db, 'SELECT r.is_success, r.source FROM check_results r JOIN monitors m ON m.id = r.monitor_id WHERE m.check_key = ?', DRILL);
  assert.deepEqual(rows.map((r) => [r.is_success, r.source]), [[1, 'real']]);
});

test('시뮬레이터 모드 보고는 이 실제 대상에 기록되지 않는다 (가짜 값이 섞이지 않음)', async () => {
  const { db, env } = setup();
  await send(env, report(0, true, 'simulator'));
  assert.equal(q(db, 'SELECT COUNT(*) AS n FROM check_results').at(0).n, 0);
});

test('훈련 A: 정상 → 포트 닫힘 2회 → 장애 열림·알림 → 다시 열림 → 복구', async () => {
  const { db, env } = setup();
  for (const [n, ok] of [[5, true], [4, true], [3, false], [2, false], [1, true]]) await send(env, report(n, ok));

  const incidents = q(db, 'SELECT cause, source, started_at, detected_at, resolved_at FROM incidents');
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].cause, 'port_closed');
  assert.equal(incidents[0].source, 'real');
  assert.ok(incidents[0].resolved_at, '복구되어 닫힘');
  assert.ok(incidents[0].started_at < incidents[0].detected_at, '첫 실패 시각이 판정 시각보다 이름 (감지에 걸린 시간이 남음)');

  const events = q(db, 'SELECT event, message FROM notifications ORDER BY id');
  assert.deepEqual(events.map((e) => e.event), ['down', 'recovered']);
  assert.match(events[0].message, /장애 훈련/);
});

test('훈련 B: 계획 작업 시간에 포트가 닫혀도 장애로 보지 않고 점검 결과에 작업 중으로 남는다', async () => {
  const { db, env } = setup();
  const id = db.sqlite.prepare('SELECT id FROM monitors WHERE check_key = ?').get(DRILL).id;
  db.sqlite.exec(`
    INSERT INTO maintenance_windows (monitor_id, title, starts_at, ends_at, source, created_at)
    VALUES (${id}, '훈련 B: 계획 작업', '2026-11-12T04:30:00Z', '2026-11-12T05:30:00Z', 'real', '2026-11-12T04:00:00Z')
  `);
  for (const [n, ok] of [[3, false], [2, false], [1, false], [0, false]]) await send(env, report(n, ok));

  assert.equal(q(db, 'SELECT COUNT(*) AS n FROM incidents').at(0).n, 0, '작업 중에는 장애를 열지 않음');
  assert.equal(q(db, 'SELECT COUNT(*) AS n FROM notifications').at(0).n, 0, '알림도 없음');
  const rows = q(db, 'SELECT is_success, in_maintenance FROM check_results ORDER BY id');
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.in_maintenance === 1), '모두 계획 작업 중으로 표시');
});
