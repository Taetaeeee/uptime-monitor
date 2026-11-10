// 에이전트 보고 수집: POST /api/agent/report
//
//   인증 → 크기 제한 → JSON·형식 검증 → check_key로 대상 찾기 → 출처 확인
//   → 회차 시각·중복 처리 → 판정(agent-judge.js) → 기록(record.js)
//
// 에이전트는 바깥으로만 연결합니다(이 API를 호출). Worker가 PC로 접속하는 일은 없어서 PC 포트를 열 필요가 없어요.

import { getMonitorsByKeys, getMonitorStates } from './db.js';
import { validateReport, judgeAgentCheck, AGENT_KINDS, MAX_REPORT_BYTES } from './agent-judge.js';
import { recordResults } from './record.js';
import { toCheckSlot } from './time.js';
import { checkBearer } from './auth.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * @param {Request} request
 * @param {object} env   { DB, AGENT_API_KEY }  — AGENT_API_KEY는 wrangler secret으로 등록 (코드·저장소에 없음)
 * @param {object} [deps] { now: Date, channels }  테스트용
 */
export async function handleAgentReport(request, env, deps = {}) {
  const now = deps.now ?? new Date();

  // ── 1) 인증 (auth.js: 타이밍 안전 비교) ──
  // 키가 등록되지 않았으면 아무도 보고할 수 없게 막습니다 ("키 없음 = 누구나 허용"이 되면 안 되므로)
  const auth = await checkBearer(request, env.AGENT_API_KEY);
  if (auth === 'disabled') {
    console.error('[수집] AGENT_API_KEY가 등록되지 않아 보고를 받지 않습니다.');
    return json({ error: 'agent_api_disabled' }, 503);
  }
  if (auth !== 'ok') {
    // 키가 틀렸다는 것 외에는 아무 정보도 주지 않습니다
    return json({ error: 'unauthorized' }, 401);
  }

  // ── 2) 크기 제한 → JSON ──
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_REPORT_BYTES) return json({ error: 'payload_too_large' }, 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_REPORT_BYTES) return json({ error: 'payload_too_large' }, 413);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  // ── 3) 형식 검증 ──
  const v = validateReport(body, now);
  if (!v.ok) return json({ error: v.error }, 400);
  const report = v.report;

  // ── 4) 대상 찾기 + 출처 확인 ──
  const monitors = await getMonitorsByKeys(env.DB, report.checks.map((c) => c.key));
  const byKey = new Map(monitors.map((m) => [m.checkKey, m]));

  const unknown = [];  // 등록되지 않은 키
  const rejected = []; // 출처·종류가 맞지 않아 거부
  const skipped = [];  // 이미 기록된 회차 (중복·순서 뒤바뀜)
  const accepted = [];

  // 측정 시각을 5분 회차로 내림 (HTTP 점검과 같은 단위로 묶기 위해)
  const checkedAt = toCheckSlot(new Date(report.observedAt));
  const prevStates = await getMonitorStates(env.DB);

  for (const c of report.checks) {
    const monitor = byKey.get(c.key);
    if (!monitor) {
      unknown.push(c.key);
      continue;
    }
    // 시뮬레이터 보고는 시뮬레이터 대상에만, 실제 보고는 실제 대상에만 기록합니다.
    // 이렇게 막지 않으면 가짜 측정값이 실제 대상의 기록에 섞일 수 있어요. (CLAUDE.md 규칙 8)
    // 시드(sample) 대상은 어떤 보고도 받지 않습니다.
    if (monitor.source !== report.mode || !AGENT_KINDS.includes(monitor.kind)) {
      rejected.push(c.key);
      continue;
    }
    // 이미 이 회차(또는 더 나중 회차)가 기록돼 있으면 건너뜀 → 같은 보고를 다시 보내도 두 번 쌓이지 않음
    const last = prevStates.get(monitor.id)?.lastCheckedAt;
    if (last && checkedAt <= last) {
      skipped.push(c.key);
      continue;
    }
    if (c.error) console.log(`[수집] ${report.agent} ${c.key} 측정 오류: ${c.error}`);
    accepted.push({ monitor, check: c });
  }

  // ── 5) 판정 → 기록 ──
  const rows = accepted.map(({ monitor, check }) => {
    const verdict = judgeAgentCheck(monitor, check);
    return {
      monitorId: monitor.id,
      checkedAt,
      isSuccess: verdict.isSuccess,
      isSlow: verdict.isSlow,
      statusCode: null, // HTTP가 아니므로 상태 코드 없음
      responseMs: verdict.responseMs,
      failureReason: verdict.failureReason,
      value: verdict.value,
    };
  });

  if (rows.length > 0) {
    await recordResults(env.DB, {
      monitors: accepted.map((a) => a.monitor),
      rows,
      checkedAt,
      source: report.mode,
      label: `보고 ${checkedAt} (에이전트 ${report.agent}, ${report.mode})`,
      channels: deps.channels,
      prevStates,
    });
  }

  return json({
    checkedAt,
    accepted: rows.length,
    skipped,
    unknown,
    rejected,
  });
}
