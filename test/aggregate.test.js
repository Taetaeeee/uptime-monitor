// 일별 집계·가동률 순수 함수 테스트 — 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toKstDay,
  kstDayRange,
  addDays,
  uptimePercent,
  summarizeDay,
  buildDailyBars,
  overallUptime,
} from '../src/aggregate.js';

test('UTC → 한국 날짜: UTC 15:00부터는 한국의 다음 날', () => {
  assert.equal(toKstDay('2026-11-10T14:55:00Z'), '2026-11-10'); // 한국 23:55
  assert.equal(toKstDay('2026-11-10T15:00:00Z'), '2026-11-11'); // 한국 다음 날 00:00
});

test('한국 하루의 UTC 범위는 전날 15:00 ~ 당일 15:00 (끝 미포함)', () => {
  assert.deepEqual(kstDayRange('2026-11-11'), {
    startUtc: '2026-11-10T15:00:00Z',
    endUtc: '2026-11-11T15:00:00Z',
  });
});

test('날짜 더하기는 월·연도 경계를 넘는다', () => {
  assert.equal(addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('가동률: 소수 둘째 자리 내림, 점검이 없으면 null', () => {
  assert.equal(uptimePercent(288, 288), 100);
  assert.equal(uptimePercent(287, 288), 99.65); // 반올림이면 99.65, 그대로
  assert.equal(uptimePercent(2879, 2880), 99.96); // 99.9652… → 내림 99.96 (반올림이면 99.97)
  assert.equal(uptimePercent(9999, 10000), 99.99); // 100으로 보이면 안 됨
  assert.equal(uptimePercent(0, 0), null);
});

test('하루 요약: 느림은 성공에 포함, 평균 응답 시간은 성공만으로', () => {
  const s = summarizeDay([
    { isSuccess: true, isSlow: false, responseMs: 100 },
    { isSuccess: true, isSlow: true, responseMs: 3500 },
    { isSuccess: false, isSlow: false, responseMs: null }, // 시간 초과
    { isSuccess: false, isSlow: false, responseMs: 50 },   // 503 같은 실패 응답은 평균에서 제외
  ]);
  assert.deepEqual(s, { totalChecks: 4, successChecks: 2, slowChecks: 1, avgResponseMs: 1800, maintenanceChecks: 0 });
});

test('하루 요약: 계획 작업 중 점검은 가동률 계산에서 빼고 개수만 센다 (B-5)', () => {
  const s = summarizeDay([
    { isSuccess: true, isSlow: false, responseMs: 100 },
    { isSuccess: false, isSlow: false, responseMs: null, inMaintenance: true }, // 작업 중 실패 → 제외
    { isSuccess: true, isSlow: false, responseMs: 900, inMaintenance: true },   // 작업 중 성공도 제외
  ]);
  assert.deepEqual(s, { totalChecks: 1, successChecks: 1, slowChecks: 0, avgResponseMs: 100, maintenanceChecks: 2 });
});

test('하루 요약: 성공이 없으면 평균 응답 시간 null', () => {
  assert.equal(summarizeDay([{ isSuccess: false, isSlow: false, responseMs: null }]).avgResponseMs, null);
});

test('30일 막대: 기록 없는 날도 빈 칸으로 채워 항상 30개, 오래된 날 → 오늘 순서', () => {
  const bars = buildDailyBars(
    [
      { day: '2026-11-10', totalChecks: 288, successChecks: 288 },
      { day: '2026-11-08', totalChecks: 288, successChecks: 276 },
    ],
    '2026-11-10',
    30
  );
  assert.equal(bars.length, 30);
  assert.equal(bars[0].day, '2026-10-12');
  assert.deepEqual(bars[29], { day: '2026-11-10', total: 288, uptime: 100 });
  assert.deepEqual(bars[28], { day: '2026-11-09', total: 0, uptime: null });
  assert.equal(bars[27].uptime, 95.83);
});

test('전체 가동률은 날짜별 %의 평균이 아니라 점검 수 합계로 계산', () => {
  // 하루는 10회 중 0회 성공(0%), 하루는 290회 모두 성공(100%)
  // 날짜 평균이면 50%지만, 실제로는 300회 중 290회 = 96.66%
  const u = overallUptime([
    { totalChecks: 10, successChecks: 0 },
    { totalChecks: 290, successChecks: 290 },
  ]);
  assert.equal(u, 96.66);
  assert.equal(overallUptime([]), null);
});
