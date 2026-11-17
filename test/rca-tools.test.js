// 합성 조회 도구 테스트 — 마감(미래 관측) 차단, 범위 제한, 정답 비유출을 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticTools, TOOL_ARGS } from '../rca/tools/synthetic-tools.js';
import { validateObservationCase, validateEvidenceShape } from '../rca/lib/case-schema.js';
import { loadCases, leakStrings } from './helpers/rca-grade.js';

const RUN = 'run-00000001';
const cases = loadCases();
const byId = (id) => cases.find((c) => c.case_id === id);
const S6 = () => byId('syn-e08d1a'); // HTTP이 오락가락하는 사례 (마감 뒤 관측이 여러 개)

const DOH_OK = { outcome: 'ok', rcode: 0, record_type: 'A', answer_count: 2 };
const H_OK = { outcome: 'ok', status_code: 200, response_ms: 100 };
const H_TO = { outcome: 'timeout', status_code: null, response_ms: null };

// 코드 안에서 만드는 작은 사례: [채널, 시각, facts] 목록
function miniCase(list, cutoff = { doh: 900, http: 900 }) {
  return {
    schema_version: 1, case_id: 'syn-0a1b2c', mode: 'synthetic', provenance: 'synthetic-simulation',
    target_alias: 'tgt-0a1b2c', observation_start_rel: 0, initial_cutoff_rel: cutoff,
    observations: list.map(([channel, observed_at, facts], i) => ({ obs_key: `o${i + 1}`, channel, observed_at, facts })),
  };
}

/** 마감에 가려진 관측의 값(facts)과 시각을 바꾼다. 가려진 순서는 바뀌지 않게 시각은 조금만 옮긴다. */
function tamperHidden(caseData, { d = 0, keepFirstHidden = false } = {}) {
  const copy = structuredClone(caseData);
  for (const channel of ['doh', 'http']) {
    const hidden = copy.observations
      .filter((o) => o.channel === channel && o.observed_at + d > copy.initial_cutoff_rel[channel])
      .sort((a, b) => a.observed_at - b.observed_at);
    hidden.forEach((o, i) => {
      if (keepFirstHidden && i === 0) return;
      o.observed_at += 7;
      o.facts = channel === 'http'
        ? { outcome: o.facts.outcome === 'ok' ? 'network_error' : 'ok', status_code: o.facts.outcome === 'ok' ? null : 200, response_ms: o.facts.outcome === 'ok' ? null : 1 }
        : { outcome: o.facts.outcome === 'ok' ? 'dns_nxdomain' : 'ok', rcode: o.facts.outcome === 'ok' ? 3 : 0, record_type: 'A', answer_count: o.facts.outcome === 'ok' ? 0 : 9 };
    });
  }
  return copy;
}

/** 도구 출력을 한 번에 모아 비교하기 위한 스냅샷 */
function snapshot(tools, alias) {
  const windows = [undefined, { from_rel: 0, to_rel: 900 }, { from_rel: 0, to_rel: 5000 }, { from_rel: 1000, to_rel: 5000 }, { from_rel: 0, to_rel: 1200 }];
  const out = { checks: tools.listChecks(), results: [] };
  for (const window of windows) {
    const args = window ? { target_alias: alias, window } : { target_alias: alias };
    out.results.push(tools.call('dns_lookup', args), tools.call('http_probe', args));
  }
  out.ledger = tools.ledger();
  return out;
}

test('fixture 6개가 계약을 통과하고, id·별칭은 서로 달라 이름으로 정답을 짐작할 수 없다', () => {
  assert.equal(cases.length, 6);
  for (const c of cases) assert.deepEqual(validateObservationCase(c), { ok: true, problems: [] }, c.case_id);
  assert.equal(new Set(cases.map((c) => c.case_id)).size, 6);
  for (const c of cases) assert.equal(c.target_alias, `tgt-${c.case_id.slice(4)}`);
  // 모든 사례의 두 채널에 마감 뒤 관측이 같은 수만큼 있어서, 요청해 보는 것만으로 사례 군을 구분할 수 없다
  for (const c of cases) {
    for (const ch of ['doh', 'http']) {
      const hidden = c.observations.filter((o) => o.channel === ch && o.observed_at > c.initial_cutoff_rel[ch]);
      assert.equal(hidden.length, 3, `${c.case_id}/${ch}`);
    }
  }
});

test('생성 조건: 합성이 아닌 모드·금지 키가 든 fixture·잘못된 id/지연은 시작도 못 한다', () => {
  const base = miniCase([['doh', 300, DOH_OK]]);
  assert.doesNotThrow(() => createSyntheticTools({ caseData: base, runId: RUN }));
  assert.throws(() => createSyntheticTools({ caseData: { ...base, mode: 'real' }, runId: RUN }), /mode_not_supported/);
  assert.throws(() => createSyntheticTools({ caseData: { ...base, mode: 'replay' }, runId: RUN }), /mode_not_supported/);
  const leaked = structuredClone(base);
  leaked.expected = { cause_outcome: 'candidate' };
  assert.throws(() => createSyntheticTools({ caseData: leaked, runId: RUN }), /fixture_contains_forbidden_key/);
  const deep = structuredClone(base);
  deep.observations[0].facts.verdict = 'x';
  assert.throws(() => createSyntheticTools({ caseData: deep, runId: RUN }), /fixture_contains_forbidden_key/);
  assert.throws(() => createSyntheticTools({ caseData: base, runId: 'run-1' }), /invalid_run_id/);
  assert.throws(() => createSyntheticTools({ caseData: base, runId: RUN, availabilityDelaySec: -1 }), /invalid_availability_delay/);
  assert.throws(() => createSyntheticTools({ caseData: { ...base, case_id: 'syn-zz' }, runId: RUN }), /invalid_case/);
  assert.throws(() => createSyntheticTools(), /invalid_case/);
});

test('미래 관측: 기본 호출·창이 마감을 넘는 호출·마감 뒤에서 시작하는 호출 모두 마감 뒤 관측이 나오지 않는다', () => {
  const c = S6();
  const tools = createSyntheticTools({ caseData: c, runId: RUN });
  const http = tools.call('http_probe', { target_alias: c.target_alias });
  assert.deepEqual(http.evidence.map((e) => e.observed_at), [300, 600]);
  assert.equal(http.cutoff_clipped, false);

  const wide = tools.call('http_probe', { target_alias: c.target_alias, window: { from_rel: 0, to_rel: 5000 } });
  assert.deepEqual(wide.evidence.map((e) => e.observed_at), [300, 600]); // 5000까지 달라고 해도 마감까지만
  assert.equal(wide.cutoff_clipped, true);                                // 잘렸다는 사실만 알린다

  const after = tools.call('http_probe', { target_alias: c.target_alias, window: { from_rel: 1000, to_rel: 5000 } });
  assert.deepEqual(after.evidence, []);                                   // 마감 뒤에서 시작해도 비어 있다
  assert.equal(after.cutoff_clipped, true);
  assert.deepEqual(after.cutoff_rel, { doh: 900, http: 900 });
});

test('변조 불변성(요청 없음): 마감 뒤 관측의 값·시각을 바꿔도 모든 도구 출력이 같다 — 6개 사례 전부', () => {
  for (const c of cases) {
    const a = snapshot(createSyntheticTools({ caseData: c, runId: RUN }), c.target_alias);
    const tampered = tamperHidden(c);
    assert.notDeepEqual(tampered.observations, c.observations, `변조가 실제로 일어나야 한다: ${c.case_id}`);
    const b = snapshot(createSyntheticTools({ caseData: tampered, runId: RUN }), c.target_alias);
    assert.deepEqual(b, a, c.case_id);
  }
});

test('변조 불변성(1회 요청 후): 열린 관측 다음의 예비 관측을 바꿔도 출력이 같다 — d=0과 d>0', () => {
  for (const d of [0, 50]) {
    const c = S6();
    const run = (data) => {
      const tools = createSyntheticTools({ caseData: data, runId: RUN, availabilityDelaySec: d });
      const opened = tools.call('request_additional_observation', { channel: 'http' });
      return { opened, snap: snapshot(tools, c.target_alias) };
    };
    const a = run(c);
    // 첫 번째 가려진 관측(방금 열린 것)은 그대로 두고 그 뒤 관측만 변조한다
    const tampered = tamperHidden(c, { d, keepFirstHidden: true });
    assert.notDeepEqual(tampered.observations, c.observations);
    const b = run(tampered);
    assert.deepEqual(b, a, `d=${d}`);
    assert.equal(a.opened.ok, true);
    assert.equal(a.opened.evidence.length, 1);
  }
});

test('가용성 지연 d: observed_at + d == 마감이면 보이고, 한 샘플(1초) 뒤는 보이지 않는다', () => {
  const cutoff = { doh: 900, http: 900 };
  const c = miniCase([['http', 800, H_OK], ['http', 801, H_TO], ['doh', 300, DOH_OK]], cutoff);
  // d=0: 800, 801 모두 900 이하 → 보임
  const d0 = createSyntheticTools({ caseData: c, runId: RUN });
  assert.deepEqual(d0.call('http_probe', { target_alias: c.target_alias }).evidence.map((e) => e.observed_at), [800, 801]);
  // d=100: 800+100=900 보임(경계 포함), 801+100=901 안 보임
  const d100 = createSyntheticTools({ caseData: c, runId: RUN, availabilityDelaySec: 100 });
  const r = d100.call('http_probe', { target_alias: c.target_alias });
  assert.deepEqual(r.evidence.map((e) => e.observed_at), [800]);
  assert.equal(r.evidence[0].available_at, 900); // 생성 시각(observed_at)과 이용 가능 시각을 구분해 적는다
  // d=101: 800+101=901 → 안 보임
  const d101 = createSyntheticTools({ caseData: c, runId: RUN, availabilityDelaySec: 101 });
  assert.deepEqual(d101.call('http_probe', { target_alias: c.target_alias }).evidence, []);
});

test('추가 관측: 요청한 채널의 마감만 "다음 관측 시각 + d"로 옮기고 한 번에 하나씩만 연다', () => {
  for (const d of [0, 25]) {
    const c = S6(); // http 가려진 관측: 1200, 1500, 1800 / doh 가려진 관측: 1200
    const tools = createSyntheticTools({ caseData: c, runId: RUN, availabilityDelaySec: d });
    const first = tools.call('request_additional_observation', { channel: 'http' });
    assert.equal(first.ok, true);
    assert.deepEqual(first.evidence.map((e) => e.observed_at), [1200]);
    assert.deepEqual(first.cutoff_rel, { doh: 900, http: 1200 + d }); // 다른 채널(doh)은 그대로
    // 조회 도구에도 새로 열린 관측만 반영된다
    const http = tools.call('http_probe', { target_alias: c.target_alias });
    assert.deepEqual(http.evidence.map((e) => e.observed_at), [300, 600, 1200]);
    const doh = tools.call('dns_lookup', { target_alias: c.target_alias });
    assert.deepEqual(doh.evidence.map((e) => e.observed_at), [300, 600]);

    const second = tools.call('request_additional_observation', { channel: 'http' });
    assert.deepEqual(second.evidence.map((e) => e.observed_at), [1500]);
    const third = tools.call('request_additional_observation', { channel: 'http' });
    assert.deepEqual(third.evidence.map((e) => e.observed_at), [1800]);
    const none = tools.call('request_additional_observation', { channel: 'http' });
    assert.deepEqual(none, { ok: false, tool: 'request_additional_observation', error_code: 'no_more_observations' });
  }
  // 가려진 관측이 없는 채널: 실제 fixture는 모든 채널에 숨은 관측이 있으므로 코드 안의 작은 사례로 확인한다.
  const c = miniCase([['doh', 300, DOH_OK], ['http', 300, H_OK]]); // 마감(900) 뒤 관측이 없다
  const tools = createSyntheticTools({ caseData: c, runId: RUN });
  assert.deepEqual(tools.call('request_additional_observation', { channel: 'http' }),
    { ok: false, tool: 'request_additional_observation', error_code: 'no_more_observations' });
  assert.equal(tools.call('request_additional_observation', { channel: 'doh' }).error_code, 'no_more_observations');
  assert.equal(tools.call('request_additional_observation', { channel: 'ping' }).error_code, 'invalid_argument');
  assert.equal(tools.call('request_additional_observation', {}).error_code, 'invalid_argument');
});

test('접근 범위: case_id·run_id·mode·url·path·file·monitor_id 인자는 자기 값이어도 거부', () => {
  const c = S6();
  const tools = createSyntheticTools({ caseData: c, runId: RUN });
  const own = { case_id: c.case_id, run_id: RUN, mode: 'synthetic', url: 'x', path: 'x', file: 'x', monitor_id: 1 };
  for (const [name, value] of Object.entries(own)) {
    const r = tools.call('http_probe', { target_alias: c.target_alias, [name]: value });
    assert.equal(r.ok, false, name);
    assert.equal(r.error_code, 'forbidden_scope', name);
  }
  assert.equal(tools.call('http_probe', { target_alias: c.target_alias, other: 1 }).error_code, 'invalid_argument');
  assert.equal(tools.call('request_additional_observation', { channel: 'http', case_id: 'syn-ffffff' }).error_code, 'forbidden_scope');
});

test('접근 범위: URL·경로 문자열과 다른 대상 별칭은 거부, 알 수 없는 도구·잘못된 인자 형태도 거부', () => {
  const c = S6();
  const tools = createSyntheticTools({ caseData: c, runId: RUN });
  for (const bad of ['https://example.invalid', '../etc/passwd', 'a\\b', 'tgt-0a1b2c/x', 'file://x']) {
    assert.equal(tools.call('http_probe', { target_alias: bad }).error_code, 'forbidden_target', bad);
  }
  assert.equal(tools.call('dns_lookup', { target_alias: 'tgt-ffffff' }).error_code, 'forbidden_target'); // 다른 사례의 별칭
  assert.equal(tools.call('http_probe', {}).error_code, 'invalid_argument');
  assert.equal(tools.call('http_probe', { target_alias: 5 }).error_code, 'invalid_argument');
  assert.equal(tools.call('read_file', { target_alias: c.target_alias }).error_code, 'unknown_tool');
  assert.equal(tools.call('__proto__', {}).error_code, 'unknown_tool');
  assert.equal(tools.call(42, {}).error_code, 'unknown_tool');
  assert.equal(tools.call('http_probe', null).error_code, 'invalid_argument');
  assert.equal(tools.call('http_probe', [c.target_alias]).error_code, 'invalid_argument');
  for (const window of [{ from_rel: 5, to_rel: 1 }, { from_rel: -1, to_rel: 1 }, { from_rel: 0 }, { from_rel: 0, to_rel: 1, x: 1 }, 'all']) {
    assert.equal(tools.call('http_probe', { target_alias: c.target_alias, window }).error_code, 'invalid_argument');
  }
  assert.equal(tools.call('dns_lookup', { target_alias: c.target_alias, record_type: 'MX' }).error_code, 'invalid_argument');
  assert.deepEqual(Object.keys(TOOL_ARGS).sort(), ['dns_lookup', 'http_probe', 'request_additional_observation']);
});

test('정답 비유출: 어떤 도구 응답에도 정답 파일의 라벨·설명·시나리오 표현이 없다 (코드 값은 대상 아님)', () => {
  const forbiddenWords = leakStrings();
  assert.ok(forbiddenWords.length >= 12);
  for (const c of cases) {
    const tools = createSyntheticTools({ caseData: c, runId: RUN });
    const texts = [JSON.stringify(tools.listChecks())];
    for (const window of [undefined, { from_rel: 0, to_rel: 5000 }]) {
      const args = window ? { target_alias: c.target_alias, window } : { target_alias: c.target_alias };
      texts.push(JSON.stringify(tools.call('dns_lookup', args)), JSON.stringify(tools.call('http_probe', args)));
    }
    for (const ch of ['doh', 'http', 'doh']) texts.push(JSON.stringify(tools.call('request_additional_observation', { channel: ch })));
    texts.push(JSON.stringify(tools.ledger()));
    const all = texts.join('\n');
    for (const word of forbiddenWords) assert.ok(!all.includes(word), `${c.case_id}: ${word}`);
    for (const word of ['scenario', 'label', 'expected', 'verdict', 'answer-key', 'grading']) {
      assert.ok(!all.includes(word), `${c.case_id}: ${word}`);
    }
  }
});

test('증거: 같은 관측은 같은 id로 한 번만 발급되고, 반환값을 고쳐도 장부는 바뀌지 않는다', () => {
  const c = S6();
  const tools = createSyntheticTools({ caseData: c, runId: RUN });
  const a = tools.call('http_probe', { target_alias: c.target_alias });
  const b = tools.call('http_probe', { target_alias: c.target_alias });
  assert.deepEqual(a.evidence.map((e) => e.evidence_id), b.evidence.map((e) => e.evidence_id));
  assert.equal(tools.ledger().length, 2);
  a.evidence[0].facts.outcome = 'timeout'; // 호출자가 증거를 고쳐도
  tools.ledger()[0].facts.outcome = 'timeout';
  assert.equal(tools.ledger()[0].facts.outcome, 'ok'); // 장부는 그대로
  for (const e of tools.ledger()) {
    assert.equal(validateEvidenceShape(e).ok, true);
    assert.deepEqual([e.case_id, e.run_id, e.mode], [c.case_id, RUN, 'synthetic']);
  }
  assert.deepEqual(tools.ledger().map((e) => e.evidence_id), [`ev:${RUN}:1`, `ev:${RUN}:2`]);
});

test('도구를 만든 뒤 fixture 원본을 바꿔도 도구 안의 관측은 그대로다', () => {
  const c = structuredClone(S6());
  const tools = createSyntheticTools({ caseData: c, runId: RUN });
  c.observations.forEach((o) => { o.facts.outcome = 'dns_nxdomain'; });
  c.target_alias = 'tgt-ffffff';
  const r = tools.call('http_probe', { target_alias: S6().target_alias });
  assert.equal(r.ok, true);
  assert.deepEqual(r.evidence.map((e) => e.facts.outcome), ['ok', 'timeout']);
});
