// 제한된 로컬 조사 흐름 — 계획 → 조회 → 판단 → (필요하면) 추가 조회 → 보고
//
// 이 러너가 하는 일과 하지 않는 일
// - 하는 일: 주입된 "결정 정책"이 정한 도구 호출을 한도 안에서 실행하고, 규칙 진단을 거쳐 보고서를 만든다.
// - 하지 않는 일: LLM을 부르지 않는다. 지금 정책은 규칙(rule) 또는 테스트 대역(test-double)뿐이며,
//   보고서의 llm_executed는 항상 false다. LLM 정책은 이번 단계에 구현하지도 표기하지도 않는다.
// - 정책에는 요약된 진단(코드와 증거 id)만 준다. fixture 원본·관측 값·정답은 주지 않는다.
// - 난수·현재 시각을 쓰지 않는다. 같은 입력이면 run id도 보고서도 같다.
//
// 종료는 항상 "예외"가 아니라 보고서의 stop_reason으로 남긴다.
//   한도 도달 → run_status=incomplete / 정책·검증 오류 → run_status=failed (cause_outcome=null)
// 실패한 실행을 "분석 불가/보류" 같은 판단으로 위장하지 않기 위해서다.

import { createHash } from 'node:crypto';
import {
  SCHEMA_VERSION, SOURCE_OF_MODE, POLICY_KINDS, STOP_REASON_STATUS, NOTICE_KO, CHANNELS,
  validateReport,
} from './lib/case-schema.js';
import { diagnoseDnsHttp } from './lib/dns-http-diagnosis.js';
import { createSyntheticTools } from './tools/synthetic-tools.js';
import { deepClone, deepFreeze, canonicalJson, sameValue, isPlainObject, isNonNegInt } from './lib/util.js';

/** 기본 한도 (모두 미확정 기본값). 한도는 호출자가 바꿀 수 있지만 0 이상 정수여야 한다. */
export const DEFAULT_LIMITS = Object.freeze({ maxToolCalls: 8, maxSteps: 6, maxAdditionalObservations: 2 });

/** 정책이 보게 되는 입력의 키 목록 (이 밖의 정보는 정책에 전달하지 않는다). */
export const POLICY_INPUT_KEYS = Object.freeze([
  'step', 'diagnosis', 'evidenceIds', 'remaining', 'lastResult', 'target_alias', 'channels',
]);

/** 정책이 스스로 끝낼 때 쓸 수 있는 사유. */
const POLICY_FINISH_REASONS = ['finished', 'additional_observation_limit'];

/** 연속으로 새 증거가 없으면 멈추는 횟수 */
const NO_NEW_INFORMATION_LIMIT = 2;

/**
 * 규칙 정책: 처음 두 단계에서 DoH·HTTP를 한 번씩 조회하고,
 * 그 뒤에는 진단이 "추가 관측이 결과를 바꿀 수 있다"고 한 채널에만 추가 관측을 요청한다.
 * 상태를 따로 갖지 않는다 (단계 번호와 진단만 보고 결정하므로 같은 입력이면 같은 결정).
 */
export function createRulePolicy() {
  return {
    name: 'rule-baseline',
    kind: 'rule',
    decide({ step, diagnosis, remaining, target_alias: alias, channels }) {
      if (step === 1) return { type: 'call', tool: 'dns_lookup', args: { target_alias: alias } };
      if (step === 2) return { type: 'call', tool: 'http_probe', args: { target_alias: alias } };
      const wanted = (diagnosis.next_checks ?? []).find(
        (n) => n.kind === 'additional_observation' && n.would_change_outcome === true && channels.includes(n.channel),
      );
      if (!wanted) return { type: 'finish', reason: 'finished' };
      if (remaining.additional <= 0) return { type: 'finish', reason: 'additional_observation_limit' };
      return { type: 'call', tool: 'request_additional_observation', args: { channel: wanted.channel } };
    },
  };
}

function resolveLimits(limits) {
  const merged = { ...DEFAULT_LIMITS, ...(isPlainObject(limits) ? limits : {}) };
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    if (!isNonNegInt(merged[key])) throw new Error(`invalid_limit:${key}`);
  }
  for (const key of Object.keys(merged)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key)) throw new Error(`unknown_limit:${key}`);
  }
  return merged;
}

/**
 * 같은 입력이면 같은 run id가 나오도록 사례·정책·한도·가용성 지연에서 만든다 (난수·시각 미사용).
 * 가용성 지연(d)도 넣는 이유: d가 다르면 보이는 관측이 달라 전혀 다른 실행인데,
 * run id(와 증거 id)가 같으면 서로 다른 실행의 증거를 구분할 수 없게 되기 때문이다.
 */
export function makeRunId(caseId, policyName, limits, availabilityDelaySec = 0) {
  const text = `${caseId}|${policyName}|${canonicalJson(limits)}|d=${availabilityDelaySec}`;
  const digest = createHash('sha256').update(text).digest('hex');
  return `run-${digest.slice(0, 8)}`;
}

function emptyDiagnosis() {
  return {
    cause_outcome: null, confirmed_cause: null,
    phenomena: [], hypotheses: [], unknown_facts: [], next_checks: [], rejected_evidence: [], notes_ko: [],
  };
}

/**
 * 만든 보고서를 장부와 대조해 검증하고, 실패하면 failed로 내린다.
 * 검증에 실패한 보고서를 "보류" 같은 정상 판단처럼 두지 않는다.
 *
 * 증거 id·숫자가 장부와 같아도(사실 검증) 그 증거가 결론을 "뒷받침하는지"는 별개다.
 * 그래서 이미 failed가 아닌 실행은 장부로 규칙 진단을 다시 계산해 보고서의 진단과 비교한다.
 * 이 비교는 결과를 낮추거나 거부할 뿐이다. 진단을 올려 주는(확정 승격) 경로는 없다.
 */
export function finalizeReport(report, ledger) {
  const check = validateReport(report, ledger);
  const problems = [...check.problems];
  if (report?.run_status === 'failed') {
    // 실패한 실행에는 판단이 없어야 한다. 가설·현상이 남아 있으면 실패 보고서에 결론을 몰래 싣는 것이다.
    if (!sameValue(report.diagnosis, emptyDiagnosis())) problems.push('diagnosis_not_empty_on_failure');
  } else if (Array.isArray(ledger) && isPlainObject(report?.diagnosis)) {
    const scope = { case_id: report.case_id, run_id: report.run_id, mode: report.mode };
    if (!sameValue(diagnoseDnsHttp(ledger, scope), report.diagnosis)) problems.push('diagnosis_not_reproducible');
  }
  if (problems.length === 0) return { ...report, validation: { ok: true, problems: [] } };
  return {
    ...report,
    run_status: 'failed',
    stop_reason: 'validation_error',
    diagnosis: emptyDiagnosis(),
    validation: { ok: false, problems },
  };
}

/**
 * 조사를 실행한다.
 * @param {object} p
 * @param {object} p.caseData 관측 fixture (정답 없음)
 * @param {{name:string, kind:string, decide:Function}} p.policy 결정 정책
 * @param {object} [p.limits] DEFAULT_LIMITS 중 바꿀 값
 * @param {string} [p.runId] 지정하지 않으면 사례·정책·한도로 만든다
 * @param {number} [p.availabilityDelaySec=0]
 */
export function runInvestigation({ caseData, policy, limits, runId, availabilityDelaySec = 0 } = {}) {
  if (!isPlainObject(policy) || typeof policy.name !== 'string' || typeof policy.decide !== 'function') {
    throw new Error('policy_invalid');
  }
  if (!POLICY_KINDS.includes(policy.kind)) throw new Error('policy_kind_not_supported'); // LLM 정책 등은 지원하지 않는다
  const cfg = resolveLimits(limits);
  const id = runId ?? makeRunId(caseData?.case_id, policy.name, cfg, availabilityDelaySec);
  const tools = createSyntheticTools({ caseData, runId: id, availabilityDelaySec });
  const scope = { case_id: caseData.case_id, run_id: id, mode: caseData.mode };
  const checks = tools.listChecks();
  const initialCutoff = { ...checks.cutoff_rel };

  const callLog = [];
  const used = { tool_calls: 0, steps: 0, additional_observations: 0 };
  const seen = new Set();
  let stopReason = null;
  let lastEntry = null;
  let noNewStreak = 0;

  const log = (entry) => {
    const row = { n: callLog.length + 1, ...entry };
    callLog.push(row);
    return row;
  };

  while (stopReason === null) {
    if (used.steps >= cfg.maxSteps) { stopReason = 'step_limit'; break; }
    used.steps += 1;

    const diagnosis = diagnoseDnsHttp(tools.ledger(), scope);
    // 정책에 전달하는 입력은 요약(코드·id)뿐이고, 얼려서 정책이 고칠 수 없게 한다.
    const input = deepFreeze({
      step: used.steps,
      diagnosis: deepClone(diagnosis),
      evidenceIds: tools.ledger().map((e) => e.evidence_id),
      remaining: {
        toolCalls: cfg.maxToolCalls - used.tool_calls,
        additional: cfg.maxAdditionalObservations - used.additional_observations,
      },
      lastResult: lastEntry === null ? null : deepClone(lastEntry),
      target_alias: checks.target_alias,
      channels: [...CHANNELS],
    });

    let decision;
    try {
      decision = policy.decide(input);
    } catch {
      stopReason = 'policy_error';
      break;
    }
    if (!isPlainObject(decision)) { stopReason = 'policy_error'; break; }

    if (decision.type === 'finish') {
      if (!POLICY_FINISH_REASONS.includes(decision.reason)) { stopReason = 'policy_error'; break; }
      stopReason = decision.reason;
      break;
    }
    if (decision.type !== 'call' || typeof decision.tool !== 'string' || !isPlainObject(decision.args)) {
      stopReason = 'policy_error';
      break;
    }

    // 한도를 넘는 호출은 실행하지 않고 기록만 남긴 채 즉시 멈춘다 (예외로 끝내지 않는다).
    const isExtra = decision.tool === 'request_additional_observation';
    const overExtra = isExtra && used.additional_observations >= cfg.maxAdditionalObservations;
    const overCalls = used.tool_calls >= cfg.maxToolCalls;
    if (overExtra || overCalls) {
      lastEntry = log({
        tool: decision.tool, args: deepClone(decision.args), ok: false,
        error_code: 'call_limit_exceeded', evidence_ids: [], cutoff_clipped: false,
      });
      stopReason = overExtra ? 'additional_observation_limit' : 'tool_call_limit';
      break;
    }

    const result = tools.call(decision.tool, decision.args);
    used.tool_calls += 1;
    if (isExtra) used.additional_observations += 1;
    const ids = (result.evidence ?? []).map((e) => e.evidence_id);
    const fresh = ids.filter((x) => !seen.has(x));
    fresh.forEach((x) => seen.add(x));
    lastEntry = log({
      tool: result.tool ?? decision.tool, args: deepClone(decision.args), ok: result.ok,
      error_code: result.ok ? null : result.error_code, evidence_ids: ids,
      cutoff_clipped: result.cutoff_clipped ?? false,
    });
    // 같은 읽기를 반복하거나 막힌 요청을 반복해도 새 증거가 없으므로 이 규칙에 걸린다.
    noNewStreak = fresh.length === 0 ? noNewStreak + 1 : 0;
    if (noNewStreak >= NO_NEW_INFORMATION_LIMIT) stopReason = 'no_new_information';
  }

  const ledger = tools.ledger();
  const failedRun = STOP_REASON_STATUS[stopReason] === 'failed';
  const report = {
    schema_version: SCHEMA_VERSION,
    report_type: 'rca-investigation',
    case_id: caseData.case_id,
    run_id: id,
    mode: caseData.mode,
    provenance: SOURCE_OF_MODE[caseData.mode],
    notice_ko: NOTICE_KO,
    run_status: STOP_REASON_STATUS[stopReason],
    stop_reason: stopReason,
    observation: {
      start_rel: caseData.observation_start_rel,
      cutoff_rel_initial: initialCutoff,
      cutoff_rel_final: { ...tools.listChecks().cutoff_rel },
      availability_delay_sec: availabilityDelaySec,
    },
    decision_policy: { name: policy.name, kind: policy.kind, llm_executed: false },
    evidence: ledger,
    diagnosis: failedRun ? emptyDiagnosis() : diagnoseDnsHttp(ledger, scope),
    call_log: callLog,
    limits_used: used,
    limits_config: cfg,
    validation: { ok: true, problems: [] },
  };
  return finalizeReport(report, ledger);
}
