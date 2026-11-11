// 공개 API
//   GET /api/status         상태 페이지가 한 번의 요청으로 화면 전체를 그릴 수 있게 필요한 값을 모아서 돌려줌
//   GET /api/incidents/:id  장애 1건의 상세와 보고서 (B-5)
// 계산(가동률·막대·장애 지표)은 aggregate.js·incident.js의 순수 함수가 하고, 여기서는 조회 결과를 엮기만 해요.

import {
  getStatusMonitors,
  getDailyStatsSince,
  getRecentNotifications,
  getCurrentAndUpcomingMaintenance,
  getRecentIncidents,
  getIncident,
  getNotificationsBetween,
  getDailyStatsBetween,
  getIncidentsOverlapping,
  getReportMonths,
  getMonitorPublic,
  getResultsSince,
} from './db.js';
import { SLA_TARGET, monthRange, kstMonthOf, summarizeMonth } from './report.js';
import { toKstDay, addDays, buildDailyBars, overallUptime } from './aggregate.js';
import { isInMaintenance, incidentMetrics } from './incident.js';
import { REASON_TEXT } from './notify.js';

// 원인 코드 → 화면 문구 (문구는 서버 한곳에서 관리, 화면은 받은 그대로 표시)
const causeText = (code) => (code ? REASON_TEXT[code] ?? code : null);
import { toIsoSeconds } from './time.js';

export const BAR_DAYS = 30;           // 화면에 보여 줄 막대 일수
export const NOTIFICATION_LIMIT = 20; // 최근 알림 개수
export const INCIDENT_LIMIT = 10;     // 장애 이력 개수

/**
 * 화면에 표시할 상태 (순수 함수)
 *   - 실제 대상인데 비활성이면 'paused'(점검 대기): 아직 실제 점검을 켜지 않은 상태
 *   - 지금 계획 작업 중이면 'maintenance'(계획 작업 중) (B-5)
 *   - 그 밖에는 monitor_state 값, 상태 행이 없으면 'unknown'(확인 중)
 * 시드용 가상 서비스는 비활성이지만 시드가 상태를 넣어 두므로 그 상태를 그대로 보여 줍니다(데모 표시와 함께).
 */
export function displayState(monitor, inMaintenance = false) {
  if (!monitor.isActive && monitor.source === 'real') return 'paused';
  if (inMaintenance) return 'maintenance';
  return monitor.state ?? 'unknown';
}

/**
 * /api/status 응답 본문을 만든다.
 * @param {object} db   D1
 * @param {Date}   now  기준 시각 (테스트에서 고정할 수 있게 인자로 받음)
 */
export async function buildStatus(db, now) {
  const nowIso = toIsoSeconds(now);
  const today = toKstDay(nowIso);
  const fromDay = addDays(today, -(BAR_DAYS - 1));

  const [monitors, stats, notifications, maintenance, incidents] = await Promise.all([
    getStatusMonitors(db),
    getDailyStatsSince(db, fromDay),
    getRecentNotifications(db, NOTIFICATION_LIMIT),
    getCurrentAndUpcomingMaintenance(db, nowIso),
    getRecentIncidents(db, INCIDENT_LIMIT),
  ]);

  const services = monitors.map((m) => {
    const mine = stats.filter((s) => s.monitorId === m.id);
    return {
      id: m.id,
      name: m.name,
      kind: m.kind, // http / ping / tcp / ssl / disk / service — 화면에서 값 표시 방식을 고를 때 사용
      source: m.source, // 화면에서 'sample'이면 '데모 데이터', 'simulator'면 '시뮬레이터'로 표시
      state: displayState(m, isInMaintenance(maintenance, m.id, nowIso)),
      lastCheckedAt: m.lastCheckedAt,
      lastResponseMs: m.lastResponseMs,
      lastValue: m.lastValue, // 디스크 사용률(%)·인증서 남은 일수 (그 밖에는 null)
      uptime30d: overallUptime(mine),
      daily: buildDailyBars(mine, today, BAR_DAYS),
    };
  });

  return {
    generatedAt: nowIso,
    today,
    barDays: BAR_DAYS,
    services,
    // 진행 중(active: true)이거나 예정된 계획 작업
    maintenance: maintenance.map((w) => ({
      ...w,
      active: w.startsAt <= nowIso && nowIso < w.endsAt,
    })),
    incidents: incidents.map((i) => ({
      id: i.id,
      monitorName: i.monitorName,
      startedAt: i.startedAt,
      resolvedAt: i.resolvedAt,
      cause: i.cause,
      causeText: causeText(i.cause),
      source: i.source,
      hasReport: Boolean(i.summary),
      summary: i.summary,
      ...incidentMetrics(i, now),
    })),
    notifications,
  };
}

/**
 * /api/incidents/:id 응답 본문. 없으면 null.
 */
export async function buildIncidentDetail(db, id, now) {
  const incident = await getIncident(db, id);
  if (!incident) return null;
  const endIso = incident.resolvedAt ?? toIsoSeconds(now);
  const notifications = await getNotificationsBetween(db, incident.monitorId, incident.startedAt, endIso);
  return {
    ...incident,
    causeText: causeText(incident.cause),
    ...incidentMetrics(incident, now),
    notifications,
  };
}

// 보고서에서 출처를 묶는 순서: 실제 → 시뮬레이터 → 데모
const SOURCE_ORDER = ['real', 'simulator', 'sample'];

/**
 * /api/reports/monthly 응답 본문 (B-6)
 *
 * 대상별로만 계산하고, 여러 대상을 합친 "전사 평균"은 만들지 않습니다.
 * 실제 데이터와 가짜(sample·simulator) 데이터를 합친 숫자는 의미가 없고, 출처 규칙(CLAUDE.md 8)에도 어긋나기 때문이에요.
 * 대신 출처별로 묶어(groups) 보여 줍니다.
 *
 * @param {object} db
 * @param {string} month  'YYYY-MM' (검증은 호출하는 쪽에서)
 * @param {Date} now
 */
export async function buildMonthlyReport(db, month, now) {
  const range = monthRange(month);
  const [monitors, stats, incidents, months] = await Promise.all([
    getStatusMonitors(db),
    getDailyStatsBetween(db, range.startDay, range.endDay),
    getIncidentsOverlapping(db, range.startUtc, range.endUtc),
    getReportMonths(db),
  ]);

  const services = monitors.map((m) => ({
    id: m.id,
    name: m.name,
    kind: m.kind,
    source: m.source,
    ...summarizeMonth(
      stats.filter((s) => s.monitorId === m.id),
      incidents.filter((i) => i.monitorId === m.id),
      range,
      now
    ),
  }));

  const nowMonth = kstMonthOf(now);
  return {
    generatedAt: toIsoSeconds(now),
    month,
    months, // 기록이 있는 달 (선택 목록)
    targetPercent: Math.round(SLA_TARGET * 1000) / 10,
    period: {
      startDay: range.startDay,
      endDay: range.endDay,
      daysInMonth: range.daysInMonth,
      inProgress: month === nowMonth, // 진행 중인 달이면 숫자가 계속 바뀜
    },
    groups: SOURCE_ORDER.map((source) => ({
      source,
      services: services.filter((s) => s.source === source),
    })).filter((g) => g.services.length > 0),
  };
}

// 상세 팝업 그래프용 기록 기간 (시간). 원본은 5분 간격이라 48시간이면 최대 576개
export const HISTORY_DEFAULT_HOURS = 24;
export const HISTORY_MAX_HOURS = 48;

/**
 * /api/monitors/:id/history 응답 본문. 대상이 없으면 null.
 * 팝업을 열 때만 부르므로 /api/status는 가볍게 유지됩니다.
 * 점검 주소(url)는 내려주지 않습니다.
 */
export async function buildMonitorHistory(db, id, hours, now) {
  const monitor = await getMonitorPublic(db, id);
  if (!monitor) return null;
  const from = toIsoSeconds(new Date(now.getTime() - hours * 3600_000));
  const points = await getResultsSince(db, id, from);
  return {
    monitor,
    hours,
    from,
    to: toIsoSeconds(now),
    points: points.map((p) => ({ ...p, failureText: causeText(p.failureReason) })),
  };
}
