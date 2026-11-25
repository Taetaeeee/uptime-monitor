// Worker 진입점
// 여기에는 "흐름"만 둡니다:
//   [Cron] 대상 조회 → 동시 점검 → 판정 → 기록(record.js: 상태 전이 → 저장 → 알림 → 일별 집계)
//   [HTTP] GET  /api/status        → 상태 페이지용 JSON (화면 파일은 public/에서 정적 파일로 제공)
//          POST /api/agent/report  → 내부 점검 에이전트 보고 수집 (ingest.js)
//          GET  /api/incidents/:id → 장애 상세·보고서 (api.js)
//          GET  /api/reports/monthly?month=YYYY-MM → 월간 가용성 보고서 (api.js + report.js)
//          GET  /api/monitors/:id/history?hours=24 → 상세 팝업 그래프용 최근 기록 (api.js)
//          GET  /api/services, /api/services/:key → 서비스 묶음 목록·상세 (api.js + service-status.js, 0015)
//          GET  /api/services/:key/analysis?days=30 → 실패 이유 분포·일별 p95·시간대 열지도 (api.js + analysis.js, 0017)
//          GET  /api/services/:key/weekly?week=YYYY-MM-DD → 서비스 주간 점검 보고서 + 복사용 텍스트 (api.js + weekly-report.js, 20단계)
//          GET  /api/retention → 데이터 보존 정책·마지막 정리 결과 (retention.js, 25단계)
//          /api/admin/...          → 보고서 작성, 계획 작업 등록·취소 (admin.js, 관리자 토큰)
//          /subscribe/confirm·unsubscribe → 장애 알림 수신 확인·그만 받기 페이지 (subscribe-api.js, 19단계, 기본은 꺼짐)
//          [Cron] 점검 직후 첫 화면 변경 감지(change-run.js, 받은 본문의 지문만), 그 뒤 에이전트 무응답 감지(stale-run.js), 오래 가는 장애 메일(escalation-run.js)도 같은 회차에 실행,
//          KST 04:00 회차에만 90일 지난 점검 원본 정리(retention-run.js, 25단계)
// 세부 동작은 checker.js(네트워크), judge.js(1회 판정), record.js(기록 공용 경로),
// ingest.js(에이전트 보고), api.js(상태 조회)가 맡습니다.
// (공개 데이터셋 재생은 2026-11-19 가짜 데이터 정리 때 실행 경로를 없앴습니다. 판정 순수 함수 replay.js는
//  판정 규칙 성능 평가(scripts/evaluate-rules)가 쓰므로 남겨 둡니다.)

import { observe } from './checker.js';
import { observeDns } from './dns.js';
import { judgeCheck, judgeDns, FAILURE_REASON } from './judge.js';
import { getActiveMonitors } from './db.js';
import { toCheckSlot, toIsoSeconds } from './time.js';
import { recordResults } from './record.js';
import {
  buildStatus,
  buildIncidentDetail,
  buildMonthlyReport,
  buildMonitorHistory,
  buildServices,
  buildServiceDetail,
  buildServiceAnalysis,
  buildWeeklyReport,
  HISTORY_DEFAULT_HOURS,
  HISTORY_MAX_HOURS,
} from './api.js';
import { ANALYSIS_DAYS } from './analysis.js';
import { isValidMonth, kstMonthOf } from './report.js';
import { isWeekStart, thisWeekStart, lastCompleteWeekStart } from './weekly-report.js';
import { handleAgentReport } from './ingest.js';
import { handleAdmin } from './admin.js';
import { handleSubscribePage } from './subscribe-api.js';
import { subscribersStatus } from './subscribers.js';
import { runStaleCheck } from './stale-run.js';
import { runEscalation } from './escalation-run.js';
import { runContentChanges } from './change-run.js';
import { handleRca } from './rca-api.js';
import { runRetention } from './retention-run.js';
import { retentionView } from './retention.js';
import { getLastRetentionRun } from './db.js';

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
  // 종류에 따라 측정 방법이 다릅니다: HTTP는 checker.js, DNS는 dns.js (판정도 아래에서 종류별로)
  const settled = await Promise.allSettled(
    monitors.map((m) => (m.kind === 'dns' ? observeDns(m, deps) : observe(m, deps)))
  );

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
    if (monitor.kind === 'dns') {
      const verdict = judgeDns(monitor, observation);
      if (observation.errorMessage) console.log(`[DNS] ${monitor.name}: ${observation.errorMessage}`);
      return {
        monitorId: monitor.id,
        checkedAt,
        isSuccess: verdict.isSuccess,
        isSlow: verdict.isSlow,
        statusCode: null, // HTTP가 아니므로 상태 코드 없음
        responseMs: observation.responseMs,
        failureReason: verdict.failureReason,
        value: observation.answers.length, // 받은 레코드 개수 (화면 표시용)
      };
    }
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

  // 첫 화면 변경 감지 (17단계): 이미 받은 본문으로 지문만 계산 (요청이 늘지 않음).
  // 기록이 모두 저장된 뒤에 하고, 실패해도 점검 기록에는 영향 없음
  try {
    const pages = settled
      .map((outcome, i) => ({ outcome, monitor: monitors[i], row: rows[i] }))
      .filter(({ outcome, monitor }) => monitor.kind === 'http' && outcome.status === 'fulfilled')
      .map(({ outcome, monitor, row }) => ({ monitorId: monitor.id, isSuccess: row.isSuccess, body: outcome.value.body }));
    await runContentChanges(env.DB, pages, checkedAt);
  } catch (err) {
    console.error(`[변경 감지 실패] ${label}:`, err);
  }

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
    const runTime = new Date(controller.scheduledTime);
    await runChecks(env, runTime);

    // 에이전트 무응답 감지 (B-11): 감시를 켠 대상이 없으면 쿼리 1번으로 끝납니다. 실패해도 위 기록에는 영향 없음.
    try {
      await runStaleCheck(env.DB, runTime);
    } catch (err) {
      console.error(`[무응답] ${toCheckSlot(runTime)} 실패:`, err);
    }

    // 오래 가는 장애 메일 (15단계): 기록이 모두 끝난 뒤에 판단. 메일 설정이 없으면 바로 끝나고, 실패해도 점검 기록에는 영향 없음
    try {
      await runEscalation(env, runTime);
    } catch (err) {
      console.error(`[메일] ${toCheckSlot(runTime)} 실패:`, err);
    }

    // 데이터 보존 정리 (25단계): KST 04:00 회차에만 90일 지난 원본을 지움. 다른 회차는 시각만 보고 끝(조회 없음).
    // 점검·메일이 모두 끝난 맨 뒤에 두어서, 정리가 실패하거나 늦어도 이번 회차 기록에는 영향이 없게 합니다.
    try {
      await runRetention(env.DB, runTime);
    } catch (err) {
      console.error(`[보존 정리] ${toCheckSlot(runTime)} 실패:`, err);
    }
  },

  // HTTP 요청 처리.
  // 상태 페이지 파일(public/의 index.html 등)은 Cloudflare가 정적 파일로 먼저 응답하고,
  // 파일이 없는 경로(/api/... 등)만 이 함수로 들어옵니다. (B-3 배포에서 동작 확인)
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/api/rca/')) {
      try { return await handleRca(request, env); }
      catch { return json({ error: 'rca_internal_error' }, 500); }
    }
    const url = new URL(request.url);

    // 데이터 보존 정책과 마지막 정리 결과 (공개, 25단계) — 운영 근거 화면용. 정리 기록 1행만 읽음
    if (url.pathname === '/api/retention') {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
      try {
        // 하루 한 번 바뀌는 값이라 5분 캐시
        return json(retentionView(await getLastRetentionRun(env.DB)), 200, { 'cache-control': 'public, max-age=300' });
      } catch (err) {
        console.error('[API 오류] /api/retention:', err);
        return json({ error: 'internal_error' }, 500);
      }
    }

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

    // 서비스 점검 기록 분석 (공개, 16단계) — ?days=7 또는 30 (기본 30)
    const analysisMatch = url.pathname.match(/^\/api\/services\/([a-z0-9][a-z0-9-]{0,39})\/analysis$/);
    if (analysisMatch) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
      const days = Number(url.searchParams.get('days') ?? '30');
      if (!ANALYSIS_DAYS.includes(days)) return json({ error: 'invalid_days' }, 400);
      try {
        const body = await buildServiceAnalysis(env.DB, analysisMatch[1], days, new Date());
        if (!body) return json({ error: 'not_found' }, 404);
        // 값이 Cron(5분)마다 바뀌므로 다른 공개 API처럼 60초 캐시
        return json(body, 200, { 'cache-control': 'public, max-age=60' });
      } catch (err) {
        console.error('[API 오류] /api/services/:key/analysis:', err);
        return json({ error: 'internal_error' }, 500);
      }
    }

    // 서비스 주간 점검 보고서 (공개, 20단계) — ?week=월요일 날짜(YYYY-MM-DD), 없으면 방금 끝난 주
    // 월요일이 아니거나 아직 시작하지 않은 주는 거부해서, 이상한 값이 DB까지 가지 않게 합니다.
    const weeklyMatch = url.pathname.match(/^\/api\/services\/([a-z0-9][a-z0-9-]{0,39})\/weekly$/);
    if (weeklyMatch) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
      const now = new Date();
      const week = url.searchParams.get('week') ?? lastCompleteWeekStart(now);
      if (!isWeekStart(week) || week > thisWeekStart(now)) return json({ error: 'invalid_week' }, 400);
      try {
        const body = await buildWeeklyReport(env.DB, weeklyMatch[1], week, now, env.SITE_URL ?? null);
        if (!body) return json({ error: 'not_found' }, 404);
        // 값이 Cron(5분)마다 바뀌므로 다른 공개 API처럼 60초 캐시
        return json(body, 200, { 'cache-control': 'public, max-age=60' });
      } catch (err) {
        console.error('[API 오류] /api/services/:key/weekly:', err);
        return json({ error: 'internal_error' }, 500);
      }
    }

    // 서비스 묶음 목록·상세 (공개, 0015)
    // 키는 0015의 CHECK와 같은 모양(영문 소문자·숫자·하이픈, 40자 이하)만 받아서, 이상한 값은 DB까지 가지 않게 합니다.
    const serviceMatch = url.pathname.match(/^\/api\/services(?:\/([a-z0-9][a-z0-9-]{0,39}))?$/);
    if (serviceMatch) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
      try {
        const key = serviceMatch[1];
        const body = key ? await buildServiceDetail(env.DB, key, new Date()) : await buildServices(env.DB, new Date());
        if (!body) return json({ error: 'not_found' }, 404);
        // 서비스 추가 팝업이 '알림 받을 메일' 칸을 보일지 정할 때 씀 (켜짐 여부만, 이유·설정 값은 넣지 않음)
        if (!key) body.subscribersEnabled = subscribersStatus(env).enabled;
        return json(body, 200, { 'cache-control': 'public, max-age=60' });
      } catch (err) {
        console.error('[API 오류] /api/services:', err);
        return json({ error: 'internal_error' }, 500);
      }
    }

    // 장애 상세 (공개, B-5)
    const incidentMatch = url.pathname.match(/^\/api\/incidents\/([1-9]\d{0,9})$/);
    if (incidentMatch) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
      try {
        const body = await buildIncidentDetail(env.DB, Number(incidentMatch[1]), new Date());
        if (!body) return json({ error: 'not_found' }, 404);
        return json(body, 200, { 'cache-control': 'public, max-age=60' });
      } catch (err) {
        console.error('[API 오류] /api/incidents:', err);
        return json({ error: 'internal_error' }, 500);
      }
    }

    // 서비스 상세 팝업 그래프 (공개): 최근 N시간 점검 기록 — ?hours=1~48, 기본 24
    const historyMatch = url.pathname.match(/^\/api\/monitors\/([1-9]\d{0,9})\/history$/);
    if (historyMatch) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
      const raw = url.searchParams.get('hours') ?? String(HISTORY_DEFAULT_HOURS);
      const hours = /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
      if (!(hours >= 1 && hours <= HISTORY_MAX_HOURS)) return json({ error: 'invalid_hours' }, 400);
      try {
        const body = await buildMonitorHistory(env.DB, Number(historyMatch[1]), hours, new Date());
        if (!body) return json({ error: 'not_found' }, 404);
        return json(body, 200, { 'cache-control': 'public, max-age=60' });
      } catch (err) {
        console.error('[API 오류] /api/monitors/:id/history:', err);
        return json({ error: 'internal_error' }, 500);
      }
    }

    // 월간 가용성 보고서 (공개, B-6) — ?month=YYYY-MM, 없으면 이번 달(KST)
    if (url.pathname === '/api/reports/monthly') {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
      const now = new Date();
      const month = url.searchParams.get('month') ?? kstMonthOf(now);
      if (!isValidMonth(month)) return json({ error: 'invalid_month' }, 400);
      try {
        const body = await buildMonthlyReport(env.DB, month, now);
        return json(body, 200, { 'cache-control': 'public, max-age=60' });
      } catch (err) {
        console.error('[API 오류] /api/reports/monthly:', err);
        return json({ error: 'internal_error' }, 500);
      }
    }

    // 장애 알림 수신 확인·그만 받기 페이지 (19단계, 메일 속 링크) — 토큰 확인은 subscribe-api.js 안에서
    if (url.pathname === '/subscribe/confirm' || url.pathname === '/subscribe/unsubscribe') {
      try {
        return await handleSubscribePage(request, env, url);
      } catch (err) {
        console.error('[API 오류] 수신 확인 페이지:', err);
        return new Response('일시적인 오류입니다. 잠시 후 다시 시도해 주세요.', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
    }

    // 관리자 API (B-5) — 인증은 admin.js 안에서
    if (url.pathname.startsWith('/api/admin/')) {
      try {
        return await handleAdmin(request, env, url);
      } catch (err) {
        console.error('[API 오류] 관리자:', err);
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
