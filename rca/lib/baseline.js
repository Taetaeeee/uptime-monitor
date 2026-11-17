// CPU 전후 증가량 기준선 — 주입 시각 전후 CPU 평균 변화량으로 "원인 서비스 후보"를 고른다.
//
// 이 파일이 하는 일과 하지 않는 일
// - 하는 일: 사례마다 주입 시각 전·후 구간의 서비스별 CPU 평균을 비교해 증가량 순위를 만든다.
// - 하지 않는 일: 원래 노트북(Colab)과 같은 결과를 냈다고 단정하지 않는다.
//   창 길이·경계·열 선택·단위·동점 처리는 원래 조건을 확인하지 못해 "미확정 기본값"으로 두고,
//   전부 설정으로 드러내 출력에 함께 찍는다.
//
// 정답이 분석에 들어오지 않게 하는 방법
// - analyzeCase / analyzeAll은 정답 인자를 받지 않는다 (시그니처에 아예 없음).
// - 채점(scoreBaseline)은 분석이 끝나 얼려진(freeze) 예측을 받아 센다. 예측을 고칠 수 없다.
//
// 이 조건은 "주입 시각과 CPU 유형을 아는 오프라인 분석"이다.
// 장애 유형을 모르는 상태에서 스스로 탐지하는 조건이 아니다 (CONDITION에 고정 표기).
//
// 순수 함수만 있다. 파일은 읽지 않는다 (CLI가 읽어서 객체로 넘긴다).

import { isPlainObject } from './util.js';
import { findForbiddenKeys } from './case-schema.js';

/** 이 분석이 어떤 조건인지 출력에 고정으로 적는 표기. */
export const CONDITION = Object.freeze({
  id: 'A0',
  inject_time_provided: true,
  fault_type_provided: 'cohort-level cpu',
  description_ko: '주입 시각과 CPU 유형을 알고 하는 오프라인 서비스 식별이다. 장애를 스스로 탐지하는 조건이 아니다.',
});

/**
 * 기본 설정. 전부 "미확정 기본값"이다 (원래 조건을 확인하지 못함).
 * 숫자를 바꿔 보며 결과가 어떻게 달라지는지 볼 수 있도록 전부 resolveSettings로 덮어쓸 수 있다.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  preWindowSec: 300,            // 주입 전 구간 길이(초)
  postWindowSec: 300,           // 주입 후 구간 길이(초)
  gapSec: 0,                    // 주입 시각 앞뒤로 비워 두는 구간(초)
  boundaryRule: 'inject_in_post', // 주입 시각과 정확히 같은 샘플이 어느 쪽에 들어가는지
  cpuColumnSuffix: '_cpu',      // CPU 열을 고르는 규칙: 이 접미사로 끝나는 열
  serviceMap: null,             // 열 이름 → 서비스 이름 직접 지정 (없으면 접미사를 뗀 이름)
  multiColumnPolicy: 'mean',    // 한 서비스에 CPU 열이 여러 개일 때 합치는 방법
  unit: 'as_is',                // 단위 변환 안 함 (사례 안에서만 비교하므로)
  increaseDefinition: 'absolute_mean_diff', // 증가량 정의
  missingPolicy: 'drop_nan',    // 결측은 빼고 평균
  minCoverage: 0.8,             // 구간 안에서 필요한 유효 샘플 비율
  minCandidateServices: 2,      // 비교하려면 필요한 후보 서비스 수
  tieBreak: 'name_asc',         // 동점이면 서비스 이름 오름차순
  tieEpsilon: 1e-9,             // 이 차이 이하면 동점으로 본다
  topK: 3,                      // 출력에 담을 상위 개수
});

const ENUMS = Object.freeze({
  boundaryRule: ['inject_in_post', 'inject_in_pre'],
  multiColumnPolicy: ['mean', 'max', 'sum'],
  unit: ['as_is'],
  increaseDefinition: ['absolute_mean_diff', 'relative_mean_ratio'],
  missingPolicy: ['drop_nan'],
  tieBreak: ['name_asc'],
});

function checkSetting(key, value) {
  if (ENUMS[key]) return ENUMS[key].includes(value);
  switch (key) {
    case 'preWindowSec': case 'postWindowSec': return Number.isFinite(value) && value > 0;
    case 'gapSec': case 'tieEpsilon': return Number.isFinite(value) && value >= 0;
    case 'minCoverage': return Number.isFinite(value) && value > 0 && value <= 1;
    case 'minCandidateServices': case 'topK': return Number.isInteger(value) && value >= 1;
    case 'cpuColumnSuffix': return typeof value === 'string' && value.length > 0;
    case 'serviceMap':
      return value === null || (isPlainObject(value) && Object.values(value).every((v) => typeof v === 'string' && v.length > 0));
    default: return false;
  }
}

/**
 * 사용자가 준 값을 기본값에 덮어 최종 설정을 만든다.
 * status는 설정마다 "unconfirmed_default"(원래 조건 미확인 기본값) 또는 "user_specified"를 적는다.
 * 모르는 설정 이름은 오타로 조용히 무시되지 않도록 예외를 던진다.
 */
export function resolveSettings(overrides = {}) {
  if (!isPlainObject(overrides)) throw new Error('invalid_settings: 설정은 객체여야 합니다');
  const settings = { ...DEFAULT_SETTINGS };
  const status = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) status[key] = 'unconfirmed_default';
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) throw new Error(`unknown_setting:${key}`);
    if (!checkSetting(key, value)) throw new Error(`invalid_setting:${key}`);
    settings[key] = value;
    status[key] = 'user_specified';
  }
  return { settings, status };
}

const CASE_KEY_RE = /^k[0-9a-z]{4,}$/;
const FAULT_WORD_RE = /(cpu|mem|disk|delay|loss|socket)/;

/**
 * 입력 전체의 모양 검사 (금지 키는 어느 깊이든 거부).
 * 사례별 모양 문제는 여기서 막지 않고 그 사례만 '자료 부족(입력 오류)'으로 분류한다.
 */
export function validateBaselineInput(input) {
  if (!isPlainObject(input)) return { ok: false, problems: ['input_not_object'] };
  const problems = [];
  for (const p of findForbiddenKeys(input)) problems.push(`forbidden_key:${p}`);
  for (const k of Object.keys(input)) {
    if (!['schema_version', 'dataset_label', 'cases'].includes(k)) problems.push(`unknown_key:${k}`);
  }
  if (input.schema_version !== 1) problems.push('invalid_schema_version');
  if (typeof input.dataset_label !== 'string' || input.dataset_label.length === 0) problems.push('invalid_dataset_label');
  if (!Array.isArray(input.cases) || input.cases.length === 0) problems.push('invalid_cases');
  return { ok: problems.length === 0, problems };
}

function isNumOrNull(v) {
  return v === null || (typeof v === 'number');
}

/** 사례 한 건의 모양 검사. 문제 목록을 돌려준다 (비어 있으면 정상). */
export function validateCaseInput(c, settings = DEFAULT_SETTINGS) {
  if (!isPlainObject(c)) return ['case_not_object'];
  const problems = [];
  for (const k of Object.keys(c)) {
    if (!['case_key', 'inject_time', 'sample_interval_sec', 'time', 'columns'].includes(k)) problems.push(`unknown_key:${k}`);
  }
  if (typeof c.case_key !== 'string' || !CASE_KEY_RE.test(c.case_key)) problems.push('invalid_case_key');
  if (!Number.isFinite(c.inject_time)) problems.push('invalid_inject_time');
  if (!(Number.isFinite(c.sample_interval_sec) && c.sample_interval_sec > 0)) problems.push('invalid_sample_interval_sec');
  const timeOk = Array.isArray(c.time) && c.time.length > 0
    && c.time.every((t) => Number.isFinite(t)) && c.time.every((t, i) => i === 0 || t >= c.time[i - 1]);
  if (!timeOk) problems.push('invalid_time');
  if (!isPlainObject(c.columns) || Object.keys(c.columns).length === 0) {
    problems.push('invalid_columns');
  } else {
    for (const [name, series] of Object.entries(c.columns)) {
      if (!Array.isArray(series) || !series.every(isNumOrNull) || (timeOk && series.length !== c.time.length)) {
        problems.push(`invalid_column:${name}`);
      }
    }
    // 사례 이름에 서비스명·장애 단어가 들어 있으면 이름만으로 정답이 유출될 수 있어 거부한다.
    if (typeof c.case_key === 'string') {
      const key = c.case_key.toLowerCase();
      if (FAULT_WORD_RE.test(key)) problems.push('case_key_contains_fault_word');
      for (const col of Object.keys(c.columns)) {
        const svc = serviceNameOf(col, settings).toLowerCase();
        if (svc.length >= 3 && key.includes(svc)) problems.push('case_key_contains_service_name');
      }
    }
  }
  return [...new Set(problems)];
}

function serviceNameOf(column, settings) {
  const mapped = settings.serviceMap?.[column];
  if (typeof mapped === 'string') return mapped;
  return column.endsWith(settings.cpuColumnSuffix)
    ? column.slice(0, column.length - settings.cpuColumnSuffix.length)
    : column;
}

function windows(injectTime, s) {
  const pre = { lo: injectTime - s.gapSec - s.preWindowSec, hi: injectTime - s.gapSec };
  const post = { lo: injectTime + s.gapSec, hi: injectTime + s.gapSec + s.postWindowSec };
  if (s.boundaryRule === 'inject_in_post') {
    // pre = [lo, hi), post = [lo, hi) : 주입 시각 샘플은 후 구간에 들어간다
    return {
      inPre: (t) => t >= pre.lo && t < pre.hi,
      inPost: (t) => t >= post.lo && t < post.hi,
    };
  }
  // inject_in_pre: pre = (lo, hi], post = (lo, hi] : 주입 시각 샘플은 전 구간에 들어간다
  return {
    inPre: (t) => t > pre.lo && t <= pre.hi,
    inPost: (t) => t > post.lo && t <= post.hi,
  };
}

function combine(values, policy) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  if (policy === 'max') return Math.max(...nums);
  if (policy === 'sum') return nums.reduce((a, b) => a + b, 0);
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function meanAndCoverage(times, series, inWindow, windowSec, interval) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < times.length; i += 1) {
    const v = series[i];
    if (inWindow(times[i]) && typeof v === 'number' && Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  const expected = Math.max(1, Math.floor(windowSec / interval));
  return { mean: count > 0 ? sum / count : null, coverage: Math.min(1, count / expected) };
}

function insufficient(caseKey, reason, extra = {}) {
  return {
    case_key: typeof caseKey === 'string' ? caseKey : null,
    status: 'insufficient', reason,
    services_considered: 0, services_excluded: [], ranking: [], top: [], predicted: null,
    top1_tied: false, tied_services: [],
    ...extra,
  };
}

/**
 * 사례 한 건을 분석한다. 정답 인자는 없다.
 * 비교 구간이 모자라면 오답이 아니라 "자료 부족(insufficient)"으로 분류하고 사유 코드를 남긴다.
 */
export function analyzeCase(caseInput, settings = DEFAULT_SETTINGS) {
  const problems = validateCaseInput(caseInput, settings);
  if (problems.length > 0) return insufficient(caseInput?.case_key, 'input_invalid', { problems });

  const { inPre, inPost } = windows(caseInput.inject_time, settings);
  const grouped = new Map(); // 서비스 이름 → CPU 열 배열 목록
  for (const [col, series] of Object.entries(caseInput.columns)) {
    if (!col.endsWith(settings.cpuColumnSuffix) && !settings.serviceMap?.[col]) continue;
    const name = serviceNameOf(col, settings);
    if (name.length === 0) continue;
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push(series);
  }
  if (grouped.size === 0) return insufficient(caseInput.case_key, 'no_cpu_columns');

  const candidates = [];
  const excluded = [];
  for (const [service, columns] of [...grouped.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const merged = caseInput.time.map((_, i) => combine(columns.map((c) => c[i]), settings.multiColumnPolicy));
    const pre = meanAndCoverage(caseInput.time, merged, inPre, settings.preWindowSec, caseInput.sample_interval_sec);
    const post = meanAndCoverage(caseInput.time, merged, inPost, settings.postWindowSec, caseInput.sample_interval_sec);
    if (pre.coverage < settings.minCoverage || post.coverage < settings.minCoverage
        || pre.mean === null || post.mean === null) {
      excluded.push({ service, reason: 'insufficient_coverage' });
      continue;
    }
    let increase;
    if (settings.increaseDefinition === 'relative_mean_ratio') {
      if (Math.abs(pre.mean) < 1e-12) { excluded.push({ service, reason: 'zero_baseline' }); continue; }
      increase = (post.mean - pre.mean) / Math.abs(pre.mean);
    } else {
      increase = post.mean - pre.mean;
    }
    candidates.push({
      service, pre_mean: pre.mean, post_mean: post.mean, increase,
      coverage_pre: pre.coverage, coverage_post: post.coverage,
    });
  }

  if (candidates.length === 0) {
    return insufficient(caseInput.case_key, 'insufficient_comparison_window', { services_excluded: excluded });
  }
  if (candidates.length < settings.minCandidateServices) {
    return insufficient(caseInput.case_key, 'insufficient_candidates', {
      services_considered: candidates.length, services_excluded: excluded,
    });
  }

  const eps = settings.tieEpsilon;
  candidates.sort((a, b) => (Math.abs(a.increase - b.increase) <= eps
    ? (a.service < b.service ? -1 : 1)
    : b.increase - a.increase));
  const tiedServices = candidates
    .filter((c) => Math.abs(c.increase - candidates[0].increase) <= eps)
    .map((c) => c.service);
  return {
    case_key: caseInput.case_key,
    status: 'analyzed', reason: null,
    services_considered: candidates.length,
    services_excluded: excluded,
    ranking: candidates,
    top: candidates.slice(0, settings.topK).map((c) => c.service),
    predicted: candidates[0].service,       // 동점이면 tieBreak(이름 오름차순)로 정한 값
    top1_tied: tiedServices.length > 1,
    tied_services: tiedServices.length > 1 ? tiedServices : [],
  };
}

/**
 * 모든 사례를 분석한다. 정답 인자는 없다.
 * N(전체) = A(분석 가능) + S(자료 부족). 자료 부족은 분모에서 숨기지 않고 사유별로 센다.
 */
export function analyzeAll(input, settings = DEFAULT_SETTINGS) {
  const v = validateBaselineInput(input);
  if (!v.ok) throw new Error(`invalid_baseline_input:${v.problems.join(',')}`);
  const seen = new Set();
  const perCase = input.cases.map((c) => {
    const key = c?.case_key;
    if (typeof key === 'string' && seen.has(key)) {
      return insufficient(key, 'input_invalid', { problems: ['duplicate_case_key'] });
    }
    if (typeof key === 'string') seen.add(key);
    return analyzeCase(c, settings);
  });
  const reasons = {};
  let analyzed = 0;
  for (const r of perCase) {
    if (r.status === 'analyzed') analyzed += 1;
    else reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  }
  return {
    perCase,
    counts: { N: perCase.length, A: analyzed, S: perCase.length - analyzed, S_reasons: reasons },
  };
}

function rate(num, den) {
  return den > 0 ? num / den : null;
}

/**
 * 채점. 분석이 끝나 얼려진 예측만 받아 정답과 비교한다 (예측을 고치지 못함).
 *
 * 분모 항등식: A = correct + correct_by_tiebreak + tied_wrong + wrong + answer_missing
 * - 1위 동점 사례는 correct/wrong에 섞지 않고 따로 센다 (원본의 동점 처리는 미확정).
 * - 정답이 없는 분석 가능 사례(answer_missing)와 쓰이지 않은 정답(answer_unused)도 숨기지 않는다.
 * - 자료 부족(S) 사례는 오답으로 세지 않는다.
 */
export function scoreBaseline(perCase, answers) {
  if (!Array.isArray(perCase)) throw new Error('invalid_per_case');
  if (!isPlainObject(answers) || !Object.values(answers).every((v) => typeof v === 'string')) {
    throw new Error('invalid_answers: 정답은 {사례키: 서비스이름} 객체여야 합니다');
  }
  const analyzed = perCase.filter((r) => r.status === 'analyzed');
  const used = new Set();
  const tally = { correct: 0, correct_by_tiebreak: 0, tied_wrong: 0, wrong: 0, answer_missing: 0 };
  for (const r of analyzed) {
    if (!Object.hasOwn(answers, r.case_key)) { tally.answer_missing += 1; continue; }
    used.add(r.case_key);
    const right = r.predicted === answers[r.case_key];
    if (r.top1_tied) tally[right ? 'correct_by_tiebreak' : 'tied_wrong'] += 1;
    else tally[right ? 'correct' : 'wrong'] += 1;
  }
  const unusedKeys = Object.keys(answers).filter((k) => !used.has(k)).sort();
  const N = perCase.length;
  const A = analyzed.length;
  const sum = tally.correct + tally.correct_by_tiebreak + tally.tied_wrong + tally.wrong + tally.answer_missing;
  const inclTie = tally.correct + tally.correct_by_tiebreak;
  return {
    scored: true,
    N, A, S: N - A,
    ...tally,
    answer_unused: { count: unusedKeys.length, keys: unusedKeys },
    answer_unused_note_ko: '쓰이지 않은 정답에는 자료 부족(S) 사례의 정답과 입력에 없는 사례의 정답이 모두 들어 있다.',
    identity_ok: sum === A,
    rate_correct_over_N: rate(tally.correct, N),
    rate_correct_over_A: rate(tally.correct, A),
    rate_correct_incl_tiebreak_over_N: rate(inclTie, N),
    rate_correct_incl_tiebreak_over_A: rate(inclTie, A),
    tie_policy_note_ko: '원본의 동점 처리 방식은 확인하지 못했다. 1위 동점 사례는 tieBreak 설정으로 1위를 정하되 correct_by_tiebreak·tied_wrong으로 따로 센다.',
  };
}
