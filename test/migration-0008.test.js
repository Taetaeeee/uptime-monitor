// 마이그레이션 0008(출처 'replay' 허용, 테이블 재생성) 테스트
//
// 핵심 확인: 이미 데이터가 들어 있는 DB에 0008을 적용해도
//   - 모든 행이 그대로 남고 (id·장애 번호·링크가 바뀌지 않음)
//   - 외래 키가 깨지지 않고
//   - 'replay'는 들어가지만 엉뚱한 출처는 여전히 거부되고
//   - 인덱스(특히 "열린 장애는 대상당 1건")가 그대로 살아 있는지
//
// 일부러 createFakeD1()을 쓰지 않습니다: 그 도우미는 0008까지 다 적용한 빈 DB를 주기 때문에,
// 여기서는 0001~0007만 적용 → 데이터 넣기 → 0008 적용 순서로 직접 만듭니다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const apply = (db, file) => db.exec(readFileSync(join(DIR, file), 'utf8'));

/** 0007까지 적용하고 출처가 다른 데이터를 골고루 넣은 DB */
function dbBefore0008() {
  const db = new DatabaseSync(':memory:'); // node:sqlite는 외래 키 검사가 기본으로 켜져 있음
  for (const f of FILES.filter((f) => f < '0008')) apply(db, f);

  db.exec(`
    INSERT INTO monitors (name, kind, url, source, is_active, check_key, threshold) VALUES
      ('시뮬 서비스', 'ping', 'ping://sim', 'simulator', 1, 'sim-ping', NULL),
      ('데모 서비스', 'http', 'https://demo.invalid', 'sample', 0, NULL, NULL);
  `);
  const real = db.prepare("SELECT id FROM monitors WHERE source = 'real' LIMIT 1").get().id;
  const sim = db.prepare("SELECT id FROM monitors WHERE name = '시뮬 서비스'").get().id;
  const demo = db.prepare("SELECT id FROM monitors WHERE name = '데모 서비스'").get().id;

  for (const [id, src] of [[real, 'real'], [sim, 'simulator'], [demo, 'sample']]) {
    db.exec(`
      INSERT INTO check_results (monitor_id, checked_at, is_success, is_slow, response_ms, source, value)
        VALUES (${id}, '2026-11-11T00:00:00Z', 1, 0, 120, '${src}', 1.5),
               (${id}, '2026-11-11T00:05:00Z', 0, 0, NULL, '${src}', NULL);
      INSERT INTO monitor_state (monitor_id, state, consecutive_failures, failing_since, last_checked_at)
        VALUES (${id}, 'down', 1, '2026-11-11T00:05:00Z', '2026-11-11T00:05:00Z');
      INSERT INTO daily_stats (monitor_id, day, total_checks, success_checks, slow_checks, avg_response_ms, source, updated_at, maintenance_checks)
        VALUES (${id}, '2026-11-11', 2, 1, 0, 120, '${src}', '2026-11-11T00:10:00Z', 0);
      INSERT INTO notifications (monitor_id, event, channel, message, failure_reason, created_at, source)
        VALUES (${id}, 'down', 'log', '${src} 장애', 'timeout', '2026-11-11T00:05:00Z', '${src}');
      INSERT INTO incidents (monitor_id, started_at, detected_at, resolved_at, cause, report_summary, source)
        VALUES (${id}, '2026-11-10T00:00:00Z', '2026-11-10T00:05:00Z', '2026-11-10T00:30:00Z', 'timeout', '요약 ${src}', '${src}');
    `);
  }
  // 열린 장애 1건 (해결 전)과 계획 작업 1건
  db.exec(`
    INSERT INTO incidents (monitor_id, started_at, detected_at, source) VALUES (${real}, '2026-11-11T00:00:00Z', '2026-11-11T00:05:00Z', 'real');
    INSERT INTO maintenance_windows (monitor_id, title, starts_at, ends_at, source, created_at)
      VALUES (${demo}, '점검 작업', '2026-11-12T00:00:00Z', '2026-11-12T01:00:00Z', 'sample', '2026-11-11T00:00:00Z');
  `);
  return { db, real, sim, demo };
}

const TABLES = ['monitors', 'monitor_state', 'maintenance_windows', 'check_results', 'notifications', 'daily_stats', 'incidents'];
const dump = (db, t) => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all());

test('0008 적용 후에도 기존 행이 내용·id 그대로 남는다', () => {
  const { db } = dbBefore0008();
  const before = Object.fromEntries(TABLES.map((t) => [t, dump(db, t)]));

  apply(db, '0008_replay_source.sql');

  for (const t of TABLES) {
    // 컬럼 순서를 같게 만들었으므로 SELECT * 결과가 그대로여야 한다 (monitors는 dataset_id 열이 하나 늘어남)
    if (t === 'monitors') {
      const rows = db.prepare('SELECT * FROM monitors ORDER BY id').all();
      const old = JSON.parse(before.monitors);
      assert.equal(rows.length, old.length);
      rows.forEach((r, i) => {
        const { dataset_id, ...rest } = r;
        assert.equal(dataset_id, null, '기존 대상은 데이터셋과 연결되지 않음');
        assert.deepEqual(rest, old[i]);
      });
    } else {
      assert.equal(dump(db, t), before[t], `${t} 내용이 그대로여야 함`);
    }
  }
  // 임시 복사본이 남아 있지 않아야 한다
  const leftover = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '\\_old\\_%' ESCAPE '\\'").all();
  assert.deepEqual(leftover, []);
});

test('0008 적용 후 외래 키가 깨지지 않았다', () => {
  const { db } = dbBefore0008();
  apply(db, '0008_replay_source.sql');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  // (node:sqlite의 결과 객체는 일반 객체와 프로토타입이 달라 deepEqual이 실패하므로 값만 비교)
  assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check), ['ok']);
});

test("0008 적용 후 'replay'는 5개 테이블 모두에 들어가고, 엉뚱한 출처는 여전히 거부된다", () => {
  const { db } = dbBefore0008();
  apply(db, '0008_replay_source.sql');

  db.exec(`INSERT INTO datasets (key, name, url, license, processing, kind)
           VALUES ('t', '테스트 데이터셋', 'https://example.invalid', 'MIT', '그대로', 'real_replay')`);
  const ds = db.prepare("SELECT id FROM datasets WHERE key = 't'").get().id;
  db.prepare(`INSERT INTO monitors (name, kind, url, source, is_active, dataset_id) VALUES ('재생 서비스', 'replay', 'replay://t', 'replay', 1, ?)`).run(ds);
  const id = db.prepare("SELECT id FROM monitors WHERE source = 'replay'").get().id;

  db.exec(`
    INSERT INTO check_results (monitor_id, checked_at, is_success, source) VALUES (${id}, '2026-11-11T01:00:00Z', 1, 'replay');
    INSERT INTO daily_stats (monitor_id, day, total_checks, success_checks, slow_checks, source, updated_at)
      VALUES (${id}, '2026-11-11', 1, 1, 0, 'replay', '2026-11-11T01:00:00Z');
    INSERT INTO notifications (monitor_id, event, channel, message, created_at, source)
      VALUES (${id}, 'down', 'log', '재생 장애', '2026-11-11T01:00:00Z', 'replay');
    INSERT INTO incidents (monitor_id, started_at, detected_at, source)
      VALUES (${id}, '2026-11-11T01:00:00Z', '2026-11-11T01:05:00Z', 'replay');
  `);

  // 엉뚱한 출처는 5개 테이블 모두에서 거부 (오타로 가짜가 진짜처럼 보이지 않게 한 장치가 살아 있는지)
  const bad = [
    `INSERT INTO monitors (name, url, source) VALUES ('x', 'u', 'fake')`,
    `INSERT INTO check_results (monitor_id, checked_at, is_success, source) VALUES (${id}, 'x', 1, 'fake')`,
    `INSERT INTO daily_stats (monitor_id, day, total_checks, success_checks, slow_checks, source, updated_at) VALUES (${id}, 'd', 1, 1, 0, 'fake', 'x')`,
    `INSERT INTO notifications (monitor_id, event, channel, message, created_at, source) VALUES (${id}, 'down', 'log', 'm', 'x', 'fake')`,
    `INSERT INTO incidents (monitor_id, started_at, detected_at, source) VALUES (${id}, 'a', 'b', 'fake')`,
  ];
  for (const sql of bad) assert.throws(() => db.exec(sql), /CHECK constraint failed/, sql);
});

test('0008 적용 후 인덱스·제약이 그대로 살아 있다', () => {
  const { db, real } = dbBefore0008();
  apply(db, '0008_replay_source.sql');

  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'").all().map((r) => r.name).sort();
  assert.deepEqual(idx, [
    'idx_check_results_monitor_time',
    'idx_incidents_open',
    'idx_incidents_started',
    'idx_maintenance_ends',
    'idx_monitors_check_key',
    'idx_notifications_created',
  ]);

  // 이미 열린 장애가 있는 대상에 또 열린 장애를 만들 수 없다 (idx_incidents_open)
  assert.throws(
    () => db.exec(`INSERT INTO incidents (monitor_id, started_at, detected_at, source) VALUES (${real}, 'a', 'b', 'real')`),
    /UNIQUE constraint failed/
  );
  // check_key는 유일해야 한다
  assert.throws(
    () => db.exec(`INSERT INTO monitors (name, url, source, check_key) VALUES ('dup', 'u', 'simulator', 'sim-ping')`),
    /UNIQUE constraint failed/
  );
  // 존재하지 않는 대상을 가리키는 행은 외래 키가 거부한다
  assert.throws(
    () => db.exec(`INSERT INTO check_results (monitor_id, checked_at, is_success, source) VALUES (99999, 'x', 1, 'real')`),
    /FOREIGN KEY constraint failed/
  );
});

test('다음 id는 이어서 붙는다 (장애 번호가 겹치지 않음)', () => {
  const { db, real } = dbBefore0008();
  const maxBefore = db.prepare('SELECT MAX(id) AS m FROM incidents').get().m;
  apply(db, '0008_replay_source.sql');
  // 이미 열린 real 장애를 닫고 새 장애를 하나 만든다
  db.exec(`UPDATE incidents SET resolved_at = '2026-11-11T02:00:00Z' WHERE monitor_id = ${real} AND resolved_at IS NULL`);
  db.exec(`INSERT INTO incidents (monitor_id, started_at, detected_at, source) VALUES (${real}, '2026-11-11T03:00:00Z', '2026-11-11T03:05:00Z', 'real')`);
  const created = db.prepare('SELECT MAX(id) AS m FROM incidents').get().m;
  assert.equal(created, maxBefore + 1);
});

test('replay_series: 같은 (대상, 순번)은 중복 불가, 라벨은 0/1/NULL만', () => {
  const { db } = dbBefore0008();
  apply(db, '0008_replay_source.sql');
  const id = db.prepare("SELECT id FROM monitors LIMIT 1").get().id;
  db.exec(`INSERT INTO replay_series (monitor_id, seq, value, is_anomaly) VALUES (${id}, 0, 0.5, 0), (${id}, 1, 0.9, 1), (${id}, 2, 0.4, NULL)`);
  assert.throws(() => db.exec(`INSERT INTO replay_series (monitor_id, seq, value) VALUES (${id}, 0, 1)`), /UNIQUE constraint failed/);
  assert.throws(() => db.exec(`INSERT INTO replay_series (monitor_id, seq, value, is_anomaly) VALUES (${id}, 9, 1, 2)`), /CHECK constraint failed/);
  assert.throws(() => db.exec(`INSERT INTO replay_series (monitor_id, seq, value) VALUES (99999, 0, 1)`), /FOREIGN KEY constraint failed/);
});

test('datasets: 구분(kind)은 real_replay / lab만, key는 중복 불가', () => {
  const { db } = dbBefore0008();
  apply(db, '0008_replay_source.sql');
  const ins = (key, kind) => db.exec(`INSERT INTO datasets (key, name, url, license, processing, kind) VALUES ('${key}', 'n', 'u', 'l', 'p', '${kind}')`);
  ins('a', 'real_replay');
  ins('b', 'lab');
  assert.throws(() => ins('c', 'sample'), /CHECK constraint failed/);
  assert.throws(() => ins('a', 'lab'), /UNIQUE constraint failed/);
});
