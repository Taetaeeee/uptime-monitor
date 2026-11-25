// D1 읽기 줄이기 (26단계) 테스트 — 결과는 그대로이고, 읽는 양만 줄었는지
// D1의 '읽은 행'은 가짜 D1에서 셀 수 없어서, (1) 어제 다시 읽기를 하는 회차, (2) 조회가 표 전체를 훑지 않는지(EXPLAIN),
// (3) 응답 결과가 예전과 같은지를 확인합니다. 실제 읽기량은 배포 다음 날 wrangler d1 insights로 잽니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './helpers/fake-d1.js';
import { shouldRefreshYesterday, YESTERDAY_REFRESH_KST } from '../src/record.js';
import { pickRecentChanges } from '../src/api.js';
import { runChecks } from '../src/index.js';

test('어제 집계는 KST 00:00~00:25와 01:00 회차에만 다시 계산한다', () => {
  // UTC 15:00 = KST 00:00
  assert.equal(shouldRefreshYesterday('2026-11-24T15:00:00Z'), true);
  assert.equal(shouldRefreshYesterday('2026-11-24T15:25:00Z'), true); // 00:25
  assert.equal(shouldRefreshYesterday('2026-11-24T15:30:00Z'), false); // 00:30
  assert.equal(shouldRefreshYesterday('2026-11-24T16:00:00Z'), true); // 01:00 안전용
  assert.equal(shouldRefreshYesterday('2026-11-25T03:00:00Z'), false); // 낮 12:00
  assert.equal(shouldRefreshYesterday('잘못된 값'), true); // 못 읽으면 예전처럼 (틀리지 않는 쪽)
  assert.equal(YESTERDAY_REFRESH_KST.length, 7); // 하루 288회차 중 7회만 어제를 읽음
});

// ── Cron으로 확인: 낮 회차는 어제를 건드리지 않고, 자정 직후 회차는 어제 마지막 기록까지 반영 ──
const okFetch = async (url) =>
  String(url).includes('cloudflare-dns.com')
    ? new Response(JSON.stringify({ Status: 0, Answer: [{ name: 'x', type: 1, data: '192.0.2.1' }] }), { status: 200 })
    : new Response('<title>Keychats</title> 고쳐라 {"status":"ok"}', { status: 200 });

async function cron(db, t) {
  const log = console.log;
  console.log = () => {};
  try {
    await runChecks({ DB: db }, t, { fetchFn: okFetch });
  } finally {
    console.log = log;
  }
}
const yesterdayTotal = (db, day) =>
  db.sqlite.prepare("SELECT SUM(total_checks) AS n FROM daily_stats WHERE day = ?").get(day).n;

test('Cron: 낮 회차는 어제 원본을 다시 읽지 않고, 자정 직후 회차는 어제 집계를 바로잡는다', async () => {
  const db = createFakeD1();
  db.sqlite.exec('UPDATE monitors SET is_active = 1 WHERE service_id IS NOT NULL');
  // KST 11-24 23:50, 23:55 회차 → 11-24 집계
  await cron(db, new Date('2026-11-24T14:50:10Z'));
  await cron(db, new Date('2026-11-24T14:55:10Z'));
  const before = yesterdayTotal(db, '2026-11-24');
  assert.ok(before > 0);

  // 어제(11-24) 원본을 몰래 하나 더 넣어 둠 (집계가 다시 계산되면 1 늘어남)
  const m = db.sqlite.prepare('SELECT id FROM monitors WHERE is_active = 1 ORDER BY id LIMIT 1').get().id;
  db.sqlite.prepare("INSERT INTO check_results (monitor_id, checked_at, is_success, response_ms, source) VALUES (?, '2026-11-24T14:40:00Z', 1, 100, 'real')").run(m);

  // KST 11-25 12:00 회차: 어제는 다시 계산하지 않음 → 그대로
  await cron(db, new Date('2026-11-25T03:00:10Z'));
  assert.equal(yesterdayTotal(db, '2026-11-24'), before);

  // KST 11-26 00:05 회차는 11-25가 '어제' — 11-25 집계에 낮 회차가 그대로 남아 있는지 + 11-24는 이미 지난 날이라 그대로
  await cron(db, new Date('2026-11-25T15:05:10Z'));
  assert.equal(yesterdayTotal(db, '2026-11-24'), before);
  assert.ok(yesterdayTotal(db, '2026-11-25') > 0);
});

test('Cron: 자정 직후 회차는 어제 마지막 회차까지 어제 집계에 반영한다', async () => {
  const db = createFakeD1();
  db.sqlite.exec('UPDATE monitors SET is_active = 1 WHERE service_id IS NOT NULL');
  await cron(db, new Date('2026-11-24T14:55:10Z')); // KST 23:55
  const m = db.sqlite.prepare('SELECT id FROM monitors WHERE is_active = 1 ORDER BY id LIMIT 1').get().id;
  const before = yesterdayTotal(db, '2026-11-24');
  db.sqlite.prepare("INSERT INTO check_results (monitor_id, checked_at, is_success, response_ms, source) VALUES (?, '2026-11-24T14:58:00Z', 1, 100, 'real')").run(m);
  await cron(db, new Date('2026-11-24T15:00:10Z')); // KST 00:00 → 어제(11-24)도 다시 계산
  assert.equal(yesterdayTotal(db, '2026-11-24'), before + 1);
});

test('일별 집계 조회는 기본 키를 탄다 (표 전체를 훑지 않음)', () => {
  const db = createFakeD1();
  const plan = (sql) => db.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ');
  const daily = plan("SELECT monitor_id, day, total_checks FROM daily_stats WHERE monitor_id IN (SELECT id FROM monitors) AND day >= '2026-11-01'");
  const svc = plan("SELECT service_id, day, total_slots FROM service_daily_stats WHERE service_id IN (SELECT id FROM services) AND day >= '2026-11-01'");
  const chg = plan("SELECT c.* FROM content_changes c WHERE c.monitor_id IN (1, 2, 3) AND c.first_seen_at >= '2026-11-18T00:00:00Z'");
  assert.match(daily, /SEARCH daily_stats USING .*INDEX sqlite_autoindex_daily_stats_1 \(monitor_id=\? AND day>\?\)/);
  assert.match(svc, /SEARCH service_daily_stats USING .*INDEX sqlite_autoindex_service_daily_stats_1 \(service_id=\? AND day>\?\)/);
  assert.match(chg, /SEARCH c USING INDEX idx_content_changes_monitor_time \(monitor_id=\? AND first_seen_at>\?\)/);
  // 예전 조회는 표 전체를 훑었음 (비교용)
  assert.match(plan("SELECT monitor_id, day FROM daily_stats WHERE day >= '2026-11-01'"), /SCAN daily_stats/);
});

test('pickRecentChanges: 최신 순 목록에서 서비스당 최근 N건과 24시간·7일 횟수를 고른다', () => {
  const serviceOf = new Map([[1, { key: 'a' }], [2, { key: 'a' }], [3, { key: 'b' }]]);
  const rows = [
    { monitorId: 1, firstSeenAt: '2026-11-25T04:00:00Z' },
    { monitorId: 1, firstSeenAt: '2026-11-25T03:00:00Z' },
    { monitorId: 3, firstSeenAt: '2026-11-24T06:00:00Z' },
    { monitorId: 2, firstSeenAt: '2026-11-24T05:00:00Z' }, // 정확히 24시간 전 → 24시간 안
    { monitorId: 1, firstSeenAt: '2026-11-24T04:59:59Z' }, // 24시간 + 1초 전 → 밖
    { monitorId: 9, firstSeenAt: '2026-11-24T04:00:00Z' }, // 내린 서비스의 점검 → 무시
  ];
  const { changes, counts } = pickRecentChanges(rows, serviceOf, '2026-11-24T05:00:00Z', 3);
  assert.deepEqual(changes.map((c) => [c.monitorId, c.firstSeenAt.slice(11, 13)]), [[1, '04'], [1, '03'], [3, '06'], [2, '05']]);
  assert.deepEqual(counts.get('a'), { serviceKey: 'a', day: 3, week: 4, deployDay: 0, deployWeek: 0 });
  assert.deepEqual(counts.get('b'), { serviceKey: 'b', day: 1, week: 1, deployDay: 0, deployWeek: 0 });
  assert.equal(counts.has('?'), false);
});
