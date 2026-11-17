// CPU 전후 증가량 기준선 테스트 — 손으로 계산할 수 있는 작은 사례만 쓴다.
// 보고된 사례 수 같은 큰 숫자는 어디에도 쓰지 않는다. 여기서 확인하는 것은
// "계산이 맞는가", "설정이 실제로 결과를 바꾸는가", "자료 부족을 오답으로 세지 않는가"이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONDITION, DEFAULT_SETTINGS, resolveSettings, validateBaselineInput, validateCaseInput,
  analyzeCase, analyzeAll, scoreBaseline,
} from '../rca/lib/baseline.js';
import { deepFreeze } from '../rca/lib/util.js';

// 시각 996..1004 (9개 샘플, 1초 간격), 주입 시각 1000.
const TIME = [996, 997, 998, 999, 1000, 1001, 1002, 1003, 1004];
const SHORT = { preWindowSec: 4, postWindowSec: 4 }; // 4초 창으로 줄여서 손계산을 쉽게 한다

function makeCase(key, columns, extra = {}) {
  return { case_key: key, inject_time: 1000, sample_interval_sec: 1, time: TIME, columns, ...extra };
}
// 전 4개(996~999) + 후 4개(1000~1003) + 마지막 1개(1004)
const step = (before, after) => [before, before, before, before, after, after, after, after, after];
const settingsOf = (o = {}) => resolveSettings({ ...SHORT, ...o }).settings;

test('증가량 순위: 후 평균 − 전 평균이 큰 서비스가 1위', () => {
  const c = makeCase('k0001', {
    a_cpu: step(10, 20), // +10
    b_cpu: step(5, 6),   // +1
    c_cpu: step(1, 4),   // +3
    a_mem: step(1, 99),  // _cpu가 아닌 열은 무시
  });
  const r = analyzeCase(c, settingsOf());
  assert.equal(r.status, 'analyzed');
  assert.deepEqual(r.ranking.map((x) => [x.service, x.increase]), [['a', 10], ['c', 3], ['b', 1]]);
  assert.equal(r.predicted, 'a');
  assert.deepEqual(r.top, ['a', 'c', 'b']);
  assert.equal(r.top1_tied, false);
  assert.equal(r.ranking[0].pre_mean, 10);
  assert.equal(r.ranking[0].post_mean, 20);
});

test('동점: 1위가 같으면 tied로 표시하고 이름 오름차순으로 정한다', () => {
  const c = makeCase('k0002', { z_cpu: step(0, 5), a_cpu: step(0, 5), m_cpu: step(0, 1) });
  const r = analyzeCase(c, settingsOf());
  assert.equal(r.top1_tied, true);
  assert.deepEqual(r.tied_services, ['a', 'z']);
  assert.equal(r.predicted, 'a');
});

test('결측: null은 빼고 평균을 내고, 유효 샘플 비율이 모자라면 그 서비스를 후보에서 뺀다', () => {
  const c = makeCase('k0003', {
    a_cpu: [10, null, null, 10, 30, 30, 30, 30, 30], // 전 구간 유효 2/4 = 0.5
    b_cpu: step(1, 2),
    c_cpu: step(1, 3),
  });
  const strict = analyzeCase(c, settingsOf()); // 기본 minCoverage 0.8
  assert.ok(strict.services_excluded.some((e) => e.service === 'a' && e.reason === 'insufficient_coverage'));
  assert.equal(strict.predicted, 'c');
  const loose = analyzeCase(c, settingsOf({ minCoverage: 0.5 }));
  assert.equal(loose.predicted, 'a');
  assert.equal(loose.ranking[0].pre_mean, 10); // null 두 개를 빼고 (10+10)/2
  assert.equal(loose.ranking[0].increase, 20);
});

test('자료 부족은 오답이 아니라 insufficient + 사유 코드로 분류된다', () => {
  // 후 구간 자료가 없는 사례
  const onlyPre = makeCase('k0004', { a_cpu: [1, 1, 1, 1, 1, 1, 1, 1, 1], b_cpu: [2, 2, 2, 2, 2, 2, 2, 2, 2] }, {
    inject_time: 1200,
  });
  const r1 = analyzeCase(onlyPre, settingsOf());
  assert.equal(r1.status, 'insufficient');
  assert.equal(r1.reason, 'insufficient_comparison_window');
  assert.equal(r1.predicted, null);
  // 후보 서비스가 하나뿐
  const single = makeCase('k0005', { a_cpu: step(1, 2) });
  assert.equal(analyzeCase(single, settingsOf()).reason, 'insufficient_candidates');
  // CPU 열이 없음
  const noCpu = makeCase('k0006', { a_mem: step(1, 2) });
  assert.equal(analyzeCase(noCpu, settingsOf()).reason, 'no_cpu_columns');
  // 입력 모양 오류
  const bad = makeCase('k0007', { a_cpu: [1, 2] });
  const r4 = analyzeCase(bad, settingsOf());
  assert.equal(r4.reason, 'input_invalid');
  assert.ok(r4.problems.includes('invalid_column:a_cpu'));
});

test('설정이 실제로 결과를 바꾼다 (장식이 아님): 경계 규칙', () => {
  // 주입 시각(1000) 샘플만 크게 튄 시계열
  const spike = [10, 10, 10, 10, 100, 10, 10, 10, 10];
  const c = makeCase('k0008', { a_cpu: spike, b_cpu: step(5, 5) });
  const inPost = analyzeCase(c, settingsOf({ boundaryRule: 'inject_in_post' }));
  assert.equal(inPost.predicted, 'a');
  assert.equal(inPost.ranking[0].increase, 22.5); // 후 구간 (100+10+10+10)/4 − 10
  const inPre = analyzeCase(c, settingsOf({ boundaryRule: 'inject_in_pre' }));
  assert.equal(inPre.predicted, 'b');             // 튄 샘플이 전 구간으로 넘어가 a의 증가량이 음수
  assert.equal(inPre.ranking.find((x) => x.service === 'a').increase, -22.5);
});

test('설정이 실제로 결과를 바꾼다: gapSec, 증가량 정의, 여러 열 합치기, 창 길이', () => {
  const spike = [10, 10, 10, 10, 100, 10, 10, 10, 10];
  const c = makeCase('k0009', { a_cpu: spike, b_cpu: step(5, 5) });
  const gap = analyzeCase(c, settingsOf({ gapSec: 1, minCoverage: 0.5 })); // 튄 샘플을 비워 둔 구간에 가둠
  assert.equal(gap.ranking.find((x) => x.service === 'a').increase, 0);

  const rel = makeCase('k0010', { a_cpu: step(10, 20), b_cpu: step(5, 6), c_cpu: step(1, 4) });
  assert.equal(analyzeCase(rel, settingsOf()).predicted, 'a');                                   // 절대 증가량
  assert.equal(analyzeCase(rel, settingsOf({ increaseDefinition: 'relative_mean_ratio' })).predicted, 'c'); // 상대 증가율

  // 한 서비스에 CPU 열이 둘: serviceMap으로 묶고 합치는 방법을 바꾼다
  const multi = makeCase('k0011', {
    x_cpu: step(10, 10), x_cpu_b: step(0, 30), y_cpu: step(0, 18),
  });
  const map = { serviceMap: { x_cpu: 'x', x_cpu_b: 'x' } };
  assert.equal(analyzeCase(multi, settingsOf({ ...map, multiColumnPolicy: 'mean' })).predicted, 'y');  // x = +15
  assert.equal(analyzeCase(multi, settingsOf({ ...map, multiColumnPolicy: 'max' })).predicted, 'x');   // x = +20
  assert.equal(analyzeCase(multi, settingsOf({ ...map, multiColumnPolicy: 'sum' })).predicted, 'x');   // x = +30

  // 창 길이: 전 구간을 8초로 늘리면 자료가 모자라 서비스가 빠진다
  const wide = analyzeCase(rel, settingsOf({ preWindowSec: 8 }));
  assert.equal(wide.status, 'insufficient');
  // CPU 열 접미사
  const sfx = makeCase('k0012', { a_load: step(1, 9), b_load: step(1, 2) });
  assert.equal(analyzeCase(sfx, settingsOf()).reason, 'no_cpu_columns');
  assert.equal(analyzeCase(sfx, settingsOf({ cpuColumnSuffix: '_load' })).predicted, 'a');
});

test('설정 해석: 기본값은 미확정 표시, 지정하면 user_specified, 모르는 이름·값은 예외', () => {
  const { settings, status } = resolveSettings({ preWindowSec: 60 });
  assert.equal(settings.preWindowSec, 60);
  assert.equal(settings.postWindowSec, DEFAULT_SETTINGS.postWindowSec);
  assert.equal(status.preWindowSec, 'user_specified');
  assert.equal(status.postWindowSec, 'unconfirmed_default');
  assert.deepEqual(Object.keys(status).sort(), Object.keys(DEFAULT_SETTINGS).sort());
  assert.throws(() => resolveSettings({ preWindowSecs: 60 }), /unknown_setting:preWindowSecs/); // 오타
  assert.throws(() => resolveSettings({ minCoverage: 0 }), /invalid_setting:minCoverage/);
  assert.throws(() => resolveSettings({ boundaryRule: 'whatever' }), /invalid_setting:boundaryRule/);
  assert.throws(() => resolveSettings('x'), /invalid_settings/);
  assert.equal(CONDITION.inject_time_provided, true);
  assert.equal(CONDITION.fault_type_provided, 'cohort-level cpu');
});

test('입력 검사: 금지 키(어느 깊이든)와, 서비스명·장애 단어가 든 사례 키를 거부', () => {
  const base = { schema_version: 1, dataset_label: '테스트', cases: [makeCase('k0001', { a_cpu: step(1, 2), b_cpu: step(1, 2) })] };
  assert.equal(validateBaselineInput(base).ok, true);
  for (const key of ['answer', 'root_cause', 'fault', 'fault_type', 'label', 'case_name', 'expected']) {
    const top = { ...base, [key]: 'x' };
    assert.equal(validateBaselineInput(top).ok, false, `top ${key}`);
    const deep = structuredClone(base);
    deep.cases[0][key] = 'x';
    assert.ok(validateBaselineInput(deep).problems.some((p) => p.includes(key)), `deep ${key}`);
  }
  const svc = makeCase('kadservice1', { adservice_cpu: step(1, 2), b_cpu: step(1, 2) });
  assert.ok(validateCaseInput(svc).includes('case_key_contains_service_name'));
  const fault = makeCase('kmem01', { a_cpu: step(1, 2) });
  assert.ok(validateCaseInput(fault).includes('case_key_contains_fault_word'));
  assert.ok(validateCaseInput(makeCase('case-1', { a_cpu: step(1, 2) })).includes('invalid_case_key'));
  assert.equal(validateBaselineInput({ ...base, cases: [] }).ok, false);
});

test('분모: N = A + S, 사유별 개수, 중복 사례 키는 입력 오류', () => {
  const input = {
    schema_version: 1, dataset_label: '테스트',
    cases: [
      makeCase('k0001', { a_cpu: step(10, 20), b_cpu: step(5, 6) }),
      makeCase('k0002', { a_cpu: step(1, 2), b_cpu: step(1, 9) }),
      makeCase('k0003', { a_cpu: step(1, 2) }),                      // 후보 하나뿐
      makeCase('k0004', { a_cpu: step(1, 2), b_cpu: step(1, 2) }, { inject_time: 5000 }), // 구간 밖
      makeCase('k0002', { a_cpu: step(1, 2), b_cpu: step(1, 9) }),    // 중복 키
    ],
  };
  const { perCase, counts } = analyzeAll(input, settingsOf());
  assert.equal(counts.N, 5);
  assert.equal(counts.A, 2);
  assert.equal(counts.S, 3);
  assert.equal(counts.N, counts.A + counts.S);
  assert.deepEqual(counts.S_reasons, {
    insufficient_candidates: 1, insufficient_comparison_window: 1, input_invalid: 1,
  });
  assert.equal(perCase[4].problems[0], 'duplicate_case_key');
  assert.throws(() => analyzeAll({ ...input, fault: 'x' }, settingsOf()), /invalid_baseline_input/);
});

test('채점: A = correct + correct_by_tiebreak + tied_wrong + wrong + answer_missing, 자료 부족은 오답이 아님', () => {
  const input = {
    schema_version: 1, dataset_label: '테스트',
    cases: [
      makeCase('k0001', { a_cpu: step(10, 20), b_cpu: step(5, 6) }),   // 예측 a (동점 아님)
      makeCase('k0002', { a_cpu: step(1, 2), b_cpu: step(1, 9) }),     // 예측 b (동점 아님)
      makeCase('k0003', { a_cpu: step(0, 5), b_cpu: step(0, 5) }),     // 동점 → 예측 a
      makeCase('k0004', { a_cpu: step(0, 5), b_cpu: step(0, 5) }),     // 동점 → 예측 a
      makeCase('k0005', { a_cpu: step(1, 2), b_cpu: step(1, 3) }),     // 예측 b, 정답 없음
      makeCase('k0006', { a_cpu: step(1, 2) }),                         // 자료 부족
    ],
  };
  const { perCase, counts } = analyzeAll(input, settingsOf());
  assert.equal(counts.A, 5);
  deepFreeze(perCase); // 예측을 얼린 뒤 채점 — 채점이 예측을 고칠 수 없다
  const before = JSON.stringify(perCase);
  const answers = {
    k0001: 'a',  // 맞음
    k0002: 'a',  // 틀림 (예측 b)
    k0003: 'a',  // 동점인데 이름순으로 정한 값과 일치
    k0004: 'b',  // 동점인데 틀림
    k0006: 'a',  // 자료 부족 사례의 정답 → 쓰이지 않음
    k9999: 'a',  // 해당 사례 없음 → 쓰이지 않음
  };
  const s = scoreBaseline(perCase, answers);
  assert.equal(JSON.stringify(perCase), before);
  assert.equal(s.scored, true);
  assert.deepEqual([s.N, s.A, s.S], [6, 5, 1]);
  assert.deepEqual(
    [s.correct, s.correct_by_tiebreak, s.tied_wrong, s.wrong, s.answer_missing],
    [1, 1, 1, 1, 1],
  );
  assert.equal(s.identity_ok, true);
  assert.deepEqual(s.answer_unused, { count: 2, keys: ['k0006', 'k9999'] });
  assert.match(s.answer_unused_note_ko, /자료 부족\(S\) 사례의 정답/);
  assert.equal(s.rate_correct_over_N, 1 / 6);
  assert.equal(s.rate_correct_over_A, 1 / 5);
  assert.equal(s.rate_correct_incl_tiebreak_over_A, 2 / 5);
  assert.throws(() => scoreBaseline(perCase, { k0001: 5 }), /invalid_answers/);
});

test('분석은 정답과 무관하다: 정답 값이 달라도 analyzeAll 결과는 같고, 정답 인자 자체가 없다', () => {
  assert.equal(analyzeCase.length <= 2, true);
  assert.equal(analyzeAll.length <= 2, true);
  const input = {
    schema_version: 1, dataset_label: '테스트',
    cases: [makeCase('k0001', { a_cpu: step(10, 20), b_cpu: step(5, 6) })],
  };
  const first = JSON.stringify(analyzeAll(input, settingsOf()));
  scoreBaseline(analyzeAll(input, settingsOf()).perCase, { k0001: 'b' });
  scoreBaseline(analyzeAll(input, settingsOf()).perCase, { k0001: 'a' });
  assert.equal(JSON.stringify(analyzeAll(input, settingsOf())), first);
});
