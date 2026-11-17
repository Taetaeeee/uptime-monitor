// RCA 합성 사례 채점 도우미 — 정답 파일(answer-key.json)을 읽는 "유일한" 코드.
//
// 왜 한 곳에만 두나?
// - 정답이 분석 경로(rca/, scripts/rca-*)로 새는 것을 막으려면, 정답을 읽는 코드가 어디 있는지
//   한눈에 보여야 한다. rca/와 CLI는 이 폴더(grading-only)를 아예 모른다 (경계 테스트가 확인).
// - 이 모듈은 부수효과가 없다. node --test가 test/ 아래 .js를 실행해도 아무 일도 일어나지 않는다.
//
// loadCases()는 정답이 없는 관측 fixture만 읽는다. 같은 파일에 둔 것은 여러 테스트가 공유하기 위해서다.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'rca-synthetic');
export const OBSERVATIONS_DIR = join(ROOT, 'observations');
const KEY_PATH = join(ROOT, 'grading-only', 'answer-key.json');

/** 관측 fixture 6개를 case_id 순으로 읽는다 (정답 없음). */
export function loadCases() {
  return readdirSync(OBSERVATIONS_DIR)
    .filter((f) => /^obs-[0-9a-f]{6}\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(OBSERVATIONS_DIR, f), 'utf8')));
}

/** 정답 전체. 채점 테스트만 호출한다. */
export function loadAnswerKey() {
  return JSON.parse(readFileSync(KEY_PATH, 'utf8'));
}

export function getKeyItem(caseId) {
  const item = loadAnswerKey().find((k) => k.case_id === caseId);
  if (!item) throw new Error(`answer key missing: ${caseId}`);
  return item;
}

/** 정답 쪽 설명 문구 목록 (도구 응답·보고서에 새면 안 되는 문자열). */
export function leakStrings() {
  const out = [];
  for (const k of loadAnswerKey()) out.push(k.label_ko, k.description_ko);
  return out;
}

const codes = (list) => (Array.isArray(list) ? list.map((x) => x.code) : []);

/**
 * 보고서가 정답 기대값을 만족하는지 채점한다.
 * 정답은 "등급·현상·미확인·가설 한계"의 코드 값 수준으로만 적혀 있다.
 */
export function gradeReport(report, keyItem) {
  const e = keyItem.expected;
  const problems = [];
  const d = report.diagnosis ?? {};
  if (d.cause_outcome !== e.cause_outcome) problems.push(`cause_outcome:${d.cause_outcome}!=${e.cause_outcome}`);
  if (d.confirmed_cause !== null) problems.push('confirmed_cause_not_null');
  if (e.run_status && report.run_status !== e.run_status) problems.push(`run_status:${report.run_status}`);
  if (e.stop_reason && report.stop_reason !== e.stop_reason) problems.push(`stop_reason:${report.stop_reason}`);

  const phenomena = codes(d.phenomena);
  for (const c of e.must_have_phenomena) if (!phenomena.includes(c)) problems.push(`missing_phenomenon:${c}`);
  const unknown = codes(d.unknown_facts);
  for (const c of e.must_have_unknown) if (!unknown.includes(c)) problems.push(`missing_unknown:${c}`);

  const hyps = Array.isArray(d.hypotheses) ? d.hypotheses : [];
  for (const h of e.must_have_hypotheses) {
    if (!hyps.some((x) => x.code === h.code && x.status === h.status)) problems.push(`missing_hypothesis:${h.code}:${h.status}`);
  }
  for (const c of e.must_not_hypotheses) if (hyps.some((x) => x.code === c)) problems.push(`forbidden_hypothesis:${c}`);
  if (typeof e.max_hypotheses === 'number' && hyps.length > e.max_hypotheses) problems.push(`too_many_hypotheses:${hyps.length}`);
  if (typeof e.min_open_hypotheses === 'number'
      && hyps.filter((x) => x.status === 'open').length < e.min_open_hypotheses) {
    problems.push('too_few_open_hypotheses');
  }
  const limits = hyps.flatMap((h) => h.limits ?? []);
  for (const c of e.must_have_limits) if (!limits.includes(c)) problems.push(`missing_limit:${c}`);

  const extra = report.limits_used?.additional_observations;
  if (e.additional_observations
      && !(extra >= e.additional_observations.min && extra <= e.additional_observations.max)) {
    problems.push(`additional_observations:${extra}`);
  }
  return { ok: problems.length === 0, problems };
}
