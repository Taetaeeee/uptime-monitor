// 일별 집계·가동률 계산 — 순수 함수
//
// 시각은 UTC로 저장하지만 "하루"는 한국 시간(KST, UTC+9) 0시~24시로 자릅니다.
// 한국은 서머타임이 없어서 항상 +9시간만 더하면 돼요. (다른 나라였다면 시간대 라이브러리가 필요)

import { toIsoSeconds } from './time.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** UTC ISO 시각 → 한국 날짜 'YYYY-MM-DD'.  예: 2026-11-10T15:30:00Z → 2026-11-11 */
export function toKstDay(isoUtc) {
  return new Date(Date.parse(isoUtc) + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 한국 날짜 하루의 UTC 범위 [start, end).  end는 포함하지 않습니다.
 * 예: 2026-11-11 → 2026-11-10T15:00:00Z ~ 2026-11-11T15:00:00Z
 * 반쯤 열린 범위로 두는 이유: 자정 정각 회차가 두 날에 중복으로 세이지 않게 하려고요.
 */
export function kstDayRange(day) {
  const start = Date.parse(`${day}T00:00:00Z`) - KST_OFFSET_MS;
  return { startUtc: toIsoSeconds(new Date(start)), endUtc: toIsoSeconds(new Date(start + DAY_MS)) };
}

/** 날짜 문자열에 n일을 더한다.  addDays('2026-11-01', -1) → '2026-10-31' */
export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * 가동률(%) = 성공 점검 수 ÷ 전체 점검 수.  점검이 없으면 null (0%와 구분하기 위해).
 * 소수 둘째 자리에서 '내림'합니다. 반올림하면 287/288(99.65%)처럼 장애가 있었던 날이
 * 99.99... → 100.00%로 보일 수 있어서, 가동률은 보수적으로 표시하는 것이 원칙이에요.
 */
export function uptimePercent(success, total) {
  if (!total) return null;
  return Math.floor((success * 10000) / total) / 100;
}

/**
 * 하루치 점검 결과를 요약한다.
 * 계획 작업 중 점검(inMaintenance)은 가동률 계산(전체·성공·느림·평균)에서 빼고 개수만 따로 셉니다. (B-5)
 *   → 미리 알린 작업 시간의 중단은 "장애"가 아니므로 가동률을 깎지 않는 것이 SLA의 일반적인 규칙이에요.
 * @param {Array<{isSuccess:boolean, isSlow:boolean, responseMs:number|null, inMaintenance?:boolean}>} rows
 */
export function summarizeDay(rows) {
  const counted = rows.filter((r) => !r.inMaintenance);
  const successes = counted.filter((r) => r.isSuccess);
  const times = successes.map((r) => r.responseMs).filter((ms) => ms !== null && ms !== undefined);
  return {
    totalChecks: counted.length,
    successChecks: successes.length,
    slowChecks: successes.filter((r) => r.isSlow).length,
    // 평균 응답 시간은 성공한 점검만으로 계산 (실패는 응답이 없거나 의미가 달라서)
    avgResponseMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    maintenanceChecks: rows.length - counted.length,
  };
}

/**
 * 최근 N일 막대 데이터를 만든다. 기록이 없는 날도 빈 칸(uptime: null)으로 채워서
 * 막대 개수가 항상 N개가 되게 합니다. (빈 날을 빼면 막대가 당겨져 날짜가 어긋나 보여요)
 *
 * @param {Array<{day:string, totalChecks:number, successChecks:number}>} stats  한 대상의 일별 집계
 * @param {string} today  오늘(KST) 'YYYY-MM-DD'
 * @param {number} days   막대 개수
 * @returns 오래된 날 → 오늘 순서
 */
export function buildDailyBars(stats, today, days = 30) {
  const byDay = new Map(stats.map((s) => [s.day, s]));
  const bars = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    const s = byDay.get(day);
    bars.push({
      day,
      total: s ? s.totalChecks : 0,
      uptime: s ? uptimePercent(s.successChecks, s.totalChecks) : null,
      // 그날 성공한 점검의 평균 응답 시간 (상세 팝업의 '30일 일평균 응답' 그래프용)
      avgResponseMs: s?.avgResponseMs ?? null,
    });
  }
  return bars;
}

/** 여러 날 집계를 합친 전체 가동률(%). 하루 평균의 평균이 아니라 점검 수를 모두 더해서 계산합니다. */
export function overallUptime(stats) {
  const total = stats.reduce((a, s) => a + s.totalChecks, 0);
  const success = stats.reduce((a, s) => a + s.successChecks, 0);
  return uptimePercent(success, total);
}
