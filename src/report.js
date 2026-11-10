// 월간 가용성 보고서 계산 — 순수 함수 (B-6)
//
// 입력: 그 달의 일별 집계(daily_stats)와 그 달에 걸친 장애 이력(incidents)
// 출력: 대상별 가동률·SLA 달성·에러 버짓·장애 지표
// 보고서는 볼 때마다 계산합니다(대상당 최대 31행). 숫자를 따로 저장하면 원본과 어긋날 수 있어서예요.

import { KST_OFFSET_MS, uptimePercent } from './aggregate.js';
import { incidentMetrics } from './incident.js';
import { toIsoSeconds, CHECK_INTERVAL_MINUTES } from './time.js';

// SLA 목표 가동률. 대상별로 다르게 하려면 monitors 테이블에 컬럼을 추가해야 합니다(지금은 하나로 고정).
export const SLA_TARGET = 0.999;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isValidMonth = (m) => typeof m === 'string' && MONTH_PATTERN.test(m);

/**
 * KST 기준 한 달의 범위.
 *   '2026-11' → 2026-11-01 ~ 2026-11-30 (30일), UTC로는 2026-10-31T15:00:00Z ~ 2026-11-30T15:00:00Z
 * UTC 범위는 [start, end) — 끝은 포함하지 않음 (다음 달 1일 0시 KST)
 */
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  // Date.UTC의 '다음 달 0일' = 이번 달 마지막 날 → 달의 날 수 (2월·윤년도 자동 처리)
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const startMs = Date.UTC(y, m - 1, 1) - KST_OFFSET_MS;
  const endMs = Date.UTC(y, m, 1) - KST_OFFSET_MS; // m이 12면 다음 해 1월로 넘어감
  return {
    month,
    startDay: `${month}-01`,
    endDay: `${month}-${String(daysInMonth).padStart(2, '0')}`,
    daysInMonth,
    startUtc: toIsoSeconds(new Date(startMs)),
    endUtc: toIsoSeconds(new Date(endMs)),
  };
}

/** 지금(UTC 시각)이 속한 KST 달 'YYYY-MM' */
export function kstMonthOf(date) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 7);
}

/**
 * 장애가 [startUtc, endUtc) 구간에 걸친 시간(분).
 * 달 경계를 넘는 장애는 그 달에 속한 부분만 셉니다. 진행 중이면 지금까지로 계산.
 */
export function clipMinutes(incident, startUtc, endUtc, now) {
  const s = Math.max(Date.parse(incident.startedAt), Date.parse(startUtc));
  const e = Math.min(incident.resolvedAt ? Date.parse(incident.resolvedAt) : now.getTime(), Date.parse(endUtc));
  return Math.max(0, Math.round((e - s) / 60000));
}

/**
 * 에러 버짓: SLA 목표 안에서 "허용되는 중단 시간"과 실제로 쓴 양.
 *   허용(분) = (1 - 목표) × 측정 시간(점검 수 × 5분)
 *   사용(분) = 실패 점검 수 × 5분
 *   남은 비율 = 1 - 사용/허용  (음수면 목표를 넘겨 버린 것)
 * 예: 한 달 8,640회 점검, 목표 99.9% → 허용 약 43.2분
 */
export function errorBudget(totalChecks, successChecks, target = SLA_TARGET) {
  if (!totalChecks) return { allowedMinutes: null, usedMinutes: null, remainingPercent: null };
  const allowed = (1 - target) * totalChecks * CHECK_INTERVAL_MINUTES;
  const used = (totalChecks - successChecks) * CHECK_INTERVAL_MINUTES;
  return {
    allowedMinutes: Math.round(allowed * 10) / 10,
    usedMinutes: used,
    // 소수 첫째 자리 내림 (가동률과 같이 보수적으로)
    remainingPercent: allowed > 0 ? Math.floor((1 - used / allowed) * 1000) / 10 : null,
  };
}

const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/**
 * 대상 1개의 월간 요약.
 * @param {Array} stats      그 대상의 그 달 일별 집계 { day, totalChecks, successChecks, maintenanceChecks, avgResponseMs }
 * @param {Array} incidents  그 대상의 그 달에 걸친 장애 { id, startedAt, detectedAt, resolvedAt }
 * @param {object} range     monthRange() 결과
 * @param {Date} now
 */
export function summarizeMonth(stats, incidents, range, now, target = SLA_TARGET) {
  const total = stats.reduce((a, s) => a + s.totalChecks, 0);
  const success = stats.reduce((a, s) => a + s.successChecks, 0);
  const maintenance = stats.reduce((a, s) => a + (s.maintenanceChecks ?? 0), 0);

  // 평균 응답 시간: 일별 평균을 그날 성공 점검 수로 가중 평균 (점검이 적은 날이 과하게 반영되지 않게)
  const weighted = stats.filter((s) => s.avgResponseMs !== null && s.successChecks > 0);
  const weight = weighted.reduce((a, s) => a + s.successChecks, 0);
  const avgResponseMs = weight
    ? Math.round(weighted.reduce((a, s) => a + s.avgResponseMs * s.successChecks, 0) / weight)
    : null;

  const metrics = incidents.map((i) => ({ id: i.id, ...incidentMetrics(i, now), inMonth: clipMinutes(i, range.startUtc, range.endUtc, now) }));
  const resolved = metrics.filter((m) => !m.ongoing);
  const longest = metrics.reduce((best, m) => (!best || m.inMonth > best.minutes ? { id: m.id, minutes: m.inMonth } : best), null);

  const uptime = uptimePercent(success, total);
  return {
    totalChecks: total,
    successChecks: success,
    failedChecks: total - success,
    uptime,
    // 기록이 없으면 달성 여부를 판단할 수 없음(null) — '달성'으로 보이면 안 되므로
    slaMet: uptime === null ? null : uptime >= target * 100,
    ...errorBudget(total, success, target),
    maintenanceMinutes: maintenance * CHECK_INTERVAL_MINUTES,
    avgResponseMs,
    incidentCount: incidents.length,
    ongoingIncidents: metrics.filter((m) => m.ongoing).length,
    incidentMinutes: metrics.reduce((a, m) => a + m.inMonth, 0),
    avgDetectMinutes: avg(metrics.map((m) => m.detectMinutes)),
    avgRecoverMinutes: avg(resolved.map((m) => m.durationMinutes)), // 복구된 장애만 (MTTR)
    longestIncident: longest,
    coverageDays: stats.filter((s) => s.totalChecks + (s.maintenanceChecks ?? 0) > 0).length,
  };
}
