// Cron 흐름 전체 테스트 — 가짜 D1(메모리 SQLite) + 가짜 fetch
// 실제 사이트에 요청하지 않고 "점검 → 판정 → 상태 → 저장 → 알림"을 끝까지 돌려 봅니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './helpers/fake-d1.js';
import { runChecks } from '../src/index.js';

// 존재할 수 없는 예약 도메인(.invalid) — 혹시 진짜 fetch가 불려도 나갈 곳이 없습니다.
function setup() {
  const db = createFakeD1();
  db.sqlite.exec(`
    INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active, source)
    VALUES ('테스트 서비스', 'http', 'https://test.invalid', 200, NULL, 3000, 1, 'sample');
  `);
  const monitorId = db.sqlite.prepare(`SELECT id FROM monitors WHERE url = 'https://test.invalid'`).get().id;
  return { db, env: { DB: db }, monitorId };
}

// 상태 코드만 정해 주는 가짜 fetch
const respond = (status) => async () => new Response('ok', { status });

// 5분 간격 실행 시각 (일부러 12초씩 늦게 — 실제 Cron처럼)
const at = (n) => new Date(Date.UTC(2026, 10, 10, 3, n * 5, 12));

// 테스트 출력이 지저분하지 않게 console.log를 잠시 끕니다
async function quiet(fn) {
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

test('실패 → 실패 → 실패 → 성공: 장애 알림 1건, 복구 알림 1건', async () => {
  const { db, env, monitorId } = setup();
  const statuses = [503, 503, 503, 200];

  await quiet(async () => {
    for (const [i, status] of statuses.entries()) {
      await runChecks(env, at(i), { fetchFn: respond(status) });
    }
  });

  // 점검 결과는 매 회차 1행씩, 회차 시각(초 없음)으로 저장
  const results = db.sqlite.prepare(`SELECT checked_at, is_success FROM check_results ORDER BY id`).all();
  assert.equal(results.length, 4);
  assert.equal(results[0].checked_at, '2026-11-10T03:00:00Z');

  // 알림은 상태가 바뀐 2번만
  const notes = db.sqlite
    .prepare(`SELECT event, channel, message, failure_reason, created_at, source FROM notifications ORDER BY id`)
    .all();
  assert.deepEqual(
    notes.map((n) => [n.event, n.created_at]),
    [
      ['down', '2026-11-10T03:05:00Z'],      // 두 번째 실패에서 장애 판정
      ['recovered', '2026-11-10T03:15:00Z'], // 성공한 회차에서 복구
    ]
  );
  assert.equal(notes[0].failure_reason, 'status_mismatch');
  assert.equal(notes[0].channel, 'log');
  assert.equal(notes[0].source, 'real');
  assert.match(notes[0].message, /^\[장애\] 테스트 서비스: .*상태 코드 불일치/);
  // 첫 실패(03:00)부터 복구(03:15)까지 15분
  assert.match(notes[1].message, /^\[복구\] 테스트 서비스: 정상 응답 확인 \(장애 약 15분\)$/);
  assert.equal(notes[1].failure_reason, null);

  // 최종 상태
  const state = db.sqlite.prepare(`SELECT * FROM monitor_state WHERE monitor_id = ?`).get(monitorId);
  assert.equal(state.state, 'up');
  assert.equal(state.consecutive_failures, 0);
  assert.equal(state.failing_since, null);
  assert.equal(state.last_checked_at, '2026-11-10T03:15:00Z');

  // 일별 집계: 한국 날짜 2026-11-10(UTC 03시 = 한국 12시)에 4회 중 1회 성공, 출처 real
  const daily = db.sqlite.prepare(`SELECT * FROM daily_stats WHERE monitor_id = ?`).all(monitorId);
  assert.equal(daily.length, 1);
  assert.equal(daily[0].day, '2026-11-10');
  assert.equal(daily[0].total_checks, 4);
  assert.equal(daily[0].success_checks, 1);
  assert.equal(daily[0].source, 'real');
});

test('처음부터 정상이면 알림이 없다', async () => {
  const { db, env } = setup();
  await quiet(() => runChecks(env, at(0), { fetchFn: respond(200) }));

  assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM notifications`).get().n, 0);
  assert.equal(db.sqlite.prepare(`SELECT state FROM monitor_state`).get().state, 'up');
});

test('알림 채널이 실패해도 점검 결과와 상태는 저장된다', async () => {
  const { db, env } = setup();
  const broken = { name: 'broken', send: async () => { throw new Error('채널 고장'); } };

  // console.error도 잠시 끕니다 (일부러 낸 오류라서)
  const originalError = console.error;
  console.error = () => {};
  try {
    await quiet(async () => {
      await runChecks(env, at(0), { fetchFn: respond(503), channels: [broken] });
      await runChecks(env, at(1), { fetchFn: respond(503), channels: [broken] }); // 여기서 장애 → 알림 시도 → 실패
    });
  } finally {
    console.error = originalError;
  }

  assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM check_results`).get().n, 2);
  assert.equal(db.sqlite.prepare(`SELECT state FROM monitor_state`).get().state, 'down');
});

test('활성 대상이 없으면 아무것도 저장하지 않는다', async () => {
  const db = createFakeD1(); // 마이그레이션의 gochyeora는 비활성
  const rows = await quiet(() => runChecks({ DB: db }, at(0), { fetchFn: respond(200) }));

  assert.deepEqual(rows, []);
  assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM check_results`).get().n, 0);
  assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM monitor_state`).get().n, 0);
});
