// 데이터 보존 정책 — 순수 함수 (25단계)
//
// 5분 점검 원본(check_results)은 하루 약 6,000행씩(점검 21개 × 288회) 쌓이는데, 지금까지는 아무것도 지우지 않았습니다.
// 화면·보고서가 원본을 읽는 범위는 최근 48시간(상세 그래프)과 어제·오늘(일별 집계)뿐이고,
// 월간·주간 보고서와 30일 막대는 일별 집계(daily_stats)만 씁니다. 그래서 원본만 오래된 것부터 지웁니다.
//
//   데이터                       보존
//   5분 점검 원본                오늘 포함 90일 (그 전 날은 삭제)
//   일별 집계 · 장애 · 보고서 · 알림 · 첫 화면 변경   계속 (작아서 1년에 몇 MB 수준)
//
// 왜 90일인가: 화면이 쓰는 48시간 + 장애를 한 분기 안에서 다시 들여다볼 여유. 90일이면 약 54만 행(약 60MB 추정)에서 더 늘지 않습니다.
// (공공기관처럼 로그 보존 기간이 규정으로 정해진 곳과는 기준이 다릅니다 — 이 프로젝트는 "화면이 쓰는 기간 + 여유"로 정함)

import { toKstDay, kstDayRange, addDays } from './aggregate.js';

export const RAW_RETENTION_DAYS = 90;  // 5분 점검 원본을 남기는 날 수 (오늘 포함)
export const RETENTION_RUN_KST = '04:00'; // 하루 한 번, 이 회차(KST)에만 정리 — 이용이 적은 새벽, 자정 직후 집계와 겹치지 않게
// 한 번에 지우는 최대 행 수. D1은 DELETE도 '쓰기'로 세고 색인 행만큼 더 셉니다(공식 문서 pricing).
// 평소 하루 지울 양은 약 6,000행(색인 포함 쓰기 약 1.2만 행)이라 한 번에 끝나고,
// 밀린 양이 많아도 하루 쓰기가 무료 한도(10만 행)에 닿지 않게 상한을 둡니다. 남은 것은 다음 날 이어서 지움
export const MAX_DELETE_PER_RUN = 10_000;

/**
 * 이번 회차가 정리 회차인가 — KST 04:00 회차(5분 단위로 내린 시각)일 때만.
 * @param {string} slotIso  회차 시각 (UTC ISO, toCheckSlot 결과)
 */
export function isRetentionSlot(slotIso) {
  const ms = Date.parse(slotIso);
  if (!Number.isFinite(ms)) return false;
  const kst = new Date(ms + 9 * 3600_000).toISOString(); // KST로 옮긴 뒤 글자로 HH:MM을 봄
  return kst.slice(11, 16) === RETENTION_RUN_KST;
}

/**
 * 기준 시각: 이 시각보다 오래된 원본을 지웁니다.
 * "오늘 포함 90일"을 남기므로, 남기는 첫 날 = 오늘 - 89일, 지우는 기준 = 그날 KST 0시(UTC로는 전날 15:00).
 * @param {string} nowIso  UTC ISO
 * @param {number} [days]  보존 날 수 (테스트에서 바꿀 수 있게)
 * @returns {{today:string, firstKeptDay:string, cutoffUtc:string}}
 */
export function retentionCutoff(nowIso, days = RAW_RETENTION_DAYS) {
  const today = toKstDay(nowIso);
  const firstKeptDay = addDays(today, -(days - 1));
  return { today, firstKeptDay, cutoffUtc: kstDayRange(firstKeptDay).startUtc };
}

/**
 * 점검마다 지울 수 있는 상한을 나눠 줌: 앞 점검이 다 쓰면 뒤 점검은 0 (다음 날 이어서).
 * @param {number} used   이미 지운 행 수
 * @param {number} [cap]
 */
export function remainingBudget(used, cap = MAX_DELETE_PER_RUN) {
  return Math.max(0, cap - used);
}

/**
 * 정리 결과를 화면·API에 보여 줄 모양으로 (공개해도 되는 값만: 시각·기준일·행 수).
 * @param {object|null} run  retention_runs 한 행 (db.js getLastRetentionRun)
 */
export function retentionView(run) {
  return {
    policy: {
      rawRetentionDays: RAW_RETENTION_DAYS,
      runAtKst: RETENTION_RUN_KST,
      maxDeletePerRun: MAX_DELETE_PER_RUN,
      kept: ['일별 집계', '장애·사후 보고서', '알림', '첫 화면 변경'],
    },
    lastRun: run
      ? {
          runAt: run.runAt,
          firstKeptDay: run.firstKeptDay,
          deletedRows: run.deletedRows,
          keptOldRows: run.keptOldRows,
          capped: run.capped,
          ok: !run.error,
        }
      : null,
  };
}
