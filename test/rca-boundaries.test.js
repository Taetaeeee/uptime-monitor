// RCA 경계 정적 검사 — 소스 텍스트를 읽어 "해서는 안 되는 의존"이 없는지 확인한다.
// 이 검사는 사람이 코드 리뷰에서 놓치기 쉬운 경계(네트워크·운영 코드·정답 파일·하드코딩 id/수치)를 자동으로 지킨다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LIMITS } from '../rca/runner.js';
import { loadCases } from './helpers/rca-grade.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RCA_DIR = join(ROOT, 'rca');
const SELF = fileURLToPath(import.meta.url);

function walk(dir, accept) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p, accept) : (accept(p) ? [p] : []);
  });
}
const isJs = (p) => /\.(js|mjs)$/.test(p);
const rcaFiles = walk(RCA_DIR, isJs);
// IO 권한은 이 두 파일에만 연다. 기존 동기 엔진/CLI의 순수 경계는 유지한다.
const ioAdapters = ['rca/adapters/openai-responses.js', 'rca/adapters/live.js'];
const cliFiles = [
  ...walk(join(ROOT, 'scripts', 'rca-baseline'), isJs),
  ...walk(join(ROOT, 'scripts', 'rca-demo'), isJs),
];
const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(ROOT, p).split(sep).join('/');

/** import 문과 동적 import/require에서 모듈 경로를 뽑는다. */
function specifiers(text) {
  const found = [];
  for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) found.push(m[1]);
  for (const m of text.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) found.push(m[1]);
  return found;
}

const NETWORK_MODULES = /^node:(http|https|http2|net|dns|dgram|tls|child_process|worker_threads|cluster|vm)$/;
const NETWORK_WORDS = /\bfetch\b|XMLHttpRequest|WebSocket|\bnavigator\b/;

test('검사 대상 파일이 실제로 존재한다 (빈 폴더를 통과로 착각하지 않기)', () => {
  assert.ok(rcaFiles.length >= 6, rcaFiles.map(rel).join(','));
  assert.ok(cliFiles.length >= 2);
});

test('rca/**의 import는 rca/ 안의 상대 경로와 node:crypto뿐이다 (파일·네트워크·프로세스 모듈 없음)', () => {
  for (const file of rcaFiles) {
    const text = read(file);
    for (const spec of specifiers(text)) {
      if (spec === 'node:crypto') continue;
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${rel(file)}: ${spec}`);
      assert.ok(resolve(dirname(file), spec).startsWith(RCA_DIR + sep), `${rel(file)}: rca/ 밖을 가리킴 ${spec}`);
    }
    assert.ok(!/\brequire\s*\(/.test(text) && !/\bimport\s*\(/.test(text), `${rel(file)}: 동적 import/require 금지`);
    if (!ioAdapters.includes(rel(file))) assert.ok(!NETWORK_WORDS.test(text), `${rel(file)}: 네트워크 API 사용 금지`);
    assert.ok(!/node:(fs|os|path|url|process)/.test(text), `${rel(file)}: 파일/시스템 모듈 금지`);
    assert.ok(!/\bprocess\./.test(text), `${rel(file)}: process 접근 금지`);
  }
});

test('rca/**는 운영 코드(src/)와 운영 DB·상태 판정 경로를 참조하지 않는다', () => {
  for (const file of rcaFiles) {
    for (const spec of specifiers(read(file))) {
      assert.ok(!/(^|\/)src\//.test(spec), `${rel(file)}: ${spec}`);
      assert.ok(!/(record|state|db|index|incident|aggregate)\.js$/.test(spec), `${rel(file)}: ${spec}`);
    }
    assert.ok(!/check_results|monitors\b|incidents\b|\bD1\b/.test(read(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')),
      `${rel(file)}: 운영 테이블/DB 이름이 코드에 등장`);
  }
});

test('rca/**는 시계·난수에 의존하지 않는다 (같은 입력이면 같은 출력)', () => {
  for (const file of rcaFiles) {
    const code = read(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/Date\.now|new Date|Math\.random|performance\.now|randomUUID|randomBytes/.test(code), rel(file));
  }
});

test('CLI는 로컬 파일 읽기 외의 접근이 없다: 허용 모듈 외 import 금지, 네트워크 API 금지', () => {
  const allowed = ['node:fs', 'node:path', 'node:url', 'node:process'];
  for (const file of cliFiles) {
    const text = read(file);
    for (const spec of specifiers(text)) {
      if (allowed.includes(spec)) continue;
      assert.ok(spec.startsWith('../../rca/'), `${rel(file)}: ${spec}`);
      assert.ok(!NETWORK_MODULES.test(spec));
    }
    assert.ok(!NETWORK_WORDS.test(text), `${rel(file)}: 네트워크 API 금지`);
    assert.ok(!/\bimport\s*\(|\brequire\s*\(/.test(text), rel(file));
  }
  // 데모 CLI는 쓰기 API 자체를 가져오지 않는다
  const demo = read(cliFiles.find((f) => f.includes('rca-demo')));
  assert.ok(!/writeFile|appendFile|createWriteStream|mkdir|rmSync|unlink/.test(demo));
  const base = read(cliFiles.find((f) => f.includes('rca-baseline')));
  assert.ok(!/writeFile|appendFile|createWriteStream|mkdir|rmSync|unlink/.test(base));
});

test('정답 비접근: rca/·CLI는 정답 폴더·파일 이름을 알지 못한다', () => {
  for (const file of [...rcaFiles, ...cliFiles]) {
    const text = read(file);
    for (const word of ['answer-key', 'grading-only', 'grading_only']) {
      assert.ok(!text.includes(word), `${rel(file)}: ${word}`);
    }
  }
});

test('정답 파일(answer-key.json)을 가리키는 코드는 test/helpers/rca-grade.js 한 곳뿐이다', () => {
  const dirs = [join(ROOT, 'test'), join(ROOT, 'rca'), join(ROOT, 'scripts'), join(ROOT, 'src'), join(ROOT, 'agent')];
  const needle = ['answer', 'key.json'].join('-'); // 이 테스트 파일 자신이 걸리지 않도록 조각으로 만든다
  const holders = dirs.filter((d) => { try { return statSync(d).isDirectory(); } catch { return false; } })
    .flatMap((d) => walk(d, (p) => /\.(js|mjs|json)$/.test(p) && !p.includes(`${sep}fixtures${sep}`)))
    .filter((p) => p !== SELF && read(p).includes(needle))
    .map(rel);
  assert.deepEqual(holders, ['test/helpers/rca-grade.js']);
});

test('사례 id 리터럴 금지: rca/·CLI에 syn-xxxxxx 형태의 하드코딩 id가 없다', () => {
  for (const file of [...rcaFiles, ...cliFiles]) {
    assert.ok(!/syn-[0-9a-f]{6}/.test(read(file)), rel(file));
  }
});

test('보고 수치 리터럴 금지: rca/·기준선 CLI에 사용자 보고 수치(단어 경계)를 박지 않았다', () => {
  const files = [...rcaFiles, ...cliFiles.filter((f) => f.includes('rca-baseline'))];
  for (const file of files) {
    assert.ok(!/\b119\b|\b120\b/.test(read(file)), rel(file));
  }
});

test('출처 필드는 provenance를 쓴다: 코드에 source 키가 없다 (운영 monitors.source와 혼동 방지)', () => {
  for (const file of [...rcaFiles, ...cliFiles]) {
    const code = read(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/['"]?\bsource\b['"]?\s*:/.test(code), rel(file));
  }
});

test('기준선 CLI는 정답을 분석 뒤에 읽는다: 정답 읽기(--answers)가 analyzeAll 호출보다 뒤에 나온다', () => {
  const text = read(cliFiles.find((f) => f.includes('rca-baseline')));
  const analyze = text.indexOf('analyzeAll(input');
  const readAnswers = text.indexOf("readLocalJson(args.answers");
  const freeze = text.indexOf('deepFreeze(perCase)');
  assert.ok(analyze > 0 && freeze > analyze && readAnswers > freeze);
});

test('fixture 균일성: 모든 사례의 두 채널에 마감 뒤 관측 수가 같고, 추가 관측 한도 이상이다', () => {
  const counts = new Set();
  for (const c of loadCases()) {
    for (const channel of ['doh', 'http']) {
      const hidden = c.observations.filter((o) => o.channel === channel && o.observed_at > c.initial_cutoff_rel[channel]).length;
      assert.ok(hidden >= DEFAULT_LIMITS.maxAdditionalObservations, `${c.case_id}/${channel}: ${hidden}`);
      counts.add(hidden);
    }
  }
  // 사례·채널마다 숨은 관측 수가 다르면 요청을 시도해 보는 것만으로 사례 군이 구분된다
  assert.equal(counts.size, 1, [...counts].join(','));
});
