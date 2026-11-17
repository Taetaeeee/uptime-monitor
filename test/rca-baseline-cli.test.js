// 기준선 CLI 테스트 — 임시 폴더에 만든 작은 입력으로 실제 프로세스를 실행한다.
// 저장소 안에는 아무것도 쓰지 않고, 네트워크도 쓰지 않는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'rca-baseline', 'run.mjs');
const TIME = [996, 997, 998, 999, 1000, 1001, 1002, 1003, 1004];
const step = (b, a) => [b, b, b, b, a, a, a, a, a];
const mk = (key, columns) => ({ case_key: key, inject_time: 1000, sample_interval_sec: 1, time: TIME, columns });

let dir;
const file = (name, value) => {
  const p = join(dir, name);
  writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value));
  return p;
};
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

const INPUT = {
  schema_version: 1, dataset_label: '테스트 입력',
  cases: [
    mk('k0001', { a_cpu: step(10, 20), b_cpu: step(5, 6) }),   // 예측 a
    mk('k0002', { a_cpu: step(1, 2), b_cpu: step(1, 9) }),     // 예측 b
    mk('k0003', { a_cpu: step(1, 2) }),                         // 자료 부족
  ],
};
const SHORT_CONFIG = { preWindowSec: 4, postWindowSec: 4 };

before(() => { dir = mkdtempSync(join(tmpdir(), 'rca-baseline-')); });
after(() => { rmSync(dir, { recursive: true, force: true }); });

test('정답 없이 실행: scored:false, 출력 스키마와 N/A/S, 조건 표기, 재현 미확인', () => {
  const r = run('--input', file('in.json', INPUT), '--config', file('cfg.json', SHORT_CONFIG));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.tool, 'rca-baseline');
  assert.equal(out.scored, false);
  assert.equal(out.scoring, null);
  assert.equal(out.data_origin, 'user_declared'); // 어느 벤치마크의 원본이라고 단정하지 않음
  assert.deepEqual([out.counts.N, out.counts.A, out.counts.S], [3, 2, 1]);
  assert.match(out.summary_line, /N 3 \/ A 2 \/ S 1/);
  assert.match(out.summary_line, /채점 안 함/);
  assert.equal(out.condition.inject_time_provided, true);
  assert.equal(out.condition.fault_type_provided, 'cohort-level cpu');
  assert.equal(out.reproduction.settings_match_original, 'unknown');
  assert.equal(out.reproduction.verified_against_original, false);
  assert.equal(out.settings.status.preWindowSec, 'user_specified');
  assert.equal(out.settings.status.gapSec, 'unconfirmed_default');
  assert.deepEqual(out.predictions.map((p) => [p.case_key, p.status, p.predicted]),
    [['k0001', 'analyzed', 'a'], ['k0002', 'analyzed', 'b'], ['k0003', 'insufficient', null]]);
});

test('정답 없음 / 있음 / 값 변경: 예측 필드는 모두 같고 채점 결과만 달라진다', () => {
  const input = file('in2.json', INPUT);
  const cfg = file('cfg2.json', SHORT_CONFIG);
  const none = JSON.parse(run('--input', input, '--config', cfg).stdout);
  const right = JSON.parse(run('--input', input, '--config', cfg, '--answers', file('ans1.json', { k0001: 'a', k0002: 'b' })).stdout);
  const wrong = JSON.parse(run('--input', input, '--config', cfg, '--answers', file('ans2.json', { k0001: 'b', k0002: 'a' })).stdout);
  assert.deepEqual(right.predictions, none.predictions);
  assert.deepEqual(wrong.predictions, none.predictions);
  assert.deepEqual(right.counts, none.counts);
  assert.equal(right.scored, true);
  assert.deepEqual([right.scoring.correct, right.scoring.wrong], [2, 0]);
  assert.deepEqual([wrong.scoring.correct, wrong.scoring.wrong], [0, 2]);
  assert.equal(right.scoring.identity_ok, true);
  assert.notDeepEqual(right.scoring, wrong.scoring);
});

test('설정 파일이 결과를 바꾼다 (창 길이를 늘리면 구간 부족으로 분석 가능 수가 줄어든다)', () => {
  const input = file('in3.json', INPUT);
  const base = JSON.parse(run('--input', input, '--config', file('c3a.json', SHORT_CONFIG)).stdout);
  const wide = JSON.parse(run('--input', input, '--config', file('c3b.json', { preWindowSec: 8, postWindowSec: 4 })).stdout);
  assert.equal(base.counts.A, 2);
  assert.equal(wide.counts.A, 0);
  assert.equal(wide.counts.S_reasons.insufficient_comparison_window, 3); // 자료 부족 사례(k0003)도 같은 사유로 센다
});

test('CSV·Parquet·URL·그 밖의 확장자는 종료 코드 2와 변환 안내, 파일을 받아 오지 않는다', () => {
  for (const target of ['data.csv', 'data.parquet', 'https://example.invalid/data.json', 'http://example.invalid/x', 'data.txt']) {
    const r = run('--input', target);
    assert.equal(r.status, 2, target);
    assert.match(r.stderr, /JSON/);
    assert.equal(r.stdout, '');
  }
  assert.equal(run('--input', file('in4.json', INPUT), '--answers', 'https://example.invalid/a.json').status, 2);
});

test('입력 거부: 금지 키는 종료 코드 3, 없는 파일·깨진 JSON·인자 오류는 1', () => {
  const leaked = structuredClone(INPUT);
  leaked.cases[0].root_cause = 'a';
  const r = run('--input', file('leak.json', leaked));
  assert.equal(r.status, 3);
  assert.match(r.stderr, /forbidden_key/);
  assert.equal(r.stdout, '');

  assert.equal(run('--input', join(dir, 'missing.json')).status, 1);
  assert.equal(run('--input', file('broken.json', '{ not json')).status, 1);
  assert.equal(run().status, 1);
  assert.equal(run('--input', file('in5.json', INPUT), '--whatever', 'x').status, 1);
  assert.equal(run('--input', file('in6.json', INPUT), '--config', file('badcfg.json', { preWindowSecs: 1 })).status, 1);
  assert.equal(run('--input', file('in7.json', INPUT), '--answers', file('badans.json', ['a'])).status, 1);
});

test('실행이 입력 폴더에 파일을 만들지 않는다 (출력은 표준 출력뿐)', () => {
  const before = existsSync(join(dir, 'result.json'));
  run('--input', file('in8.json', INPUT));
  assert.equal(before, false);
  assert.equal(existsSync(join(dir, 'result.json')), false);
});
