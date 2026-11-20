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
  getServices,
  getServiceDailyStatsSince,
  getServiceIncidents,
  getAnalysisStats,
  getRecentChanges,
  getChangesBetween,
  getSiblingMonitorIds,
} from './db.js';
import { changeView, isNoisy } from './fingerprint.js';
import { buildAnalysis, parseJsonOr } from './analysis.js';
import { serviceState, toDailyShape } from './service-status.js';
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
  // 장애 직전 변경 (17단계): 같은 서비스의 첫 화면이 첫 실패 전 60분 안에 바뀌었으면 함께 보여 줌.
  // "원인"이라고 단정하지 않고, 원인을 찾을 때 먼저 볼 단서로만 제시합니다.
  const from = toIsoSeconds(new Date(Date.parse(incident.startedAt) - CHANGE_LOOKBACK_MIN * 60_000));
  const siblings = await getSiblingMonitorIds(db, incident.monitorId);
  const changesBefore = (await getChangesBetween(db, siblings, from, incident.startedAt)).map(changeView);
  return {
    ...incident,
    causeText: causeText(incident.cause),
    ...incidentMetrics(incident, now),
    notifications,
    changeLookbackMin: CHANGE_LOOKBACK_MIN,
    changesBefore,
  };
}

// 장애 상세에서 "장애 직전 변경"으로 볼 범위 (분)
export const CHANGE_LOOKBACK_MIN = 60;
// 서비스 상세의 최근 변경 수
export const SERVICE_CHANGE_LIMIT = 10;

// 보고서에서 출처를 묶는 순서: 실제 → 공개 데이터 재생 → 시뮬레이터 → 데모
// (대상이 없는 출처는 아래에서 걸러지므로, 재생 대상이 아직 없는 동안 응답은 바뀌지 않습니다)
const SOURCE_ORDER = ['real', 'replay', 'simulator', 'sample'];

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

// ─────────────────────────────────────────────
// 서비스 묶음 (0015)
//   GET /api/services        서비스 목록: 서비스 상태·30일 가동률(회차 기준)·묶인 점검
//   GET /api/services/:key   서비스 1개 + 그 서비스의 최근 장애
// 기존 /api/status는 월간 보고서·장애 상세 화면이 쓰고 있어서 그대로 둡니다.
// ─────────────────────────────────────────────

export const SERVICE_INCIDENT_LIMIT = 10;

/**
 * 서비스 목록을 만든다. 서비스에 묶이지 않은 점검(예: 훈련 대상)은 여기 나오지 않습니다.
 * 공개 응답에는 서비스 대표 주소(공개 사이트 첫 화면)만 넣고, 점검 주소(DB 상태 확인·DNS)는 넣지 않습니다.
 */
export async function buildServices(db, now) {
  const { list, ...meta } = await collectServices(db, now);
  return { ...meta, services: list.map((x) => x.view) };
}

/** /api/services/:key 응답 본문. 없거나 내린 서비스면 null */
export async function buildServiceDetail(db, key, now) {
  const { list, ...meta } = await collectServices(db, now);
  const found = list.find((x) => x.view.key === key);
  if (!found) return null;
  const [incidents, changes] = await Promise.all([
    getServiceIncidents(db, found.id, SERVICE_INCIDENT_LIMIT),
    getRecentChanges(db, found.view.checks.map((c) => c.id), SERVICE_CHANGE_LIMIT),
  ]);
  return {
    ...meta,
    service: found.view,
    // 첫 화면 변경 (17단계, 최신 순). noisy: 24시간에 자주 바뀌면 동적 내용일 수 있다는 안내용
    changes: changes.map(changeView),
    changesNoisy: isNoisy(changes, now),
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
  };
}

// 목록·상세가 함께 쓰는 조립 함수. 내부 id는 공개 응답(view) 밖에 따로 둡니다.
async function collectServices(db, now) {
  const nowIso = toIsoSeconds(now);
  const today = toKstDay(nowIso);
  const fromDay = addDays(today, -(BAR_DAYS - 1));

  const [services, monitors, monitorStats, serviceStats, maintenance] = await Promise.all([
    getServices(db),
    getStatusMonitors(db),
    getDailyStatsSince(db, fromDay),
    getServiceDailyStatsSince(db, fromDay),
    getCurrentAndUpcomingMaintenance(db, nowIso),
  ]);

  return {
    generatedAt: nowIso,
    today,
    barDays: BAR_DAYS,
    list: services.map((svc) => {
      const checks = monitors
        .filter((m) => m.serviceId === svc.id)
        .map((m) => {
          const mine = monitorStats.filter((s) => s.monitorId === m.id);
          return {
            id: m.id,
            name: m.name,
            kind: m.kind,
            source: m.source,
            state: displayState(m, isInMaintenance(maintenance, m.id, nowIso)),
            lastCheckedAt: m.lastCheckedAt,
            lastResponseMs: m.lastResponseMs,
            lastIsSlow: m.lastIsSlow,
            uptime30d: overallUptime(mine),
            daily: buildDailyBars(mine, today, BAR_DAYS),
          };
        });
      const mine = serviceStats.filter((s) => s.serviceId === svc.id).map(toDailyShape);
      // 서비스의 마지막 점검 시각 = 묶인 점검 중 가장 최근
      const last = checks.map((c) => c.lastCheckedAt).filter(Boolean).sort().at(-1) ?? null;
      return {
        id: svc.id,
        view: {
          key: svc.key,
          name: svc.name,
          description: svc.description,
          source: svc.source,
          homeUrl: svc.homeUrl, // 공개 사이트 첫 화면 주소 (점검 주소는 넣지 않음)
          state: serviceState(checks),
          lastCheckedAt: last,
          uptime30d: overallUptime(mine), // 모든 점검이 성공한 회차 비율
          daily: buildDailyBars(mine, today, BAR_DAYS),
          checks,
        },
      };
    }),
  };
}

/**
 * /api/services/:key/analysis 응답 본문 (16단계). 없거나 내린 서비스면 null.
 * 실패 이유 분포 · 점검별 일별 p95 · 요일×시간 열지도. 값은 Cron이 미리 계산해 둔 daily_stats 분석 열에서 읽습니다.
 * 점검 주소(url)는 내려주지 않습니다 (다른 공개 API와 같은 원칙).
 */
export async function buildServiceAnalysis(db, key, days, now) {
  const today = toKstDay(toIsoSeconds(now));
  const service = (await getServices(db)).find((s) => s.key === key);
  if (!service) return null;
  const checks = (await getStatusMonitors(db))
    .filter((m) => m.serviceId === service.id)
    .map((m) => ({ id: m.id, name: m.name, kind: m.kind }));
  const raw = await getAnalysisStats(db, checks.map((c) => c.id), addDays(today, -(days - 1)));
  const stats = raw.map((s) => ({ ...s, hourly: parseJsonOr(s.hourly), failures: parseJsonOr(s.failures, {}) }));
  return {
    generatedAt: toIsoSeconds(now),
    service: { key: service.key, name: service.name },
    checks,
    ...buildAnalysis({ checks, stats, today, days, reasonText: REASON_TEXT }),
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
