// 합성 사례 조사 데모 (네트워크·DB·파일 쓰기 없음)
//
// 사용법 (Windows PowerShell):
//   node scripts/rca-demo/run.mjs --list               # 사용할 수 있는 사례 id 목록 (id만 출력)
//   node scripts/rca-demo/run.mjs --case <사례id>      # 그 사례를 조사한 JSON 보고서를 표준 출력으로
//
// 이 파일이 지키는 약속
// - 합성(가짜) 측정 fixture만 읽는다. 관측 폴더만 읽고, 정답이 든 폴더는 알지도 열지도 않는다.
// - 사례 id는 형식을 검사한 뒤, 폴더 목록 안에서 찾는다 (id로 경로를 만들지 않으므로 경로 조작이 불가능).
// - 실제 DNS·HTTP 호출은 없다. 결정 정책은 규칙(rule)이고 LLM은 실행하지 않는다.
// - 결과는 표준 출력으로만 낸다. 파일을 쓰지 않는다.
//
// 종료 코드: 0 성공 / 1 사용법 오류·없는 사례

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit, stderr, stdout } from 'node:process';
import { runInvestigation, createRulePolicy } from '../../rca/runner.js';
import { CASE_ID_RE, validateObservationCase } from '../../rca/lib/case-schema.js';

const OBSERVATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures', 'rca-synthetic', 'observations');
const USAGE = '사용법: node scripts/rca-demo/run.mjs --list | --case <사례id>';

function fail(message) {
  stderr.write(`${message}\n`);
  exit(1);
}

/** 관측 fixture 파일 이름 목록 (obs-<id>.json 형식만). 사례 id → 파일 이름 대응도 여기서만 만든다. */
function listFixtureFiles() {
  return readdirSync(OBSERVATIONS_DIR)
    .map((name) => /^obs-([0-9a-f]{6})\.json$/.exec(name))
    .filter(Boolean)
    .map((m) => ({ file: m[0], id: `syn-${m[1]}` }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

const args = argv.slice(2);
if (args.length === 1 && args[0] === '--list') {
  stdout.write(`${listFixtureFiles().map((f) => f.id).join('\n')}\n`);
} else if (args.length === 2 && args[0] === '--case') {
  const wanted = args[1];
  if (!CASE_ID_RE.test(wanted)) fail(`사례 id 형식이 아닙니다: ${wanted}\n${USAGE}`);
  const found = listFixtureFiles().find((f) => f.id === wanted);
  if (!found) fail(`없는 사례입니다: ${wanted} (--list 로 확인)`);
  const caseData = JSON.parse(readFileSync(join(OBSERVATIONS_DIR, found.file), 'utf8'));
  const checked = validateObservationCase(caseData);
  if (!checked.ok || caseData.case_id !== wanted) fail(`fixture가 계약에 맞지 않습니다: ${checked.problems.join(', ')}`);
  const report = runInvestigation({ caseData, policy: createRulePolicy() });
  stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  fail(USAGE);
}
