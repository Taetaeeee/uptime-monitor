// 조사 러너 테스트 — 한도, 반복 방지, 보고서 필드, 실패/미완료 구분, 위조 검출, 정답 비유입
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runInvestigation, createRulePolicy, finalizeReport, makeRunId, DEFAULT_LIMITS, POLICY_INPUT_KEYS,
} from '../rca/runner.js';
import { validateReport, CAUSE_OUTCOMES, RUN_ID_RE, NO_ANOMALY_LIMIT_KO } from '../rca/lib/case-schema.js';
import { loadCases, getKeyItem, gradeReport, leakStrings } from './helpers/rca-grade.js';

const cases = loadCases();
const byId = (id) => cases.find((c) => c.case_id === id);
const S1 = () => byId('syn-7f3a21');
const S3 = () => byId('syn-1d85f6');
const S6 = () => byId('syn-e08d1a');

const rule = () => createRulePolicy();
const double = (name, decide) => ({ name, kind: 'test-double', decide });
const ledgerOf = (report) => structuredClone(report.evidence);

test('합성 6개를 규칙 정책으로 돌리면 정답 파일의 기대(등급·현상·실행 상태·추가 관측 횟수)와 일치', () => {
  assert.equal(cases.length, 6);
  for (const c of cases) {
    const report = runInvestigation({ caseData: c, policy: rule() });
    const graded = gradeReport(report, getKeyItem(c.case_id));
    assert.deepEqual(graded.problems, [], `${c.case_id}: ${graded.problems.join(',')}`);
    assert.deepEqual(report.validation, { ok: true, problems: [] }, c.case_id);
    assert.deepEqual(validateReport(report, ledgerOf(report)), { ok: true, problems: [] }, c.case_id);
  }
});

test('보고서 필수 필드: 출처·모드·사례/실행 id·관측 시각/마감·근거·호출 기록·한도, LLM 미실행 표기', () => {
  const c = S3();
  const r = runInvestigation({ caseData: c, policy: rule() });
  for (const key of [
    'schema_version', 'report_type', 'case_id', 'run_id', 'mode', 'provenance', 'notice_ko', 'run_status',
    'stop_reason', 'observation', 'decision_policy', 'evidence', 'diagnosis', 'call_log', 'limits_used',
    'limits_config', 'validation',
  ]) assert.ok(key in r, key);
  assert.equal(r.provenance, 'synthetic-simulation');
  assert.ok(!('source' in r), '출처 필드 이름은 provenance다');
  assert.equal(r.mode, 'synthetic');
  assert.match(r.run_id, RUN_ID_RE);
  assert.match(r.notice_ko, /합성\(가짜\)/);
  assert.deepEqual(r.observation, {
    start_rel: 0, cutoff_rel_initial: { doh: 900, http: 900 }, cutoff_rel_final: { doh: 900, http: 900 }, availability_delay_sec: 0,
  });
  assert.deepEqual(r.decision_policy, { name: 'rule-baseline', kind: 'rule', llm_executed: false });
  assert.equal(r.run_status, 'completed');
  assert.equal(r.stop_reason, 'finished');
  assert.deepEqual(r.limits_config, DEFAULT_LIMITS);
  assert.deepEqual(r.limits_used, { tool_calls: 2, steps: 3, additional_observations: 0 });
  assert.deepEqual(r.call_log.map((e) => [e.n, e.tool, e.ok, e.error_code]), [
    [1, 'dns_lookup', true, null], [2, 'http_probe', true, null],
  ]);
  assert.ok(r.call_log.every((e) => e.evidence_ids.every((id) => r.evidence.some((ev) => ev.evidence_id === id))));
  assert.equal(r.diagnosis.confirmed_cause, null);
});

test('정상 사례 보고서에는 "관측 범위 안에서만 이상 없음, 정상 증명 아님"이 고정으로 들어간다', () => {
  const r = runInvestigation({ caseData: S1(), policy: rule() });
  assert.equal(r.diagnosis.cause_outcome, 'no_anomaly_observed');
  assert.ok(r.diagnosis.notes_ko.includes(NO_ANOMALY_LIMIT_KO));
  assert.deepEqual(r.diagnosis.hypotheses, []);
});

test('같은 입력이면 같은 run id와 같은 보고서, 정책 이름·한도가 다르면 run id가 달라진다', () => {
  const a = runInvestigation({ caseData: S6(), policy: rule() });
  const b = runInvestigation({ caseData: S6(), policy: rule() });
  assert.deepEqual(a, b);
  assert.equal(a.run_id, makeRunId(S6().case_id, 'rule-baseline', DEFAULT_LIMITS));
  const other = runInvestigation({ caseData: S6(), policy: { ...rule(), name: 'rule-baseline-2' } });
  assert.notEqual(other.run_id, a.run_id);
  const lim = runInvestigation({ caseData: S6(), policy: rule(), limits: { maxToolCalls: 7 } });
  assert.notEqual(lim.run_id, a.run_id);
  assert.equal(runInvestigation({ caseData: S6(), policy: rule(), runId: 'run-deadbeef' }).run_id, 'run-deadbeef');
});

test('시나리오 6: 추가 관측을 한도(2회)까지만 요청하고 incomplete로 끝나며 확정하지 않는다', () => {
  const r = runInvestigation({ caseData: S6(), policy: rule() });
  assert.equal(r.run_status, 'incomplete');
  assert.equal(r.stop_reason, 'additional_observation_limit');
  assert.equal(r.limits_used.additional_observations, 2);
  assert.equal(r.diagnosis.cause_outcome, 'deferred');
  assert.equal(r.diagnosis.confirmed_cause, null);
  assert.deepEqual(r.observation.cutoff_rel_final, { doh: 900, http: 1500 });
  assert.equal(r.call_log.filter((e) => e.tool === 'request_additional_observation').length, 2);
});

test('도구 호출 한도: 초과 호출은 실행하지 않고 call_limit_exceeded로 기록하며 incomplete로 멈춘다', () => {
  const c = S6();
  const calls = [
    { tool: 'dns_lookup', args: { target_alias: c.target_alias } },
    { tool: 'http_probe', args: { target_alias: c.target_alias } },
    { tool: 'http_probe', args: { target_alias: c.target_alias, window: { from_rel: 0, to_rel: 400 } } },
  ];
  const r = runInvestigation({
    caseData: c, policy: double('always-call', ({ step }) => ({ type: 'call', ...calls[Math.min(step - 1, 2)] })),
    limits: { maxToolCalls: 2 },
  });
  assert.equal(r.stop_reason, 'tool_call_limit');
  assert.equal(r.run_status, 'incomplete');
  assert.equal(r.limits_used.tool_calls, 2); // 거부된 호출은 실행 횟수에 넣지 않는다
  const last = r.call_log.at(-1);
  assert.deepEqual([last.n, last.ok, last.error_code, last.evidence_ids], [3, false, 'call_limit_exceeded', []]);
  assert.ok(CAUSE_OUTCOMES.includes(r.diagnosis.cause_outcome)); // 미완료 실행도 그 시점까지의 판단을 담는다
});

test('단계 한도: 끝없이 호출만 하는 정책도 step_limit에서 멈춘다 (예외 없이 보고서)', () => {
  const c = S6();
  const r = runInvestigation({
    caseData: c, limits: { maxSteps: 2 },
    policy: double('forever', () => ({ type: 'call', tool: 'dns_lookup', args: { target_alias: c.target_alias } })),
  });
  assert.equal(r.stop_reason, 'step_limit');
  assert.equal(r.run_status, 'incomplete');
  assert.equal(r.limits_used.steps, 2);
});

test('추가 관측 한도: 정책이 계속 요청해도 한도 초과 요청은 실행되지 않는다', () => {
  const c = S6();
  const r = runInvestigation({
    caseData: c, limits: { maxAdditionalObservations: 1 },
    policy: double('greedy', () => ({ type: 'call', tool: 'request_additional_observation', args: { channel: 'http' } })),
  });
  assert.equal(r.stop_reason, 'additional_observation_limit');
  assert.equal(r.run_status, 'incomplete');
  assert.equal(r.limits_used.additional_observations, 1);
  assert.equal(r.call_log.at(-1).error_code, 'call_limit_exceeded');
});

test('반복 방지: 같은 읽기를 반복하면 새 증거가 없으므로 no_new_information으로 멈춘다 (completed)', () => {
  const c = S6();
  const r = runInvestigation({
    caseData: c,
    policy: double('repeat', () => ({ type: 'call', tool: 'dns_lookup', args: { target_alias: c.target_alias } })),
  });
  assert.equal(r.stop_reason, 'no_new_information');
  assert.equal(r.run_status, 'completed');
  assert.equal(r.call_log.length, 3); // 첫 호출은 새 증거, 이후 두 번이 새 증거 없음
  assert.equal(r.diagnosis.cause_outcome, 'not_analyzable'); // HTTP는 한 번도 보지 못했다
});

test('반복 방지: 규칙 정책이 한도를 넉넉히 받아도 더 열 관측이 없으면 무한 요청하지 않는다', () => {
  const r = runInvestigation({
    caseData: S6(), policy: rule(),
    limits: { maxSteps: 20, maxToolCalls: 20, maxAdditionalObservations: 10 },
  });
  assert.equal(r.stop_reason, 'no_new_information');
  assert.equal(r.run_status, 'completed');
  const extra = r.call_log.filter((e) => e.tool === 'request_additional_observation');
  assert.deepEqual(extra.map((e) => e.error_code), [null, null, null, 'no_more_observations', 'no_more_observations']);
  assert.equal(r.diagnosis.cause_outcome, 'deferred'); // 끝까지 모호하면 보류로 남는다
});

test('정책 오류는 failed: cause_outcome을 not_analyzable/deferred로 재사용하지 않고 null', () => {
  const c = S3();
  const bad = {
    thrown: () => { throw new Error('boom'); },
    garbage: () => 'finish',
    unknownType: () => ({ type: 'dance' }),
    badFinish: () => ({ type: 'finish', reason: 'tool_call_limit' }),
    badArgs: () => ({ type: 'call', tool: 'dns_lookup', args: 'x' }),
    noTool: () => ({ type: 'call', args: {} }),
  };
  for (const [name, decide] of Object.entries(bad)) {
    const r = runInvestigation({ caseData: c, policy: double(name, decide) });
    assert.equal(r.run_status, 'failed', name);
    assert.equal(r.stop_reason, 'policy_error', name);
    assert.equal(r.diagnosis.cause_outcome, null, name);
    assert.equal(r.diagnosis.confirmed_cause, null, name);
    assert.deepEqual(validateReport(r, ledgerOf(r)), { ok: true, problems: [] }, name);
  }
});

test('정책이 입력을 고치려 하면(얼려 있음) 오류가 되어 failed — 정책은 진단·증거를 바꿀 수 없다', () => {
  const r = runInvestigation({
    caseData: S3(),
    policy: double('tamper', ({ diagnosis }) => { diagnosis.cause_outcome = 'candidate'; return { type: 'finish', reason: 'finished' }; }),
  });
  assert.equal(r.run_status, 'failed');
  assert.equal(r.stop_reason, 'policy_error');
});

test('지원하지 않는 정책 종류(LLM 등)·잘못된 정책·잘못된 한도·합성 아닌 모드는 시작할 때 예외', () => {
  const c = S3();
  const llm = { name: 'x', kind: 'llm', decide: () => ({ type: 'finish', reason: 'finished' }) };
  assert.throws(() => runInvestigation({ caseData: c, policy: llm }), /policy_kind_not_supported/);
  assert.throws(() => runInvestigation({ caseData: c, policy: { name: 'x', kind: 'rule' } }), /policy_invalid/);
  assert.throws(() => runInvestigation({ caseData: c }), /policy_invalid/);
  assert.throws(() => runInvestigation({ caseData: c, policy: rule(), limits: { maxSteps: -1 } }), /invalid_limit:maxSteps/);
  assert.throws(() => runInvestigation({ caseData: c, policy: rule(), limits: { maxLlmCalls: 3 } }), /unknown_limit/);
  assert.throws(() => runInvestigation({ caseData: { ...c, mode: 'real' }, policy: rule() }), /mode_not_supported/);
});

test('거부된 도구 호출(범위 밖 인자·URL·다른 대상)도 호출 기록에 남고 흐름은 계속된다', () => {
  const c = S3();
  // 거부된 호출이 연달아 2번 나오면 "새 증거 없음"으로 멈추므로(반복 방지), 정상 호출 사이에 끼워 넣는다.
  const script = [
    { tool: 'dns_lookup', args: { target_alias: c.target_alias } },
    { tool: 'http_probe', args: { target_alias: c.target_alias, url: 'https://example.invalid' } },
    { tool: 'http_probe', args: { target_alias: c.target_alias } },
    { tool: 'http_probe', args: { target_alias: 'tgt-ffffff' } },
    { tool: 'read_file', args: {} },
  ];
  const r = runInvestigation({
    caseData: c,
    policy: double('probing', ({ step }) => (step <= script.length ? { type: 'call', ...script[step - 1] } : { type: 'finish', reason: 'finished' })),
    limits: { maxSteps: 10 },
  });
  assert.deepEqual(r.call_log.map((e) => e.error_code), [null, 'forbidden_scope', null, 'forbidden_target', 'unknown_tool']);
  assert.equal(r.call_log[1].ok, false);
  assert.equal(r.run_status, 'completed');
  assert.equal(r.diagnosis.cause_outcome, 'deferred');
  assert.equal(JSON.stringify(r).includes('example.invalid'), true); // 시도한 인자는 기록에 남는다 (감사용)
  assert.ok(r.evidence.every((e) => e.case_id === c.case_id)); // 거부된 호출은 증거를 만들지 못한다
});

test('위조: 보고서의 근거 id를 다른 run의 것으로 바꾸면 검증 실패 → finalizeReport가 failed로 내린다', () => {
  const real = runInvestigation({ caseData: S3(), policy: rule() });
  const ledger = ledgerOf(real);
  const forged = structuredClone(real);
  forged.diagnosis.phenomena[0].evidence_ids = ['ev:run-ffffffff:1'];
  assert.ok(validateReport(forged, ledger).problems.includes('unknown_evidence_ref:ev:run-ffffffff:1'));
  const fin = finalizeReport(forged, ledger);
  assert.equal(fin.run_status, 'failed');
  assert.equal(fin.stop_reason, 'validation_error');
  assert.equal(fin.diagnosis.cause_outcome, null);
  assert.equal(fin.validation.ok, false);
  assert.ok(fin.validation.problems.length > 0);
});

test('위조: ledger에 없는 증거 추가, facts만 바꾼 증거, 확정 선언은 모두 검증 실패', () => {
  const real = runInvestigation({ caseData: S3(), policy: rule() });
  const ledger = ledgerOf(real);

  const extra = structuredClone(real);
  extra.evidence.push({ ...structuredClone(real.evidence[0]), evidence_id: `ev:${real.run_id}:99` });
  assert.ok(validateReport(extra, ledger).problems.includes(`evidence_not_in_ledger:ev:${real.run_id}:99`));

  const changed = structuredClone(real);
  const http = changed.evidence.find((e) => e.channel === 'http');
  http.facts.status_code = 200;
  http.facts.outcome = 'ok';
  assert.ok(validateReport(changed, ledger).problems.includes(`evidence_not_in_ledger:${http.evidence_id}`));

  const confirmed = structuredClone(real);
  confirmed.diagnosis.cause_outcome = 'confirmed';
  confirmed.diagnosis.confirmed_cause = 'database_problem';
  const fin = finalizeReport(confirmed, ledger);
  assert.equal(fin.run_status, 'failed');
  assert.equal(fin.diagnosis.cause_outcome, null);

  const ok = finalizeReport(structuredClone(real), ledger); // 정상 보고서는 그대로 통과
  assert.equal(ok.run_status, 'completed');
  assert.deepEqual(ok.validation, { ok: true, problems: [] });
});

test('정답 비유입: 정책 입력의 키는 허용 목록뿐이고, 관측 값·fixture·정답 문구가 없다', () => {
  const seenInputs = [];
  for (const c of cases) {
    const policy = rule();
    const spy = double('spy', (input) => { seenInputs.push(input); return policy.decide(input); });
    runInvestigation({ caseData: c, policy: spy, limits: { maxSteps: 10 } });
  }
  assert.ok(seenInputs.length >= 12);
  const words = leakStrings();
  for (const input of seenInputs) {
    assert.deepEqual(Object.keys(input).sort(), [...POLICY_INPUT_KEYS].sort());
    const text = JSON.stringify(input);
    for (const w of words) assert.ok(!text.includes(w), w);
    for (const w of ['"facts"', 'response_ms', '"observations"', 'scenario', 'expected']) assert.ok(!text.includes(w), w);
    assert.ok(Object.isFrozen(input) && Object.isFrozen(input.diagnosis));
  }
});

test('정답 비유입: 6개 보고서 어디에도 정답 파일의 라벨·설명·정답 파일 이름이 없다', () => {
  const words = leakStrings();
  for (const c of cases) {
    const text = JSON.stringify(runInvestigation({ caseData: c, policy: rule() }));
    for (const w of words) assert.ok(!text.includes(w), `${c.case_id}: ${w}`);
    for (const w of ['answer-key', 'grading-only', 'scenario_no', 'label_ko', 'expected']) assert.ok(!text.includes(w), w);
  }
});

test('변조 불변성(러너): 마감 뒤 관측을 바꿔도 보고서가 같다 — 요청 없음(시나리오 3)과 2회 요청 후(시나리오 6)', () => {
  const s3 = S3();
  const s3t = structuredClone(s3);
  s3t.observations.filter((o) => o.observed_at > s3.initial_cutoff_rel[o.channel]).forEach((o) => {
    o.facts = o.channel === 'http'
      ? { outcome: 'timeout', status_code: null, response_ms: null }
      : { outcome: 'dns_nxdomain', rcode: 3, record_type: 'A', answer_count: 0 };
  });
  assert.notDeepEqual(s3t.observations, s3.observations);
  assert.deepEqual(runInvestigation({ caseData: s3t, policy: rule() }), runInvestigation({ caseData: s3, policy: rule() }));

  // 시나리오 6은 1200·1500 관측이 열린다. 아직 열리지 않은 1800 관측과 doh 1200 관측을 바꾼다.
  const s6 = S6();
  const s6t = structuredClone(s6);
  s6t.observations.filter((o) => o.observed_at === 1800 || (o.channel === 'doh' && o.observed_at === 1200)).forEach((o) => {
    o.facts = o.channel === 'http'
      ? { outcome: 'network_error', status_code: null, response_ms: null }
      : { outcome: 'dns_nxdomain', rcode: 3, record_type: 'A', answer_count: 0 };
  });
  assert.notDeepEqual(s6t.observations, s6.observations);
  assert.deepEqual(runInvestigation({ caseData: s6t, policy: rule() }), runInvestigation({ caseData: s6, policy: rule() }));
});

test('가용성 지연 d가 보고서에 기록되고, 지연이 있으면 마감 안 관측이 줄어 분석 불가가 될 수 있다', () => {
  const c = S3();
  const r = runInvestigation({ caseData: c, policy: rule(), availabilityDelaySec: 400 });
  assert.equal(r.observation.availability_delay_sec, 400);
  // 300+400 ≤ 900 → 보이지만 600+400 > 900 → 두 번째 관측은 안 보인다
  assert.deepEqual(r.evidence.map((e) => e.observed_at), [300, 300]);
  assert.deepEqual(r.evidence.map((e) => e.available_at), [700, 700]);
  const late = runInvestigation({ caseData: c, policy: rule(), availabilityDelaySec: 700 });
  assert.equal(late.diagnosis.cause_outcome, 'not_analyzable'); // 아직 아무것도 이용할 수 없다
  assert.equal(late.run_status, 'completed');
});

test('R-1: 모든 fixture의 두 채널에서 추가 관측 한도 안에서는 no_more_observations가 나오지 않는다', () => {
  for (const c of cases) {
    for (const channel of ['doh', 'http']) {
      const script = [1, 2].map(() => ({ tool: 'request_additional_observation', args: { channel } }));
      const r = runInvestigation({
        caseData: c, limits: { maxSteps: 10 },
        policy: double('probe-extra', ({ step }) => (step <= 2 ? { type: 'call', ...script[step - 1] } : { type: 'finish', reason: 'finished' })),
      });
      assert.deepEqual(r.call_log.map((e) => e.error_code), [null, null], `${c.case_id}/${channel}`);
      assert.equal(r.limits_used.additional_observations, DEFAULT_LIMITS.maxAdditionalObservations);
    }
    // 규칙 정책의 기본 실행에서도 no_more_observations는 나오지 않는다
    const normal = runInvestigation({ caseData: c, policy: rule() });
    assert.ok(normal.call_log.every((e) => e.error_code !== 'no_more_observations'), c.case_id);
  }
});

test('R-2: id는 장부에 있어도 사실이 뒷받침하지 않는 결론은 finalizeReport가 failed(validation_error)로 낮춘다', () => {
  const real = runInvestigation({ caseData: S6(), policy: rule() });
  const ledger = ledgerOf(real);
  const httpId = real.evidence.find((e) => e.channel === 'doh').evidence_id;

  // 시나리오 6 보고서에 이름 해석 후보를 끼워 넣음: 근거 id는 장부에 있어 사실 검증(validateReport)은 통과한다
  const injected = structuredClone(real);
  injected.diagnosis.hypotheses.push({
    hyp_id: 'h9', code: 'name_resolution_problem', status: 'candidate', evidence_ids: [httpId], limits: [],
  });
  assert.deepEqual(validateReport(injected, ledger), { ok: true, problems: [] });
  const fin = finalizeReport(injected, ledger);
  assert.equal(fin.run_status, 'failed');
  assert.equal(fin.stop_reason, 'validation_error');
  assert.equal(fin.diagnosis.cause_outcome, null);
  assert.ok(fin.validation.problems.includes('diagnosis_not_reproducible'));

  // 등급만 올린 경우(보류 → 후보)도, 등급을 낮춘 경우(후보 → 보류)도 같은 규칙으로 거부된다 (올려 주는 경로 없음)
  const up = structuredClone(real);
  up.diagnosis.cause_outcome = 'candidate';
  assert.equal(finalizeReport(up, ledger).run_status, 'failed');
  const s2 = runInvestigation({ caseData: byId('syn-c4e09b'), policy: rule() });
  const down = structuredClone(s2);
  down.diagnosis.cause_outcome = 'deferred';
  assert.equal(finalizeReport(down, ledgerOf(s2)).run_status, 'failed');

  // 정상 보고서는 그대로 통과하고, 이미 failed인 실행은 비교하지 않는다
  for (const c of cases) {
    const r = runInvestigation({ caseData: c, policy: rule() });
    assert.equal(finalizeReport(structuredClone(r), ledgerOf(r)).run_status, r.run_status, c.case_id);
  }
  const failed = runInvestigation({ caseData: S3(), policy: double('bad', () => 'x') });
  assert.equal(failed.stop_reason, 'policy_error');
  assert.deepEqual(finalizeReport(structuredClone(failed), ledgerOf(failed)).validation, { ok: true, problems: [] });
  assert.ok(!CAUSE_OUTCOMES.includes('confirmed'));
});

test('R-3: 가용성 지연 d가 다르면 run id와 증거 id가 달라진다', () => {
  const a = runInvestigation({ caseData: S3(), policy: rule(), availabilityDelaySec: 0 });
  const b = runInvestigation({ caseData: S3(), policy: rule(), availabilityDelaySec: 50 });
  assert.notEqual(a.run_id, b.run_id);
  assert.notEqual(a.evidence[0].evidence_id, b.evidence[0].evidence_id);
  assert.equal(b.run_id, makeRunId(S3().case_id, 'rule-baseline', DEFAULT_LIMITS, 50));
  assert.equal(a.run_id, makeRunId(S3().case_id, 'rule-baseline', DEFAULT_LIMITS)); // 기본 d=0
  // 같은 d면 같은 id (결정적)
  assert.equal(runInvestigation({ caseData: S3(), policy: rule(), availabilityDelaySec: 50 }).run_id, b.run_id);
});

test('실패 보고서에 결론을 몰래 싣는 위조: failed인데 진단이 비어 있지 않으면 거부', () => {
  const real = runInvestigation({ caseData: S3(), policy: rule() });
  const ledger = ledgerOf(real);
  // 정상 보고서를 복사해 failed로 바꾸고 후보 가설을 끼워 넣음: cause_outcome=null이라 validateReport는 통과한다
  const forged = structuredClone(real);
  forged.run_status = 'failed';
  forged.stop_reason = 'policy_error';
  forged.diagnosis.cause_outcome = null;
  forged.diagnosis.hypotheses.push({
    hyp_id: 'h1', code: 'name_resolution_problem', status: 'candidate', evidence_ids: [real.evidence[0].evidence_id], limits: [],
  });
  assert.deepEqual(validateReport(forged, ledger), { ok: true, problems: [] });
  const fin = finalizeReport(forged, ledger);
  assert.equal(fin.run_status, 'failed');
  assert.equal(fin.stop_reason, 'validation_error');
  assert.equal(fin.validation.ok, false);
  assert.ok(fin.validation.problems.includes('diagnosis_not_empty_on_failure'));
  assert.deepEqual(fin.diagnosis.hypotheses, []); // 거부된 보고서의 진단은 비워진다

  // 현상만 남긴 경우도 거부, 비어 있는 정상 failed 보고서는 통과
  const phenomenaOnly = structuredClone(forged);
  phenomenaOnly.diagnosis.hypotheses = [];
  assert.ok(finalizeReport(phenomenaOnly, ledger).validation.problems.includes('diagnosis_not_empty_on_failure'));
  const genuine = runInvestigation({ caseData: S3(), policy: double('bad', () => 'x') });
  assert.deepEqual(finalizeReport(structuredClone(genuine), ledgerOf(genuine)).validation, { ok: true, problems: [] });
});
