// Worker 진입점
// 여기에는 "흐름"만 둡니다:
//   [Cron] 대상 조회 → 동시 점검 → 판정 → 기록(record.js: 상태 전이 → 저장 → 알림 → 일별 집계)
//   [HTTP] GET  /api/status        → 상태 페이지용 JSON (화면 파일은 public/에서 정적 파일로 제공)
//          POST /api/agent/report  → 내부 점검 에이전트 보고 수집 (ingest.js)
// 세부 동작은 checker.js(네트워크), judge.js(1회 판정), record.js(기록 공용 경로),
// ingest.js(에이전트 보고), api.js(상태 조회)가 맡습니다.

import { observe } from './checker.js';
import { judgeCheck, FAILURE_REASON } from './judge.js';
import { getActiveMonitors } from './db.js';
import { toCheckSlot, toIsoSeconds } from './time.js';
import { recordResults } from './record.js';
import { buildStatus } from './api.js';
import { handleAgentReport } from './ingest.js';

/**
 * 예약 실행 1회분: 활성 HTTP 대상을 모두 점검하고 기록한다.
 * @param {object} env       Worker 환경 (env.DB = D1)
 * @param {Date}   runTime   이번 실행의 기준 시각
 * @param {object} [deps]    테스트용 주입 구멍
 * @param {Function} [deps.fetchFn]  가짜 fetch (checker.js로 그대로 전달)
 * @param {Array}    [deps.channels] 알림 채널 목록 (기본: log 채널)
 */
export async function runChecks(env, runTime, deps = {}) {
  const monitors = await getActiveMonitors(env.DB);

  // DB에 저장하는 시각은 '회차' 시각(5분 단위 내림), 로그에는 실제 실행 시각도 함께 남깁니다.
  // 한 번의 실행에서 나온 결과는 모두 같은 checked_at을 써서 "02:50 회차"로 묶을 수 있어요.
  const checkedAt = toCheckSlot(runTime);
  const ranAt = toIsoSeconds(runTime);
  const label = `회차 ${checkedAt} (실행 ${ranAt})`;

  // 활성 대상이 없으면 점검·저장할 것이 없으므로 바로 끝냅니다.
  // 로그를 남기는 이유: 아무것도 안 찍히면 "Cron이 안 돈 것"과 "돌았는데 대상이 없는 것"을
  // `wrangler tail`에서 구분할 수 없기 때문이에요.
  if (monitors.length === 0) {
    console.log(`[점검] ${label} 활성 대상 없음`);
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
        value: null,
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
      value: null,
    };
  });

  // Worker가 직접 한 HTTP 점검은 항상 실제 점검 → source 'real'
  await recordResults(env.DB, {
    monitors,
    rows,
    checkedAt,
    source: 'real',
    label,
    channels: deps.channels,
  });

  return rows;
}

/** JSON 응답 도우미 */
export function json(body, status = 200, extraHeaders = {}) {
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
  // 파일이 없는 경로(/api/... 등)만 이 함수로 들어옵니다. (B-3 배포에서 동작 확인)
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

    if (url.pathname === '/api/agent/report') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
      try {
        return await handleAgentReport(request, env);
      } catch (err) {
        console.error('[API 오류] /api/agent/report:', err);
        return json({ error: 'internal_error' }, 500);
      }
    }

    return json({ error: 'not_found' }, 404);
  },
};
