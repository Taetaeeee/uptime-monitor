// 합성 데모 CLI 테스트 — 실제 프로세스를 실행해 출력과 안전 경계를 확인한다. (네트워크·DB·파일 쓰기 없음)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReport, CASE_ID_RE } from '../rca/lib/case-schema.js';
import { loadCases, getKeyItem, gradeReport, leakStrings, OBSERVATIONS_DIR } from './helpers/rca-grade.js';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'rca-demo', 'run.mjs');
const FIXTURE_ROOT = join(OBSERVATIONS_DIR, '..');

let cwd;
before(() => { cwd = mkdtempSync(join(tmpdir(), 'rca-demo-')); });
after(() => { rmSync(cwd, { recursive: true, force: true }); });

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd });

function treeStamp(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? treeStamp(p) : [`${p}|${statSync(p).size}|${statSync(p).mtimeMs}`];
  }).sort();
}

test('--list: 사례 id만 한 줄씩 출력한다 (설명·번호·라벨 없음)', () => {
  const r = run('--list');
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 6);
  for (const line of lines) assert.match(line, CASE_ID_RE);
  assert.deepEqual(lines, loadCases().map((c) => c.case_id));
  for (const w of leakStrings()) assert.ok(!r.stdout.includes(w), w);
});

test('--case: 6개 사례 모두 계약을 통과하는 보고서를 내고, 정답 파일의 기대와 일치한다', () => {
  for (const c of loadCases()) {
    const r = run('--case', c.case_id);
    assert.equal(r.status, 0, `${c.case_id}: ${r.stderr}`);
    const report = JSON.parse(r.stdout);
    assert.equal(report.case_id, c.case_id);
    assert.equal(report.provenance, 'synthetic-simulation');
    assert.deepEqual(report.validation, { ok: true, problems: [] });
    assert.deepEqual(validateReport(report, structuredClone(report.evidence)), { ok: true, problems: [] });
    assert.equal(report.decision_policy.llm_executed, false);
    const graded = gradeReport(report, getKeyItem(c.case_id));
    assert.deepEqual(graded.problems, [], `${c.case_id}: ${graded.problems.join(',')}`);
    for (const w of leakStrings()) assert.ok(!r.stdout.includes(w), `${c.case_id}: ${w}`);
  }
});

test('같은 사례를 두 번 실행하면 출력이 같고(난수·시각 없음), 어느 폴더에서 실행해도 같다', () => {
  const id = loadCases()[0].case_id;
  const a = run('--case', id);
  const b = run('--case', id);
  assert.equal(a.stdout, b.stdout);
});

test('파일을 쓰지 않는다: 실행 폴더가 비어 있고 fixture 폴더가 그대로다', () => {
  const before = treeStamp(FIXTURE_ROOT);
  for (const c of loadCases()) run('--case', c.case_id);
  run('--list');
  assert.deepEqual(readdirSync(cwd), []);
  assert.deepEqual(treeStamp(FIXTURE_ROOT), before);
});

test('잘못된 사용은 종료 코드 1: 없는 사례·형식 오류·경로 조작 시도·인자 없음·섞어 쓰기', () => {
  for (const args of [
    ['--case', 'syn-ffffff'], ['--case', '../package.json'], ['--case', 'syn-1'], ['--case'],
    [], ['--list', '--case', 'syn-ffffff'], ['--whatever'], ['--case', 'obs-7f3a21.json'],
  ]) {
    const r = run(...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.equal(r.stdout, '', args.join(' '));
    assert.ok(r.stderr.length > 0);
  }
});
