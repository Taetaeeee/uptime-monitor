// 테스트용 가짜 D1 — Node 내장 SQLite(node:sqlite)로 D1의 사용법을 흉내 낸다.
//
// 왜 필요한가?
//   이 PC에서는 Windows 스마트 앱 컨트롤 때문에 wrangler 로컬 실행(workerd)이 막혀 있습니다.
//   D1도 SQLite라서, 같은 마이그레이션 SQL을 메모리 DB에 적용하면
//   "점검 → 판정 → 저장 → 알림" 흐름 전체를 node --test로 검증할 수 있어요.
//
// 흉내 내는 범위: 이 프로젝트가 쓰는 것만
//   db.prepare(sql).bind(...).all() / .run() / .first(),  db.batch([...])
// 실제 D1과 동작이 100% 같다는 보장은 없습니다. (최종 확인은 원격 배포로)

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

class FakeStatement {
  constructor(sqlite, sql, params = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }
  // D1처럼 bind는 값이 묶인 "새" 문장을 돌려줍니다 (같은 문장을 여러 번 재사용할 수 있게)
  bind(...params) {
    return new FakeStatement(this.sqlite, this.sql, params);
  }
  runSync() {
    const info = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: info.changes } };
  }
  async run() {
    return this.runSync();
  }
  async all() {
    return { success: true, results: this.sqlite.prepare(this.sql).all(...this.params) };
  }
  async first() {
    return this.sqlite.prepare(this.sql).get(...this.params) ?? null;
  }
}

/**
 * 마이그레이션이 모두 적용된 메모리 DB를 만든다.
 * @returns D1처럼 쓸 수 있는 객체 (+ 테스트에서 직접 조회할 수 있게 sqlite도 노출)
 */
export function createFakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  // 파일 이름 순서(0001, 0002 ...)대로 적용 — wrangler와 같은 규칙
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }

  return {
    sqlite,
    prepare(sql) {
      return new FakeStatement(sqlite, sql);
    },
    // batch: 전부 성공하거나 전부 취소 (트랜잭션)
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((s) => s.runSync());
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
