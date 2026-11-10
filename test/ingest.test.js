// 에이전트 보고 수집 API 테스트 — 가짜 D1 + 실제 시뮬레이터 대상 시드(seed/simulator-monitors.sql)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeD1 } from './helpers/fake-d1.js';
import { handleAgentReport } from '../src/ingest.js';
import worker from '../src/index.js';

const SIM_SQL = readFileSync(new URL('../seed/simulator-monitors.sql', import.meta.url), 'utf8');
const KEY = 'test-agent-key'; // 테스트 전용 값 (실제 키 아님)
const NOW = new Date('2026-11-10T05:00:00Z');

function setup() {
  const db = createFakeD1();
  db.sqlite.exec(SIM_SQL);
  return { db, env: { DB: db, AGENT_API_KEY: KEY } };
}

function post(body, { key = KEY, raw } = {}) {
  return new Request('https://example.invalid/api/agent/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: raw ?? JSON.stringify(body),
  });
}

// n회차 전 시각 (5분 간격, 초는 일부러 어긋나게)
const ago = (n) => new Date(NOW.getTime() - n * 300000 + 7000).toISOString().replace('.000Z', 'Z');
const report = (n, checks, mode = 'simulator') => ({ agent: 'test-pc', mode, observed_at: ago(n), checks });

async function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}
const send = (env, body, opts) => quiet(() => handleAgentReport(post(body, opts), env, { now: NOW }));

test('인증: 키 없음·틀린 키는 401, 서버에 키가 등록되지 않았으면 503', async () => {
  const { env } = setup();
  const body = report(0, [{ key: 'sim-db-tcp', ok: true }]);
  assert.equal((await send(env, body, { key: null })).status, 401);
  assert.equal((await send(env, body, { key: 'wrong' })).status, 401);

  const errLog = console.error;
  console.error = () => {};
  try {
    assert.equal((await send({ DB: env.DB }, body)).status, 503);
  } finally {
    console.error = errLog;
  }
});

test('형식 오류는 400, 아무것도 저장하지 않음', async () => {
  const { db, env } = setup();
  assert.equal((await send(env, null, { raw: '{not json' })).status, 400);
  const res = await send(env, { ...report(0, [{ key: 'sim-db-tcp', ok: true }]), mode: 'fake' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_mode');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM check_results').get().n, 0);
});

test('정상 보고: 회차로 내림해 저장, 값·출처(simulator) 기록', async () => {
  const { db, env } = setup();
  const res = await send(env, report(0, [
    { key: 'sim-db-tcp', ok: true, response_ms: 12 },
    { key: 'sim-fileserver-disk', ok: true, value: 72.5 },
  ]));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.accepted, 2);
  assert.equal(body.checkedAt, '2026-11-10T05:00:00Z'); // 05:00:07 → 05:00:00

  const rows = db.sqlite.prepare('SELECT response_ms, value, source, status_code FROM check_results ORDER BY id').all();
  assert.deepEqual(rows.map((r) => [r.response_ms, r.value, r.source, r.status_code]), [
    [12, null, 'simulator', null],
    [null, 72.5, 'simulator', null],
  ]);
});

test('모르는 키는 unknown, 출처가 다른 대상(실제 대상에 시뮬레이터 보고)은 rejected', async () => {
  const { db, env } = setup();
  db.sqlite.exec(`INSERT INTO monitors (name, kind, url, check_key, is_active, source)
                  VALUES ('내 PC 디스크', 'disk', 'disk://local/C:', 'real-pc-disk', 1, 'real')`);
  const body = await (await send(env, report(0, [
    { key: 'no-such-key', ok: true },
    { key: 'real-pc-disk', ok: true, value: 50 }, // 시뮬레이터가 실제 대상에 쓰려 함 → 거부
  ]))).json();
  assert.deepEqual(body.unknown, ['no-such-key']);
  assert.deepEqual(body.rejected, ['real-pc-disk']);
  assert.equal(body.accepted, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM check_results').get().n, 0);
});

test('같은 회차를 다시 보내면 건너뛴다 (멱등)', async () => {
  const { db, env } = setup();
  const r = report(0, [{ key: 'sim-db-tcp', ok: true, response_ms: 10 }]);
  await send(env, r);
  const second = await (await send(env, r)).json();
  assert.deepEqual(second.skipped, ['sim-db-tcp']);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM check_results').get().n, 1);
});

test('시나리오: DB 포트 2회 연속 실패 → 장애 알림, 성공 → 복구 알림 (모두 simulator 표시)', async () => {
  const { db, env } = setup();
  const steps = [true, false, false, true]; // 오래된 회차 → 최근 회차
  for (const [i, ok] of steps.entries()) {
    const n = steps.length - 1 - i;
    const res = await send(env, report(n, [{ key: 'sim-db-tcp', ok, response_ms: ok ? 11 : null }]));
    assert.equal(res.status, 200);
  }

  const notes = db.sqlite.prepare('SELECT event, message, source, failure_reason FROM notifications ORDER BY id').all();
  assert.deepEqual(notes.map((n) => n.event), ['down', 'recovered']);
  assert.ok(notes.every((n) => n.source === 'simulator'));
  assert.equal(notes[0].failure_reason, 'port_closed');
  assert.match(notes[0].message, /포트 연결 실패/);
  assert.match(notes[1].message, /장애 약 10분/);

  const daily = db.sqlite.prepare('SELECT total_checks, success_checks, source FROM daily_stats').get();
  assert.deepEqual([daily.total_checks, daily.success_checks, daily.source], [4, 2, 'simulator']);
});

test('HTTP 경로: POST만 허용, Worker fetch로 연결됨', async () => {
  const { env } = setup();
  const get = await worker.fetch(new Request('https://example.invalid/api/agent/report'), env);
  assert.equal(get.status, 405);
  const res = await quiet(() =>
    worker.fetch(post({ agent: 'x', mode: 'simulator', observed_at: new Date().toISOString(), checks: [{ key: 'sim-gw-ssl', ok: true, value: 41 }] }), env)
  );
  assert.equal(res.status, 200);
});
