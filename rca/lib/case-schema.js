// RCA 최소 계약(스키마) — 관측 사례·증거·보고서의 모양과 검사 규칙을 한 곳에서 관리한다.
//
// 왜 한 파일에 모았나?
// - 합성 도구·진단 규칙·러너·테스트가 "같은 금지 키, 같은 값 목록"을 써야
//   파일마다 규칙이 달라져 생기는 정답 유입·출처 혼동을 막을 수 있다.
// - 전부 순수 함수다. 파일·네트워크를 쓰지 않는다 (입력은 이미 읽어 둔 객체).
//
// 이 계약은 "합성(가짜) 측정으로 조사 흐름을 검증"하기 위한 최소 버전이다.
// 실제 서비스 기록·실제 RCAEval 자료와 연결하는 계약이 아니다.

import { isPlainObject, isNonNegInt, sameValue } from './util.js';

export const SCHEMA_VERSION = 1;

/** 지금 지원하는 실행 모드. 합성(synthetic)만 있다. */
export const MODES = Object.freeze(['synthetic']);

/**
 * 모드 → 출처(provenance) 대응.
 * 필드 이름을 source가 아니라 provenance로 쓴 이유:
 * 운영 DB의 monitors.source(real/sample/simulator/replay)와 이름이 겹쳐
 * "기존 출처 값을 재해석한 것"으로 오해되는 것을 막기 위해서다.
 */
export const SOURCE_OF_MODE = Object.freeze({ synthetic: 'synthetic-simulation' });

export const CHANNELS = Object.freeze(['doh', 'http']);

/**
 * 관측 결과 값 목록.
 * 운영 판정(src/judge.js)의 실패 코드와 같은 이름을 복사해 두었다.
 * rca/는 src/를 import하지 않기 때문에, 테스트가 두 목록을 대조해 어긋남을 잡는다.
 * 'slow'는 judge.js에서 실패가 아니라 isSlow 플래그이지만, 관측 사실로는 따로 적는다.
 * 'doh_transport_error'는 "점검 쪽이 리졸버에 닿지 못함"이라 대상 DNS 응답(dns_*)과 다르다.
 */
export const DOH_OUTCOMES = Object.freeze([
  'ok', 'dns_nxdomain', 'dns_error', 'dns_no_answer', 'dns_mismatch', 'doh_transport_error',
]);
export const HTTP_OUTCOMES = Object.freeze([
  'ok', 'slow', 'timeout', 'network_error', 'status_mismatch', 'keyword_missing',
]);
export const OUTCOMES_OF_CHANNEL = Object.freeze({ doh: DOH_OUTCOMES, http: HTTP_OUTCOMES });

/**
 * 원인 판단 등급. 'confirmed'(확정)는 일부러 없다.
 * 증거가 많거나 점수가 높아도 이 단계에서는 최대 candidate(후보)로만 나온다.
 * null은 run_status가 failed일 때만 쓴다 (아래 RUN_STATUSES 참고).
 */
export const CAUSE_OUTCOMES = Object.freeze(['no_anomaly_observed', 'candidate', 'deferred', 'not_analyzable']);

/**
 * 실행 상태. 원인 판단(cause_outcome)과 분리한 이유:
 * "조사가 한도에서 멈췄다/검증에 실패했다"는 사실을 "분석 불가·보류"라는 판단과 섞으면
 * 실패한 실행이 정상적인 보류 결과처럼 보이기 때문이다.
 */
export const RUN_STATUSES = Object.freeze(['completed', 'incomplete', 'failed']);

export const STOP_REASONS = Object.freeze([
  'finished', 'no_new_information',
  'tool_call_limit', 'step_limit', 'additional_observation_limit',
  'policy_error', 'validation_error',
]);

/** 종료 사유 → 실행 상태. 한도 도달=incomplete, 정책·검증 오류=failed. */
export const STOP_REASON_STATUS = Object.freeze({
  finished: 'completed',
  no_new_information: 'completed',
  tool_call_limit: 'incomplete',
  step_limit: 'incomplete',
  additional_observation_limit: 'incomplete',
  policy_error: 'failed',
  validation_error: 'failed',
});

export const POLICY_KINDS = Object.freeze(['rule', 'test-double']);

/** 정상 사례 보고서에 반드시 들어가는 한계 문구 (정상 증명처럼 읽히지 않게). */
export const NO_ANOMALY_LIMIT_KO = '관측 범위 안에서만 이상 없음, 정상 증명 아님';

export const NOTICE_KO = '합성(가짜) 측정으로 만든 시연 보고서입니다. 실제 서비스 상태와 무관하며 운영 기록에 쓰지 않습니다.';

/**
 * 입력 객체 어디에도 있으면 안 되는 키 (정확히 일치할 때만 금지).
 * 정답·사례 설명·운영 식별자가 분석 입력으로 새어 들어오는 길을 막는다.
 * 부분 일치로 막지 않는 이유: answer_count 같은 정상 필드까지 막히기 때문이다.
 */
export const FORBIDDEN_KEYS = Object.freeze([
  'answer', 'answers', 'expected', 'expected_verdict', 'verdict',
  'scenario', 'scenario_no', 'scenario_name', 'label', 'label_ko',
  'cause', 'root_cause', 'fault', 'fault_type', 'case_name',
  'url', 'file', 'path', 'monitor_id', 'grading',
]);

/** 도구 인자로 넘기면 거부하는 이름 (다른 사례·실행·모드·임의 자원 접근 시도). */
export const FORBIDDEN_ARG_NAMES = Object.freeze([
  'case_id', 'run_id', 'mode', 'url', 'path', 'file', 'monitor_id',
]);

export const CASE_ID_RE = /^syn-[0-9a-f]{6}$/;
export const TARGET_ALIAS_RE = /^tgt-[0-9a-f]{6}$/;
export const RUN_ID_RE = /^run-[0-9a-f]{8}$/;
export const EVIDENCE_ID_RE = /^ev:(run-[0-9a-f]{8}):([1-9][0-9]*)$/;

/** 증거 id를 만든다. 증거는 도구만 발급하고 모델·정책이 만들지 않는다. */
export function makeEvidenceId(runId, n) {
  return `ev:${runId}:${n}`;
}

/**
 * 사례 id에서 대상 별칭을 만든다 (앞의 syn-을 tgt-로 바꾼 값).
 * 시나리오 번호나 설명을 별칭에 넣으면 이름만으로 정답을 짐작할 수 있어서, id 파생 값만 허용한다.
 */
export function deriveTargetAlias(caseId) {
  return `tgt-${String(caseId).slice(4)}`;
}

/** 객체 안(어느 깊이든)에 금지 키가 있으면 경로 목록으로 돌려준다. 정확 일치만 검사. */
export function findForbiddenKeys(value, path = '$') {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => found.push(...findForbiddenKeys(item, `${path}[${i}]`)));
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.includes(key)) found.push(`${path}.${key}`);
      found.push(...findForbiddenKeys(value[key], `${path}.${key}`));
    }
  }
  return found;
}

function unknownKeys(obj, allowed, where) {
  return Object.keys(obj).filter((k) => !allowed.includes(k)).map((k) => `unknown_key:${where}.${k}`);
}

function nullOrNonNegInt(v) {
  return v === null || isNonNegInt(v);
}

/** 관측 한 건(채널별 사실 포함)의 모양을 검사한다. */
export function validateObservation(obs) {
  const problems = [];
  if (!isPlainObject(obs)) return { ok: false, problems: ['observation_not_object'] };
  problems.push(...unknownKeys(obs, ['obs_key', 'channel', 'observed_at', 'facts'], 'observation'));
  if (typeof obs.obs_key !== 'string' || !/^o[0-9]+$/.test(obs.obs_key)) problems.push('invalid_obs_key');
  if (!CHANNELS.includes(obs.channel)) problems.push('invalid_channel');
  if (!isNonNegInt(obs.observed_at)) problems.push('invalid_observed_at');
  if (!isPlainObject(obs.facts)) {
    problems.push('invalid_facts');
  } else if (CHANNELS.includes(obs.channel)) {
    const f = obs.facts;
    const outcomes = OUTCOMES_OF_CHANNEL[obs.channel];
    if (!outcomes.includes(f.outcome)) problems.push('invalid_outcome');
    if (obs.channel === 'doh') {
      problems.push(...unknownKeys(f, ['outcome', 'rcode', 'record_type', 'answer_count'], 'facts'));
      if (!nullOrNonNegInt(f.rcode)) problems.push('invalid_rcode');
      if (!['A', 'AAAA'].includes(f.record_type)) problems.push('invalid_record_type');
      if (!nullOrNonNegInt(f.answer_count)) problems.push('invalid_answer_count');
    } else {
      problems.push(...unknownKeys(f, ['outcome', 'status_code', 'response_ms'], 'facts'));
      if (!(f.status_code === null || (Number.isInteger(f.status_code) && f.status_code >= 100 && f.status_code <= 599))) {
        problems.push('invalid_status_code');
      }
      if (!nullOrNonNegInt(f.response_ms)) problems.push('invalid_response_ms');
    }
  }
  return { ok: problems.length === 0, problems };
}

/** 관측 사례(fixture 한 개) 전체를 검사한다. 시각은 관측 시작 기준 상대 초(정수). */
export function validateObservationCase(obj) {
  if (!isPlainObject(obj)) return { ok: false, problems: ['case_not_object'] };
  const problems = [];
  for (const path of findForbiddenKeys(obj)) problems.push(`forbidden_key:${path}`);
  problems.push(...unknownKeys(obj, [
    'schema_version', 'case_id', 'mode', 'provenance', 'target_alias',
    'observation_start_rel', 'initial_cutoff_rel', 'observations',
  ], 'case'));
  if (obj.schema_version !== SCHEMA_VERSION) problems.push('invalid_schema_version');
  if (typeof obj.case_id !== 'string' || !CASE_ID_RE.test(obj.case_id)) problems.push('invalid_case_id');
  if (!MODES.includes(obj.mode)) problems.push('invalid_mode');
  else if (obj.provenance !== SOURCE_OF_MODE[obj.mode]) problems.push('provenance_mode_mismatch');
  if (typeof obj.target_alias !== 'string' || !TARGET_ALIAS_RE.test(obj.target_alias)
      || obj.target_alias !== deriveTargetAlias(obj.case_id)) {
    problems.push('invalid_target_alias');
  }
  if (!isNonNegInt(obj.observation_start_rel)) problems.push('invalid_observation_start_rel');
  const cut = obj.initial_cutoff_rel;
  if (!isPlainObject(cut) || Object.keys(cut).sort().join(',') !== 'doh,http'
      || !isNonNegInt(cut.doh) || !isNonNegInt(cut.http)) {
    problems.push('invalid_initial_cutoff_rel');
  }
  if (!Array.isArray(obj.observations)) {
    problems.push('invalid_observations');
  } else {
    const seen = new Set();
    for (const o of obj.observations) {
      for (const p of validateObservation(o).problems) problems.push(`observation:${p}`);
      if (isPlainObject(o)) {
        if (seen.has(o.obs_key)) problems.push('duplicate_obs_key');
        seen.add(o.obs_key);
        if (isNonNegInt(o.observed_at) && isNonNegInt(obj.observation_start_rel)
            && o.observed_at < obj.observation_start_rel) {
          problems.push('observation_before_start');
        }
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * 증거 한 건의 모양을 검사한다. 증거는 도구가 발급한 것만 유효하다.
 * (id가 실제로 발급된 것인지는 validateReport가 ledger와 비교해 확인한다.)
 */
export function validateEvidenceShape(ev) {
  if (!isPlainObject(ev)) return { ok: false, problems: ['evidence_not_object'] };
  const problems = unknownKeys(ev, [
    'evidence_id', 'case_id', 'run_id', 'mode', 'channel', 'observed_at', 'available_at', 'facts',
  ], 'evidence');
  const m = typeof ev.evidence_id === 'string' ? EVIDENCE_ID_RE.exec(ev.evidence_id) : null;
  if (!m) problems.push('invalid_evidence_id');
  else if (m[1] !== ev.run_id) problems.push('evidence_id_run_mismatch');
  if (typeof ev.case_id !== 'string' || !CASE_ID_RE.test(ev.case_id)) problems.push('invalid_case_id');
  if (typeof ev.run_id !== 'string' || !RUN_ID_RE.test(ev.run_id)) problems.push('invalid_run_id');
  if (!MODES.includes(ev.mode)) problems.push('invalid_mode');
  if (!CHANNELS.includes(ev.channel)) problems.push('invalid_channel');
  if (!isNonNegInt(ev.observed_at)) problems.push('invalid_observed_at');
  if (!isNonNegInt(ev.available_at)) problems.push('invalid_available_at');
  if (CHANNELS.includes(ev.channel)) {
    const probe = validateObservation({
      obs_key: 'o1', channel: ev.channel, observed_at: ev.observed_at, facts: ev.facts,
    });
    for (const p of probe.problems) problems.push(`facts:${p}`);
  }
  return { ok: problems.length === 0, problems };
}

function refsOf(diagnosis) {
  const ids = [];
  for (const group of [diagnosis.phenomena, diagnosis.hypotheses]) {
    if (Array.isArray(group)) for (const item of group) if (Array.isArray(item?.evidence_ids)) ids.push(...item.evidence_ids);
  }
  return ids;
}

/**
 * 보고서를 발급 장부(ledger)와 대조해 검증한다.
 *
 * 왜 ledger가 필요한가?
 * 증거 id·숫자가 "형식상 그럴듯한지"만 보면, 모델이 없는 증거를 만들어 넣거나
 * facts만 슬쩍 바꿔도 통과한다. 도구가 실제로 발급한 증거(ledger)와
 * id·observed_at·facts를 포함해 한 글자도 다르지 않아야 통과시킨다.
 * 또한 이 검증은 "사실이 실제로 있었는가"만 확인한다. 통과해도 원인 등급은 올라가지 않는다.
 *
 * 주의: 이 함수 단독으로는 진단이 그 사실에서 나왔는지 확인하지 않는다
 * (finalizeReport가 진단을 다시 계산해 비교하는 것으로 보완한다).
 * 진단을 정책/모델이 직접 쓰게 되면 다른 검증이 필요하다.
 */
export function validateReport(report, ledger) {
  if (!isPlainObject(report)) return { ok: false, problems: ['report_not_object'] };
  const problems = [];
  if (!Array.isArray(ledger)) problems.push('ledger_missing');

  if (report.schema_version !== SCHEMA_VERSION) problems.push('invalid_schema_version');
  if (report.report_type !== 'rca-investigation') problems.push('invalid_report_type');
  if (!MODES.includes(report.mode)) problems.push('invalid_mode');
  else if (report.provenance !== SOURCE_OF_MODE[report.mode]) problems.push('provenance_mode_mismatch');
  if (typeof report.case_id !== 'string' || !CASE_ID_RE.test(report.case_id)) problems.push('invalid_case_id');
  if (typeof report.run_id !== 'string' || !RUN_ID_RE.test(report.run_id)) problems.push('invalid_run_id');

  if (!RUN_STATUSES.includes(report.run_status)) problems.push('invalid_run_status');
  if (!STOP_REASONS.includes(report.stop_reason)) problems.push('invalid_stop_reason');
  else if (STOP_REASON_STATUS[report.stop_reason] !== report.run_status) problems.push('run_status_stop_reason_mismatch');

  const policy = report.decision_policy;
  if (!isPlainObject(policy) || typeof policy.name !== 'string' || !POLICY_KINDS.includes(policy.kind)) {
    problems.push('invalid_decision_policy');
  } else if (policy.llm_executed !== false) {
    problems.push('llm_executed_must_be_false');
  }

  const diag = report.diagnosis;
  if (!isPlainObject(diag)) {
    problems.push('invalid_diagnosis');
  } else {
    if (diag.confirmed_cause !== null) problems.push('confirmed_cause_must_be_null');
    if (report.run_status === 'failed') {
      // 실패한 실행은 "보류/분석 불가"로 포장하지 않는다. 판단 자체가 없다.
      if (diag.cause_outcome !== null) problems.push('failed_run_must_not_have_cause_outcome');
    } else if (!CAUSE_OUTCOMES.includes(diag.cause_outcome)) {
      problems.push('invalid_cause_outcome');
    }
    if (diag.cause_outcome === 'no_anomaly_observed'
        && !(Array.isArray(diag.notes_ko) && diag.notes_ko.includes(NO_ANOMALY_LIMIT_KO))) {
      problems.push('missing_no_anomaly_limit_note');
    }
  }

  if (!Array.isArray(report.evidence)) {
    problems.push('invalid_evidence');
  } else {
    const ids = new Set();
    const byId = new Map(Array.isArray(ledger) ? ledger.map((e) => [e?.evidence_id, e]) : []);
    for (const ev of report.evidence) {
      for (const p of validateEvidenceShape(ev).problems) problems.push(`evidence:${p}`);
      if (!isPlainObject(ev)) continue;
      if (ids.has(ev.evidence_id)) problems.push(`duplicate_evidence:${ev.evidence_id}`);
      ids.add(ev.evidence_id);
      if (ev.case_id !== report.case_id) problems.push(`evidence_case_mismatch:${ev.evidence_id}`);
      if (ev.run_id !== report.run_id) problems.push(`evidence_run_mismatch:${ev.evidence_id}`);
      if (ev.mode !== report.mode) problems.push(`evidence_mode_mismatch:${ev.evidence_id}`);
      // id만 맞아서는 안 된다. 객체 전체(facts, observed_at 포함)가 발급본과 같아야 한다.
      if (Array.isArray(ledger) && !(byId.has(ev.evidence_id) && sameValue(byId.get(ev.evidence_id), ev))) {
        problems.push(`evidence_not_in_ledger:${ev.evidence_id}`);
      }
    }
    // 반대 방향도 확인: 발급된 증거를 보고서에서 빼서 불리한 관측을 숨기는 일을 막는다.
    if (Array.isArray(ledger)) {
      for (const e of ledger) if (!ids.has(e?.evidence_id)) problems.push(`ledger_evidence_missing_from_report:${e?.evidence_id}`);
    }
    if (isPlainObject(diag)) {
      for (const ref of refsOf(diag)) if (!ids.has(ref)) problems.push(`unknown_evidence_ref:${ref}`);
    }
  }

  const used = report.limits_used;
  const usedOk = isPlainObject(used) && isNonNegInt(used.tool_calls) && isNonNegInt(used.steps)
    && isNonNegInt(used.additional_observations);
  if (!usedOk) problems.push('invalid_limits_used');
  if (!Array.isArray(report.call_log)) {
    problems.push('invalid_call_log');
  } else {
    // 호출 기록: 번호가 1부터 이어지고, 인용한 증거 id가 모두 보고서 증거(=장부)에 있어야 한다.
    const evidenceIds = new Set(Array.isArray(report.evidence) ? report.evidence.map((e) => e?.evidence_id) : []);
    let executed = 0;
    let additional = 0;
    report.call_log.forEach((entry, i) => {
      if (!isPlainObject(entry) || entry.n !== i + 1 || typeof entry.tool !== 'string' || typeof entry.ok !== 'boolean'
          || !Array.isArray(entry.evidence_ids)) {
        problems.push(`invalid_call_log_entry:${i + 1}`);
        return;
      }
      for (const id of entry.evidence_ids) if (!evidenceIds.has(id)) problems.push(`call_log_unknown_evidence:${id}`);
      // 한도 초과로 거부된 호출은 실행하지 않은 것이므로 실행 횟수에 넣지 않는다.
      if (entry.error_code !== 'call_limit_exceeded') {
        executed += 1;
        if (entry.tool === 'request_additional_observation') additional += 1;
      }
    });
    // 사용량 숫자가 호출 기록과 다르면 한도 안에서 멈췄다는 보고를 믿을 수 없다.
    if (usedOk) {
      if (used.tool_calls !== executed) problems.push('limits_used_tool_calls_mismatch');
      if (used.additional_observations !== additional) problems.push('limits_used_additional_mismatch');
      if (used.steps < report.call_log.length) problems.push('limits_used_steps_too_small');
    }
  }
  if (!isPlainObject(report.observation)) problems.push('invalid_observation_block');
  if (typeof report.notice_ko !== 'string' || report.notice_ko.length === 0) problems.push('missing_notice');

  return { ok: problems.length === 0, problems };
}
