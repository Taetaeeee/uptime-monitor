// 점검 결과 기록 — Cron(HTTP 점검)과 에이전트 보고(B-4)가 함께 쓰는 공용 경로
//
//   판정된 결과 → 계획 작업 확인 → 장애 판정(상태 전이) → (결과 + 상태 + 장애 이력) 한 batch 저장
//   → 상태가 바뀌었으면 알림 → 일별 집계 (대상별 + 서비스별, 0015)
//
// 왜 공용으로 뺐나?
//   내부 점검도 장애 판정·알림·가동률을 HTTP 점검과 똑같이 받아야 합니다.
//   같은 일을 두 군데에 따로 쓰면, 한쪽만 고쳐서 규칙이 어긋나는 일이 생겨요.

import {
  getMonitorStates,
  saveCheckResults,
  getResultsInRange,
  upsertDailyStats,
  getActiveMaintenanceAt,
  getOpenIncidents,
  getActiveServiceMembers,
  upsertServiceDailyStats,
  getDailyStatsMissingAnalysis,
  updateDailyAnalysis,
} from './db.js';
import { summarizeSlots } from './service-status.js';
import { analyzeDay, BACKFILL_PER_RUN } from './analysis.js';
import { initialState, nextState, TRANSITION } from './state.js';
import { dispatch } from './notify.js';
import { logChannel } from './channels/log.js';
import { toKstDay, addDays, kstDayRange, summarizeDay } from './aggregate.js';
import { isInMaintenance } from './incident.js';

// 지금 사용하는 알림 채널 목록. 채널을 바꾸거나 추가할 때는 이 배열만 고치면 됩니다.
export const DEFAULT_CHANNELS = [logChannel];

/**
 * 계획 작업 중인 대상의 다음 상태 (순수 함수)
 *   - 상태(up/down/unknown)는 그대로 둡니다: 작업 중에는 장애도 복구도 판정하지 않음
 *   - 연속 횟수와 실패 시작 시각은 비웁니다: 작업이 끝난 뒤 0부터 다시 세서,
 *     작업 중의 실패가 작업 직후 장애 판정에 섞이지 않게 해요
 */
export function maintenanceState(prev, checkedAt) {
  return {
    state: prev.state,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    failingSince: null,
    changedAt: prev.changedAt,
    lastCheckedAt: checkedAt,
  };
}

/**
 * 판정이 끝난 결과들을 기록한다.
 *
 * @param {object} db
 * @param {object} p
 * @param {Array}  p.monitors   결과에 해당하는 대상들 ({ id, name } 이상)
 * @param {Array}  p.rows       판정된 결과 { monitorId, checkedAt, isSuccess, isSlow, statusCode, responseMs, failureReason, value }
 * @param {string} p.checkedAt  이번 회차 시각 (UTC ISO, 5분 내림)
 * @param {string} p.source     'real' | 'simulator'  — 결과·알림·장애 이력·집계에 모두 같은 출처를 남깁니다
 * @param {string} p.label      로그 앞머리 (예: "회차 … (실행 …)")
 * @param {Array}  [p.channels] 알림 채널 (기본: log)
 * @param {Map}    [p.prevStates] 이미 조회한 이전 상태가 있으면 재사용
 */
export async function recordResults(db, p) {
  const { monitors, rows, checkedAt, source, label } = p;
  const channels = p.channels ?? DEFAULT_CHANNELS;
  if (rows.length === 0) return { events: [] };

  const [prevStates, windows, openIncidents] = await Promise.all([
    p.prevStates ?? getMonitorStates(db),
    getActiveMaintenanceAt(db, checkedAt),
    getOpenIncidents(db),
  ]);

  const events = [];
  const incidentOps = { open: [], close: [] };

  const states = rows.map((r) => {
    const monitor = monitors.find((m) => m.id === r.monitorId);
    const prev = prevStates.get(r.monitorId) ?? initialState();

    // ── 계획 작업 중: 기록만 하고 판정·알림은 건너뜀 ──
    r.inMaintenance = isInMaintenance(windows, r.monitorId, checkedAt);
    if (r.inMaintenance) {
      return { monitorId: r.monitorId, ...maintenanceState(prev, checkedAt) };
    }

    // ── 장애 판정: 이전 상태 + 이번 결과 → 새 상태, 알릴 이벤트 ──
    const { next, transition } = nextState(prev, r.isSuccess, checkedAt);
    const open = openIncidents.get(r.monitorId);

    if (transition === TRANSITION.DOWN) {
      incidentOps.open.push({
        monitorId: r.monitorId,
        startedAt: next.failingSince ?? checkedAt, // 첫 실패 회차
        detectedAt: checkedAt,                     // 장애 판정 회차
        cause: r.failureReason,
      });
    }
    if (transition === TRANSITION.RECOVERED) {
      incidentOps.close.push({ monitorId: r.monitorId, resolvedAt: checkedAt });
    }

    if (transition) {
      events.push({
        type: transition,
        monitorId: r.monitorId,
        monitorName: monitor.name,
        failureReason: r.failureReason,
        occurredAt: checkedAt,
        // 복구 메시지의 장애 시간: 장애 이력의 시작 시각이 가장 정확합니다.
        // (작업 시간을 거치면 연속 실패 기록이 비워지므로 이력을 먼저 봅니다)
        failingSince: open?.startedAt ?? prev.failingSince ?? next.failingSince,
        source, // 시뮬레이터에서 생긴 알림은 'simulator'로 남아 화면에서 구분됩니다
      });
    }
    return { monitorId: r.monitorId, ...next, lastCheckedAt: checkedAt };
  });

  // 결과·상태·장애 이력은 한 묶음(batch)으로 저장합니다. (이유는 db.js 주석 참고)
  await saveCheckResults(db, rows, states, source, incidentOps);

  // wrangler dev 터미널이나 `wrangler tail`에서 보이는 로그
  for (const r of rows) {
    const name = monitors.find((m) => m.id === r.monitorId)?.name;
    const result = r.isSuccess ? (r.isSlow ? '느림' : '정상') : `실패(${r.failureReason})`;
    const s = states.find((x) => x.monitorId === r.monitorId);
    const value = r.value === null || r.value === undefined ? '' : ` / 값 ${r.value}`;
    const tail = r.inMaintenance ? ' → 계획 작업 중 (판정 안 함)' : ` → 상태 ${s.state} (연속 실패 ${s.consecutiveFailures})`;
    console.log(`[점검] ${label} ${name}: ${result} / ${r.statusCode ?? '-'} / ${r.responseMs ?? '-'}ms${value}${tail}`);
  }

  // ── 알림: 결과·상태 저장이 끝난 뒤에 보냅니다 ──
  // 알림은 외부 채널(나중에 이메일 등)일 수 있어 DB 묶음에 넣을 수 없고,
  // 알림이 실패해도 점검 기록은 남아야 하기 때문이에요. (dispatch는 실패를 삼키고 개수만 돌려줌)
  if (events.length > 0) {
    const { sent, failed } = await dispatch(events, channels, { db });
    console.log(`[알림] ${label} 이벤트 ${events.length}건, 전송 ${sent} / 실패 ${failed}`);
  }

  // ── 일별 집계: 기록한 대상의 '어제'와 '오늘'(KST)을 다시 계산 ──
  // 집계는 화면용 요약이라, 실패해도 이미 저장한 점검 기록에는 영향이 없도록 예외를 따로 잡습니다.
  try {
    await refreshDailyStats(db, rows.map((r) => r.monitorId), checkedAt, source);
  } catch (err) {
    console.error(`[집계 실패] ${label}:`, err);
  }

  return { events };
}

// '어제' 집계를 다시 계산하는 회차 (KST HH:MM). 26단계 — D1 읽기 줄이기
//   자정 직후 6회차(00:00~00:25): 어제 마지막 회차(23:55) 기록이 늦게 저장돼도 반영되게
//   01:00: 그 30분이 모두 실패했을 때를 위한 안전용 1회
// 자정이 지나면 어제 원본은 더 늘지 않으므로, 그 밖의 회차에 어제를 다시 읽는 것은 같은 결과를 위한 읽기 낭비였습니다
// (점검 21개 × 어제 288행 × 하루 288회차 ≈ 하루 170만 행 — 무료 한도 500만의 3분의 1).
export const YESTERDAY_REFRESH_KST = ['00:00', '00:05', '00:10', '00:15', '00:20', '00:25', '01:00'];

/**
 * 이 회차에 '어제' 일별 집계도 다시 계산해야 하나 (순수 함수, 26단계)
 * @param {string} checkedAt  회차 시각 (UTC ISO)
 */
export function shouldRefreshYesterday(checkedAt) {
  const ms = Date.parse(checkedAt);
  if (!Number.isFinite(ms)) return true; // 시각을 못 읽으면 예전처럼 어제도 (덜 읽는 것보다 틀리지 않는 쪽)
  const hm = new Date(ms + 9 * 3600_000).toISOString().slice(11, 16); // KST로 옮긴 뒤 HH:MM
  return YESTERDAY_REFRESH_KST.includes(hm);
}

/**
 * 대상별로 KST '오늘'(자정 직후 몇 회차는 '어제'도)의 일별 집계를 원본에서 다시 계산해 덮어쓴다.
 *
 * 왜 매 회차 다시 계산하나?
 *   - 하루 288행 정도라 매번 다시 세도 부담이 거의 없고, 별도 Cron을 만들 필요가 없습니다.
 *   - "증가분만 더하기" 방식보다 단순하고, 중간에 한 번 실패해도 다음 회차에 저절로 바로잡혀요.
 *   - p95·시간대별 값은 그날 원본 전체가 있어야 계산할 수 있어서 증가분으로는 못 합니다.
 * 왜 '어제'는 자정 직후에만?
 *   - 자정 직후 회차에서 어제 마지막 회차(23:55)까지 반영하면 충분하고, 그 뒤로는 어제 원본이 바뀌지 않기 때문입니다 (26단계).
 */
async function refreshDailyStats(db, monitorIds, checkedAt, source) {
  const today = toKstDay(checkedAt);
  const days = shouldRefreshYesterday(checkedAt) ? [addDays(today, -1), today] : [today];
  const stats = [];
  // 읽은 원본을 서비스 집계에서 다시 쓰려고 보관합니다 ("대상id|날짜" → 결과 배열).
  // 같은 행을 두 번 읽지 않아서 D1 읽기 양이 늘지 않아요.
  const cache = new Map();
  for (const monitorId of monitorIds) {
    for (const day of days) {
      const { startUtc, endUtc } = kstDayRange(day);
      const rows = await getResultsInRange(db, monitorId, startUtc, endUtc);
      cache.set(`${monitorId}|${day}`, rows);
      if (rows.length === 0) continue; // 기록이 없는 날은 행을 만들지 않음 (화면에서 빈 칸)
      // 가동률 요약 + 분석 값(p95·시간대별·실패 이유, 16단계)을 같은 원본으로 함께 계산 → 추가 읽기 없음
      stats.push({ monitorId, day, ...summarizeDay(rows), ...analyzeDay(rows) });
    }
  }
  await upsertDailyStats(db, stats, checkedAt, source);

  // 0017 이전 날짜의 분석 값 채우기(backfillAnalysis)는 2026-11-25에 남은 날이 0이 되어 Cron에서 부르지 않습니다 (26단계).
  // 확인 조회(WHERE hourly IS NULL)가 매 회차 일별 집계 표 전체를 훑어서, 표가 커질수록 읽기가 늘었기 때문입니다.
  // 새 일별 집계는 만들 때 분석 값을 함께 계산하므로 빈 날이 다시 생기지 않습니다. 함수는 필요할 때 손으로 돌릴 수 있게 남김.

  // 서비스 집계는 대상 집계와 따로 잡습니다: 서비스 쪽이 실패해도 대상 집계는 이미 저장됐으니까요.
  try {
    await refreshServiceStats(db, monitorIds, days, cache, checkedAt, source);
  } catch (err) {
    console.error(`[서비스 집계 실패] ${checkedAt}:`, err);
  }
}

/**
 * 분석 값이 비어 있는 과거 일별 집계를 회차마다 BACKFILL_PER_RUN개씩 원본에서 다시 계산해 채운다. (16단계)
 *
 * 왜 마이그레이션 SQL로 한 번에 채우지 않나?
 *   p95는 SQL로 구하려면 윈도 함수가 필요한데 D1 지원 여부가 공식 문서에 없고,
 *   같은 규칙을 SQL과 JS 두 곳에 쓰면 어긋날 수 있어서 순수 함수(analyzeDay) 하나로 계산합니다.
 * 한 회차에 조금씩만 하는 이유: 원본은 점검·날짜당 288행이라, 한꺼번에 하면 한 회차의 D1 읽기가 커져요.
 *   다 채우고 나면 조회 1번(빈 결과)만 남습니다.
 */
export async function backfillAnalysis(db, limit = BACKFILL_PER_RUN) {
  const missing = await getDailyStatsMissingAnalysis(db, limit);
  const items = [];
  for (const { monitorId, day } of missing) {
    const { startUtc, endUtc } = kstDayRange(day);
    const rows = await getResultsInRange(db, monitorId, startUtc, endUtc);
    // 원본이 없어도(지운 기록) 빈 분석 값을 저장해서, 같은 날을 계속 다시 고르지 않게 합니다
    items.push({ monitorId, day, ...analyzeDay(rows) });
  }
  await updateDailyAnalysis(db, items);
  return items.length;
}

/**
 * 이번에 기록한 대상이 속한 서비스의 '어제'·'오늘' 일별 집계를 다시 계산한다. (0015)
 *
 * 서비스에 묶인 점검 중 이번 회차에 기록하지 않은 것(예: 에이전트가 따로 보고하는 점검)이 있으면
 * 그 점검의 원본만 추가로 읽습니다. 지금 서비스는 모두 Cron 점검이라 추가 읽기는 없어요.
 */
async function refreshServiceStats(db, monitorIds, days, cache, checkedAt, source) {
  const recorded = new Set(monitorIds);
  const services = (await getActiveServiceMembers(db)).filter((s) => s.monitorIds.some((id) => recorded.has(id)));
  if (services.length === 0) return;

  const stats = [];
  for (const { serviceId, monitorIds: members } of services) {
    for (const day of days) {
      const rows = [];
      for (const id of members) {
        const key = `${id}|${day}`;
        if (!cache.has(key)) {
          const { startUtc, endUtc } = kstDayRange(day);
          cache.set(key, await getResultsInRange(db, id, startUtc, endUtc));
        }
        rows.push(...cache.get(key));
      }
      const summary = summarizeSlots(rows);
      if (summary.totalSlots === 0) continue; // 기록이 없는 날은 행을 만들지 않음
      stats.push({ serviceId, day, ...summary });
    }
  }
  await upsertServiceDailyStats(db, stats, checkedAt, source);
}
