// 장애 이력·계획 작업이 Cron 흐름에서 동작하는지 (B-5) — 가짜 D1 + 가짜 fetch
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './helpers/fake-d1.js';
import { runChecks } from '../src/index.js';
import { buildStatus, buildIncidentDetail } from '../src/api.js';

function setup() {
  const db = createFakeD1();
  db.sqlite.exec(`
    INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active, source)
    VALUES ('테스트 서비스', 'http', 'https://test.invalid', 200, NULL, 3000, 1, 'sample');
  `);
  const monitorId = db.sqlite.prepare(`SELECT id FROM monitors WHERE url = 'https://test.invalid'`).get().id;
  return { db, env: { DB: db }, monitorId };
}

const respond = (status) => async () => new Response('ok', { status });
const at = (n) => new Date(Date.UTC(2026, 10, 10, 3, n * 5, 12)); // 03:00:12, 03:05:12 …
const slot = (n) => new Date(Date.UTC(2026, 10, 10, 3, n * 5)).toISOString().replace('.000Z', 'Z');

async function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}
async function runAll(env, statuses, start = 0) {
  await quiet(async () => {
    for (const [i, s] of statuses.entries()) await runChecks(env, at(start + i), { fetchFn: respond(s) });
  });
}
const count = (db, sql) => db.sqlite.prepare(sql).get().n;

test('장애 이력: 첫 실패에 시작, 판정 회차에 감지, 복구 회차에 종료', async () => {
  const { db, env, monitorId } = setup();
  await runAll(env, [503, 503, 503, 200]);

  const rows = db.sqlite.prepare('SELECT * FROM incidents').all();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].monitor_id, rows[0].started_at, rows[0].detected_at, rows[0].resolved_at, rows[0].cause, rows[0].source],
    [monitorId, slot(0), slot(1), slot(3), 'status_mismatch', 'real']
  );

  // 상세: 지표 + 기간 안의 알림 2건
  const detail = await buildIncidentDetail(db, rows[0].id, at(4));
  assert.equal(detail.durationMinutes, 15);
  assert.equal(detail.detectMinutes, 5);
  assert.equal(detail.causeText, '상태 코드 불일치');
  assert.deepEqual(detail.notifications.map((n) => n.event), ['down', 'recovered']);
});

test('진행 중 장애는 대상당 1건만 (장애 중 실패가 계속돼도 새로 열리지 않음)', async () => {
  const { db, env } = setup();
  await runAll(env, [503, 503, 503, 503, 503]);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM incidents'), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM incidents WHERE resolved_at IS NULL'), 1);
});

test('계획 작업 중 실패: 장애·알림 없음, in_maintenance 기록, 가동률에서 제외', async () => {
  const { db, env, monitorId } = setup();
  // 03:05 ~ 03:20 작업 (회차 1, 2, 3)
  db.sqlite.exec(`INSERT INTO maintenance_windows (monitor_id, title, starts_at, ends_at, source, created_at)
                  VALUES (${monitorId}, '테스트 작업', '${slot(1)}', '${slot(4)}', 'real', '${slot(0)}')`);
  await runAll(env, [200, 503, 503, 503, 200]); // 회차 0 정상, 1~3 작업 중 실패, 4 정상

  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM notifications'), 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM incidents'), 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM check_results WHERE in_maintenance = 1'), 3);

  const daily = db.sqlite.prepare('SELECT total_checks, success_checks, maintenance_checks FROM daily_stats').get();
  assert.deepEqual([daily.total_checks, daily.success_checks, daily.maintenance_checks], [2, 2, 3]); // 가동률 100%
  assert.equal(db.sqlite.prepare('SELECT state FROM monitor_state').get().state, 'up');
});

test('작업이 끝나면 연속 실패를 0부터 다시 센다', async () => {
  const { db, env, monitorId } = setup();
  // 회차 1만 작업 중
  db.sqlite.exec(`INSERT INTO maintenance_windows (monitor_id, title, starts_at, ends_at, source, created_at)
                  VALUES (${monitorId}, 't', '${slot(1)}', '${slot(2)}', 'real', '${slot(0)}')`);
  await runAll(env, [503, 503, 503]); // 회차 0 실패(1회), 1 작업 중(초기화), 2 실패(다시 1회)
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM notifications'), 0); // 작업을 사이에 둔 2회는 연속이 아님
  await runAll(env, [503], 3); // 회차 3 실패 → 작업 후 2회 연속 → 장애
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM notifications WHERE event = 'down'"), 1);
  assert.equal(db.sqlite.prepare('SELECT started_at FROM incidents').get().started_at, slot(2));
});

test('상태 API: 작업 중인 대상은 maintenance 표시, 작업·장애 이력 포함', async () => {
  const { db, env, monitorId } = setup();
  await runAll(env, [503, 503]); // 장애 진행 중
  db.sqlite.exec(`INSERT INTO maintenance_windows (monitor_id, title, starts_at, ends_at, source, created_at)
                  VALUES (${monitorId}, '긴급 작업', '${slot(2)}', '${slot(8)}', 'real', '${slot(2)}')`);

  const body = await buildStatus(db, at(3));
  assert.equal(body.services.find((s) => s.id === monitorId).state, 'maintenance');
  assert.equal(body.maintenance.length, 1);
  assert.equal(body.maintenance[0].active, true);
  assert.equal(body.incidents.length, 1);
  assert.equal(body.incidents[0].ongoing, true);
  assert.equal(body.incidents[0].hasReport, false);
});
