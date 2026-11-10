// 장애 이력·계획 작업 — 순수 함수 (B-5)
// 네트워크·DB 없이 입력 → 출력만 계산하므로 node --test로 바로 검증합니다.

import { toIsoSeconds } from './time.js';

export const MAX_MAINTENANCE_MS = 24 * 60 * 60 * 1000;     // 작업 1건 최대 24시간
export const MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;     // 1년 넘게 뒤의 작업은 거부
export const MAX_TITLE_LENGTH = 100;
export const MAX_REPORT_FIELD_LENGTH = 2000;

// 보고서 항목: API에서 받는 이름 → DB 컬럼 이름
export const REPORT_FIELDS = Object.freeze({
  summary: 'report_summary',
  impact: 'report_impact',
  root_cause: 'report_root_cause',
  action: 'report_action',
  prevention: 'report_prevention',
});

/**
 * 시간대가 붙은 시각 문자열 → UTC ISO(초 단위, Z).  시간대가 없으면 null.
 *   '2026-11-12T22:00:00+09:00' → '2026-11-12T13:00:00Z'
 * 왜 시간대 없는 값은 거부하나? '22:00'이 한국 시간인지 UTC인지 모호해서
 * 9시간 어긋난 작업이 등록되는 사고를 막기 위해서입니다.
 */
export function toUtcIso(input) {
  if (typeof input !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(input)) return null;
  const ms = Date.parse(input);
  return Number.isNaN(ms) ? null : toIsoSeconds(new Date(ms));
}

/**
 * 계획 작업 등록 입력 검증.
 * @param {object} body { monitor_id: number|null, title, starts_at, ends_at }
 * @param {Date} now
 * @returns {{ok:true, value:{monitorId, title, startsAt, endsAt}} | {ok:false, error}}
 */
export function validateMaintenance(body, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('body_must_be_object');

  const monitorId = body.monitor_id ?? null;
  if (monitorId !== null && !(Number.isInteger(monitorId) && monitorId > 0)) return bad('invalid_monitor_id');

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > MAX_TITLE_LENGTH) return bad('invalid_title');

  const startsAt = toUtcIso(body.starts_at);
  const endsAt = toUtcIso(body.ends_at);
  if (!startsAt || !endsAt) return bad('invalid_time'); // 시간대(Z 또는 +09:00) 필수

  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (end <= start) return bad('ends_before_starts');
  if (end - start > MAX_MAINTENANCE_MS) return bad('too_long');
  if (end <= now.getTime()) return bad('ends_in_past');           // 이미 끝난 작업을 소급 등록하면 과거 가동률이 바뀜
  if (start > now.getTime() + MAX_AHEAD_MS) return bad('too_far_ahead');

  return { ok: true, value: { monitorId, title, startsAt, endsAt } };
}

/**
 * 이 대상이 이 시각에 계획 작업 중인가?  [starts_at, ends_at) — 끝 시각은 포함하지 않음
 * monitor_id가 NULL인 작업은 모든 대상에 적용됩니다.
 */
export function isInMaintenance(windows, monitorId, atIso) {
  return windows.some(
    (w) => (w.monitorId === null || w.monitorId === monitorId) && w.startsAt <= atIso && atIso < w.endsAt
  );
}

/**
 * 보고서 입력 검증. 보낸 항목만 바꾸고(부분 수정), null을 보내면 그 항목을 비웁니다.
 * 모르는 항목 이름은 오타일 가능성이 높아 거부합니다.
 * @returns {{ok:true, value:object(DB컬럼→값)} | {ok:false, error}}
 */
export function validateIncidentReport(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('body_must_be_object');
  const keys = Object.keys(body);
  if (keys.length === 0) return bad('empty_report');

  const value = {};
  for (const key of keys) {
    const column = REPORT_FIELDS[key];
    if (!column) return bad(`unknown_field:${key}`);
    const v = body[key];
    if (v === null) {
      value[column] = null;
      continue;
    }
    if (typeof v !== 'string' || v.length > MAX_REPORT_FIELD_LENGTH) return bad(`invalid_field:${key}`);
    value[column] = v.trim() || null;
  }
  return { ok: true, value };
}

/**
 * 장애 지표 (분 단위, 회차 시각 기준이라 5분 단위로 나옵니다)
 *   durationMinutes : 첫 실패 → 복구 (진행 중이면 → 지금)
 *   detectMinutes   : 첫 실패 → 장애 판정 (감지까지 걸린 시간)
 */
export function incidentMetrics(incident, now) {
  const start = Date.parse(incident.startedAt);
  const end = incident.resolvedAt ? Date.parse(incident.resolvedAt) : now.getTime();
  return {
    ongoing: !incident.resolvedAt,
    durationMinutes: Math.max(0, Math.round((end - start) / 60000)),
    detectMinutes: Math.max(0, Math.round((Date.parse(incident.detectedAt) - start) / 60000)),
  };
}

function bad(error) {
  return { ok: false, error };
}
