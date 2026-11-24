// 주간 서비스 점검 보고서 (20단계: weekly-report.js + /api/services/:key/weekly) 테스트
// 실제 사이트에는 요청하지 않고, 손으로 만든 입력과 가짜 D1로 "일별 집계 → 주간 요약 → 공개 API"를 확인합니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './helpers/fake-d1.js';
import {
  isWeekStart, weekStartOf, thisWeekStart, lastCompleteWeekStart, recentWeekStarts, weekRange,
  summarizeWeek, renderWeeklyText, minutesText, kstStamp, VERDICT,
  CHANGE_LIST_LIMIT, NOISY_CHANGES_PER_WEEK,
} from '../src/weekly-report.js';
import { addDays } from '../src/aggregate.js';
import { buildWeeklyReport } from '../src/api.js';
import worker from '../src/index.js';

// 2026-11-16(월) ~ 11-22(일)이 "이번에 보는 주", 11-09 ~ 11-15가 전주
const WEEK = '2026-11-16';
const range = weekRange(WEEK);
const NOW = new Date('2026-11-23T01:00:00Z'); // 한국 시간 월요일 오전 10시 → 위 주는 방금 끝남
const TODAY = '2026-11-23';

// ── 주 계산 ──

test('isWeekStart: 실제로 있는 월요일만 통과', () => {
  assert.equal(isWeekStart('2026-11-16'), true);
  for (const bad of ['2026-11-17', '2026-11-22', '2026-02-30', '2026-1-16', '2026-11-16T00:00', '', null, undefined, 20261116]) {
    assert.equal(isWeekStart(bad), false, String(bad));
  }
});

test('주 시작·지난 주: 한국 시간 자정(UTC 15시)에서 주가 바뀐다', () => {
  assert.equal(weekStartOf('2026-11-16'), '2026-11-16');
  assert.equal(weekStartOf('2026-11-22'), '2026-11-16'); // 일요일은 그 주의 마지막 날
  assert.equal(thisWeekStart(new Date('2026-11-22T14:59:59Z')), '2026-11-16'); // KST 일요일 23:59:59
  assert.equal(thisWeekStart(new Date('2026-11-22T15:00:00Z')), '2026-11-23'); // KST 월요일 00:00:00
  assert.equal(lastCompleteWeekStart(new Date('2026-11-22T14:59:59Z')), '2026-11-09'); // 아직 그 주 안이라 직전 주는 11-09
  assert.equal(lastCompleteWeekStart(NOW), '2026-11-16');
  assert.deepEqual(recentWeekStarts(NOW, 3), ['2026-11-23', '2026-11-16', '2026-11-09']); // 진행 중인 주부터
});

test('weekRange: 월 00:00 ~ 다음 월 00:00 (KST), 전주 범위 포함', () => {
  assert.deepEqual(range, {
    startDay: '2026-11-16',
    endDay: '2026-11-22',
    prevStartDay: '2026-11-09',
    prevEndDay: '2026-11-15',
    startUtc: '2026-11-15T15:00:00Z',
    endUtc: '2026-11-22T15:00:00Z',
  });
});

// ── 입력 만들기 ──

const days = (from, n) => Array.from({ length: n }, (_, i) => addDays(from, i));
const slot = (day, o = {}) => ({ day, totalSlots: 288, upSlots: 288, slowSlots: 0, ...o });
const calm = () => [...days('2026-11-09', 14).map((d) => slot(d))]; // 전주 + 이번 주, 모두 정상
const stat = (day, o = {}) => ({ day, successChecks: 288, avgResponseMs: 120, p95ResponseMs: 200, ...o });
const check = (over = {}) => ({
  id: 1, name: '웹 (HTTP)', kind: 'http', stats: days('2026-11-09', 14).map((d) => stat(d, over)),
});
const run = (over = {}) =>
  summarizeWeek({ range, today: TODAY, now: NOW, slots: calm(), checks: [check()], incidents: [], changes: [], ...over });

// ── 판정 ──

test('무사고 주: 이상 없음, 가동률 100%, 전주와 같음, 안내 없음', () => {
  const s = run();
  assert.equal(s.verdict, VERDICT.QUIET);
  assert.equal(s.verdictText, '이상 없음');
  assert.equal(s.uptime, 100);
  assert.equal(s.uptimeDelta, 0);
  assert.equal(s.incidentCount, 0);
  assert.equal(s.period.coverageDays, 7);
  assert.equal(s.period.expectedDays, 7);
  assert.equal(s.period.inProgress, false);
  assert.deepEqual(s.notes, []);
  assert.equal(s.checks[0].avgResponseMs, 120);
  assert.equal(s.checks[0].changePercent, 0);
  assert.equal(s.checks[0].p95WorstMs, 200);
});

test('가동률은 하루 평균의 평균이 아니라 회차를 모두 더해 계산하고 내림한다', () => {
  const slots = calm().map((s) => (s.day === '2026-11-18' ? { ...s, upSlots: 287 } : s)); // 하루에 1회차 실패
  const s = run({ slots });
  assert.equal(s.totalSlots, 288 * 7);
  assert.equal(s.failedSlots, 1);
  assert.equal(s.uptime, 99.95); // 2015/2016 = 99.9503… → 내림
  assert.equal(s.uptimeDelta, -0.05);
  assert.equal(s.verdict, VERDICT.QUIET); // 장애 판정(2회 연속 실패)이 아니면 기록·판정만 달라지지 않음
});

test('장애가 있으면 장애 있었음 — 겹친 점검 장애는 영향 시간을 한 번만 센다', () => {
  const incidents = [
    { id: 11, monitorName: '웹 (HTTP)', startedAt: '2026-11-17T01:00:00Z', detectedAt: '2026-11-17T01:05:00Z', resolvedAt: '2026-11-17T01:15:00Z', cause: 'timeout' },
    { id: 12, monitorName: 'DNS', startedAt: '2026-11-17T01:05:00Z', detectedAt: '2026-11-17T01:10:00Z', resolvedAt: '2026-11-17T01:20:00Z', cause: 'dns_error' },
  ];
  const s = run({ incidents });
  assert.equal(s.verdict, VERDICT.INCIDENT);
  assert.equal(s.incidentCount, 2); // 점검 단위 기록 수
  assert.equal(s.incidentMinutes, 20); // 01:00~01:20 (겹침 합침), 15+15=30이 아님
  assert.deepEqual(s.longestIncident, { id: 11, minutes: 15 });
  assert.deepEqual(s.incidents.map((i) => i.id), [11, 12]);
  assert.equal(s.ongoingIncidents, 0);
});

test('주 경계에 걸친 장애는 이 주에 속한 부분만 센다', () => {
  const incidents = [
    { id: 21, startedAt: '2026-11-15T14:50:00Z', detectedAt: '2026-11-15T14:55:00Z', resolvedAt: '2026-11-15T15:20:00Z', cause: null }, // 일요일 23:50 ~ 월요일 00:20
  ];
  const s = run({ incidents });
  assert.equal(s.incidentMinutes, 20); // 월요일 00:00~00:20만
  assert.equal(s.longestIncident.minutes, 20);
});

test('진행 중인 장애는 주 끝까지로 자르고, 진행 중으로 표시한다', () => {
  const incidents = [
    { id: 31, startedAt: '2026-11-22T14:00:00Z', detectedAt: '2026-11-22T14:05:00Z', resolvedAt: null, cause: 'timeout' },
  ];
  const s = run({ incidents });
  assert.equal(s.incidentMinutes, 60); // 14:00 ~ 주 끝(15:00)
  assert.equal(s.ongoingIncidents, 1);
  assert.match(renderWeeklyText('테스트', s), /진행 중 1건/);
});

test('장애 기록은 집계 행이 아직 없어도 "기록 없음"보다 먼저 본다', () => {
  const incidents = [{ id: 41, startedAt: '2026-11-17T01:00:00Z', detectedAt: '2026-11-17T01:05:00Z', resolvedAt: '2026-11-17T01:15:00Z', cause: null }];
  assert.equal(run({ slots: [], incidents }).verdict, VERDICT.INCIDENT);
});

test('평균 응답이 크게 느려지면 주의 — 비율과 늘어난 양이 모두 기준을 넘고 표본이 충분할 때만', () => {
  const slower = (thisWeek) =>
    check().stats.map((s) => (s.day >= WEEK ? { ...s, avgResponseMs: thisWeek } : s));
  const mk = (thisWeek, over = {}) => run({ checks: [{ ...check(), stats: slower(thisWeek).map((s) => ({ ...s, ...over })) }] });

  const bad = mk(250); // 120 → 250 (+108%, +130ms)
  assert.equal(bad.checks[0].changePercent, 108);
  assert.equal(bad.checks[0].slower, true);
  assert.equal(bad.verdict, VERDICT.WATCH);
  assert.match(renderWeeklyText('테스트', bad), /느려짐/);

  // 비율은 크지만(+60%) 늘어난 양이 작으면(30ms) 잡음으로 보고 넘어감
  const small = run({ checks: [{ ...check(), stats: check().stats.map((s) => ({ ...s, avgResponseMs: s.day >= WEEK ? 80 : 50 })) }] });
  assert.equal(small.checks[0].changePercent, 60);
  assert.equal(small.checks[0].slower, false);
  assert.equal(small.verdict, VERDICT.QUIET);

  // 표본이 적으면(하루 성공 점검 10개 → 7일 70개) 비교하지 않음
  const few = mk(500, { successChecks: 10 });
  assert.equal(few.checks[0].trendReliable, false);
  assert.equal(few.checks[0].slower, false);
  assert.equal(few.verdict, VERDICT.QUIET);
});

test('느린 회차가 5% 이상이면 주의, 그 아래면 이상 없음', () => {
  const withSlow = (n) => calm().map((s) => (s.day >= WEEK ? { ...s, slowSlots: n } : s));
  assert.equal(run({ slots: withSlow(20) }).verdict, VERDICT.WATCH); // 20/288 = 6.9%
  assert.equal(run({ slots: withSlow(10) }).verdict, VERDICT.QUIET); // 3.5%
  assert.equal(run({ slots: withSlow(15) }).verdict, VERDICT.WATCH); // 15/288 = 5.2%
});

test('기록이 없는 주는 이상 없음이 아니라 기록 없음', () => {
  const s = run({ slots: [], checks: [] });
  assert.equal(s.verdict, VERDICT.NODATA);
  assert.equal(s.uptime, null);
  const text = renderWeeklyText('테스트', s);
  assert.match(text, /판정: 기록 없음/);
  assert.match(text, /점검 기록이 없습니다/);
  assert.doesNotMatch(text, /이상 없음/);
});

test('진행 중인 주·일부만 측정한 주·전주 기록 없음은 안내 문구가 붙는다', () => {
  // 수요일(11-18)까지만 지난 주, 월·화 이틀만 측정, 전주 기록 없음
  const s = summarizeWeek({
    range, today: '2026-11-18', now: new Date('2026-11-18T03:00:00Z'),
    slots: [slot('2026-11-17'), slot('2026-11-18')], checks: [], incidents: [], changes: [],
  });
  assert.equal(s.period.expectedDays, 3);
  assert.equal(s.period.coverageDays, 2);
  assert.equal(s.period.inProgress, true);
  assert.equal(s.prevUptime, null);
  assert.equal(s.uptimeDelta, null);
  assert.deepEqual(s.notes, [
    '진행 중인 주라 숫자가 계속 바뀝니다.',
    '이번 주 측정 기록이 2/3일뿐이라 가동률과 전주 비교가 실제와 다를 수 있습니다.',
    '전주 기록이 없어 전주와 비교하지 않았습니다.',
  ]);
});

test('첫 화면 변경: 시각은 최근 10개만, 너무 자주 바뀌면 동적 내용 안내', () => {
  const changes = Array.from({ length: NOISY_CHANGES_PER_WEEK }, (_, i) => ({
    firstSeenAt: `2026-11-17T${String(i).padStart(2, '0')}:00:00Z`, monitorName: '웹 (HTTP)',
  }));
  const s = run({ changes });
  assert.equal(s.changeCount, NOISY_CHANGES_PER_WEEK);
  assert.equal(s.changes.length, CHANGE_LIST_LIMIT);
  assert.equal(s.changes.at(-1).firstSeenAt, changes.at(-1).firstSeenAt); // 가장 최근 것이 남음
  assert.ok(s.notes.some((n) => n.includes('동적 내용')));
  assert.match(renderWeeklyText('테스트', s), /\(.*…\)/); // 더 있다는 표시

  const few = run({ changes: changes.slice(0, 2) });
  assert.equal(few.notes.length, 0);
  assert.match(renderWeeklyText('테스트', few), /배포 추정\(첫 화면 변경\): 2회 \(11\/17 09:00, 11\/17 10:00\)/); // UTC 0·1시 = KST 9·10시
});

// ── 복사용 텍스트 ──

test('복사용 텍스트: 한 줄 판정과 숫자, 링크. 점검 주소·소유자 정보는 없다', () => {
  const s = run({ changes: [{ firstSeenAt: '2026-11-18T05:30:00Z', monitorName: '웹 (HTTP)' }] });
  const text = renderWeeklyText('고쳐라!', s, 'https://monitor.example/weekly.html?key=gochyeora&week=2026-11-16');
  assert.equal(
    text,
    [
      '[주간 점검 보고] 고쳐라! · 2026-11-16 ~ 2026-11-22 (월~일, 한국 시간)',
      '판정: 이상 없음',
      '- 가동률: 100% (전주 100%, 0%p)',
      '- 장애: 없음',
      '- 응답 시간(웹 (HTTP)): 평균 120ms (전주 120ms, 0%) · 가장 느린 날 p95 200ms',
      '- 배포 추정(첫 화면 변경): 1회 (11/18 14:30)',
      '- 측정 기간: 7/7일',
      '자세히: https://monitor.example/weekly.html?key=gochyeora&week=2026-11-16',
    ].join('\n')
  );
  assert.doesNotMatch(text, /dns:\/\//);
});

test('서식 도우미: 분 표시, 한국 시각 표시', () => {
  assert.equal(minutesText(0), '0분');
  assert.equal(minutesText(15), '15분');
  assert.equal(minutesText(60), '1시간');
  assert.equal(minutesText(65), '1시간 5분');
  assert.equal(minutesText(null), '-');
  assert.equal(kstStamp('2026-11-17T15:05:00Z'), '11/18 00:05'); // 자정을 넘기면 날짜가 바뀜
});

// ── 공개 API (가짜 D1) ──

const serviceIds = (db, key) => ({
  serviceId: db.sqlite.prepare('SELECT id FROM services WHERE service_key = ?').get(key).id,
  monitors: db.sqlite.prepare('SELECT m.id, m.kind FROM monitors m JOIN services s ON s.id = m.service_id WHERE s.service_key = ? ORDER BY m.id').all(key),
});

function seed(db) {
  const { serviceId, monitors } = serviceIds(db, 'gochyeora');
  const http = monitors.find((m) => m.kind === 'http');
  const dns = monitors.find((m) => m.kind === 'dns');
  const now = '2026-11-23T00:00:00Z';
  for (const d of days('2026-11-09', 14)) {
    // 이번 주 월요일(11-16)에는 1회차 실패
    const up = d === '2026-11-16' ? 287 : 288;
    db.sqlite
      .prepare('INSERT INTO service_daily_stats (service_id, day, total_slots, up_slots, slow_slots, updated_at) VALUES (?, ?, 288, ?, 0, ?)')
      .run(serviceId, d, up, now);
    for (const [m, avg, p95] of [[http, d >= '2026-11-16' ? 300 : 120, 450], [dns, 20, 40]]) {
      db.sqlite
        .prepare('INSERT INTO daily_stats (monitor_id, day, total_checks, success_checks, slow_checks, avg_response_ms, updated_at, p95_response_ms) VALUES (?, ?, 288, 288, 0, ?, ?, ?)')
        .run(m.id, d, avg, now, p95);
    }
  }
  const insertChange = db.sqlite.prepare(
    "INSERT INTO content_changes (monitor_id, first_seen_at, confirmed_at, old_hash, new_hash, old_size, new_size) VALUES (?, ?, ?, 'a', 'b', 100, 120)"
  );
  insertChange.run(http.id, '2026-11-15T15:00:00Z', '2026-11-15T15:05:00Z'); // 이번 주 시작 정각 → 이번 주
  insertChange.run(http.id, '2026-11-22T14:55:00Z', '2026-11-22T15:00:00Z'); // 이번 주 마지막 회차 → 이번 주
  insertChange.run(http.id, '2026-11-22T15:00:00Z', '2026-11-22T15:05:00Z'); // 다음 주 시작 정각 → 다음 주 (중복으로 세지 않음)
  insertChange.run(http.id, '2026-11-15T14:55:00Z', '2026-11-15T15:00:00Z'); // 전주 마지막 회차 → 전주 (이번 주 아님)
  db.sqlite
    .prepare("INSERT INTO incidents (monitor_id, started_at, detected_at, resolved_at, cause) VALUES (?, '2026-11-17T01:00:00Z', '2026-11-17T01:05:00Z', '2026-11-17T01:15:00Z', 'timeout')")
    .run(http.id);
  // 다른 서비스의 장애·변경은 섞이지 않아야 함
  const other = serviceIds(db, 'keychats').monitors[0];
  db.sqlite
    .prepare("INSERT INTO incidents (monitor_id, started_at, detected_at, resolved_at, cause) VALUES (?, '2026-11-18T01:00:00Z', '2026-11-18T01:05:00Z', '2026-11-18T01:30:00Z', 'timeout')")
    .run(other.id);
  insertChange.run(other.id, '2026-11-18T03:00:00Z', '2026-11-18T03:05:00Z');
}

test('buildWeeklyReport: 이 서비스의 가동률·장애·응답 시간·변경만 모아 주간 요약을 만든다', async () => {
  const db = createFakeD1();
  seed(db);
  const body = await buildWeeklyReport(db, 'gochyeora', WEEK, NOW, 'https://monitor.example/');
  assert.equal(body.service.key, 'gochyeora');
  assert.equal(body.week, WEEK);
  assert.deepEqual(body.weeks.slice(0, 2), ['2026-11-23', '2026-11-16']);

  const s = body.summary;
  assert.equal(s.verdict, VERDICT.INCIDENT);
  assert.equal(s.uptime, 99.95);
  assert.equal(s.uptimeDelta, -0.05);
  assert.equal(s.incidentCount, 1); // keychats 장애는 없음
  assert.equal(s.incidentMinutes, 15);
  assert.equal(typeof s.incidents[0].causeText, 'string'); // 화면 문구는 서버에서 붙여 줌
  assert.equal(s.changeCount, 2); // 정각 경계 변경이 이번 주·다음 주에 중복되지 않음
  const http = s.checks.find((c) => c.kind === 'http');
  assert.equal(http.avgResponseMs, 300);
  assert.equal(http.prevAvgResponseMs, 120);
  assert.equal(http.p95WorstMs, 450);
  assert.equal(http.slower, true);
  assert.equal(s.checks.find((c) => c.kind === 'dns').slower, false);

  assert.match(body.text, /\[주간 점검 보고\] .* · 2026-11-16 ~ 2026-11-22/);
  assert.match(body.text, /자세히: https:\/\/monitor\.example\/weekly\.html\?key=gochyeora&week=2026-11-16$/);
  // 점검 주소(DNS 점검 주소 등)와 비밀 값은 응답에 없음
  assert.doesNotMatch(JSON.stringify(body), /dns:\/\//);
});

test('buildWeeklyReport: 없는 서비스는 null, 기록이 없는 주는 기록 없음', async () => {
  const db = createFakeD1();
  assert.equal(await buildWeeklyReport(db, 'nope', WEEK, NOW), null);
  const body = await buildWeeklyReport(db, 'keychats', WEEK, NOW);
  assert.equal(body.summary.verdict, VERDICT.NODATA);
  assert.doesNotMatch(body.text, /자세히:/); // 사이트 주소가 없으면 링크 줄을 뺌
});

test('buildWeeklyReport: 내린 서비스는 null', async () => {
  const db = createFakeD1();
  db.sqlite.exec("UPDATE services SET is_active = 0 WHERE service_key = 'keychats'");
  assert.equal(await buildWeeklyReport(db, 'keychats', WEEK, NOW), null);
});

test('GET /api/services/:key/weekly: 검증·상태 코드·캐시', async () => {
  const db = createFakeD1();
  const call = (path, method = 'GET') => worker.fetch(new Request(`https://example.test${path}`, { method }), { DB: db, SITE_URL: 'https://monitor.example' });
  const thisMonday = thisWeekStart(new Date());
  const nextMonday = addDays(thisMonday, 7);

  assert.equal((await call('/api/services/gochyeora/weekly?week=2026-11-17')).status, 400); // 월요일이 아님
  assert.equal((await call('/api/services/gochyeora/weekly?week=abc')).status, 400);
  assert.equal((await call('/api/services/gochyeora/weekly?week=2026-02-30')).status, 400);
  assert.equal((await call(`/api/services/gochyeora/weekly?week=${nextMonday}`)).status, 400); // 아직 시작 안 한 주
  assert.equal((await call('/api/services/nope/weekly')).status, 404);
  assert.equal((await call('/api/services/gochyeora/weekly', 'POST')).status, 405);

  const res = await call('/api/services/gochyeora/weekly'); // 주를 안 적으면 방금 끝난 주
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  const body = await res.json();
  assert.equal(body.week, lastCompleteWeekStart(new Date()));
  assert.equal(body.summary.verdict, VERDICT.NODATA); // 가짜 DB에는 이 주 기록이 없음

  const current = await call(`/api/services/gochyeora/weekly?week=${thisMonday}`); // 진행 중인 주도 볼 수 있음
  assert.equal(current.status, 200);
});
