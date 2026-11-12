// 내부 점검 에이전트 보고 — 검증과 판정 (순수 함수)
//
// 에이전트는 "측정값"만 보내고, 성공/실패 판정은 서버(여기)가 합니다.
//   왜? 기준값(디스크 90% 등)을 한곳에서 관리하고, 에이전트가 여러 대여도 판정이 어긋나지 않게 하려고요.
//   그리고 판정 규칙을 node --test로 검증할 수 있습니다.
//
// 에이전트 보고 형식 (POST /api/agent/report 본문):
// {
//   "agent": "my-pc",                      // 보낸 에이전트 이름 (로그용)
//   "mode": "real" | "simulator",          // 실제 측정인지, 시나리오의 가짜 측정인지
//   "observed_at": "2026-11-10T05:00:12Z", // 측정 시각 (UTC)
//   "checks": [
//     { "key": "sim-db-tcp", "ok": true, "response_ms": 12, "value": null, "error": null }
//   ]
// }
//   ok    : 측정 자체의 결과 (ping 응답 있음 / 포트 열림 / 서비스 실행 중 / 값을 읽었음)
//   value : disk = 사용률(%), ssl = 남은 일수

import { FAILURE_REASON } from './judge.js';

// 내부 점검 전용 실패 이유 (DB에 이 값 그대로 저장)
export const AGENT_FAILURE = Object.freeze({
  UNREACHABLE: 'unreachable',       // ping 응답 없음
  PORT_CLOSED: 'port_closed',       // TCP 연결 실패
  SSL_EXPIRING: 'ssl_expiring',     // 인증서 만료 임박
  DISK_FULL: 'disk_full',           // 디스크 사용률 기준 이상
  SERVICE_STOPPED: 'service_stopped', // 서비스가 실행 중이 아님
  MEASURE_ERROR: 'measure_error',   // 값을 읽지 못함 (디스크 경로 오류 등)
  SILENT: 'agent_silent',           // 에이전트 보고가 끊김 (측정 실패가 아니라 "측정 결과가 안 옴", B-11)
});

export const AGENT_KINDS = Object.freeze(['ping', 'tcp', 'ssl', 'disk', 'service']);

// monitors.threshold가 비어 있을 때 쓰는 기본 기준
export const DEFAULT_THRESHOLD = Object.freeze({
  ssl: 14,  // 남은 일수가 14일 미만이면 실패 (갱신할 시간을 남겨 두기 위해)
  disk: 90, // 사용률 90% 이상이면 실패
});

// 보고 1건의 한계 — 잘못된(또는 악의적인) 요청이 DB를 과하게 쓰지 못하게
export const MAX_CHECKS_PER_REPORT = 50;
export const MAX_REPORT_BYTES = 64 * 1024;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 하루보다 오래된 측정은 거부
export const MAX_FUTURE_MS = 5 * 60 * 1000;    // 5분 넘게 미래인 측정은 거부 (PC 시계 오차 허용)

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * 보고 본문을 검증한다. 하나라도 틀리면 전체를 거부합니다(부분 저장 없음 → 원인 파악이 쉬움).
 * @param {unknown} body  JSON.parse 결과
 * @param {Date} now      서버 현재 시각
 * @returns {{ ok: true, report: object } | { ok: false, error: string }}
 */
export function validateReport(body, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('body_must_be_object');
  const { agent, mode, observed_at: observedAt, checks } = body;

  if (typeof agent !== 'string' || agent.length === 0 || agent.length > 64) return bad('invalid_agent');
  if (mode !== 'real' && mode !== 'simulator') return bad('invalid_mode');

  if (typeof observedAt !== 'string' || !ISO_UTC_PATTERN.test(observedAt)) return bad('invalid_observed_at');
  const observedMs = Date.parse(observedAt);
  if (Number.isNaN(observedMs)) return bad('invalid_observed_at');
  if (observedMs < now.getTime() - MAX_AGE_MS) return bad('observed_at_too_old');
  if (observedMs > now.getTime() + MAX_FUTURE_MS) return bad('observed_at_in_future');

  if (!Array.isArray(checks) || checks.length === 0) return bad('checks_required');
  if (checks.length > MAX_CHECKS_PER_REPORT) return bad('too_many_checks');

  const seen = new Set();
  const cleaned = [];
  for (const c of checks) {
    if (!c || typeof c !== 'object') return bad('invalid_check');
    if (typeof c.key !== 'string' || !KEY_PATTERN.test(c.key)) return bad('invalid_check_key');
    if (seen.has(c.key)) return bad('duplicate_check_key');
    seen.add(c.key);
    if (typeof c.ok !== 'boolean') return bad('invalid_check_ok');

    const responseMs = c.response_ms ?? null;
    if (responseMs !== null && !(isFiniteNumber(responseMs) && responseMs >= 0 && responseMs <= 600000)) {
      return bad('invalid_response_ms');
    }
    const value = c.value ?? null;
    if (value !== null && !isFiniteNumber(value)) return bad('invalid_value');

    const error = c.error ?? null;
    if (error !== null && typeof error !== 'string') return bad('invalid_error');

    cleaned.push({
      key: c.key,
      ok: c.ok,
      responseMs: responseMs === null ? null : Math.round(responseMs),
      value,
      error: error === null ? null : error.slice(0, 200), // 로그용, 길이 제한
    });
  }

  return { ok: true, report: { agent, mode, observedAt, checks: cleaned } };
}

function bad(error) {
  return { ok: false, error };
}

/**
 * 측정값 1개를 판정한다. 종류(kind)는 에이전트가 아니라 서버의 대상 설정에서 가져옵니다.
 *
 * @param {object} monitor  { kind, maxResponseMs, threshold }
 * @param {object} m        validateReport가 정리한 측정값 { ok, responseMs, value }
 * @returns {{ isSuccess, isSlow, failureReason, responseMs, value }}
 */
export function judgeAgentCheck(monitor, m) {
  const keep = { responseMs: m.responseMs, value: m.value };
  const fail = (reason) => ({ isSuccess: false, isSlow: false, failureReason: reason, ...keep });
  const pass = (isSlow = false) => ({ isSuccess: true, isSlow, failureReason: null, ...keep });

  switch (monitor.kind) {
    case 'ping':
    case 'tcp': {
      if (!m.ok) return fail(monitor.kind === 'ping' ? AGENT_FAILURE.UNREACHABLE : AGENT_FAILURE.PORT_CLOSED);
      // '느림'은 성공일 때만 (HTTP 판정과 같은 규칙)
      return pass(m.responseMs !== null && m.responseMs > monitor.maxResponseMs);
    }
    case 'ssl': {
      // 인증서를 읽지 못함 = 접속 자체가 안 됨 (HTTP의 network_error와 같은 의미)
      if (!m.ok || m.value === null) return fail(FAILURE_REASON.NETWORK_ERROR);
      const minDays = monitor.threshold ?? DEFAULT_THRESHOLD.ssl;
      return m.value < minDays ? fail(AGENT_FAILURE.SSL_EXPIRING) : pass();
    }
    case 'disk': {
      if (!m.ok || m.value === null) return fail(AGENT_FAILURE.MEASURE_ERROR);
      const maxPercent = monitor.threshold ?? DEFAULT_THRESHOLD.disk;
      return m.value >= maxPercent ? fail(AGENT_FAILURE.DISK_FULL) : pass();
    }
    case 'service':
      return m.ok ? pass() : fail(AGENT_FAILURE.SERVICE_STOPPED);
    default:
      // 에이전트 대상이 아닌 종류(http 등)에 보고가 오면 판정하지 않음 (호출하는 쪽에서 걸러야 함)
      throw new Error(`에이전트 판정 대상이 아닌 종류: ${monitor.kind}`);
  }
}
