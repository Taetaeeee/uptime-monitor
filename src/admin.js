// 관리자 API (B-5) — 보고서 작성, 계획 작업 등록·취소
//
//   PUT    /api/admin/incidents/:id/report   보고서 항목 작성·수정 (보낸 항목만 바뀜)
//   POST   /api/admin/maintenance            계획 작업 등록
//   DELETE /api/admin/maintenance/:id        계획 작업 취소
//   POST   /api/admin/services/preview       '+ 서비스 추가' 미리 점검: 주소 검사 + 1회 접속 결과 (저장 안 함, S4)
//   POST   /api/admin/services               서비스 + 점검(HTTP·DNS·선택한 상태 확인) 만들기 (S4)
//   PATCH  /api/admin/services/:key          { isActive: false|true } 서비스 끄기·다시 켜기 (삭제 대신 끄기, S4)
//   POST   /api/admin/alerts/test            시험 메일 1통 (장애를 기다리지 않고 메일 설정 확인, 15단계)
//   GET    /api/admin/subscribers            서비스별 수신자 목록 (주소는 가림, 19단계 — 기본은 꺼짐)
//   POST   /api/admin/services/:key/subscribers   { email } 수신자 초대 → 확인 메일 (켜져 있을 때만)
//   DELETE /api/admin/subscribers/:id        수신자 삭제 (주소도 지움)
//
// 인증: Authorization: Bearer <ADMIN_TOKEN>  (wrangler secret, 에이전트 키와 별개)
// 보고서·계획 작업은 PowerShell의 Invoke-RestMethod 등으로 호출해요. 서비스 추가만 대시보드 팝업이 있습니다(토큰은 저장하지 않음).

import { checkBearer } from './auth.js';
import { validateIncidentReport, validateMaintenance } from './incident.js';
import {
  updateIncidentReport,
  insertMaintenance,
  deleteMaintenance,
  getMonitorSource,
  getServiceRows,
  insertServiceWithMonitors,
  setServiceActive,
  setServiceCategory,
  getServices,
  listSubscribers,
  getSubscriber,
  deleteSubscriber,
} from './db.js';
import { subscribersStatus, normalizeEmail, maskEmail } from './subscribers.js';
import { inviteSubscriber } from './subscribe-api.js';
import { toIsoSeconds } from './time.js';
import { validateServiceInput, serviceKeyFor, buildMonitors, MAX_SERVICES, suggestCategory, checkCategory } from './service-admin.js';
import { observe } from './checker.js';
import { observeDns } from './dns.js';
import { judgeCheck, judgeDns } from './judge.js';
import { REASON_TEXT } from './notify.js';
import { isEmailConfigured, sendEmail } from './channels/email.js';

const PREVIEW_TIMEOUT_MS = 8_000; // 미리 점검은 사람이 기다리므로 Cron(10초)보다 조금 짧게

/** 같은 사이트인지 비교할 때 끝의 / 차이는 무시 (기존 고쳐라!는 'https://gochyeora.pages.dev'로 저장돼 있음) */
const sameSite = (a, b) => (a ?? '').replace(/\/$/, '') === (b ?? '').replace(/\/$/, '');

/**
 * 미리 점검: 만들 점검을 저장하지 않고 한 번씩 실제로 돌려 본다 (Cron과 같은 측정·판정 함수).
 * 실패해도 추가는 막지 않고 화면에 경고로 보여 줍니다 (아직 배포 전인 사이트를 먼저 등록할 수도 있어서).
 */
async function previewChecks(monitors, deps) {
  const opts = { fetchFn: deps.fetchFn, timeoutMs: PREVIEW_TIMEOUT_MS };
  return Promise.all(
    monitors.map(async (m) => {
      const isDns = m.kind === 'dns';
      const obs = isDns ? await observeDns(m, opts) : await observe(m, opts);
      const v = isDns ? judgeDns(m, obs) : judgeCheck(m, obs);
      return {
        name: m.name,
        kind: m.kind,
        isSuccess: v.isSuccess,
        isSlow: v.isSlow,
        statusCode: isDns ? null : obs.statusCode,
        responseMs: obs.responseMs,
        records: isDns ? obs.answers.length : null,
        failureReason: v.failureReason,
        failureText: v.failureReason ? REASON_TEXT[v.failureReason] ?? v.failureReason : null,
      };
    })
  );
}

const MAX_BODY_BYTES = 16 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function readJson(request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { error: json({ error: 'payload_too_large' }, 413) };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: json({ error: 'invalid_json' }, 400) };
  }
}

const parseId = (s) => (/^[1-9]\d{0,9}$/.test(s) ? Number(s) : null);

/**
 * /api/admin/... 요청 처리
 * @param {Request} request
 * @param {object} env  { DB, ADMIN_TOKEN }
 * @param {URL} url
 * @param {object} [deps] { now: Date } 테스트용
 */
export async function handleAdmin(request, env, url, deps = {}) {
  const now = deps.now ?? new Date();

  // ── 인증 (모든 관리자 경로 공통) ──
  const auth = await checkBearer(request, env.ADMIN_TOKEN);
  if (auth === 'disabled') {
    console.error('[관리자] ADMIN_TOKEN이 등록되지 않아 관리자 API를 막습니다.');
    return json({ error: 'admin_api_disabled' }, 503);
  }
  if (auth !== 'ok') return json({ error: 'unauthorized' }, 401);

  const path = url.pathname;
  const method = request.method;

  // ── 보고서 작성 ──
  let m = path.match(/^\/api\/admin\/incidents\/([^/]+)\/report$/);
  if (m) {
    if (method !== 'PUT') return json({ error: 'method_not_allowed' }, 405);
    const id = parseId(m[1]);
    if (!id) return json({ error: 'invalid_id' }, 400);
    const { body, error } = await readJson(request);
    if (error) return error;
    const v = validateIncidentReport(body);
    if (!v.ok) return json({ error: v.error }, 400);
    const changed = await updateIncidentReport(env.DB, id, v.value, toIsoSeconds(now));
    if (changed === 0) return json({ error: 'incident_not_found' }, 404);
    console.log(`[관리자] 장애 ${id} 보고서 수정: ${Object.keys(v.value).join(', ')}`);
    return json({ ok: true, id });
  }

  // ── 계획 작업 등록 ──
  if (path === '/api/admin/maintenance') {
    if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const { body, error } = await readJson(request);
    if (error) return error;
    const v = validateMaintenance(body, now);
    if (!v.ok) return json({ error: v.error }, 400);
    // 작업의 출처는 대상의 출처를 따릅니다 (CLAUDE.md 규칙 8).
    //   시뮬레이터·시드 대상의 작업이 'real'로 저장되면 화면에서 실제 작업처럼 보이기 때문이에요.
    //   대상이 없는(모든 대상) 작업은 실제 운영 작업이므로 'real'.
    let source = 'real';
    if (v.value.monitorId !== null) {
      source = await getMonitorSource(env.DB, v.value.monitorId);
      if (!source) return json({ error: 'monitor_not_found' }, 400);
    }
    const id = await insertMaintenance(env.DB, v.value, toIsoSeconds(now), source);
    console.log(`[관리자] 계획 작업 ${id} 등록(${source}): ${v.value.title} ${v.value.startsAt} ~ ${v.value.endsAt}`);
    return json({ ok: true, id, ...v.value, source }, 201);
  }

  // ── 계획 작업 취소 ──
  m = path.match(/^\/api\/admin\/maintenance\/([^/]+)$/);
  if (m) {
    if (method !== 'DELETE') return json({ error: 'method_not_allowed' }, 405);
    const id = parseId(m[1]);
    if (!id) return json({ error: 'invalid_id' }, 400);
    const changed = await deleteMaintenance(env.DB, id);
    if (changed === 0) return json({ error: 'maintenance_not_found' }, 404);
    console.log(`[관리자] 계획 작업 ${id} 취소`);
    return json({ ok: true, id });
  }

  // ── 서비스 추가: 미리 점검 (저장 안 함) ──
  const selfHost = url.host; // 이 Worker 자신의 주소는 점검 대상으로 받지 않음
  if (path === '/api/admin/services/preview') {
    if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const { body, error } = await readJson(request);
    if (error) return error;
    const v = validateServiceInput(body, { selfHost, requireConsent: false });
    if (!v.ok) return json({ error: v.error }, 400);
    const rows = await getServiceRows(env.DB);
    const monitors = buildMonitors(v.value);
    const checks = await previewChecks(monitors, deps);
    return json({
      ok: true,
      proposed: { key: serviceKeyFor(v.value.host, rows.map((r) => r.key)), name: v.value.name, homeUrl: v.value.homeUrl },
      // 종류 추천(28단계): 이름·설명의 단어로. 팝업이 이 값을 기본으로 골라 두고, 운영자가 바꿀 수 있음
      suggestedCategory: suggestCategory(v.value.name, v.value.description),
      alreadyExists: rows.some((r) => r.isActive && sameSite(r.homeUrl, v.value.homeUrl)),
      activeCount: rows.filter((r) => r.isActive).length,
      limit: MAX_SERVICES,
      checks,
    });
  }

  // ── 서비스 추가: 만들기 ──
  if (path === '/api/admin/services') {
    if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const { body, error } = await readJson(request);
    if (error) return error;
    const v = validateServiceInput(body, { selfHost, requireConsent: true });
    if (!v.ok) return json({ error: v.error }, 400);
    // 알림 받을 메일 (19단계, 선택): 기능이 꺼져 있으면 받지 않음. 서비스를 만들기 전에 먼저 검사해서 반쯤 만들어지는 일이 없게
    const alertEmail = typeof body.alertEmail === 'string' ? body.alertEmail.trim() : '';
    if (alertEmail) {
      if (!subscribersStatus(env).enabled) return json({ error: 'subscribers_disabled' }, 400);
      const e = normalizeEmail(alertEmail);
      if (!e.ok) return json({ error: e.error }, 400);
    }
    const rows = await getServiceRows(env.DB);
    if (rows.some((r) => r.isActive && sameSite(r.homeUrl, v.value.homeUrl))) return json({ error: 'already_exists' }, 409);
    if (rows.filter((r) => r.isActive).length >= MAX_SERVICES) return json({ error: 'limit_reached', limit: MAX_SERVICES }, 409);
    const key = serviceKeyFor(v.value.host, rows.map((r) => r.key));
    const sortOrder = Math.max(0, ...rows.map((r) => r.sortOrder ?? 0)) + 1; // 맨 뒤에 붙임
    const monitors = buildMonitors(v.value);
    await insertServiceWithMonitors(env.DB, { key, name: v.value.name, description: v.value.description, homeUrl: v.value.homeUrl, sortOrder, category: v.value.category }, monitors, toIsoSeconds(now));
    console.log(`[관리자] 서비스 추가 ${key} (${v.value.host}), 점검 ${monitors.length}개`);
    let subscriber = null;
    if (alertEmail) {
      const svc = (await getServices(env.DB)).find((s) => s.key === key);
      const r = await inviteSubscriber(env, svc, alertEmail, now, deps);
      subscriber = { status: r.status, ...r.body }; // 서비스는 이미 만들어졌으므로 수신자 결과만 따로 알려 줌
    }
    return json({ ok: true, key, name: v.value.name, category: v.value.category, checks: monitors.map((m) => ({ name: m.name, kind: m.kind })), ...(subscriber ? { subscriber } : {}) }, 201);
  }

  // ── 시험 메일 (15단계) ──
  // 받는 주소는 응답에 넣지 않습니다 (개인 정보). 성공·실패만 돌려줘요.
  if (path === '/api/admin/alerts/test') {
    if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!isEmailConfigured(env)) return json({ error: 'email_not_configured' }, 503);
    try {
      await sendEmail({
        subject: '[Uptime Monitor] 시험 메일',
        text: `메일 알림 설정이 동작합니다.
보낸 시각(UTC): ${toIsoSeconds(now)}
장애가 15분 넘게 계속되면 이 주소로 장애 메일과 복구 메일이 옵니다.`,
      }, env, deps);
      console.log('[관리자] 시험 메일 보냄');
      return json({ ok: true });
    } catch (err) {
      console.error(`[관리자] 시험 메일 실패: ${err?.message ?? err}`);
      return json({ error: 'email_send_failed' }, 502);
    }
  }

  // ── 서비스 끄기·다시 켜기 · 종류 바꾸기(28단계) ──
  m = path.match(/^\/api\/admin\/services\/([a-z0-9][a-z0-9-]{0,39})$/);
  if (m) {
    if (method !== 'PATCH') return json({ error: 'method_not_allowed' }, 405);
    const { body, error } = await readJson(request);
    if (error) return error;
    // { category }만 오면 종류만 바꿈 (isActive와 함께 와도 됨). 둘 다 없으면 400
    const hasCategory = body && Object.prototype.hasOwnProperty.call(body, 'category');
    if (hasCategory) {
      const c = checkCategory(body.category);
      if (!c.ok || c.value === null) return json({ error: 'category_invalid' }, 400);
      const changed = await setServiceCategory(env.DB, m[1], c.value);
      if (changed === 0) return json({ error: 'service_not_found' }, 404);
      console.log(`[관리자] 서비스 ${m[1]} 종류 → ${c.value}`);
      if (typeof body.isActive !== 'boolean') return json({ ok: true, key: m[1], category: c.value });
    }
    if (typeof body?.isActive !== 'boolean') return json({ error: 'is_active_required' }, 400);
    if (body.isActive) {
      // 다시 켤 때도 상한을 지킴
      const rows = await getServiceRows(env.DB);
      const target = rows.find((r) => r.key === m[1]);
      if (!target) return json({ error: 'service_not_found' }, 404);
      if (!target.isActive && rows.filter((r) => r.isActive).length >= MAX_SERVICES) return json({ error: 'limit_reached', limit: MAX_SERVICES }, 409);
    }
    const changed = await setServiceActive(env.DB, m[1], body.isActive);
    if (changed === 0) return json({ error: 'service_not_found' }, 404);
    console.log(`[관리자] 서비스 ${m[1]} ${body.isActive ? '다시 켬' : '끔'}`);
    return json({ ok: true, key: m[1], isActive: body.isActive });
  }

  // ── 서비스별 수신자 (19단계, 기본은 꺼짐) ──
  if (path === '/api/admin/subscribers') {
    if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const st = subscribersStatus(env);
    const items = (await listSubscribers(env.DB)).map((s) => ({
      id: s.id, serviceKey: s.serviceKey, serviceName: s.serviceName, email: maskEmail(s.email), status: s.status, createdAt: s.createdAt, confirmedAt: s.confirmedAt,
    }));
    return json({ enabled: st.enabled, reason: st.reason, items });
  }
  m = path.match(/^\/api\/admin\/services\/([a-z0-9][a-z0-9-]{0,39})\/subscribers$/);
  if (m) {
    if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const { body, error } = await readJson(request);
    if (error) return error;
    const svc = (await getServices(env.DB)).find((s) => s.key === m[1]);
    if (!svc) return json({ error: 'service_not_found' }, 404);
    const r = await inviteSubscriber(env, svc, body.email, now, deps);
    return json(r.body, r.status);
  }
  m = path.match(/^\/api\/admin\/subscribers\/([1-9]\d{0,9})$/);
  if (m) {
    if (method !== 'DELETE') return json({ error: 'method_not_allowed' }, 405);
    const sub = await getSubscriber(env.DB, Number(m[1]));
    if (!sub) return json({ error: 'not_found' }, 404);
    await deleteSubscriber(env.DB, sub.id);
    console.log(`[관리자] 수신자 #${sub.id} 삭제`);
    return json({ ok: true, id: sub.id });
  }

  return json({ error: 'not_found' }, 404);
}
