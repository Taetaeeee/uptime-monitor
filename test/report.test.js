// 월간 가용성 보고서 순수 함수 테스트 (B-6) — 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthRange, kstMonthOf, clipMinutes, errorBudget, summarizeMonth, isValidMonth } from '../src/report.js';

test('한 달의 범위: KST 1일 0시 ~ 다음 달 1일 0시 (UTC로는 전날 15시)', () => {
  assert.deepEqual(monthRange('2026-11'), {
    month: '2026-11',
    startDay: '2026-11-01',
    endDay: '2026-11-30',
    daysInMonth: 30,
    startUtc: '2026-10-31T15:00:00Z',
    endUtc: '2026-11-30T15:00:00Z',
  });
});

test('달의 날 수: 2월·윤년, 12월 → 다음 해', () => {
  assert.equal(monthRange('2026-02').daysInMonth, 28);
  assert.equal(monthRange('2028-02').daysInMonth, 29); // 윤년
  const dec = monthRange('2026-12');
  assert.equal(dec.endDay, '2026-12-31');
  assert.equal(dec.endUtc, '2026-12-31T15:00:00Z'); // 2027-01-01 00:00 KST
});

test('KST 달: UTC 10월 31일 15시는 한국 11월 1일', () => {
  assert.equal(kstMonthOf(new Date('2026-10-31T14:59:59Z')), '2026-10');
  assert.equal(kstMonthOf(new Date('2026-10-31T15:00:00Z')), '2026-11');
});

test('달 형식 검증', () => {
  assert.equal(isValidMonth('2026-11'), true);
  for (const bad of ['2026-13', '2026-1', '26-11', '2026-11-01', null]) assert.equal(isValidMonth(bad), false, String(bad));
});

test('장애 시간 자르기: 달 경계를 넘는 장애는 이 달 부분만', () => {
  const { startUtc, endUtc } = monthRange('2026-11'); // 10-31T15:00Z ~ 11-30T15:00Z
  const now = new Date('2026-12-05T00:00:00Z');
  // 10월 31일 14:30Z(한국 23:30) 시작 → 15:30Z 복구: 11월 부분은 30분
  assert.equal(clipMinutes({ startedAt: '2026-10-31T14:30:00Z', resolvedAt: '2026-10-31T15:30:00Z' }, startUtc, endUtc, now), 30);
  // 이 달 안에서 시작·종료
  assert.equal(clipMinutes({ startedAt: '2026-11-10T03:00:00Z', resolvedAt: '2026-11-10T04:05:00Z' }, startUtc, endUtc, now), 65);
  // 진행 중: 지금(이 달 범위 밖)까지가 아니라 달 끝까지만
  assert.equal(clipMinutes({ startedAt: '2026-11-30T14:00:00Z', resolvedAt: null }, startUtc, endUtc, now), 60);
  // 다른 달 장애
  assert.equal(clipMinutes({ startedAt: '2026-12-01T00:00:00Z', resolvedAt: '2026-12-01T01:00:00Z' }, startUtc, endUtc, now), 0);
});

test('에러 버짓: 30일 × 288회, 목표 99.9% → 허용 43.2분', () => {
  const total = 8640;
  assert.deepEqual(errorBudget(total, total), { allowedMinutes: 43.2, usedMinutes: 0, remainingPercent: 100 });
  assert.deepEqual(errorBudget(total, total - 4), { allowedMinutes: 43.2, usedMinutes: 20, remainingPercent: 53.7 });
  // 목표를 넘기면 남은 비율이 음수
  assert.equal(errorBudget(total, total - 13).remainingPercent < 0, true);
  assert.deepEqual(errorBudget(0, 0), { allowedMinutes: null, usedMinutes: null, remainingPercent: null });
});

test('대상 월간 요약', () => {
  const range = monthRange('2026-11');
  const now = new Date('2026-12-01T00:00:00Z');
  const stats = [
    { day: '2026-11-01', totalChecks: 288, successChecks: 288, maintenanceChecks: 0, avgResponseMs: 100 },
    { day: '2026-11-02', totalChecks: 264, successChecks: 260, maintenanceChecks: 24, avgResponseMs: 400 },
  ];
  const incidents = [
    { id: 7, startedAt: '2026-11-02T03:00:00Z', detectedAt: '2026-11-02T03:05:00Z', resolvedAt: '2026-11-02T03:20:00Z' },
  ];
  const s = summarizeMonth(stats, incidents, range, now);
  assert.equal(s.totalChecks, 552);
  assert.equal(s.failedChecks, 4);
  assert.equal(s.uptime, 99.27);             // 548/552 = 99.275… → 내림
  assert.equal(s.slaMet, false);
  assert.equal(s.maintenanceMinutes, 120);    // 24회 × 5분
  assert.equal(s.avgResponseMs, Math.round((100 * 288 + 400 * 260) / 548)); // 성공 수로 가중 평균
  assert.equal(s.incidentCount, 1);
  assert.equal(s.incidentMinutes, 20);
  assert.equal(s.avgDetectMinutes, 5);
  assert.equal(s.avgRecoverMinutes, 20);
  assert.deepEqual(s.longestIncident, { id: 7, minutes: 20 });
  assert.equal(s.coverageDays, 2);
});

test('기록이 없으면 가동률·SLA는 판단하지 않음(null)', () => {
  const s = summarizeMonth([], [], monthRange('2026-11'), new Date('2026-12-01T00:00:00Z'));
  assert.equal(s.uptime, null);
  assert.equal(s.slaMet, null);
  assert.equal(s.coverageDays, 0);
  assert.equal(s.longestIncident, null);
});
