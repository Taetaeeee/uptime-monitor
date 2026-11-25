// 데이터 보존 정리 (25단계) 테스트 — 언제·어디까지·무엇을 지우고, 무엇을 남기는지
// 실제 D1 대신 가짜 D1(node:sqlite)에 마이그레이션을 모두 적용해서 확인합니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './helpers/fake-d1.js';
import { isRetentionSlot, retentionCutoff, remainingBudget, retentionView, RAW_RETENTION_DAYS, MAX_DELETE_PER_RUN } from '../src/retention.js';
import { runRetention } from '../src/retention-run.js';
import worker from '../src/index.js';

test('정리 회차는 KST 04:00 회차 하나뿐 (UTC 19:00)', () => {
  assert.equal(isRetentionSlot('2026-11-24T19:00:00Z'), true); // KST 11-25 04:00
  assert.equal(isRetentionSlot('2026-11-24T19:05:00Z'), false);
  assert.equal(isRetentionSlot('2026-11-24T04:00:00Z'), false); // UTC 04:00 = KST 13:00
  assert.equal(isRetentionSlot('nope'), false);
});

test('기준: 오늘 포함 90일을 남기고, KST 자정을 경계로 날짜가 바뀐다', () => {
  assert.equal(RAW_RETENTION_DAYS, 90);
  assert.deepEqual(retentionCutoff('2026-11-25T05:00:00Z'), { today: '2026-11-25', firstKeptDay: '2026-08-28', cutoffUtc: '2026-08-27T15:00:00Z' });
  // KST 자정 직전·직후
  assert.equal(retentionCutoff('2026-11-24T14:59:59Z').firstKeptDay, '2026-08-27');
  assert.equal(retentionCutoff('2026-11-24T15:00:00Z').firstKeptDay, '2026-08-28');
  assert.equal(remainingBudget(9_990), 10);
  assert.equal(remainingBudget(MAX_DELETE_PER_RUN + 5), 0);
});

// ── 가짜 D1에 기록 만들기 ──
const DAY = 86400_000;
const now = new Date('2026-11-24T19:00:12Z'); // KST 11-25 04:00 회차 (12초 늦게 들어와도 같은 회차)

function seed(db, { days = 100, perDay = 3, skipAggregateDay = null } = {}) {
  const monitorId = db.sqlite.prepare("SELECT id FROM monitors WHERE url = 'https://gochyeora.pages.dev'").get().id;
  const insR = db.sqlite.prepare("INSERT INTO check_results (monitor_id, checked_at, is_success, response_ms, source) VALUES (?, ?, 1, 100, 'real')");
  const insD = db.sqlite.prepare("INSERT INTO daily_stats (monitor_id, day, total_checks, success_checks, slow_checks, avg_response_ms, updated_at) VALUES (?, ?, ?, ?, 0, 100, '2026-11-25T00:00:00Z')");
  for (let d = 0; d < days; d += 1) {
    // KST 정오 근처에 하루 perDay건 (KST 날짜가 흔들리지 않게)
    const kstNoon = Date.parse('2026-11-25T03:00:00Z') - d * DAY;
    const day = new Date(kstNoon + 9 * 3600_000).toISOString().slice(0, 10);
    for (let k = 0; k < perDay; k += 1) insR.run(monitorId, new Date(kstNoon + k * 300_000).toISOString().replace(/\.\d+Z$/, 'Z'));
    if (day !== skipAggregateDay) insD.run(monitorId, day, perDay, perDay);
  }
  return monitorId;
}
const count = (db, sql, ...a) => db.sqlite.prepare(sql).get(...a).n;

test('정리: 90일 지난 원본만 지우고, 일별 집계가 없는 날의 원본은 남기며, 기록을 1행 남긴다', async () => {
  const db = createFakeD1();
  const id = seed(db, { days: 100, perDay: 3, skipAggregateDay: '2026-08-20' }); // 기준 전 날 하나는 집계 없음
  const dailyBefore = count(db, 'SELECT COUNT(*) AS n FROM daily_stats');

  const run = await runRetention(db, now);
  assert.equal(run.firstKeptDay, '2026-08-28');
  // 100일 중 기준 전 10일(08-18~08-27) × 3건 = 30건, 그중 집계 없는 08-20의 3건은 남김
  assert.equal(run.deletedRows, 27);
  assert.equal(run.keptOldRows, 3);
  assert.equal(run.capped, false);
  assert.equal(run.error, null);

  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM check_results WHERE monitor_id = ? AND checked_at >= ?', id, run.cutoffUtc), 90 * 3); // 남긴 90일은 그대로
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM daily_stats'), dailyBefore); // 일별 집계는 지우지 않음
  const saved = db.sqlite.prepare('SELECT * FROM retention_runs').all();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].deleted_rows, 27);
  assert.equal(saved[0].first_kept_day, '2026-08-28');

  // 같은 회차가 한 번 더 실행돼도 기록은 1행, 지울 것은 0건
  const again = await runRetention(db, now);
  assert.equal(again.deletedRows, 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM retention_runs'), 1);
});

test('정리 회차가 아니면 아무것도 읽거나 쓰지 않는다', async () => {
  const db = createFakeD1();
  seed(db, { days: 100, perDay: 1 });
  const before = count(db, 'SELECT COUNT(*) AS n FROM check_results');
  assert.equal(await runRetention(db, new Date('2026-11-24T19:05:00Z')), null);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM check_results'), before);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM retention_runs'), 0);
});

test('한 번에 지우는 상한: 넘치면 상한만큼만 지우고 capped, 남은 것은 다음 날로', async () => {
  const db = createFakeD1();
  // 기준 전 원본이 상한보다 많게: 100일 × 120건 중 기준 전 10일 = 1,200건, 상한을 낮춘 효과를 보려고 보존 날 수를 줄임
  seed(db, { days: 100, perDay: 120 });
  const run = await runRetention(db, now, { force: true, days: 10 }); // 기준 전 90일 × 120 = 10,800건 > 상한 10,000
  assert.equal(run.deletedRows, MAX_DELETE_PER_RUN);
  assert.equal(run.capped, true);
  assert.equal(run.keptOldRows, 90 * 120 - MAX_DELETE_PER_RUN);
  // 오래된 것부터 지웠는지: 남은 오래된 행은 기준에 가까운 쪽
  const oldest = db.sqlite.prepare('SELECT MIN(checked_at) AS t FROM check_results').get().t;
  assert.ok(oldest > '2026-08-26', `오래된 것부터 지움 (남은 가장 오래된 행 ${oldest})`);
});

test('지우는 조회는 점검별 색인 (monitor_id, checked_at)을 탄다 (D1은 훑은 행을 모두 읽기로 셈)', () => {
  const db = createFakeD1();
  const plan = db.sqlite
    .prepare("EXPLAIN QUERY PLAN SELECT r.id FROM check_results r WHERE r.monitor_id = 1 AND r.checked_at < '2026-08-27T15:00:00Z' ORDER BY r.checked_at LIMIT 10")
    .all()
    .map((r) => r.detail)
    .join(' | ');
  assert.match(plan, /idx_check_results_monitor_time/);
  assert.doesNotMatch(plan, /SCAN r\b(?! USING)/); // 표 전체 훑기 아님
});

test('GET /api/retention: 정책 값과 마지막 정리 결과만 공개 (정리 전에는 lastRun null)', async () => {
  const db = createFakeD1();
  const call = (method = 'GET') => worker.fetch(new Request('https://example.test/api/retention', { method }), { DB: db });
  let res = await call();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /max-age=300/);
  let body = await res.json();
  assert.equal(body.policy.rawRetentionDays, 90);
  assert.equal(body.policy.runAtKst, '04:00');
  assert.equal(body.lastRun, null);

  seed(db, { days: 95, perDay: 2 });
  await runRetention(db, now);
  body = await (await call()).json();
  assert.deepEqual(body.lastRun, { runAt: '2026-11-24T19:00:00Z', firstKeptDay: '2026-08-28', deletedRows: 10, keptOldRows: 0, capped: false, ok: true });
  assert.equal((await call('POST')).status, 405);
  assert.deepEqual(retentionView(null).lastRun, null);
});
