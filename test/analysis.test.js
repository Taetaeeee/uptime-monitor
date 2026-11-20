// 점검 기록 분석 (16단계: 0017 + analysis.js + Cron 집계 + /api/services/:key/analysis) 테스트
// 실제 사이트에는 요청하지 않고, 가짜 D1과 가짜 fetch로 "원본 → 일별 분석 값 → 공개 API"를 확인합니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './helpers/fake-d1.js';
import { percentile, kstHour, weekdayIndex, analyzeDay, buildAnalysis, parseJsonOr, BACKFILL_PER_RUN } from '../src/analysis.js';
import { backfillAnalysis } from '../src/record.js';
import { buildServiceAnalysis } from '../src/api.js';
import worker, { runChecks } from '../src/index.js';

// ── 순수 함수 ──

test('percentile: nearest-rank — 정렬 후 ceil(p% × n)번째 값, 숫자가 아니면 뺀다', () => {
  const xs = Array.from({ length: 20 }, (_, i) => (i + 1) * 10); // 10..200
  assert.equal(percentile(xs, 95), 190); // ceil(19) = 19번째
  assert.equal(percentile(xs, 50), 100);
  assert.equal(percentile([300, 100, 200], 95), 300); // 정렬해서 셈, ceil(2.85) = 3번째
  assert.equal(percentile([42], 95), 42);
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([null, undefined, NaN], 95), null);
});

test('kstHour·weekdayIndex: 한국 시각 기준 시·요일 (월=0)', () => {
  assert.equal(kstHour('2026-11-19T14:59:00Z'), 23); // KST 19일 23:59
  assert.equal(kstHour('2026-11-19T15:00:00Z'), 0); // KST 20일 00:00
  assert.equal(weekdayIndex('2026-11-16'), 0); // 월요일
  assert.equal(weekdayIndex('2026-11-22'), 6); // 일요일
});

const row = (checkedAt, isSuccess, o = {}) => ({
  checkedAt, isSuccess, isSlow: false, responseMs: isSuccess ? 100 : null, inMaintenance: false, failureReason: isSuccess ? null : 'timeout', ...o,
});

test('analyzeDay: 시간대별 [전체, 실패, 느림], 실패 이유, p95는 성공한 점검만 — 계획 작업 중은 뺀다', () => {
  const rows = [
    row('2026-11-19T15:00:00Z', true, { responseMs: 100 }), // KST 0시
    row('2026-11-19T15:05:00Z', true, { responseMs: 900, isSlow: true }),
    row('2026-11-19T15:10:00Z', false), // timeout
    row('2026-11-19T16:00:00Z', false, { failureReason: 'dns_error' }), // KST 1시
    row('2026-11-19T16:05:00Z', false, { failureReason: null }), // 이유 없음 → unknown
    row('2026-11-19T16:10:00Z', false, { inMaintenance: true }), // 작업 중: 빼고
    row('2026-11-19T16:15:00Z', true, { responseMs: 5000, inMaintenance: true }), // p95에도 안 들어감
  ];
  const a = analyzeDay(rows);
  assert.deepEqual(a.hourly[0], [3, 1, 1]);
  assert.deepEqual(a.hourly[1], [2, 2, 0]);
  assert.equal(a.hourly.length, 24);
  assert.deepEqual(a.failures, { timeout: 1, dns_error: 1, unknown: 1 });
  assert.equal(a.p95ResponseMs, 900);
  // 실패 이유 합계 = 열지도 실패 합계 (두 화면이 같은 숫자를 말함)
  const failSum = a.hourly.reduce((s, c) => s + c[1], 0);
  assert.equal(Object.values(a.failures).reduce((s, n) => s + n, 0), failSum);
});

test('analyzeDay: 기록이 없으면 0칸·빈 실패·p95 없음', () => {
  const a = analyzeDay([]);
  assert.equal(a.p95ResponseMs, null);
  assert.deepEqual(a.failures, {});
  assert.ok(a.hourly.every((c) => c.join() === '0,0,0'));
});

test('parseJsonOr: 깨진 JSON이면 기본값', () => {
  assert.deepEqual(parseJsonOr('{"a":1}'), { a: 1 });
  assert.equal(parseJsonOr('{깨짐'), null);
  assert.deepEqual(parseJsonOr(null, {}), {});
});

test('buildAnalysis: 실패 이유를 점검별로 모아 많은 순, 기간 밖은 빼고, 분석 전 날은 따로 센다', () => {
  const hourly = (h, t, f, s) => Array.from({ length: 24 }, (_, i) => (i === h ? [t, f, s] : [0, 0, 0]));
  const checks = [{ id: 1, name: 'A (HTTP)', kind: 'http' }, { id: 2, name: 'A (DNS)', kind: 'dns' }];
  const stats = [
    // 2026-11-19는 목요일(3)
    { monitorId: 1, day: '2026-11-19', avgResponseMs: 120, p95ResponseMs: 300, hourly: hourly(14, 12, 2, 1), failures: { timeout: 2 } },
    { monitorId: 2, day: '2026-11-19', avgResponseMs: 20, p95ResponseMs: 40, hourly: hourly(14, 12, 1, 0), failures: { timeout: 1 } },
    { monitorId: 2, day: '2026-11-20', avgResponseMs: 22, p95ResponseMs: 45, hourly: hourly(3, 12, 3, 0), failures: { dns_error: 3 } },
    { monitorId: 1, day: '2026-11-20', avgResponseMs: null, p95ResponseMs: null, hourly: null, failures: {} }, // 아직 분석 전
    { monitorId: 1, day: '2026-11-01', avgResponseMs: 1, p95ResponseMs: 1, hourly: hourly(0, 99, 99, 0), failures: { timeout: 99 } }, // 기간 밖
    { monitorId: 9, day: '2026-11-20', avgResponseMs: 1, p95ResponseMs: 1, hourly: hourly(0, 99, 99, 0), failures: { timeout: 99 } }, // 다른 서비스
  ];
  const a = buildAnalysis({ checks, stats, today: '2026-11-20', days: 7, reasonText: { timeout: '응답 시간 초과' } });

  assert.equal(a.from, '2026-11-14');
  assert.equal(a.failureTotal, 6);
  assert.deepEqual(a.failures.map((f) => [f.reason, f.text, f.total]), [['dns_error', 'dns_error', 3], ['timeout', '응답 시간 초과', 3]]);
  assert.deepEqual(a.failures[1].byCheck, [{ id: 1, name: 'A (HTTP)', count: 2 }, { id: 2, name: 'A (DNS)', count: 1 }]);

  assert.equal(a.p95.length, 2);
  assert.equal(a.p95[0].points.length, 7);
  assert.deepEqual(a.p95[0].points.at(-2), { day: '2026-11-19', p95Ms: 300, avgMs: 120 });
  assert.deepEqual(a.p95[0].points.at(-1), { day: '2026-11-20', p95Ms: null, avgMs: null });
  assert.deepEqual(a.p95[0].points[0], { day: '2026-11-14', p95Ms: null, avgMs: null });

  assert.deepEqual(a.heatmap.cells[3][14], { total: 24, fail: 3, slow: 1 }); // 목 14시: 두 점검 합
  assert.deepEqual(a.heatmap.cells[4][3], { total: 12, fail: 3, slow: 0 }); // 금 3시
  assert.deepEqual(a.heatmap.cells[0][0], { total: 0, fail: 0, slow: 0 }); // 기간 밖·다른 서비스 값은 없음
  assert.deepEqual(a.coverage, { analyzedDays: 3, pendingDays: 1 });
});

// ── Cron 집계 → 저장 → 공개 API ──

function fakeFetch({ healthOk = true } = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes('cloudflare-dns.com')) {
      return new Response(JSON.stringify({ Status: 0, Answer: [{ name: 'x', type: 1, data: '192.0.2.1' }] }), { status: 200 });
    }
    if (u.endsWith('/chats/api/health')) {
      return new Response(healthOk ? '{"status":"ok"}' : '{"status":"error"}', { status: healthOk ? 200 : 503 });
    }
    return new Response('<title>Keychats</title> 고쳐라', { status: 200 });
  };
}

async function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}

const at = (min) => new Date(Date.UTC(2026, 10, 19, 3, min, 12)); // KST 2026-11-19(목) 12시대

test('Cron: 일별 집계에 p95·시간대별·실패 이유가 함께 저장된다', async () => {
  const db = createFakeD1();
  db.sqlite.exec('UPDATE monitors SET is_active = 1 WHERE service_id IS NOT NULL');
  await quiet(async () => {
    await runChecks({ DB: db }, at(0), { fetchFn: fakeFetch() });
    await runChecks({ DB: db }, at(5), { fetchFn: fakeFetch({ healthOk: false }) });
  });
  const health = db.sqlite.prepare(
    "SELECT d.* FROM daily_stats d JOIN monitors m ON m.id = d.monitor_id WHERE m.url LIKE '%/chats/api/health'"
  ).get();
  assert.equal(health.day, '2026-11-19');
  assert.deepEqual(JSON.parse(health.failures), { status_mismatch: 1 });
  assert.deepEqual(JSON.parse(health.hourly)[12], [2, 1, 0]);
  assert.equal(typeof health.p95_response_ms, 'number');
});

test('backfillAnalysis: 분석 값이 빈 과거 날을 회차마다 정해진 수만큼 원본에서 채운다', async () => {
  const db = createFakeD1();
  const ids = db.sqlite.prepare('SELECT id FROM monitors WHERE service_id IS NOT NULL ORDER BY id').all().map((x) => x.id);
  const ins = db.sqlite.prepare(
    "INSERT INTO check_results (monitor_id, checked_at, is_success, is_slow, response_ms, failure_reason, source) VALUES (?, ?, ?, 0, ?, ?, 'real')"
  );
  const stat = db.sqlite.prepare(
    "INSERT INTO daily_stats (monitor_id, day, total_checks, success_checks, slow_checks, avg_response_ms, source, updated_at) VALUES (?, ?, 2, 1, 0, 100, 'real', 'x')"
  );
  // 0017 이전처럼 분석 열이 빈 일별 집계 10개 (점검 5개 × 2일)
  for (const id of ids) {
    for (const day of ['2026-11-17', '2026-11-18']) {
      ins.run(id, `${day}T01:00:00Z`, 1, 100, null); // KST 10시
      ins.run(id, `${day}T01:05:00Z`, 0, null, 'timeout');
      stat.run(id, day);
    }
  }
  // 원본이 없는 날(지운 기록)도 하나
  stat.run(ids[0], '2026-11-10');
  const missing = () => db.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_stats WHERE hourly IS NULL').get().n;
  assert.equal(missing(), 11);

  assert.equal(await backfillAnalysis(db), BACKFILL_PER_RUN);
  assert.equal(missing(), 11 - BACKFILL_PER_RUN);
  // 최근 날부터 채움
  const filled = db.sqlite.prepare('SELECT day, hourly, failures, p95_response_ms, total_checks FROM daily_stats WHERE hourly IS NOT NULL').all();
  assert.ok(filled.every((f) => f.day === '2026-11-18' || f.day === '2026-11-17'));
  const one = filled.find((f) => f.day === '2026-11-18');
  assert.deepEqual(JSON.parse(one.hourly)[10], [2, 1, 0]);
  assert.deepEqual(JSON.parse(one.failures), { timeout: 1 });
  assert.equal(one.p95_response_ms, 100);
  assert.equal(one.total_checks, 2); // 가동률 숫자는 건드리지 않음

  await backfillAnalysis(db);
  assert.equal(missing(), 0); // 원본이 없는 날도 빈 값으로 채워서 다시 고르지 않음
  assert.equal(await backfillAnalysis(db), 0);
});

test('GET /api/services/:key/analysis: 기간 검사, 없는 서비스 404, 점검 주소는 공개하지 않음', async () => {
  const db = createFakeD1();
  db.sqlite.exec('UPDATE monitors SET is_active = 1 WHERE service_id IS NOT NULL');
  await quiet(async () => {
    await runChecks({ DB: db }, at(0), { fetchFn: fakeFetch({ healthOk: false }) });
    await runChecks({ DB: db }, at(5), { fetchFn: fakeFetch() });
  });
  const call = (path, method = 'GET') => worker.fetch(new Request(`https://example.test${path}`, { method }), { DB: db });

  assert.equal((await call('/api/services/keychats/analysis?days=14')).status, 400);
  assert.equal((await call('/api/services/keychats/analysis?days=abc')).status, 400);
  assert.equal((await call('/api/services/nope/analysis')).status, 404);
  assert.equal((await call('/api/services/keychats/analysis', 'POST')).status, 405);

  const res = await call('/api/services/keychats/analysis?days=7');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /max-age=60/);
  const text = await res.text();
  assert.ok(!/dns:\/\/|\/api\/health|https:\/\//.test(text), '점검 주소를 공개하지 않음');
  const body = JSON.parse(text);
  assert.equal(body.service.key, 'keychats');
  assert.equal(body.days, 7);
  assert.equal(body.checks.length, 3);
  assert.equal(body.p95.length, 3);

  // 라우트는 실제 시계(new Date())를 쓰므로, 값은 시각을 정해 조립 함수로 확인
  const fixed = await buildServiceAnalysis(db, 'keychats', 7, at(10));
  assert.equal(fixed.to, '2026-11-19');
  assert.equal(fixed.failureTotal, 1);
  assert.equal(fixed.failures[0].reason, 'status_mismatch');
  assert.equal(fixed.failures[0].text, '상태 코드 불일치');
  // 실패한 점검은 상태 확인 주소 하나뿐 (HTTP·DNS는 성공)
  assert.equal(fixed.failures[0].byCheck.length, 1);
  assert.equal(fixed.failures[0].byCheck[0].count, 1);
  assert.deepEqual(fixed.heatmap.cells[3][12], { total: 6, fail: 1, slow: 0 }); // 목 12시: 점검 3개 × 2회
  assert.equal(fixed.p95.find((s) => s.kind === 'dns').points.at(-1).day, '2026-11-19');
  assert.deepEqual(fixed.coverage, { analyzedDays: 3, pendingDays: 0 });
});
