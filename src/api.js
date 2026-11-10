// 공개 API: GET /api/status
// 상태 페이지가 한 번의 요청으로 화면 전체를 그릴 수 있게 필요한 값을 모아서 돌려줍니다.
// 계산(가동률·막대)은 aggregate.js의 순수 함수가 하고, 여기서는 조회 결과를 엮기만 해요.

import { getStatusMonitors, getDailyStatsSince, getRecentNotifications } from './db.js';
import { toKstDay, addDays, buildDailyBars, overallUptime } from './aggregate.js';
import { toIsoSeconds } from './time.js';

export const BAR_DAYS = 30;          // 화면에 보여 줄 막대 일수
export const NOTIFICATION_LIMIT = 20; // 최근 알림 개수

/**
 * 화면에 표시할 상태 (순수 함수)
 *   - 실제 대상인데 비활성이면 'paused'(점검 대기): 아직 실제 점검을 켜지 않은 상태
 *   - 그 밖에는 monitor_state 값, 상태 행이 없으면 'unknown'(확인 중)
 * 시드용 가상 서비스는 비활성이지만 시드가 상태를 넣어 두므로 그 상태를 그대로 보여 줍니다(데모 표시와 함께).
 */
export function displayState(monitor) {
  if (!monitor.isActive && monitor.source === 'real') return 'paused';
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

  const [monitors, stats, notifications] = await Promise.all([
    getStatusMonitors(db),
    getDailyStatsSince(db, fromDay),
    getRecentNotifications(db, NOTIFICATION_LIMIT),
  ]);

  const services = monitors.map((m) => {
    const mine = stats.filter((s) => s.monitorId === m.id);
    return {
      id: m.id,
      name: m.name,
      kind: m.kind, // http / ping / tcp / ssl / disk / service — 화면에서 값 표시 방식을 고를 때 사용
      source: m.source, // 화면에서 'sample'이면 '데모 데이터', 'simulator'면 '시뮬레이터'로 표시
      state: displayState(m),
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
    notifications,
  };
}
