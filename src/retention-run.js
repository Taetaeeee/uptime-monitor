// 데이터 보존 정리 실행 (25단계) — Cron 회차 끝에서 부릅니다. 규칙(언제·어디까지·상한)은 retention.js의 순수 함수.
//
// 하루 한 번(KST 04:00 회차)만 실제로 일합니다. 그 밖의 회차는 시각만 보고 바로 끝나서 D1 조회가 없습니다.
// 점검마다 "오늘 포함 90일보다 오래된 원본"을 지우고, 결과를 retention_runs에 1행 남깁니다.
// 중간에 실패해도 그때까지 지운 행 수와 오류 문구를 기록하고 끝냅니다 (점검 기록에는 영향 없음, 남은 것은 다음 날 이어서).

import { toCheckSlot } from './time.js';
import { isRetentionSlot, retentionCutoff, remainingBudget, MAX_DELETE_PER_RUN } from './retention.js';
import { getAllMonitorIds, deleteOldResults, countOldResults, insertRetentionRun } from './db.js';

/**
 * @param {D1Database} db
 * @param {Date} runTime  Cron 실행 시각
 * @param {{force?: boolean, days?: number}} [opts]  테스트용: 회차와 상관없이 실행 / 보존 날 수 바꾸기
 * @returns {Promise<object|null>}  정리 회차가 아니면 null
 */
export async function runRetention(db, runTime, opts = {}) {
  const slot = toCheckSlot(runTime);
  if (!opts.force && !isRetentionSlot(slot)) return null;
  const { firstKeptDay, cutoffUtc } = retentionCutoff(slot, opts.days);
  const ids = await getAllMonitorIds(db);

  let deletedRows = 0;
  let keptOldRows = 0;
  let error = null;
  try {
    for (const id of ids) {
      deletedRows += await deleteOldResults(db, id, cutoffUtc, remainingBudget(deletedRows));
      keptOldRows += await countOldResults(db, id, cutoffUtc);
    }
  } catch (err) {
    error = String(err?.message ?? err).slice(0, 200);
    console.error(`[보존 정리] ${slot} 실패:`, err);
  }

  const run = { runAt: slot, firstKeptDay, cutoffUtc, deletedRows, keptOldRows, monitors: ids.length, capped: deletedRows >= MAX_DELETE_PER_RUN, error };
  await insertRetentionRun(db, run);
  console.log(`[보존 정리] ${slot} 기준 ${firstKeptDay} 이전 원본 ${deletedRows}행 삭제, 남은 오래된 행 ${keptOldRows}`);
  return run;
}
