// 월간 보고서 API 테스트 (B-6) — 가짜 D1 + 실제 시드(seed/sample.sql)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeD1 } from './helpers/fake-d1.js';
import { buildMonthlyReport } from '../src/api.js';
import { kstMonthOf, monthRange } from '../src/report.js';
import worker from '../src/index.js';

const SEED_SQL = readFileSync(new URL('../seed/sample.sql', import.meta.url), 'utf8');

// 시드는 SQLite의 'now' 기준으로 날짜를 만들므로 보고서도 현재 시각으로 계산합니다.
function seeded() {
  const db = createFakeD1();
  db.sqlite.exec(SEED_SQL);
  return db;
}

test('이번 달 보고서: 출처별 묶음(실제 → 데모), 실제·가짜를 합친 숫자 없음', async () => {
  const db = seeded();
  const now = new Date();
  const month = kstMonthOf(now);
  const r = await buildMonthlyReport(db, month, now);

  assert.equal(r.month, month);
  assert.equal(r.targetPercent, 99.9);
  assert.equal(r.period.inProgress, true);
  assert.deepEqual(r.groups.map((g) => g.source), ['real', 'sample']);
  assert.ok(r.months.includes(month));
  // 전사 합계 같은 필드가 없어야 함
  assert.equal('overall' in r, false);

  // 실제 대상(gochyeora)은 기록 없음 → 판단 불가
  const real = r.groups[0].services[0];
  assert.equal(real.uptime, null);
  assert.equal(real.slaMet, null);
  // 공개 응답에 점검 주소 없음
  for (const g of r.groups) assert.ok(g.services.every((s) => !('url' in s)));
});

test('보고서 숫자가 원본(daily_stats·incidents)과 일치', async () => {
  const db = seeded();
  const now = new Date();
  const month = kstMonthOf(now);
  const range = monthRange(month);
  const r = await buildMonthlyReport(db, month, now);
  const erp = r.groups.find((g) => g.source === 'sample').services.find((s) => s.name === '○○산업 ERP');
  const erpId = db.sqlite.prepare("SELECT id FROM monitors WHERE url = 'https://erp.ooindustry.invalid'").get().id;

  const sums = db.sqlite
    .prepare('SELECT SUM(total_checks) AS t, SUM(success_checks) AS s FROM daily_stats WHERE monitor_id = ? AND day BETWEEN ? AND ?')
    .get(erpId, range.startDay, range.endDay);
  assert.equal(erp.totalChecks, sums.t);
  assert.equal(erp.successChecks, sums.s);

  const incCount = db.sqlite
    .prepare('SELECT COUNT(*) AS n FROM incidents WHERE monitor_id = ? AND started_at < ? AND (resolved_at IS NULL OR resolved_at > ?)')
    .get(erpId, range.endUtc, range.startUtc).n;
  assert.equal(erp.incidentCount, incCount);
});

test('HTTP: 잘못된 달은 400, 기본값은 이번 달, 60초 캐시', async () => {
  const env = { DB: seeded() };
  const bad = await worker.fetch(new Request('https://example.invalid/api/reports/monthly?month=2026-13'), env);
  assert.equal(bad.status, 400);

  const ok = await worker.fetch(new Request('https://example.invalid/api/reports/monthly'), env);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'public, max-age=60');
  assert.equal((await ok.json()).month, kstMonthOf(new Date()));

  // 기록이 없는 달도 오류 없이 빈 보고서
  const empty = await (await worker.fetch(new Request('https://example.invalid/api/reports/monthly?month=2020-01'), env)).json();
  assert.ok(empty.groups.every((g) => g.services.every((s) => s.uptime === null)));
});
