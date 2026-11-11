// 데모 시드 자동 갱신(src/demo.js) 테스트
//   - 언제 다시 넣는지(KST 04:00 회차만)
//   - 실제 seed/sample.sql을 문장으로 제대로 나누는지
//   - 다시 넣어도 sample만 바뀌고 실제(real) 기록은 그대로인지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeD1 } from './helpers/fake-d1.js';
import { shouldReseed, splitSqlStatements, reseedDemo } from '../src/demo.js';

const SEED_SQL = readFileSync(new URL('../seed/sample.sql', import.meta.url), 'utf8');

test('shouldReseed: UTC 19:00 회차(KST 04:00)에만 true', () => {
  assert.equal(shouldReseed('2026-11-10T19:00:00Z'), true);
  assert.equal(shouldReseed('2026-11-10T19:05:00Z'), false); // 다음 회차
  assert.equal(shouldReseed('2026-11-10T04:00:00Z'), false); // UTC 04:00 = KST 13:00
  assert.equal(shouldReseed('2026-11-10T18:55:00Z'), false);
  assert.equal(shouldReseed(undefined), false);
});

test('splitSqlStatements: 주석은 버리고, 따옴표 안의 ; 와 -- 는 글자로 남김', () => {
  const sql = `-- 맨 위 주석
DELETE FROM a; -- 줄 끝 주석
INSERT INTO a VALUES ('x;y', 'it''s -- not comment');
`;
  assert.deepEqual(splitSqlStatements(sql), [
    'DELETE FROM a',
    "INSERT INTO a VALUES ('x;y', 'it''s -- not comment')",
  ]);
});

test('splitSqlStatements: 실제 seed/sample.sql은 23개 문장', () => {
  const statements = splitSqlStatements(SEED_SQL);
  assert.equal(statements.length, 23);
  // 첫 문장들은 "지우고 다시 넣기"(멱등)를 위한 DELETE
  assert.match(statements[0], /^DELETE FROM notifications WHERE source = 'sample'$/);
});

test('reseedDemo: 두 번 넣어도 sample 개수는 같고, 실제(real) 기록은 그대로', async () => {
  const db = createFakeD1();

  // 실제 점검 기록 1건 (마이그레이션이 넣은 실제 대상 중 하나에 연결)
  const real = db.sqlite.prepare("SELECT id FROM monitors WHERE source = 'real' LIMIT 1").get();
  assert.ok(real, '마이그레이션에 실제 대상이 있어야 함');
  db.sqlite
    .prepare(
      `INSERT INTO check_results (monitor_id, checked_at, is_success, is_slow, status_code, response_ms, source)
       VALUES (?, '2026-11-10T00:00:00Z', 1, 0, 200, 321, 'real')`
    )
    .run(real.id);

  const count = (table) =>
    db.sqlite.prepare(`SELECT source, COUNT(*) AS n FROM ${table} GROUP BY source ORDER BY source`).all()
      .map((r) => `${r.source}:${r.n}`).join(',');

  const n1 = await reseedDemo(db, SEED_SQL);
  const after1 = ['monitors', 'check_results', 'daily_stats', 'incidents', 'notifications'].map(count);

  const n2 = await reseedDemo(db, SEED_SQL);
  const after2 = ['monitors', 'check_results', 'daily_stats', 'incidents', 'notifications'].map(count);

  assert.equal(n1, 23);
  assert.equal(n2, 23);
  assert.deepEqual(after2, after1, '다시 넣어도 개수가 늘지 않음(멱등)');

  // 실제 기록은 1건 그대로
  const realRows = db.sqlite.prepare("SELECT response_ms FROM check_results WHERE source = 'real'").all();
  assert.deepEqual(realRows.map((r) => r.response_ms), [321]);

  // 데모 데이터가 실제로 들어갔는지
  const sampleMonitors = db.sqlite.prepare("SELECT COUNT(*) AS n FROM monitors WHERE source = 'sample'").get();
  assert.ok(sampleMonitors.n >= 3);
});
