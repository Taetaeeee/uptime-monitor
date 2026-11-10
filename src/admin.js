// 관리자 API (B-5) — 보고서 작성, 계획 작업 등록·취소
//
//   PUT    /api/admin/incidents/:id/report   보고서 항목 작성·수정 (보낸 항목만 바뀜)
//   POST   /api/admin/maintenance            계획 작업 등록
//   DELETE /api/admin/maintenance/:id        계획 작업 취소
//
// 인증: Authorization: Bearer <ADMIN_TOKEN>  (wrangler secret, 에이전트 키와 별개)
// 관리자 화면은 만들지 않았습니다. PowerShell의 Invoke-RestMethod 등으로 호출해요.

import { checkBearer } from './auth.js';
import { validateIncidentReport, validateMaintenance } from './incident.js';
import {
  updateIncidentReport,
  insertMaintenance,
  deleteMaintenance,
  getMonitorSource,
} from './db.js';
import { toIsoSeconds } from './time.js';

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

  return json({ error: 'not_found' }, 404);
}
