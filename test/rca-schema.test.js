// RCA 최소 계약(스키마) 테스트 — 합성 입력만 쓴다 (다운로드 자료·네트워크·DB 불필요)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION, MODES, SOURCE_OF_MODE, CAUSE_OUTCOMES, RUN_STATUSES, STOP_REASONS, STOP_REASON_STATUS,
  DOH_OUTCOMES, HTTP_OUTCOMES, FORBIDDEN_KEYS, NO_ANOMALY_LIMIT_KO, NOTICE_KO,
  makeEvidenceId, deriveTargetAlias, findForbiddenKeys,
  validateObservationCase, validateObservation, validateEvidenceShape, validateReport,
} from '../rca/lib/case-schema.js';
import { FAILURE_REASON, DNS_FAILURE } from '../src/judge.js';

// 테스트용 최소 사례를 만든다. (실제 fixture와 무관한 임시 id)
function goodCase() {
  return {
    schema_version: 1,
    case_id: 'syn-0a1b2c',
    mode: 'synthetic',
    provenance: 'synthetic-simulation',
    target_alias: 'tgt-0a1b2c',
    observation_start_rel: 0,
    initial_cutoff_rel: { doh: 900, http: 900 },
    observations: [
      { obs_key: 'o1', channel: 'doh', observed_at: 300, facts: { outcome: 'ok', rcode: 0, record_type: 'A', answer_count: 2 } },
      { obs_key: 'o2', channel: 'http', observed_at: 300, facts: { outcome: 'ok', status_code: 200, response_ms: 120 } },
    ],
  };
}

function goodEvidence(n = 1, channel = 'http') {
  return {
    evidence_id: makeEvidenceId('run-0000abcd', n),
    case_id: 'syn-0a1b2c', run_id: 'run-0000abcd', mode: 'synthetic',
    channel, observed_at: 300, available_at: 300,
    facts: channel === 'http'
      ? { outcome: 'ok', status_code: 200, response_ms: 120 }
      : { outcome: 'ok', rcode: 0, record_type: 'A', answer_count: 2 },
  };
}

function goodReport(ledger) {
  return {
    schema_version: 1, report_type: 'rca-investigation',
    case_id: 'syn-0a1b2c', run_id: 'run-0000abcd', mode: 'synthetic', provenance: 'synthetic-simulation',
    notice_ko: NOTICE_KO,
    run_status: 'completed', stop_reason: 'finished',
    observation: { start_rel: 0, cutoff_rel_initial: { doh: 900, http: 900 }, cutoff_rel_final: { doh: 900, http: 900 }, availability_delay_sec: 0 },
    decision_policy: { name: 'rule-baseline', kind: 'rule', llm_executed: false },
    evidence: structuredClone(ledger),
    diagnosis: {
      cause_outcome: 'no_anomaly_observed', confirmed_cause: null,
      phenomena: [{ code: 'http_ok', evidence_ids: [ledger[0].evidence_id], supported: true }],
      hypotheses: [], unknown_facts: [], next_checks: [], rejected_evidence: [],
      notes_ko: [NO_ANOMALY_LIMIT_KO],
    },
    call_log: [],
    limits_used: { tool_calls: 0, steps: 0, additional_observations: 0 },
    limits_config: { maxToolCalls: 8, maxSteps: 6, maxAdditionalObservations: 2 },
    validation: { ok: true, problems: [] },
  };
}

test('정상 사례는 통과하고, mode↔provenance는 1:1이다', () => {
  assert.deepEqual(validateObservationCase(goodCase()), { ok: true, problems: [] });
  assert.equal(SOURCE_OF_MODE.synthetic, 'synthetic-simulation');
  assert.deepEqual([...MODES], ['synthetic']);
  assert.equal(SCHEMA_VERSION, 1);
  const bad = goodCase();
  bad.provenance = 'real'; // 운영 출처 값을 합성 사례에 붙이면 거부
  assert.ok(validateObservationCase(bad).problems.includes('provenance_mode_mismatch'));
  bad.provenance = 'replay';
  assert.ok(validateObservationCase(bad).problems.includes('provenance_mode_mismatch'));
});

test('옛 이름 source 필드는 허용하지 않는다 (운영 monitors.source와 혼동 방지)', () => {
  const c = goodCase();
  c.source = 'synthetic-simulation';
  assert.ok(validateObservationCase(c).problems.includes('unknown_key:case.source'));
});

test('금지 키는 어느 깊이에 있어도 거부 (정확 일치), 비슷한 이름은 허용', () => {
  const top = goodCase();
  top.expected = { cause_outcome: 'candidate' };
  assert.ok(validateObservationCase(top).problems.some((p) => p.startsWith('forbidden_key:$.expected')));

  const deep = goodCase();
  deep.observations[0].facts.root_cause = 'cpu';
  assert.ok(validateObservationCase(deep).problems.some((p) => p.includes('root_cause')));

  const mon = goodCase();
  mon.observations[1].facts.monitor_id = 7; // 운영 모니터 식별자 거부
  assert.ok(validateObservationCase(mon).problems.some((p) => p.includes('monitor_id')));

  // answer_count는 정상 필드 — 'answer'와 정확히 일치하지 않으므로 통과해야 한다
  assert.deepEqual(findForbiddenKeys({ facts: { answer_count: 1 } }), []);
  assert.deepEqual(findForbiddenKeys({ a: [{ label: 'x' }] }), ['$.a[0].label']);
  for (const k of ['answer', 'expected', 'verdict', 'scenario_no', 'label_ko', 'fault_type', 'case_name', 'url']) {
    assert.ok(FORBIDDEN_KEYS.includes(k), k);
  }
});

test('case_id·target_alias 형식: 시나리오 번호나 설명을 담은 값은 거부', () => {
  for (const id of ['syn-1', 'scenario-1', 'syn-ZZZZZZ', 'syn-0a1b2', 'syn-0a1b2cd']) {
    const c = goodCase();
    c.case_id = id;
    assert.ok(validateObservationCase(c).problems.includes('invalid_case_id'), id);
  }
  const c = goodCase();
  c.target_alias = 'svc-1'; // 번호식 별칭 거부
  assert.ok(validateObservationCase(c).problems.includes('invalid_target_alias'));
  c.target_alias = 'tgt-ffffff'; // 형식은 맞지만 case id에서 파생되지 않음
  assert.ok(validateObservationCase(c).problems.includes('invalid_target_alias'));
  assert.equal(deriveTargetAlias('syn-0a1b2c'), 'tgt-0a1b2c');
});

test('실제 URL·monitor_id를 담는 필드는 스키마가 거부', () => {
  const c = goodCase();
  c.target_url = 'https://example.invalid';
  assert.ok(validateObservationCase(c).problems.includes('unknown_key:case.target_url'));
});

test('시각은 0 이상 정수(상대 초)여야 하고, 시작 이전 관측은 거부', () => {
  for (const v of [-1, 1.5, '300', null, NaN]) {
    const c = goodCase();
    c.observations[0].observed_at = v;
    assert.ok(validateObservationCase(c).problems.includes('observation:invalid_observed_at'), String(v));
  }
  const c = goodCase();
  c.observation_start_rel = 400;
  assert.ok(validateObservationCase(c).problems.includes('observation_before_start'));
  const d = goodCase();
  d.initial_cutoff_rel = { doh: 900 }; // 채널별 마감은 두 채널 모두 필요
  assert.ok(validateObservationCase(d).problems.includes('invalid_initial_cutoff_rel'));
});

test('관측 값 목록은 운영 판정(src/judge.js)의 실패 코드를 포함한다', () => {
  for (const code of Object.values(FAILURE_REASON)) assert.ok(HTTP_OUTCOMES.includes(code), code);
  for (const code of [DNS_FAILURE.NXDOMAIN, DNS_FAILURE.ERROR, DNS_FAILURE.NO_ANSWER, DNS_FAILURE.MISMATCH]) {
    assert.ok(DOH_OUTCOMES.includes(code), code);
  }
  // 점검 쪽 리졸버 접근 실패는 대상 DNS 응답 실패와 다른 값으로 분리되어 있다
  assert.ok(DOH_OUTCOMES.includes('doh_transport_error'));
  assert.ok(!Object.values(DNS_FAILURE).includes('doh_transport_error'));
});

test('관측 한 건: 채널별 필드와 값 검사, 모르는 필드 거부', () => {
  const ok = { obs_key: 'o1', channel: 'http', observed_at: 10, facts: { outcome: 'status_mismatch', status_code: 500, response_ms: 80 } };
  assert.equal(validateObservation(ok).ok, true);
  assert.ok(validateObservation({ ...ok, channel: 'ping' }).problems.includes('invalid_channel'));
  assert.ok(validateObservation({ ...ok, facts: { outcome: 'ok', status_code: 99, response_ms: 1 } }).problems.includes('invalid_status_code'));
  assert.ok(validateObservation({ ...ok, facts: { outcome: 'dns_nxdomain', status_code: 200, response_ms: 1 } }).problems.includes('invalid_outcome'));
  assert.ok(validateObservation({ ...ok, extra: 1 }).problems.includes('unknown_key:observation.extra'));
  assert.deepEqual(validateObservation(null).problems, ['observation_not_object']);
});

test('증거 id 형식과 run 일치', () => {
  assert.equal(makeEvidenceId('run-0000abcd', 3), 'ev:run-0000abcd:3');
  assert.equal(validateEvidenceShape(goodEvidence()).ok, true);
  const e = goodEvidence();
  e.evidence_id = 'ev:run-ffffffff:1'; // 다른 run의 id
  assert.ok(validateEvidenceShape(e).problems.includes('evidence_id_run_mismatch'));
  e.evidence_id = 'evidence-1';
  assert.ok(validateEvidenceShape(e).problems.includes('invalid_evidence_id'));
});

test('정상 보고서는 ledger와 같으면 통과', () => {
  const ledger = [goodEvidence(1, 'http'), goodEvidence(2, 'doh')];
  assert.deepEqual(validateReport(goodReport(ledger), ledger), { ok: true, problems: [] });
});

test('위조 1: ledger에 없는 증거(범위·형식만 맞음)는 거부', () => {
  const ledger = [goodEvidence(1, 'http')];
  const report = goodReport(ledger);
  report.evidence.push(goodEvidence(2, 'doh')); // 형식은 완벽하지만 도구가 발급한 적 없음
  const r = validateReport(report, ledger);
  assert.equal(r.ok, false);
  assert.ok(r.problems.includes('evidence_not_in_ledger:ev:run-0000abcd:2'));
});

test('위조 2: id는 같고 facts만 바꾼 증거는 거부', () => {
  const ledger = [goodEvidence(1, 'http')];
  const report = goodReport(ledger);
  report.evidence[0].facts.outcome = 'timeout';
  report.evidence[0].facts.response_ms = null;
  assert.ok(validateReport(report, ledger).problems.includes('evidence_not_in_ledger:ev:run-0000abcd:1'));
  // observed_at만 바꿔도 거부
  const r2 = goodReport(ledger);
  r2.evidence[0].observed_at = 301;
  assert.ok(validateReport(r2, ledger).problems.includes('evidence_not_in_ledger:ev:run-0000abcd:1'));
});

test('위조 3: 다른 mode / case / run의 증거 — 필드를 하나씩 바꾼 3개 케이스', () => {
  const ledger = [goodEvidence(1, 'http')];
  const cases = [
    ['mode', 'real', 'evidence_mode_mismatch'],
    ['case_id', 'syn-ffffff', 'evidence_case_mismatch'],
    ['run_id', 'run-ffffffff', 'evidence_run_mismatch'],
  ];
  for (const [field, value, expected] of cases) {
    const report = goodReport(ledger);
    report.evidence[0][field] = value;
    const problems = validateReport(report, ledger).problems;
    assert.ok(problems.some((p) => p.startsWith(expected)), `${field}: ${problems.join(',')}`);
  }
});

test('보고서가 인용한 근거 id가 보고서 증거에 없으면 거부, 증거를 빼도 거부', () => {
  const ledger = [goodEvidence(1, 'http'), goodEvidence(2, 'doh')];
  const report = goodReport(ledger);
  report.diagnosis.phenomena[0].evidence_ids = ['ev:다른-run:1'];
  assert.ok(validateReport(report, ledger).problems.includes('unknown_evidence_ref:ev:다른-run:1'));

  const hidden = goodReport(ledger);
  hidden.evidence.pop(); // 불리한 관측을 보고서에서 숨김
  assert.ok(validateReport(hidden, ledger).problems.some((p) => p.startsWith('ledger_evidence_missing_from_report')));
});

test('run_status는 종료 사유와 맞아야 하고, failed 보고서는 cause_outcome을 null로 둔다', () => {
  assert.deepEqual([...RUN_STATUSES], ['completed', 'incomplete', 'failed']);
  for (const reason of STOP_REASONS) assert.ok(RUN_STATUSES.includes(STOP_REASON_STATUS[reason]), reason);
  assert.equal(STOP_REASON_STATUS.tool_call_limit, 'incomplete');
  assert.equal(STOP_REASON_STATUS.policy_error, 'failed');

  const ledger = [goodEvidence(1, 'http')];
  const mismatch = goodReport(ledger);
  mismatch.run_status = 'incomplete'; // stop_reason은 finished
  assert.ok(validateReport(mismatch, ledger).problems.includes('run_status_stop_reason_mismatch'));

  const failedReuse = goodReport(ledger);
  failedReuse.run_status = 'failed';
  failedReuse.stop_reason = 'policy_error';
  failedReuse.diagnosis.cause_outcome = 'not_analyzable'; // 실패를 분석 불가로 재사용 금지
  assert.ok(validateReport(failedReuse, ledger).problems.includes('failed_run_must_not_have_cause_outcome'));
  failedReuse.diagnosis.cause_outcome = 'deferred';
  assert.ok(validateReport(failedReuse, ledger).problems.includes('failed_run_must_not_have_cause_outcome'));

  const failedOk = goodReport(ledger);
  failedOk.run_status = 'failed';
  failedOk.stop_reason = 'policy_error';
  failedOk.diagnosis.cause_outcome = null;
  failedOk.diagnosis.notes_ko = [];
  assert.equal(validateReport(failedOk, ledger).ok, true);

  // 실패하지 않은 실행인데 cause_outcome이 null이면 거부
  const nullOutcome = goodReport(ledger);
  nullOutcome.diagnosis.cause_outcome = null;
  assert.ok(validateReport(nullOutcome, ledger).problems.includes('invalid_cause_outcome'));
});

test('확정 등급은 존재하지 않는다: confirmed 값과 confirmed_cause 값을 모두 거부', () => {
  assert.ok(!CAUSE_OUTCOMES.includes('confirmed'));
  const ledger = [goodEvidence(1, 'http')];
  const a = goodReport(ledger);
  a.diagnosis.cause_outcome = 'confirmed';
  assert.ok(validateReport(a, ledger).problems.includes('invalid_cause_outcome'));
  const b = goodReport(ledger);
  b.diagnosis.confirmed_cause = 'name_resolution_problem';
  assert.ok(validateReport(b, ledger).problems.includes('confirmed_cause_must_be_null'));
});

test('LLM 실행으로 표기한 보고서와 정상 사례 한계 문구 누락을 거부', () => {
  const ledger = [goodEvidence(1, 'http')];
  const llm = goodReport(ledger);
  llm.decision_policy.llm_executed = true;
  assert.ok(validateReport(llm, ledger).problems.includes('llm_executed_must_be_false'));

  const noNote = goodReport(ledger);
  noNote.diagnosis.notes_ko = [];
  assert.ok(validateReport(noNote, ledger).problems.includes('missing_no_anomaly_limit_note'));
});

test('ledger를 넘기지 않으면 검증할 수 없으므로 실패', () => {
  const ledger = [goodEvidence(1, 'http')];
  assert.ok(validateReport(goodReport(ledger), undefined).problems.includes('ledger_missing'));
  assert.deepEqual(validateReport(null, ledger).problems, ['report_not_object']);
});

test('호출 기록 검증: 인용한 증거 id가 보고서 증거에 있어야 하고, 번호가 이어져야 한다', () => {
  const ledger = [goodEvidence(1, 'http')];
  const entry = (n, extra = {}) => ({ n, tool: 'http_probe', args: {}, ok: true, error_code: null, evidence_ids: [ledger[0].evidence_id], cutoff_clipped: false, ...extra });
  const base = () => {
    const r = goodReport(ledger);
    r.call_log = [entry(1)];
    r.limits_used = { tool_calls: 1, steps: 1, additional_observations: 0 };
    return r;
  };
  assert.deepEqual(validateReport(base(), ledger), { ok: true, problems: [] });

  const unknown = base();
  unknown.call_log[0].evidence_ids = ['ev:run-0000abcd:7']; // 장부에 없는 증거를 호출 결과로 인용
  assert.ok(validateReport(unknown, ledger).problems.includes('call_log_unknown_evidence:ev:run-0000abcd:7'));

  const skipped = base();
  skipped.call_log = [entry(2)];
  assert.ok(validateReport(skipped, ledger).problems.includes('invalid_call_log_entry:1'));
  const malformed = base();
  malformed.call_log = [{ n: 1 }];
  assert.ok(validateReport(malformed, ledger).problems.includes('invalid_call_log_entry:1'));
});

test('사용량 검증: limits_used가 호출 기록과 다르면 거부, 한도 초과로 거부된 호출은 실행 횟수에 넣지 않는다', () => {
  const ledger = [goodEvidence(1, 'http')];
  const id = ledger[0].evidence_id;
  const mk = (n, tool, error_code = null, ids = [id]) => ({ n, tool, args: {}, ok: error_code === null, error_code, evidence_ids: ids, cutoff_clipped: false });
  const r = goodReport(ledger);
  r.call_log = [mk(1, 'http_probe'), mk(2, 'request_additional_observation', 'no_more_observations', []), mk(3, 'request_additional_observation', 'call_limit_exceeded', [])];
  r.limits_used = { tool_calls: 2, steps: 4, additional_observations: 1 };
  assert.deepEqual(validateReport(r, ledger), { ok: true, problems: [] });

  const fewer = structuredClone(r);
  fewer.limits_used.tool_calls = 1; // 실제 실행은 2번인데 1번이라고 줄여서 보고
  assert.ok(validateReport(fewer, ledger).problems.includes('limits_used_tool_calls_mismatch'));
  const more = structuredClone(r);
  more.limits_used.tool_calls = 3; // 거부된 호출을 실행으로 센 경우
  assert.ok(validateReport(more, ledger).problems.includes('limits_used_tool_calls_mismatch'));
  const extra = structuredClone(r);
  extra.limits_used.additional_observations = 0;
  assert.ok(validateReport(extra, ledger).problems.includes('limits_used_additional_mismatch'));
  const steps = structuredClone(r);
  steps.limits_used.steps = 2; // 호출 기록이 3줄인데 단계가 2
  assert.ok(validateReport(steps, ledger).problems.includes('limits_used_steps_too_small'));
});
