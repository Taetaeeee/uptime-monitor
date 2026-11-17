// CPU 전후 증가량 기준선 실행기 (로컬 JSON 전용)
//
// 사용법 (Windows PowerShell):
//   node scripts/rca-baseline/run.mjs --input <입력.json> [--answers <정답.json>] [--config <설정.json>]
//
// 이 파일이 지키는 약속
// - 로컬 .json 파일만 읽는다. 다운로드·네트워크 코드는 없다. URL·CSV·Parquet은 받지 않고 변환 안내만 한다.
// - 정답 파일은 "분석이 끝나고 예측을 얼린 뒤에" 읽는다. 분석 경로에는 정답이 들어오지 않는다.
// - 원래 노트북(Colab)과 같은 결과라고 단정하지 않는다. 출력의 reproduction은 항상 미확인이다.
//
// 종료 코드: 0 성공 / 1 사용법·파일·JSON 오류 / 2 지원하지 않는 입력 형식 / 3 입력 내용 거부(금지 키 등)

import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { argv, exit, stderr, stdout } from 'node:process';
import {
  CONDITION, resolveSettings, validateBaselineInput, analyzeAll, scoreBaseline,
} from '../../rca/lib/baseline.js';
import { deepFreeze } from '../../rca/lib/util.js';

const USAGE = `사용법: node scripts/rca-baseline/run.mjs --input <입력.json> [--answers <정답.json>] [--config <설정.json>]`;

const CONVERT_GUIDE = `이 실행기는 로컬 .json 파일만 읽습니다 (URL·CSV·Parquet 직접 읽기와 다운로드는 지원하지 않음).
원본이 CSV/Parquet이면 Colab 등 직접 쓰는 환경에서 아래 모양의 JSON으로 먼저 변환하세요.
  1) 사례마다 불투명 키를 붙입니다. 형식 ^k[0-9a-z]{4,}$ (예: k0001). 서비스 이름이나 cpu·mem·disk·delay·loss·socket 같은 장애 단어를 넣지 마세요.
  2) 시각은 초 단위 숫자로 통일합니다 (time 배열, 샘플 간격은 sample_interval_sec).
  3) 정답(원인 서비스)은 입력에 넣지 말고 별도 파일 {"k0001":"서비스이름"} 으로 저장해 --answers 로 따로 넘깁니다.
입력 JSON 모양:
  { "schema_version": 1, "dataset_label": "사용자 지정 문자열",
    "cases": [ { "case_key": "k0001", "inject_time": 1705312345, "sample_interval_sec": 1,
                 "time": [초...], "columns": { "서비스_cpu": [값...], "서비스2_cpu": [값...] } } ] }`;

function fail(code, message) {
  stderr.write(`${message}\n`);
  exit(code);
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!['--input', '--answers', '--config'].includes(flag) || value === undefined || value.startsWith('--')) {
      fail(1, `알 수 없는 인자이거나 값이 없습니다: ${flag}\n${USAGE}`);
    }
    out[flag.slice(2)] = value;
  }
  if (!out.input) fail(1, `--input 이 필요합니다.\n${USAGE}`);
  return out;
}

/** 로컬 .json 경로만 통과시킨다. URL·다른 확장자는 종료 코드 2와 안내. */
function readLocalJson(pathText, what) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pathText)) {
    fail(2, `${what}: URL은 받지 않습니다 (${pathText}).\n${CONVERT_GUIDE}`);
  }
  if (extname(pathText).toLowerCase() !== '.json') {
    fail(2, `${what}: .json 파일만 받습니다 (${pathText}).\n${CONVERT_GUIDE}`);
  }
  let text;
  try {
    text = readFileSync(resolve(pathText), 'utf8');
  } catch (e) {
    fail(1, `${what}: 파일을 읽을 수 없습니다 (${pathText}): ${e.code ?? e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return fail(1, `${what}: JSON 형식이 아닙니다 (${pathText})`);
  }
}

function summaryLine(counts, scoring) {
  const base = `N ${counts.N} / A ${counts.A} / S ${counts.S}`;
  if (!scoring) return `${base} / 정답 미제공: 채점 안 함`;
  return `${base} / C ${scoring.correct} (W ${scoring.wrong}, 동점 맞음 ${scoring.correct_by_tiebreak}, `
    + `동점 틀림 ${scoring.tied_wrong}, 정답 없음 ${scoring.answer_missing})`;
}

const args = parseArgs(argv.slice(2));

// 1) 입력과 설정 읽기
const input = readLocalJson(args.input, '--input');
let resolved;
try {
  resolved = resolveSettings(args.config ? readLocalJson(args.config, '--config') : {});
} catch (e) {
  fail(1, `--config: ${e.message}`);
}
const inputCheck = validateBaselineInput(input);
if (!inputCheck.ok) fail(3, `입력 거부: ${inputCheck.problems.join(', ')}`);

// 2) 분석 — 이 시점까지 정답 파일은 읽지 않았다. 결과는 얼려서 이후에 고칠 수 없게 한다.
const { perCase, counts } = analyzeAll(input, resolved.settings);
deepFreeze(perCase);

// 3) (선택) 채점 — 분석이 끝난 뒤에만 정답 파일을 읽는다.
let scoring = null;
if (args.answers) {
  const answers = readLocalJson(args.answers, '--answers');
  try {
    scoring = scoreBaseline(perCase, answers);
  } catch (e) {
    fail(1, `--answers: ${e.message}`);
  }
}

const result = {
  tool: 'rca-baseline',
  schema_version: 1,
  data_origin: 'user_declared',          // 사용자가 가져온 자료라는 뜻. 어느 공개 벤치마크의 원본이라고 단정하지 않는다.
  dataset_label: input.dataset_label,
  condition: CONDITION,
  settings: { values: resolved.settings, status: resolved.status },
  reproduction: {
    settings_match_original: 'unknown',
    verified_against_original: false,
    note_ko: '원래 노트북의 창 길이·경계·열 선택·동점 처리 조건을 확인하지 못했다. 이 결과는 원본 결과의 재현이 아니다.',
  },
  counts,
  summary_line: summaryLine(counts, scoring),
  predictions: perCase,
  scored: scoring !== null,
  scoring,
};
stdout.write(`${JSON.stringify(result, null, 2)}\n`);
