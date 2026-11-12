// 에이전트 무응답 감지 실행 (B-11) — Cron이 5분마다 호출
//
//   감시 대상 조회 → 무응답 판정(stale.js) → 실패 점검으로 기록(record.js)
//
// 새 판정 경로를 만들지 않고 기존 record.js를 씁니다. 그래서 "연속 2회 실패 → 장애, 보고 1회 성공 → 복구",
// 장애 이력, 알림, 계획 작업 제외, 일별 집계가 다른 점검과 똑같이 적용돼요.
// 감시를 켠 대상이 없으면 쿼리 1번만 하고 끝납니다.

import { toCheckSlot } from './time.js';
import { getStaleWatchMonitors } from './db.js';
import { planStale } from './stale.js';
import { recordResults } from './record.js';

/**
 * @param {object} db
 * @param {Date} runTime  Cron 실행 시각
 * @param {object} [deps] { channels }  테스트용
 * @returns 기록한 행들
 */
export async function runStaleCheck(db, runTime, deps = {}) {
  const watched = await getStaleWatchMonitors(db);
  if (watched.length === 0) return [];

  const slotAt = toCheckSlot(runTime);
  const stale = planStale(watched, slotAt);
  if (stale.length === 0) return [];

  // 출처(real/simulator)별로 나눠 기록: 결과·알림·장애·집계에 같은 출처를 남기는 규칙 때문입니다
  const bySource = new Map();
  for (const s of stale) {
    if (!bySource.has(s.monitor.source)) bySource.set(s.monitor.source, []);
    bySource.get(s.monitor.source).push(s);
  }
  for (const [source, list] of bySource) {
    await recordResults(db, {
      monitors: list.map((s) => s.monitor),
      rows: list.map((s) => s.row),
      checkedAt: slotAt,
      source,
      label: `무응답 ${slotAt}`,
      channels: deps.channels,
    });
  }
  return stale.map((s) => s.row);
}
