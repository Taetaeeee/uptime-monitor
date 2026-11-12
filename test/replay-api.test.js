// /api/status가 재생 대상의 화면용 정보를 주는지 (B-7e)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createFakeD1 } from './helpers/fake-d1.js';
import { buildStatus, buildMonitorHistory, replayInfo } from '../src/api.js';
import { runReplay } from '../src/replay-run.js';
import { toCheckSlot } from '../src/time.js';

const SEED = fileURLToPath(new URL('../seed/replay/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(SEED, 'manifest.json'), 'utf8'));
const read = (f) => readFileSync(join(SEED, f), 'utf8');
const STEP = 5 * 60_000;

function loadedDb() {
  const db = createFakeD1();
  db.sqlite.exec(read('datasets.sql'));
  db.sqlite.exec(read('monitors.sql'));
  for (const m of manifest.monitors) db.sqlite.exec(read(m.file));
  return db;
}

test('replayInfo: 재생 대상이 아니면 null, 규칙 JSON은 객체로 풀고 깨진 규칙은 null', () => {
  assert.equal(replayInfo({ replayRule: null }), null);
  assert.equal(replayInfo({}), null);
  const ok = replayInfo({ replayRule: '{"type":"high","slowAt":1,"failAt":2}', replayMetric: '지표', replayUnit: '%', replayBaseline: null, datasetKey: 'smd' });
  assert.deepEqual(ok, { metric: '지표', unit: '%', rule: { type: 'high', slowAt: 1, failAt: 2 }, baseline: null, datasetKey: 'smd' });
  const broken = replayInfo({ replayRule: 'not json', replayMetric: '지표', replayUnit: '', replayBaseline: null, datasetKey: 'smd' });
  assert.equal(broken.rule, null); // 상태 페이지 전체가 죽지 않음
});

test('재생 대상이 없으면 datasets는 빈 객체이고 모든 서비스의 replay는 null', async () => {
  const body = await buildStatus(createFakeD1(), new Date());
  assert.deepEqual(body.datasets, {});
  assert.ok(body.services.every((s) => s.replay === null));
});

test('재생 대상: 지표 설명·단위·규칙·데이터셋 정보가 응답에 들어 있다', async () => {
  const db = loadedDb();
  const now = new Date();
  const T0 = Date.parse(toCheckSlot(now));
  for (let k = 0; k < 3; k += 1) await runReplay(db, new Date(T0 + k * STEP));

  const body = await buildStatus(db, now);
  const replays = body.services.filter((s) => s.source === 'replay');
  assert.equal(replays.length, manifest.monitors.length);

  for (const e of manifest.monitors) {
    const s = replays.find((x) => x.name === e.name && x.replay.metric === e.metric);
    assert.ok(s, e.checkKey);
    assert.equal(s.kind, 'replay');
    assert.equal(s.replay.unit, e.unit);
    assert.deepEqual(s.replay.rule, e.rule);
    assert.equal(s.replay.datasetKey, e.datasetKey);
    assert.ok(Number.isFinite(s.lastValue), '마지막 값이 숫자');
    // 데이터셋 상세: 화면의 "데이터 출처" 블록에 필요한 항목
    const d = body.datasets[e.datasetKey];
    assert.ok(d && d.name && /^https:\/\//.test(d.url) && d.license && d.processing, e.datasetKey);
  }
  assert.deepEqual(Object.keys(body.datasets).sort(), ['backblaze', 'nab', 'smd']);

  // 재생이 아닌 서비스(마이그레이션이 넣은 실제 대상)는 영향이 없다
  const real = body.services.filter((s) => s.source === 'real');
  assert.ok(real.length >= 1 && real.every((s) => s.replay === null));
});

test('규칙이 깨진 재생 대상이 있어도 상태 응답은 만들어진다', async () => {
  const db = loadedDb();
  db.sqlite.exec("UPDATE replay_config SET rule = 'broken' WHERE monitor_id = (SELECT id FROM monitors WHERE check_key = 'replay-smd-1-1')");
  const body = await buildStatus(db, new Date());
  const s = body.services.find((x) => x.name === '그룹웨어·메일');
  assert.equal(s.replay.rule, null);
  assert.ok(s.replay.metric);
});

test('재생 대상의 24시간 기록은 값(value)이 들어 있다 (그래프용)', async () => {
  const db = loadedDb();
  const now = new Date();
  const T0 = Date.parse(toCheckSlot(now));
  for (let k = 0; k < 5; k += 1) await runReplay(db, new Date(T0 + k * STEP));
  const id = db.sqlite.prepare("SELECT id FROM monitors WHERE check_key = 'replay-nab-machine-temp'").get().id;

  const h = await buildMonitorHistory(db, id, 24, new Date(T0 + 5 * STEP));
  assert.ok(h.points.length >= 5);
  assert.ok(h.points.every((p) => Number.isFinite(p.value)));
});
