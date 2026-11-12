// 데이터 준비 스크립트(scripts/prepare-datasets)의 순수 함수와, 저장소에 올린 생성 파일(seed/replay)을 검증한다
//
// 원본 데이터(수십 MB)는 저장소에 없으므로 이 테스트는 원본 없이 돌아갑니다:
//   1) lib.mjs의 계산을 작은 가짜 입력으로 확인
//   2) 이미 만들어 둔 seed/replay/*.sql 을 가짜 D1에 적용해 모양·개수·값 범위를 확인
//   3) 재생 값이 정말로 "장애 열림 → 복구"를 일으키는지 확인 (B-7의 완료 기준)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createFakeD1 } from './helpers/fake-d1.js';
import {
  quantile, round, parseSmdRows, parseLabelLines, parseInterpretation, segmentsOf, bestWindow, topDimensions,
  separation, runsAbove, pickBestDimension, parseNabCsv, parseNabWindows, labelByWindows, windowAround,
  parseCsvLine, addDays, chooseDiskGroup, dailyDiskSeries, sqlString, sqlNumber, buildDatasetsSql, buildSeriesSql,
} from '../scripts/prepare-datasets/lib.mjs';
import { downsample, buildReplayRow, baselineOf } from '../src/replay.js';
import { initialState, nextState, TRANSITION } from '../src/state.js';

const SEED = fileURLToPath(new URL('../seed/replay/', import.meta.url));

// ───────── SMD 읽기·구간 ─────────
test('parseSmdRows: 숫자 표를 읽고, 열 개수가 다르거나 숫자가 아니면 거부', () => {
  assert.deepEqual(parseSmdRows('0.1,0.2\n0.3,0.4\n'), [[0.1, 0.2], [0.3, 0.4]]);
  assert.throws(() => parseSmdRows('0.1,0.2\n0.3\n'), TypeError);
  assert.throws(() => parseSmdRows('0.1,abc\n'), TypeError);
});

test('parseLabelLines / parseInterpretation / segmentsOf', () => {
  assert.deepEqual(parseLabelLines('0\n1\n1\n0\n1\n'), [0, 1, 1, 0, 1]);
  assert.throws(() => parseLabelLines('0\n2\n'), TypeError);
  assert.deepEqual(parseInterpretation('15849-16368:1,9,10\n16963-17517:2\n'), [
    { start: 15849, end: 16368, dims: [1, 9, 10] },
    { start: 16963, end: 17517, dims: [2] },
  ]);
  assert.throws(() => parseInterpretation('abc\n'), TypeError);
  assert.deepEqual(segmentsOf([0, 1, 1, 0, 0, 1, 0, 1]), [[1, 2], [5, 5], [7, 7]]);
  assert.deepEqual(segmentsOf([0, 0]), []);
});

test('bestWindow: 이상 구간을 통째로 가장 많이 담는 창 (동점이면 앞쪽)', () => {
  const segs = [[100, 110], [300, 310], [320, 330], [900, 905]];
  // 40~340 창에 [100,110]·[300,310]·[320,330] 셋이 통째로 들어간다 (0~300 창은 하나뿐)
  assert.deepEqual(bestWindow(segs, 1000, 300, 10), { start: 40, count: 3 });
  assert.throws(() => bestWindow(segs, 100, 300), RangeError);
});

test('topDimensions: 창 안의 이상 구간에서 원인으로 자주 꼽힌 지표 순', () => {
  const interp = [
    { start: 10, end: 20, dims: [3, 5] },
    { start: 30, end: 40, dims: [3, 7] },
    { start: 500, end: 510, dims: [9] }, // 창 밖
  ];
  assert.deepEqual(topDimensions(interp, [0, 100], 3), [
    { dim: 3, count: 2 }, { dim: 5, count: 1 }, { dim: 7, count: 1 },
  ]);
});

test('quantile / round', () => {
  assert.equal(quantile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4], 1), 4);
  assert.throws(() => quantile([], 0.5), RangeError);
  assert.equal(round(1.234567, 2), 1.23);
});

test('separation: 이상 값이 정상 99% 지점을 넘는 비율', () => {
  const values = [...Array(100).fill(1), 5, 5, 0.5, 0.5];
  const labels = [...Array(100).fill(0), 1, 1, 1, 1];
  const s = separation(values, labels);
  assert.equal(s.normalP99, 1);
  assert.equal(s.hitRate, 0.5);
  assert.equal(separation([1, 2], [0, 0]), null);
});

test('runsAbove: 기준을 넘는 칸이 2개 이상 이어진 덩어리만', () => {
  assert.deepEqual(runsAbove([0, 5, 0, 5, 5, 5, 0, 5], 1), [[3, 5]]);
  assert.deepEqual(runsAbove([5, 5], 1), [[0, 1]]);
  assert.deepEqual(runsAbove([5, 0, 5], 1, 1), [[0, 0], [2, 2]]);
});

test('pickBestDimension: 이상 구간에서 길게 튀는 지표를 고르고, 헛경보 많은 지표는 피한다', () => {
  // 열0: 이상과 무관하게 2칸짜리 튐이 5번(헛경보 5개), 열1: 이상 구간(11칸)에서만 길게 큼
  // (기준 th = 값의 99% 지점이라, 이상이 전체의 1% 안쪽이어야 "넘는 칸"이 생깁니다. 실제 SMD도 이상은 몇 % 이하)
  const n = 2000;
  const labels = Array.from({ length: n }, (_, i) => (i >= 100 && i < 111 ? 1 : 0));
  const spikes = new Set([300, 301, 600, 601, 900, 901, 1200, 1201, 1500, 1501]);
  const rows = Array.from({ length: n }, (_, i) => [spikes.has(i) ? 1 : 0, labels[i] ? 1 : 0.1]);
  const best = pickBestDimension(rows, labels, (pts) => pts); // 줄이지 않고 그대로
  assert.equal(best.dim, 2);
  assert.equal(best.detected, 1);
  assert.equal(best.falseRuns, 0);
});

// ───────── NAB ─────────
test('parseNabCsv / parseNabWindows / labelByWindows / windowAround', () => {
  const pts = parseNabCsv('timestamp,value\n2013-12-10 06:00:00,70.5\n2013-12-10 06:05:00,71\n2013-12-10 06:10:00,3\n2013-12-10 06:15:00,72\n');
  assert.equal(pts.length, 4);
  assert.deepEqual(pts[0], { ts: '2013-12-10 06:00:00', value: 70.5 });
  assert.throws(() => parseNabCsv('time,val\n'), TypeError);
  assert.throws(() => parseNabCsv('timestamp,value\nbad,1\n'), TypeError);

  const w = parseNabWindows({ 'a.csv': [['2013-12-10 06:05:00.000000', '2013-12-10 06:10:00.000000']] }, 'a.csv');
  assert.deepEqual(w, [['2013-12-10 06:05:00', '2013-12-10 06:10:00']]);
  assert.throws(() => parseNabWindows({}, 'a.csv'), RangeError);

  const lab = labelByWindows(pts, w);
  assert.deepEqual(lab.map((p) => p.anomaly), [0, 1, 1, 0]); // 창 양 끝 포함
  assert.deepEqual(windowAround(lab, w, 0), [1, 2]);
  assert.deepEqual(windowAround(lab, w, 5), [0, 3]); // 여유는 데이터 끝에서 잘림
});

// ───────── Backblaze ─────────
test('parseCsvLine: 쉼표 구분과 따옴표 칸', () => {
  assert.deepEqual(parseCsvLine('a,b,,d'), ['a', 'b', '', 'd']);
  assert.deepEqual(parseCsvLine('a,"b,c","d""e"'), ['a', 'b,c', 'd"e']);
});

test('addDays: 월·연 경계와 음수', () => {
  assert.equal(addDays('2013-01-31', 1), '2013-02-01');
  assert.equal(addDays('2013-03-01', -1), '2013-02-28');
  assert.equal(addDays('2013-12-31', 1), '2014-01-01');
});

test('chooseDiskGroup: 같은 모델의 고장 2대 + 기간 내내 살아 있는 정상 6대', () => {
  const failures = [
    { serial: 'F1', model: 'M', date: '2013-05-10' },
    { serial: 'F2', model: 'M', date: '2013-05-20' },
    { serial: 'X1', model: 'OTHER', date: '2013-05-11' },
  ];
  const seen = new Map();
  seen.set('F1', { model: 'M', first: '2013-04-10', last: '2013-05-10' });
  seen.set('F2', { model: 'M', first: '2013-04-10', last: '2013-05-20' });
  for (let i = 1; i <= 8; i += 1) seen.set(`H${i}`, { model: 'M', first: '2013-04-10', last: '2013-12-31' });
  seen.set('SHORT', { model: 'M', first: '2013-05-15', last: '2013-12-31' }); // 시작 전에 없던 드라이브는 제외
  seen.set('O1', { model: 'OTHER', first: '2013-04-10', last: '2013-12-31' });

  const g = chooseDiskGroup(failures, seen, { days: 60, nFailed: 2, nHealthy: 6 });
  assert.equal(g.model, 'M');
  assert.equal(g.start, '2013-05-03'); // 첫 고장 7일 전
  assert.deepEqual(g.failed, ['F1', 'F2']);
  assert.deepEqual(g.healthy, ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

  // 조건을 못 채우면 null
  assert.equal(chooseDiskGroup(failures, seen, { days: 5, nFailed: 2, nHealthy: 6 }), null);
  assert.equal(chooseDiskGroup(failures, seen, { days: 60, nFailed: 2, nHealthy: 99 }), null);
});

test('dailyDiskSeries: 날짜별 불량 섹터 합계와 고장 표시', () => {
  const byDate = new Map([
    ['2013-05-01', [{ serial: 'a', smart5: 0, failure: 0 }, { serial: 'b', smart5: 4, failure: 0 }]],
    ['2013-05-02', [{ serial: 'a', smart5: NaN, failure: 0 }, { serial: 'b', smart5: 6, failure: 1 }]],
  ]);
  assert.deepEqual(dailyDiskSeries(byDate, ['2013-05-01', '2013-05-02', '2013-05-03']), [
    { value: 4, anomaly: 0 }, { value: 6, anomaly: 1 }, { value: 0, anomaly: 0 },
  ]);
});

// ───────── SQL 만들기 ─────────
test('sqlString: 작은따옴표 이스케이프, NUL·비문자열 거부 / sqlNumber: 유한한 숫자만', () => {
  assert.equal(sqlString("it's"), "'it''s'");
  assert.equal(sqlString("'; DROP TABLE monitors; --"), "'''; DROP TABLE monitors; --'");
  assert.throws(() => sqlString('a\0b'), TypeError);
  assert.throws(() => sqlString(5), TypeError);
  assert.equal(sqlNumber(1.5), '1.5');
  assert.throws(() => sqlNumber(NaN), TypeError);
  assert.throws(() => sqlNumber(Infinity), TypeError);
});

test('악의적인 문자열도 SQL 안에서 글자로만 저장된다', () => {
  const db = createFakeD1();
  const evil = "x'); DROP TABLE monitors; --";
  db.sqlite.exec(buildDatasetsSql([{ key: 'evil', name: evil, url: 'u', license: 'l', processing: 'p', kind: 'lab', citation: null }]));
  assert.equal(db.sqlite.prepare("SELECT name FROM datasets WHERE key = 'evil'").get().name, evil);
  assert.ok(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'monitors'").get().n === 1);
});

test('buildDatasetsSql: 구분 값 검증, 다시 실행해도 1행 (UPSERT)', () => {
  assert.throws(() => buildDatasetsSql([{ key: 'k', name: 'n', url: 'u', license: 'l', processing: 'p', kind: 'sample' }]), RangeError);
  const db = createFakeD1();
  const sql = buildDatasetsSql([{ key: 'k', name: 'n', url: 'u', license: 'l', processing: 'p', kind: 'lab', citation: null }]);
  db.sqlite.exec(sql);
  db.sqlite.exec(sql.replace("'n'", "'n2'"));
  const rows = db.sqlite.prepare("SELECT name FROM datasets WHERE key = 'k'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'n2');
});

function dbWithMonitor(checkKey) {
  const db = createFakeD1();
  db.sqlite.prepare("INSERT INTO monitors (name, kind, url, source, is_active, check_key) VALUES ('t', 'replay', 'replay://t', 'replay', 0, ?)").run(checkKey);
  return db;
}

test('buildSeriesSql: 문장을 나눠 모두 들어가고, 다시 실행해도 같은 결과 (순번·NULL 라벨 포함)', () => {
  const pts = Array.from({ length: 1000 }, (_, i) => ({ value: i / 7, anomaly: i % 100 === 0 ? 1 : i % 2 ? 0 : null }));
  const sql = buildSeriesSql('k1', pts, { chunk: 400 });
  assert.equal((sql.match(/^INSERT INTO replay_series/gm) ?? []).length, 3); // 400 + 400 + 200

  const db = dbWithMonitor('k1');
  db.sqlite.exec(sql);
  db.sqlite.exec(sql); // 두 번 실행
  const rows = db.sqlite.prepare('SELECT seq, value, is_anomaly FROM replay_series ORDER BY seq').all();
  assert.equal(rows.length, 1000);
  assert.equal(rows[0].seq, 0);
  assert.equal(rows[999].seq, 999);
  assert.equal(rows[100].is_anomaly, 1);
  assert.equal(rows[2].is_anomaly, null);
  assert.equal(rows[7].value, 1); // 7/7
});

test('buildSeriesSql: 대상이 없으면 아무 것도 넣지 않는다 (다른 대상 데이터를 건드리지 않음)', () => {
  const db = dbWithMonitor('other');
  db.sqlite.exec(buildSeriesSql('other', [{ value: 1, anomaly: 0 }]));
  db.sqlite.exec(buildSeriesSql('missing', [{ value: 9, anomaly: 0 }]));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM replay_series').get().n, 1);
});

// ───────── 저장소에 올린 생성 파일 검증 ─────────
const manifest = JSON.parse(readFileSync(join(SEED, 'manifest.json'), 'utf8'));

/** B-7d가 할 일을 흉내: 데이터셋 적재 → 대상 등록 → 시계열 적재 */
function loadedDb() {
  const db = createFakeD1();
  db.sqlite.exec(readFileSync(join(SEED, 'datasets.sql'), 'utf8'));
  for (const m of manifest.monitors) {
    db.sqlite.prepare(
      "INSERT INTO monitors (name, kind, url, source, is_active, check_key, dataset_id) VALUES (?, 'replay', ?, 'replay', 0, ?, (SELECT id FROM datasets WHERE key = ?))"
    ).run(m.name, `replay://${m.checkKey}`, m.checkKey, m.datasetKey);
    db.sqlite.exec(readFileSync(join(SEED, m.file), 'utf8'));
  }
  return db;
}

test('manifest: 대상 키가 유일하고, 필수 항목과 규칙 모양이 올바르다', () => {
  assert.ok(manifest.monitors.length >= 5);
  assert.equal(new Set(manifest.monitors.map((m) => m.checkKey)).size, manifest.monitors.length);
  for (const m of manifest.monitors) {
    assert.match(m.checkKey, /^replay-[a-z0-9-]+$/);
    assert.ok(m.name && m.metric && m.description, m.checkKey);
    assert.ok([5, 1440].includes(m.stepMinutes), m.checkKey);
    assert.ok(Number.isInteger(m.length) && m.length > 0, m.checkKey);
    assert.ok(manifest.datasets.includes(m.datasetKey), m.checkKey);
    assert.ok(['high', 'deviation', 'ratio', 'smart'].includes(m.rule.type), m.checkKey);
    if (m.rule.type === 'high') assert.ok(m.rule.slowAt < m.rule.failAt, m.checkKey);
    if (m.rule.type === 'deviation') assert.ok(Number.isFinite(m.baseline) && m.baseline !== 0, m.checkKey);
    assert.ok(!/serial|MJ0|시리얼 번호:/.test(m.description), '드라이브 시리얼 번호를 기록하지 않음');
  }
});

test('생성된 SQL을 적용하면 매니페스트의 길이와 같은 행이 순번 0부터 빠짐없이 들어간다', () => {
  const db = loadedDb();
  for (const m of manifest.monitors) {
    const rows = db.sqlite.prepare(
      'SELECT seq, value, is_anomaly FROM replay_series WHERE monitor_id = (SELECT id FROM monitors WHERE check_key = ?) ORDER BY seq'
    ).all(m.checkKey);
    assert.equal(rows.length, m.length, m.checkKey);
    rows.forEach((r, i) => {
      assert.equal(r.seq, i);
      assert.ok(Number.isFinite(r.value));
      assert.ok(r.is_anomaly === 0 || r.is_anomaly === 1 || r.is_anomaly === null);
    });
    assert.ok(rows.some((r) => r.is_anomaly === 1), `${m.checkKey}에 이상 라벨이 있어야 함`);
  }
});

test('데이터셋 메타: 3종 모두 있고, 라이선스·가공 방법·출처 링크가 비어 있지 않다 (Backblaze를 MIT로 적지 않음)', () => {
  const db = loadedDb();
  const ds = db.sqlite.prepare('SELECT * FROM datasets ORDER BY key').all();
  assert.deepEqual(ds.map((d) => d.key), ['backblaze', 'nab', 'smd']);
  for (const d of ds) {
    assert.match(d.url, /^https:\/\//);
    assert.ok(d.license.length > 10 && d.processing.length > 30, d.key);
    assert.equal(d.kind, 'real_replay');
  }
  const bb = ds.find((d) => d.key === 'backblaze');
  assert.ok(!bb.license.startsWith('MIT'), 'Backblaze는 자체 이용 조건');
  assert.match(bb.license, /Backblaze/);
  assert.match(bb.citation, /Backblaze/);
});

test('SMD 값은 0~100% 안, 모든 대상의 시리즈에 NULL 값이 없다', () => {
  const db = loadedDb();
  const smd = db.sqlite.prepare(
    "SELECT MIN(value) AS lo, MAX(value) AS hi FROM replay_series WHERE monitor_id IN (SELECT id FROM monitors WHERE check_key LIKE 'replay-smd-%')"
  ).get();
  assert.ok(smd.lo >= 0 && smd.hi <= 100, `${smd.lo} ~ ${smd.hi}`);
});

test('B-7 완료 기준: 모든 재생 대상에서 장애가 열리고 닫힌다 (한 바퀴 + 처음으로 돌아가는 부분까지, 기존 연속 2회 판정 사용)', () => {
  const db = loadedDb();
  for (const m of manifest.monitors) {
    const rows = db.sqlite.prepare(
      'SELECT value, is_anomaly FROM replay_series WHERE monitor_id = (SELECT id FROM monitors WHERE check_key = ?) ORDER BY seq'
    ).all(m.checkKey);
    const baseline = m.rule.type === 'deviation' ? m.baseline : undefined;

    // 시리즈가 이상 구간으로 끝나는 경우(예: DB 서버)에는 처음으로 돌아간 뒤에야 복구되므로 두 바퀴를 돌립니다.
    // 실제 재생도 끝에서 처음으로 돌아가며 계속되기 때문입니다.
    // 하루 단위 데이터(디스크)는 한 값이 하루(288회) 동안 유지되므로, 5분 점검 횟수만큼 반복해서 넣습니다.
    const repeat = m.stepMinutes / 5;
    const expanded = rows.flatMap((r) => Array(repeat).fill(r));
    const twoLoops = [...expanded, ...expanded];
    let state = initialState();
    const transitions = [];
    twoLoops.forEach((r, i) => {
      const row = buildReplayRow({
        monitorId: 1,
        checkedAt: `t${i}`,
        value: r.value,
        rule: m.rule,
        baseline,
        failed: m.rule.type === 'smart' && r.is_anomaly === 1, // 디스크는 데이터가 기록한 고장 표시만 사용
      });
      const res = nextState(state, row.isSuccess, row.checkedAt);
      state = res.next;
      if (res.transition) transitions.push(res.transition);
    });
    assert.ok(transitions.includes(TRANSITION.DOWN), `${m.checkKey}: 장애가 한 번도 안 열림`);
    assert.ok(transitions.includes(TRANSITION.RECOVERED), `${m.checkKey}: 복구가 한 번도 없음`);
  }
});

test('재생 기준값 자체는 라벨 없이 시리즈 값만으로 정해졌다 (SMD: 95·99% 지점, NAB: 중앙값)', () => {
  const db = loadedDb();
  for (const m of manifest.monitors.filter((x) => x.rule.type === 'high')) {
    const values = db.sqlite.prepare(
      'SELECT value FROM replay_series WHERE monitor_id = (SELECT id FROM monitors WHERE check_key = ?)'
    ).all(m.checkKey).map((r) => r.value);
    assert.equal(m.rule.failAt, round(quantile(values, 0.99), 2), m.checkKey);
    assert.equal(m.rule.slowAt, round(quantile(values, 0.95), 2), m.checkKey);
  }
  const nab = manifest.monitors.find((x) => x.rule.type === 'deviation');
  const values = db.sqlite.prepare(
    'SELECT value FROM replay_series WHERE monitor_id = (SELECT id FROM monitors WHERE check_key = ?)'
  ).all(nab.checkKey).map((r) => r.value);
  assert.equal(nab.baseline, round(baselineOf(values), 2));
});

test('downsample 재확인: SMD처럼 5개씩 묶은 최댓값/이상 라벨 합치기 (스크립트가 쓰는 방식)', () => {
  const out = downsample([0.1, 0.9, 0.2, 0.3, 0.4, 0.5, 0.1, 0.2, 0.3, 0.4].map((value, i) => ({ value, anomaly: i === 1 ? 1 : 0 })), 5, 'max');
  assert.deepEqual(out.map((p) => p.value), [0.9, 0.5]);
  assert.deepEqual(out.map((p) => p.anomaly), [1, 0]);
});
