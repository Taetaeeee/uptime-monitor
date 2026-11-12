// B-7f 컷오버용 SQL 검증: 데모 정리, 시뮬레이터 디스크 정리, 재생 되돌리기(unload)
//
// 운영 DB와 같은 모양의 가짜 D1을 만든다:
//   실제 대상(마이그레이션) + 데모(seed/sample.sql) + 시뮬레이터 5개(+ 기록) + 재생 대상 5개(+ 24시간치 기록)
// 그리고 각 SQL이 "지우려는 것만" 지우고 나머지는 그대로 두는지 확인한다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createFakeD1 } from './helpers/fake-d1.js';
import { runReplay } from '../src/replay-run.js';
import { toCheckSlot } from '../src/time.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const manifest = JSON.parse(read('seed/replay/manifest.json'));
const STEP = 5 * 60_000;

/** 운영과 비슷한 DB (재생은 24시간치를 미리 돌려 둠) */
async function productionLikeDb() {
  const db = createFakeD1();
  const x = (sql) => db.sqlite.exec(sql);
  x(read('seed/sample.sql'));
  x(read('seed/simulator-monitors.sql'));

  // 시뮬레이터 기록: 디스크는 열린 장애까지, DB 포트는 정상 기록
  for (const key of ['sim-fileserver-disk', 'sim-db-tcp']) {
    const id = db.sqlite.prepare('SELECT id FROM monitors WHERE check_key = ?').get(key).id;
    x(`
      INSERT INTO check_results (monitor_id, checked_at, is_success, source) VALUES (${id}, '2026-11-10T08:00:00Z', 1, 'simulator');
      INSERT INTO monitor_state (monitor_id, state, last_checked_at) VALUES (${id}, 'up', '2026-11-10T08:00:00Z');
      INSERT INTO daily_stats (monitor_id, day, total_checks, success_checks, slow_checks, source, updated_at)
        VALUES (${id}, '2026-11-10', 1, 1, 0, 'simulator', '2026-11-10T08:00:00Z');
      INSERT INTO notifications (monitor_id, event, channel, message, created_at, source)
        VALUES (${id}, 'down', 'log', '시뮬레이터 장애', '2026-11-10T08:05:00Z', 'simulator');
      INSERT INTO incidents (monitor_id, started_at, detected_at, source)
        VALUES (${id}, '2026-11-10T08:00:00Z', '2026-11-10T08:05:00Z', 'simulator');
      INSERT INTO maintenance_windows (monitor_id, title, starts_at, ends_at, source, created_at)
        VALUES (${id}, '시뮬 작업', '2026-11-20T00:00:00Z', '2026-11-20T01:00:00Z', 'simulator', '2026-11-10T00:00:00Z');
    `);
  }
  // 실제 대상 기록 1건
  const realId = db.sqlite.prepare("SELECT id FROM monitors WHERE source = 'real' LIMIT 1").get().id;
  x(`INSERT INTO check_results (monitor_id, checked_at, is_success, source) VALUES (${realId}, '2026-11-11T00:00:00Z', 1, 'real')`);

  // 재생 적재(컷오버 4단계를 흉내) + 24시간치
  x(read('seed/replay/datasets.sql'));
  x(read('seed/replay/monitors.sql'));
  for (const m of manifest.monitors) x(read(`seed/replay/${m.file}`));
  const T0 = Date.parse(toCheckSlot(new Date()));
  for (let k = 0; k < 288; k += 1) await runReplay(db, new Date(T0 + k * STEP));
  return { db, T0 };
}

/** 표마다 출처별 행 수. monitor_state·replay_*는 대상의 출처로 센다 */
function snapshot(db) {
  const out = {};
  for (const t of ['monitors', 'check_results', 'daily_stats', 'notifications', 'incidents', 'maintenance_windows']) {
    out[t] = Object.fromEntries(db.sqlite.prepare(`SELECT source, COUNT(*) AS n FROM ${t} GROUP BY source`).all().map((r) => [r.source, r.n]));
  }
  for (const t of ['monitor_state', 'replay_series', 'replay_config']) {
    const col = t === 'monitor_state' || t === 'replay_series' || t === 'replay_config' ? 'monitor_id' : '';
    out[t] = Object.fromEntries(
      db.sqlite.prepare(`SELECT m.source, COUNT(*) AS n FROM ${t} x JOIN monitors m ON m.id = x.${col} GROUP BY m.source`).all().map((r) => [r.source, r.n])
    );
  }
  out.datasets = { _: db.sqlite.prepare('SELECT COUNT(*) AS n FROM datasets').get().n };
  return out;
}

/** snapshot에서 특정 출처를 빼고 비교하기 위한 복사본 */
function without(snap, source) {
  return Object.fromEntries(Object.entries(snap).map(([t, bySource]) => [t, Object.fromEntries(Object.entries(bySource).filter(([s]) => s !== source))]));
}

test('준비 확인: 운영과 비슷한 DB에 네 가지 출처가 모두 있다', async () => {
  const { db } = await productionLikeDb();
  const s = snapshot(db);
  for (const src of ['real', 'sample', 'simulator', 'replay']) assert.ok(s.monitors[src] > 0, src);
  assert.ok(s.check_results.replay >= 288 * manifest.monitors.length);
});

test('retire-demo.sql: 데모(sample)만 모든 표에서 사라지고, 나머지 출처는 그대로이며, 다시 실행해도 안전하다', async () => {
  const { db } = await productionLikeDb();
  const before = snapshot(db);
  db.sqlite.exec(read('seed/retire-demo.sql'));
  const after = snapshot(db);

  for (const [t, bySource] of Object.entries(after)) assert.equal(bySource.sample ?? 0, 0, `${t}에 sample이 남음`);
  assert.deepEqual(after, without(before, 'sample'));
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);

  db.sqlite.exec(read('seed/retire-demo.sql')); // 두 번째 실행도 오류 없이 같은 결과
  assert.deepEqual(snapshot(db), after);
});

test('retire-simulator-disk.sql: 디스크 시뮬레이터와 그 기록만 지우고, DB 포트 시뮬레이터·실제·재생은 그대로', async () => {
  const { db } = await productionLikeDb();
  const count = (sql, ...p) => db.sqlite.prepare(sql).get(...p).n;
  const diskId = db.sqlite.prepare("SELECT id FROM monitors WHERE check_key = 'sim-fileserver-disk'").get().id;
  const dbId = db.sqlite.prepare("SELECT id FROM monitors WHERE check_key = 'sim-db-tcp'").get().id;
  const before = snapshot(db);

  db.sqlite.exec(read('seed/retire-simulator-disk.sql'));

  assert.equal(count("SELECT COUNT(*) AS n FROM monitors WHERE check_key = 'sim-fileserver-disk'"), 0);
  for (const t of ['check_results', 'monitor_state', 'daily_stats', 'notifications', 'incidents', 'maintenance_windows']) {
    assert.equal(count(`SELECT COUNT(*) AS n FROM ${t} WHERE monitor_id = ?`, diskId), 0, t);
    assert.equal(count(`SELECT COUNT(*) AS n FROM ${t} WHERE monitor_id = ?`, dbId), 1, `${t}: DB 포트 시뮬레이터는 그대로`);
  }
  const after = snapshot(db);
  assert.equal(after.monitors.simulator, before.monitors.simulator - 1);
  assert.deepEqual({ ...after, monitors: null, check_results: null, daily_stats: null, notifications: null, incidents: null, maintenance_windows: null, monitor_state: null },
    { ...before, monitors: null, check_results: null, daily_stats: null, notifications: null, incidents: null, maintenance_windows: null, monitor_state: null });
  assert.equal(after.replay_series.replay, before.replay_series.replay);
  assert.equal(after.check_results.real, before.check_results.real);
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

test('unload.sql: 재생 대상과 기록·설정·시계열·데이터셋만 지우고, 지운 뒤 다시 적재해 돌릴 수 있다', async () => {
  const { db, T0 } = await productionLikeDb();
  const before = snapshot(db);
  assert.ok(before.replay_config.replay > 0);

  db.sqlite.exec(read('seed/replay/unload.sql'));
  const after = snapshot(db);

  for (const [t, bySource] of Object.entries(after)) assert.equal(bySource.replay ?? 0, 0, `${t}에 replay가 남음`);
  assert.equal(after.datasets._, 0);
  assert.deepEqual({ ...after, datasets: null }, { ...without(before, 'replay'), datasets: null });
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);

  // 다시 적재 → 재생이 처음부터 정상 동작
  db.sqlite.exec(read('seed/replay/datasets.sql'));
  db.sqlite.exec(read('seed/replay/monitors.sql'));
  for (const m of manifest.monitors) db.sqlite.exec(read(`seed/replay/${m.file}`));
  const rows = await runReplay(db, new Date(T0 + 1000 * STEP));
  assert.equal(rows.length, manifest.monitors.length);
});

test('전체 컷오버 순서(데모 정리 → 디스크 정리)를 거친 뒤에도 재생은 계속 기록된다', async () => {
  const { db, T0 } = await productionLikeDb();
  db.sqlite.exec(read('seed/retire-demo.sql'));
  db.sqlite.exec(read('seed/retire-simulator-disk.sql'));
  const before = db.sqlite.prepare("SELECT COUNT(*) AS n FROM check_results WHERE source = 'replay'").get().n;
  await runReplay(db, new Date(T0 + 400 * STEP));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM check_results WHERE source = 'replay'").get().n, before + manifest.monitors.length);
  // 실제 5 = 고쳐라! 2 + 사내 메신저 3(0011, 비활성)
  assert.deepEqual(snapshot(db).monitors, { real: 5, simulator: 4, replay: 5 });
});
