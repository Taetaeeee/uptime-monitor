// Worker 진입점
// 여기에는 "흐름"만 둡니다:
//   [Cron] 대상 조회 → 동시 점검 → 판정 → 상태 계산 → (결과 + 상태) 저장 → 상태가 바뀌었으면 알림 → 일별 집계
//   [HTTP] /api/status → 상태 페이지용 JSON (화면 파일은 public/에서 정적 파일로 제공)
// 세부 동작은 checker.js(네트워크), judge.js(1회 판정), state.js(장애 판정),
// db.js(저장), notify.js + channels/(알림)가 맡습니다.

import { observe } from './checker.js';
import { judgeCheck, FAILURE_REASON } from './judge.js';
import {
  getActiveMonitors,
  getMonitorStates,
  saveCheckResults,
  getResultsInRange,
  upsertDailyStats,
} from './db.js';
import { toCheckSlot, toIsoSeconds } from './time.js';
import { initialState, nextState } from './state.js';
import { dispatch } from './notify.js';
import { logChannel } from './channels/log.js';
import { toKstDay, addDays, kstDayRange, summarizeDay } from './aggregate.js';
import { buildStatus } from './api.js';

// 지금 사용하는 알림 채널 목록. 채널을 바꾸거나 추가할 때는 이 배열만 고치면 됩니다.
const DEFAULT_CHANNELS = [logChannel];

/**
 * 예약 실행 1회분: 활성 대상을 모두 점검하고 결과·상태를 저장한 뒤, 상태가 바뀌면 알린다.
 * @param {object} env       Worker 환경 (env.DB = D1)
 * @param {Date}   runTime   이번 실행의 기준 시각
 * @param {object} [deps]    테스트용 주입 구멍
 * @param {Function} [deps.fetchFn]  가짜 fetch (checker.js로 그대로 전달)
 * @param {Array}    [deps.channels] 알림 채널 목록 (기본: log 채널)
 */
export async function runChecks(env, runTime, deps = {}) {
  const channels = deps.channels ?? DEFAULT_CHANNELS;
  const monitors = await getActiveMonitors(env.DB);

  // DB에 저장하는 시각은 '회차' 시각(5분 단위 내림), 로그에는 실제 실행 시각도 함께 남깁니다.
  // 한 번의 실행에서 나온 결과는 모두 같은 checked_at을 써서 "02:50 회차"로 묶을 수 있어요.
  const checkedAt = toCheckSlot(runTime);
  const ranAt = toIsoSeconds(runTime);
  const when = `회차 ${checkedAt} (실행 ${ranAt})`;

  // 활성 대상이 없으면 점검·저장할 것이 없으므로 바로 끝냅니다.
  // 로그를 남기는 이유: 아무것도 안 찍히면 "Cron이 안 돈 것"과 "돌았는데 대상이 없는 것"을
  // `wrangler tail`에서 구분할 수 없기 때문이에요.
  if (monitors.length === 0) {
    console.log(`[점검] ${when} 활성 대상 없음`);
    return [];
  }

  // 동시에 점검. allSettled는 하나가 예외로 터져도 나머지 결과를 모두 기다려 줍니다.
  // (Promise.all은 하나만 실패해도 전체가 실패로 끝나요)
  const settled = await Promise.allSettled(monitors.map((m) => observe(m, deps)));

  const rows = settled.map((outcome, i) => {
    const monitor = monitors[i];

    // observe는 내부에서 예외를 잡도록 만들었지만, 예상 못 한 예외에도 대비합니다.
    // 이 경우도 '응답을 못 받음'이므로 네트워크 오류로 기록해요.
    if (outcome.status === 'rejected') {
      console.error(`[점검 예외] ${monitor.name}:`, outcome.reason);
      return {
        monitorId: monitor.id,
        checkedAt,
        isSuccess: false,
        isSlow: false,
        statusCode: null,
        responseMs: null,
        failureReason: FAILURE_REASON.NETWORK_ERROR,
      };
    }

    const observation = outcome.value;
    const verdict = judgeCheck(monitor, observation);
    return {
      monitorId: monitor.id,
      checkedAt,
      isSuccess: verdict.isSuccess,
      isSlow: verdict.isSlow,
      statusCode: observation.statusCode,
      responseMs: observation.responseMs,
      failureReason: verdict.failureReason,
    };
  });

  // ── 장애 판정: 이전 상태 + 이번 결과 → 새 상태, 알릴 이벤트 ──
  const prevStates = await getMonitorStates(env.DB);
  const events = [];
  const states = rows.map((r) => {
    const monitor = monitors.find((m) => m.id === r.monitorId);
    const prev = prevStates.get(r.monitorId) ?? initialState();
    const { next, transition } = nextState(prev, r.isSuccess, checkedAt);

    if (transition) {
      events.push({
        type: transition,
        monitorId: r.monitorId,
        monitorName: monitor.name,
        failureReason: r.failureReason,
        occurredAt: checkedAt,
        // 복구 시 장애 시간을 계산하려면 "복구 직전까지의" 연속 실패 시작 시각이 필요해서
        // 새 상태(성공하면 null로 지워짐)가 아니라 이전 상태에서 가져옵니다.
        failingSince: prev.failingSince ?? next.failingSince,
        source: 'real', // Cron의 실제 점검에서 나온 알림
      });
    }
    return { monitorId: r.monitorId, ...next, lastCheckedAt: checkedAt };
  });

  // 결과와 상태는 한 묶음(batch)으로 저장합니다. (이유는 db.js 주석 참고)
  await saveCheckResults(env.DB, rows, states);

  // wrangler dev 터미널이나 `wrangler tail`에서 보이는 로그
  for (const r of rows) {
    const name = monitors.find((m) => m.id === r.monitorId)?.name;
    const result = r.isSuccess ? (r.isSlow ? '느림' : '정상') : `실패(${r.failureReason})`;
    const s = states.find((x) => x.monitorId === r.monitorId);
    console.log(
      `[점검] ${when} ${name}: ${result} / ${r.statusCode ?? '-'} / ${r.responseMs ?? '-'}ms` +
        ` → 상태 ${s.state} (연속 실패 ${s.consecutiveFailures})`
    );
  }

  // ── 알림: 결과·상태 저장이 끝난 뒤에 보냅니다 ──
  // 알림은 외부 채널(나중에 이메일 등)일 수 있어 DB 묶음에 넣을 수 없고,
  // 알림이 실패해도 점검 기록은 남아야 하기 때문이에요. (dispatch는 실패를 삼키고 개수만 돌려줌)
  if (events.length > 0) {
    const { sent, failed } = await dispatch(events, channels, { db: env.DB });
    console.log(`[알림] ${when} 이벤트 ${events.length}건, 전송 ${sent} / 실패 ${failed}`);
  }

  // ── 일별 집계: 점검한 대상의 '어제'와 '오늘'(KST)을 다시 계산 ──
  // 집계는 화면용 요약이라, 실패해도 이미 저장한 점검 기록에는 영향이 없도록 예외를 따로 잡습니다.
  try {
    await refreshDailyStats(env.DB, monitors.map((m) => m.id), checkedAt);
  } catch (err) {
    console.error(`[집계 실패] ${when}:`, err);
  }

  return rows;
}

/**
 * 대상별로 KST '어제'와 '오늘'의 일별 집계를 원본에서 다시 계산해 덮어쓴다.
 *
 * 왜 매 회차 다시 계산하나?
 *   - 하루 288행 정도라 매번 다시 세도 부담이 거의 없고, 별도 Cron을 만들 필요가 없습니다.
 *   - "증가분만 더하기" 방식보다 단순하고, 중간에 한 번 실패해도 다음 회차에 저절로 바로잡혀요.
 * 왜 '어제'도?
 *   - 자정 직후 첫 회차에서 어제 마지막 회차(23:55)까지 빠짐없이 반영하기 위해서입니다.
 */
async function refreshDailyStats(db, monitorIds, checkedAt) {
  const today = toKstDay(checkedAt);
  const days = [addDays(today, -1), today];
  const stats = [];
  for (const monitorId of monitorIds) {
    for (const day of days) {
      const { startUtc, endUtc } = kstDayRange(day);
      const rows = await getResultsInRange(db, monitorId, startUtc, endUtc);
      if (rows.length === 0) continue; // 기록이 없는 날은 행을 만들지 않음 (화면에서 빈 칸)
      stats.push({ monitorId, day, ...summarizeDay(rows) });
    }
  }
  await upsertDailyStats(db, stats, checkedAt);
}

/** JSON 응답 도우미 */
function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

export default {
  // Cron이 5분마다 호출하는 함수
  async scheduled(controller, env, ctx) {
    // controller.scheduledTime: 이번 실행 시각(ms).
    // 정각(:00초)이 아닐 수 있어서(실제로 02:50:12가 들어옴) runChecks 안에서 회차로 내림합니다.
    await runChecks(env, new Date(controller.scheduledTime));
  },

  // HTTP 요청 처리.
  // 상태 페이지 파일(public/의 index.html 등)은 Cloudflare가 정적 파일로 먼저 응답하고,
  // 파일이 없는 경로(/api/... 등)만 이 함수로 들어옵니다. (assets 설정 → 공식 문서에서 확인할 부분)
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/status') {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
      try {
        const body = await buildStatus(env.DB, new Date());
        // 60초 캐시: 접속이 몰려도 D1 조회가 덜 일어나게 합니다. 점검 주기가 5분이라 60초 늦어도 괜찮아요.
        return json(body, 200, { 'cache-control': 'public, max-age=60' });
      } catch (err) {
        console.error('[API 오류] /api/status:', err);
        // 내부 오류 내용은 공개 응답에 넣지 않습니다 (로그에만 남김)
        return json({ error: 'internal_error' }, 500);
      }
    }

    return json({ error: 'not_found' }, 404);
  },
};
