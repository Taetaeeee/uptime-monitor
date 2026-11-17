// DNS·HTTP 규칙 진단 테스트 — 합성 fixture 6개와 코드 안에서 만든 증거만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseDnsHttp } from '../rca/lib/dns-http-diagnosis.js';
import { CAUSE_OUTCOMES, DOH_OUTCOMES, HTTP_OUTCOMES, makeEvidenceId, NO_ANOMALY_LIMIT_KO } from '../rca/lib/case-schema.js';
import { deepFreeze } from '../rca/lib/util.js';
import { loadCases, getKeyItem, gradeReport } from './helpers/rca-grade.js';

const RUN = 'run-00000001';

// 마감 안에서 보이는 관측만 증거로 만든다 (도구가 하는 일을 흉내 낸 테스트용 변환).
function visibleEvidence(caseData, runId = RUN) {
  const visible = caseData.observations
    .filter((o) => o.observed_at <= caseData.initial_cutoff_rel[o.channel])
    .sort((a, b) => a.observed_at - b.observed_at || (a.channel < b.channel ? -1 : 1));
  return visible.map((o, i) => ({
    evidence_id: makeEvidenceId(runId, i + 1), case_id: caseData.case_id, run_id: runId, mode: caseData.mode,
    channel: o.channel, observed_at: o.observed_at, available_at: o.observed_at, facts: structuredClone(o.facts),
  }));
}
const scopeOf = (c, runId = RUN) => ({ case_id: c.case_id, run_id: runId, mode: c.mode });

const DOH = {
  ok: { outcome: 'ok', rcode: 0, record_type: 'A', answer_count: 1 },
  dns_nxdomain: { outcome: 'dns_nxdomain', rcode: 3, record_type: 'A', answer_count: 0 },
  dns_error: { outcome: 'dns_error', rcode: 2, record_type: 'A', answer_count: 0 },
  dns_no_answer: { outcome: 'dns_no_answer', rcode: 0, record_type: 'A', answer_count: 0 },
  dns_mismatch: { outcome: 'dns_mismatch', rcode: 0, record_type: 'A', answer_count: 1 },
  doh_transport_error: { outcome: 'doh_transport_error', rcode: null, record_type: 'A', answer_count: null },
};
const HTTP = {
  ok: { outcome: 'ok', status_code: 200, response_ms: 100 },
  slow: { outcome: 'slow', status_code: 200, response_ms: 5000 },
  timeout: { outcome: 'timeout', status_code: null, response_ms: null },
  network_error: { outcome: 'network_error', status_code: null, response_ms: null },
  status_mismatch: { outcome: 'status_mismatch', status_code: 500, response_ms: 80 },
  keyword_missing: { outcome: 'keyword_missing', status_code: 200, response_ms: 90 },
};
// 코드 안에서 증거 목록을 만든다: [[채널, 시각, facts], ...]
function build(list, caseId = 'syn-0a1b2c', runId = RUN, mode = 'synthetic') {
  return list.map(([channel, t, facts], i) => ({
    evidence_id: makeEvidenceId(runId, i + 1), case_id: caseId, run_id: runId, mode,
    channel, observed_at: t, available_at: t, facts,
  }));
}
const SCOPE = { case_id: 'syn-0a1b2c', run_id: RUN, mode: 'synthetic' };

test('합성 6개: 진단 등급·현상·미확인·가설이 정답 파일의 기대와 일치 (실행 단계 항목 제외)', () => {
  const cases = loadCases();
  assert.equal(cases.length, 6);
  for (const c of cases) {
    const diagnosis = diagnoseDnsHttp(visibleEvidence(c), scopeOf(c));
    const item = structuredClone(getKeyItem(c.case_id));
    // 이 테스트는 규칙 진단만 본다. 추가 관측·종료 사유는 러너 테스트에서 확인한다.
    delete item.expected.run_status;
    delete item.expected.stop_reason;
    delete item.expected.additional_observations;
    const graded = gradeReport({ diagnosis }, item);
    assert.deepEqual(graded.problems, [], `${c.case_id}: ${graded.problems.join(',')}`);
  }
});

test('정상 사례: 원인·가설을 만들지 않고 "정상 증명 아님" 한계 문구를 붙인다', () => {
  const ev = build([['doh', 300, DOH.ok], ['http', 300, HTTP.ok]]);
  const d = diagnoseDnsHttp(ev, SCOPE);
  assert.equal(d.cause_outcome, 'no_anomaly_observed');
  assert.deepEqual(d.hypotheses, []);
  assert.deepEqual(d.unknown_facts, []);
  assert.ok(d.notes_ko.includes(NO_ANOMALY_LIMIT_KO));
  assert.match(NO_ANOMALY_LIMIT_KO, /정상 증명 아님/);
});

test('이름 해석 실패 + 연결 실패 → 후보일 뿐, 내부 원인(CPU·DB·앱)은 만들지 않는다', () => {
  const d = diagnoseDnsHttp(build([['doh', 300, DOH.dns_nxdomain], ['http', 300, HTTP.network_error]]), SCOPE);
  assert.equal(d.cause_outcome, 'candidate');
  assert.equal(d.confirmed_cause, null);
  assert.equal(d.hypotheses.length, 1);
  assert.equal(d.hypotheses[0].code, 'name_resolution_problem');
  assert.equal(d.hypotheses[0].status, 'candidate');
  assert.ok(d.hypotheses[0].limits.includes('http_path_resolution_not_observed'));
  assert.ok(d.unknown_facts.some((u) => u.code === 'origin_server_state_unobserved'));
});

test('같은 일치 관측을 10개로 늘려도 등급은 candidate에 머문다 (증거가 많다고 확정되지 않음)', () => {
  const many = [];
  for (let i = 0; i < 10; i += 1) {
    many.push(['doh', 100 + i * 10, DOH.dns_nxdomain], ['http', 100 + i * 10, HTTP.network_error]);
  }
  const d = diagnoseDnsHttp(build(many), SCOPE);
  assert.equal(d.cause_outcome, 'candidate');
  assert.equal(d.confirmed_cause, null);
  assert.equal(d.hypotheses.length, 1);
});

test('인과 과장 금지: HTTP 500·지연은 현상만 적고 CPU·DB는 가설이 아니라 미확인', () => {
  for (const http of [HTTP.status_mismatch, HTTP.slow]) {
    const d = diagnoseDnsHttp(build([['doh', 300, DOH.ok], ['http', 300, http]]), SCOPE);
    assert.equal(d.cause_outcome, 'deferred');
    assert.deepEqual(d.hypotheses, []);
    const unknownCodes = d.unknown_facts.map((u) => u.code);
    assert.ok(unknownCodes.includes('cpu_load_unobserved'));
    assert.ok(unknownCodes.includes('db_state_unobserved'));
  }
  const server = diagnoseDnsHttp(build([['doh', 300, DOH.ok], ['http', 300, HTTP.status_mismatch]]), SCOPE);
  assert.ok(server.phenomena.some((p) => p.code === 'http_server_error'));
  const slow = diagnoseDnsHttp(build([['doh', 300, DOH.ok], ['http', 300, HTTP.slow]]), SCOPE);
  assert.ok(slow.phenomena.some((p) => p.code === 'http_slow_response'));
});

test('5xx가 아닌 상태 코드는 서버 오류로 부르지 않는다', () => {
  const four = { outcome: 'status_mismatch', status_code: 404, response_ms: 50 };
  const d = diagnoseDnsHttp(build([['doh', 300, DOH.ok], ['http', 300, four]]), SCOPE);
  assert.ok(d.phenomena.some((p) => p.code === 'http_unexpected_status'));
  assert.ok(!d.phenomena.some((p) => p.code === 'http_server_error'));
});

test('DoH 통신 실패: 점검→리졸버 경로 실패와 대상 DNS 장애를 둘 다 열린 가설로 두고, 후보로 올리지 않는다', () => {
  const d = diagnoseDnsHttp(build([['doh', 300, DOH.doh_transport_error], ['http', 300, HTTP.ok]]), SCOPE);
  assert.equal(d.cause_outcome, 'deferred');
  const byCode = Object.fromEntries(d.hypotheses.map((h) => [h.code, h]));
  assert.equal(byCode.probe_to_resolver_path_failure.status, 'open');
  assert.equal(byCode.target_dns_failure.status, 'open');
  assert.ok(byCode.target_dns_failure.limits.includes('doh_and_http_are_different_paths'));
  // HTTP도 실패해도 대상 DNS 장애를 후보로 올리지 않는다
  const both = diagnoseDnsHttp(build([['doh', 300, DOH.doh_transport_error], ['http', 300, HTTP.network_error]]), SCOPE);
  assert.equal(both.hypotheses.find((h) => h.code === 'target_dns_failure').status, 'open');
  assert.notEqual(both.cause_outcome, 'candidate');
});

test('DoH는 실패인데 HTTP는 응답: 서로 다른 경로의 관측이므로 후보가 아니라 보류', () => {
  const d = diagnoseDnsHttp(build([['doh', 300, DOH.dns_nxdomain], ['http', 300, HTTP.ok]]), SCOPE);
  assert.equal(d.cause_outcome, 'deferred');
  assert.equal(d.hypotheses[0].status, 'open');
});

test('같은 채널 결과가 엇갈리면 보류 + 열린 가설 3개 이상 + 추가 관측 제안', () => {
  const d = diagnoseDnsHttp(build([['doh', 300, DOH.ok], ['http', 300, HTTP.ok], ['http', 600, HTTP.timeout]]), SCOPE);
  assert.equal(d.cause_outcome, 'deferred');
  assert.ok(d.hypotheses.length >= 3);
  assert.ok(d.hypotheses.every((h) => h.status === 'open'));
  assert.deepEqual(d.next_checks.filter((n) => n.would_change_outcome), [
    { kind: 'additional_observation', channel: 'http', reason_code: 'mixed_outcomes', would_change_outcome: true },
  ]);
  // 엇갈리지 않으면 추가 관측을 제안하지 않는다 (무한 요청 방지의 첫 단계)
  const steady = diagnoseDnsHttp(build([['doh', 300, DOH.ok], ['http', 300, HTTP.timeout]]), SCOPE);
  assert.equal(steady.next_checks.filter((n) => n.would_change_outcome).length, 0);
});

test('관측 부족은 not_analyzable: 증거 없음, 한 채널만, 다른 사례 증거만', () => {
  assert.equal(diagnoseDnsHttp([], SCOPE).cause_outcome, 'not_analyzable');
  assert.equal(diagnoseDnsHttp(undefined, SCOPE).cause_outcome, 'not_analyzable');
  const onlyDoh = diagnoseDnsHttp(build([['doh', 300, DOH.ok]]), SCOPE);
  assert.equal(onlyDoh.cause_outcome, 'not_analyzable');
  assert.deepEqual(onlyDoh.next_checks.map((n) => n.channel), ['http']);
  assert.ok(onlyDoh.unknown_facts.some((u) => u.code === 'http_channel_unobserved'));
  const onlyHttp = diagnoseDnsHttp(build([['http', 300, HTTP.ok]]), SCOPE);
  assert.equal(onlyHttp.cause_outcome, 'not_analyzable');
  const foreign = build([['doh', 300, DOH.ok], ['http', 300, HTTP.ok]], 'syn-ffffff');
  assert.equal(diagnoseDnsHttp(foreign, SCOPE).cause_outcome, 'not_analyzable');
});

test('다른 case / run / mode 증거는 쓰지 않고 rejected_evidence에 사유를 남긴다', () => {
  const own = build([['doh', 300, DOH.ok], ['http', 300, HTTP.ok]]);
  const otherCase = build([['http', 300, HTTP.timeout]], 'syn-ffffff');
  const otherRun = build([['http', 300, HTTP.timeout]], 'syn-0a1b2c', 'run-00000002');
  const otherMode = build([['http', 300, HTTP.timeout]], 'syn-0a1b2c', RUN, 'real');
  const d = diagnoseDnsHttp([...own, ...otherCase, ...otherRun, ...otherMode], SCOPE);
  assert.equal(d.cause_outcome, 'no_anomaly_observed'); // 남의 타임아웃이 섞이지 않음
  assert.equal(d.rejected_evidence.length, 3);
  assert.ok(d.rejected_evidence.every((r) => r.reason === 'scope_mismatch'));
  // 모양이 깨진 증거·중복 증거도 거부
  const broken = { ...own[0], evidence_id: 'x' };
  const dup = diagnoseDnsHttp([...own, own[0], broken, null], SCOPE);
  assert.deepEqual(dup.rejected_evidence.map((r) => r.reason).sort(), ['duplicate_evidence', 'invalid_evidence', 'invalid_evidence']);
});

test('전수 열거: 채널별 결과 조합 전부에서 확정이 나오지 않고, 인용한 증거 id는 모두 입력에 존재', () => {
  const dohCombos = [...DOH_OUTCOMES.map((o) => [o]), ['ok', 'dns_nxdomain'], ['dns_nxdomain', 'doh_transport_error']];
  const httpCombos = [...HTTP_OUTCOMES.map((o) => [o]), ['ok', 'timeout'], ['slow', 'status_mismatch'], ['ok', 'slow', 'timeout']];
  let checked = 0;
  for (const dohSet of dohCombos) {
    for (const httpSet of httpCombos) {
      const list = [
        ...dohSet.map((o, i) => ['doh', 100 + i * 10, DOH[o]]),
        ...httpSet.map((o, i) => ['http', 100 + i * 10, HTTP[o]]),
      ];
      const evidence = build(list);
      const d = diagnoseDnsHttp(evidence, SCOPE);
      const label = `${dohSet}|${httpSet}`;
      assert.ok(CAUSE_OUTCOMES.includes(d.cause_outcome), label);
      assert.notEqual(d.cause_outcome, 'confirmed', label);
      assert.equal(d.confirmed_cause, null, label);
      const ids = new Set(evidence.map((e) => e.evidence_id));
      for (const item of [...d.phenomena, ...d.hypotheses]) {
        for (const ref of item.evidence_ids) assert.ok(ids.has(ref), `${label}: ${ref}`);
      }
      for (const h of d.hypotheses) {
        assert.ok(['candidate', 'open'].includes(h.status), label);
        assert.doesNotMatch(h.code, /cpu|db|database|application/, label); // CPU·DB·앱을 후보로 올리지 않음
      }
      // candidate는 이름 해석 실패 + 연결 실패 조합에서만 나온다
      if (d.cause_outcome === 'candidate') {
        assert.deepEqual(dohSet.length, 1, label);
        assert.ok(['dns_nxdomain', 'dns_error', 'dns_no_answer', 'dns_mismatch'].includes(dohSet[0]), label);
      }
      checked += 1;
    }
  }
  assert.equal(checked, dohCombos.length * httpCombos.length);
});

test('같은 입력이면 같은 출력, 입력(얼린 객체)을 바꾸지 않는다', () => {
  const evidence = deepFreeze(build([['doh', 300, DOH.ok], ['http', 300, HTTP.timeout]]));
  const a = JSON.stringify(diagnoseDnsHttp(evidence, SCOPE));
  const b = JSON.stringify(diagnoseDnsHttp(evidence, SCOPE));
  assert.equal(a, b);
});
