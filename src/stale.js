// 에이전트 무응답 판정 (B-11) — 순수 함수
//
// 질문: "이 에이전트 대상은 마지막 보고 이후 너무 오래 조용한가?"
// 시계·DB를 건드리지 않아서 node --test로 경계값까지 검증할 수 있습니다.
//
// 기준: 마지막 보고 회차로부터 지난 분이 staleAfterMin을 "넘으면" 무응답입니다.
//   같은 값(예: 15분 정각)은 아직 무응답이 아닙니다. 에이전트의 보고가 Cron 실행과 거의 동시에
//   도착할 수 있어서, 딱 한 회차의 여유를 둡니다. (15분 기준이면 마지막 보고 뒤 20분 회차에 첫 실패,
//   연속 2회 규칙으로 25분 회차에 장애 판정)

import { AGENT_FAILURE } from './agent-judge.js';

/**
 * @param {string|null} lastReportAt  마지막으로 "실제 보고"가 기록된 회차 (UTC ISO). 한 번도 없으면 null
 * @param {string} slotAt             이번 회차 (UTC ISO, 5분 내림)
 * @param {number|null} staleAfterMin 감시 기준(분). null이면 감시 안 함
 * @returns {{ stale: boolean, minutesSince: (number|null) }}
 */
export function judgeStale(lastReportAt, slotAt, staleAfterMin) {
  // 감시를 켜지 않았거나 기준이 이상하면 판정하지 않음
  if (!Number.isInteger(staleAfterMin) || staleAfterMin <= 0) return { stale: false, minutesSince: null };
  // 한 번도 보고한 적 없는 대상은 판정하지 않음: 새로 등록하자마자 장애로 뜨는 것을 막습니다
  if (!lastReportAt) return { stale: false, minutesSince: null };

  const minutesSince = (Date.parse(slotAt) - Date.parse(lastReportAt)) / 60000;
  if (!Number.isFinite(minutesSince)) return { stale: false, minutesSince: null };
  return { stale: minutesSince > staleAfterMin, minutesSince };
}

/**
 * 감시 대상 중 무응답인 것에 대해 "실패 점검 1건"을 만든다.
 *   만든 행은 record.js로 들어가 장애 판정(연속 2회)·알림·장애 이력·집계를 똑같이 받습니다.
 *
 * @param {Array<{id:number, name:string, source:string, staleAfterMin:number, lastReportAt:(string|null)}>} watched
 * @param {string} slotAt
 * @returns {Array<{monitor:object, row:object}>}
 */
export function planStale(watched, slotAt) {
  const out = [];
  for (const m of watched) {
    if (!judgeStale(m.lastReportAt, slotAt, m.staleAfterMin).stale) continue;
    out.push({
      monitor: m,
      row: {
        monitorId: m.id,
        checkedAt: slotAt,
        isSuccess: false,
        isSlow: false,
        statusCode: null,
        responseMs: null,
        failureReason: AGENT_FAILURE.SILENT,
        value: null,
      },
    });
  }
  return out;
}
