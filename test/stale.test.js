// 에이전트 무응답 감지(B-11) 테스트
//   1) 순수 함수 judgeStale·planStale의 경계값
//   2) 가짜 D1 + 실제 시뮬레이터 대상으로 "보고 끊김 → 장애 → 보고 재개 → 복구" 흐름
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeD1 } from './helpers/fake-d1.js';
import { handleAgentReport } from '../src/ingest.js';
import { runStaleCheck } from '../src/stale-run.js';
import { judgeStale, planStale } from '../src/stale.js';
import { REASON_TEXT } from '../src/notify.js';

const SIM_SQL = readFileSync(new URL('../seed/simulator-monitors.sql', import.meta.url), 'utf8');
const KEY = 'test-agent-key'; // 테스트 전용 값 (실제 키 아님)
const T = (hhmm) => `2026-11-10T${hhmm}:00Z`; // 같은 날의 회차 시각

// ───────── 순수 함수 ─────────
test('judgeStale: 기준을 "넘어야" 무응답 (정확히 기준값은 아직 아님)', () => {
  const last = T('05:00');
  assert.deepEqual(judgeStale(last, T('05:10'), 15), { stale: false, minutesSince: 10 });
  assert.deepEqual(judgeStale(last, T('05:15'), 15), { stale: false, minutesSince: 15 }); // 딱 15분: 여유 1회차
  assert.deepEqual(judgeStale(last, T('05:20'), 15), { stale: true, minutesSince: 20 });
  // 1초 차이도 구분: 15분 1초는 무응답
  assert.equal(judgeStale(last, '2026-11-10T05:15:01Z', 15).stale, true);
});

test('judgeStale: 감시를 안 켰거나, 한 번도 보고한 적 없거나, 값이 이상하면 판정하지 않는다', () => {
  assert.equal(judgeStale(T('05:00'), T('09:00'), null).stale, false);   // 감시 안 함
  assert.equal(judgeStale(T('05:00'), T('09:00'), 0).stale, false);      // 0 이하는 무효
  assert.equal(judgeStale(T('05:00'), T('09:00'), 7.5).stale, false);    // 정수가 아님
  assert.equal(judgeStale(null, T('09:00'), 15).stale, false);           // 보고 이력 없음 (새로 등록한 대상)
  assert.equal(judgeStale('garbage', T('09:00'), 15).stale, false);      // 시각이 깨짐
});

test('planStale: 무응답인 대상만 agent_silent 실패 행을 만든다', () => {
  const watched = [
    { id: 1, name: 'a', source: 'real', staleAfterMin: 15, lastReportAt: T('05:00') },      // 무응답
    { id: 2, name: 'b', source: 'real', staleAfterMin: 15, lastReportAt: T('05:20') },      // 정상
    { id: 3, name: 'c', source: 'real', staleAfterMin: 15, lastReportAt: null },            // 이력 없음
  ];
  const plan = planStale(watched, T('05:25'));
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].row, {
    monitorId: 1, checkedAt: T('05:25'), isSuccess: false, isSlow: false,
    statusCode: null, responseMs: null, failureReason: 'agent_silent', value: null,
  });
});

test('agent_silent의 화면 문구가 등록돼 있다', () => {
  assert.equal(REASON_TEXT.agent_silent, '에이전트 보고 없음');
});

// ───────── DB 흐름 ─────────
function setup({ watch = true } = {}) {
  const db = createFakeD1();
  db.sqlite.exec(SIM_SQL);
  if (watch) db.sqlite.exec("UPDATE monitors SET stale_after_min = 15 WHERE check_key = 'sim-db-tcp'");
  return db;
}

const quiet = async (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

/** 에이전트 보고 1건 (at 시각에 측정, at 시각에 도착) */
const report = (db, at, ok = true) =>
  quiet(() =>
    handleAgentReport(
      new Request('https://example.invalid/api/agent/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          agent: 'test-pc', mode: 'simulator', observed_at: at,
          checks: [{ key: 'sim-db-tcp', ok, response_ms: ok ? 10 : null }],
        }),
      }),
      { DB: db, AGENT_API_KEY: KEY },
      { now: new Date(at) }
    )
  );

const stale = (db, at) => quiet(() => runStaleCheck(db, new Date(at)));
const notes = (db) => db.sqlite.prepare('SELECT event, message, source, failure_reason FROM notifications ORDER BY id').all();
const state = (db) =>
  db.sqlite.prepare("SELECT s.* FROM monitor_state s JOIN monitors m ON m.id = s.monitor_id WHERE m.check_key = 'sim-db-tcp'").get();

test('흐름: 보고 끊김 → (기준 이내는 무시) → 20분 회차 첫 실패 → 25분 회차 장애 → 계속 끊겨도 알림 1건 → 보고 재개 → 복구', async () => {
  const db = setup();
  await report(db, T('05:00'));

  assert.deepEqual(await stale(db, T('05:10')), []); // 10분: 이내
  assert.deepEqual(await stale(db, T('05:15')), []); // 15분 정각: 아직

  assert.equal((await stale(db, '2026-11-10T05:20:12Z')).length, 1); // Cron은 몇 초 늦음 → 5분 회차로 내림
  assert.equal(state(db).consecutive_failures, 1);
  assert.equal(state(db).state, 'up'); // 첫 실패만으로는 장애가 아님 (기존 2회 연속 규칙)
  assert.deepEqual(notes(db), []);

  await stale(db, T('05:25'));
  assert.equal(state(db).state, 'down');
  assert.equal(notes(db).length, 1);
  assert.equal(notes(db)[0].event, 'down');
  assert.equal(notes(db)[0].failure_reason, 'agent_silent');
  assert.match(notes(db)[0].message, /에이전트 보고 없음/);
  assert.equal(notes(db)[0].source, 'simulator'); // 출처가 대상의 출처를 따라감

  // 계속 끊겨 있어도 알림이 더 쌓이지 않음 — 그리고 마지막 "실제 보고" 기준이라 무응답이 풀리지 않음
  await stale(db, T('05:30'));
  await stale(db, T('05:35'));
  assert.equal(notes(db).length, 1);
  assert.equal(state(db).state, 'down');

  // 장애 이력이 열림
  const open = db.sqlite.prepare('SELECT cause, resolved_at FROM incidents').all();
  assert.deepEqual(open.map((i) => [i.cause, i.resolved_at]), [['agent_silent', null]]);

  // 보고 재개 → 기존 규칙(성공 1회)으로 복구
  await report(db, T('05:40'));
  assert.deepEqual(notes(db).map((n) => n.event), ['down', 'recovered']);
  assert.equal(state(db).state, 'up');
  assert.notEqual(db.sqlite.prepare('SELECT resolved_at FROM incidents').get().resolved_at, null);

  // 복구 직후에는 무응답이 아님
  assert.deepEqual(await stale(db, T('05:45')), []);
});

test('감시를 켜지 않은 대상(stale_after_min = NULL)은 아무리 조용해도 건드리지 않는다', async () => {
  const db = setup({ watch: false });
  await report(db, T('05:00'));
  assert.deepEqual(await stale(db, T('09:00')), []);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM check_results').get().n, 1);
});

test('한 번도 보고하지 않은 감시 대상, 비활성 대상은 판정하지 않는다', async () => {
  const db = setup();
  assert.deepEqual(await stale(db, T('09:00')), []); // 보고 이력 없음

  await report(db, T('05:00'));
  db.sqlite.exec("UPDATE monitors SET is_active = 0 WHERE check_key = 'sim-db-tcp'");
  assert.deepEqual(await stale(db, T('09:00')), []);
});

test('계획 작업 중에는 무응답을 기록하되 장애로 판정하지 않는다', async () => {
  const db = setup();
  await report(db, T('05:00'));
  const id = db.sqlite.prepare("SELECT id FROM monitors WHERE check_key = 'sim-db-tcp'").get().id;
  db.sqlite
    .prepare("INSERT INTO maintenance_windows (monitor_id, title, starts_at, ends_at, source, created_at) VALUES (?, '점검', ?, ?, 'simulator', ?)")
    .run(id, T('05:10'), T('06:00'), T('05:10'));

  await stale(db, T('05:20'));
  await stale(db, T('05:25'));
  await stale(db, T('05:30'));
  assert.deepEqual(notes(db), []);
  assert.notEqual(state(db).state, 'down');
  const rows = db.sqlite.prepare("SELECT in_maintenance FROM check_results WHERE failure_reason = 'agent_silent'").all();
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.in_maintenance === 1));
});

test('같은 회차에 무응답 기록 뒤 늦게 온 보고는 건너뛰고, 다음 회차 보고는 받는다 (알려진 한계)', async () => {
  const db = setup();
  await report(db, T('05:00'));
  await stale(db, T('05:20'));
  await stale(db, T('05:25')); // 장애

  const same = await (await report(db, '2026-11-10T05:25:30Z')).json();
  assert.deepEqual(same.skipped, ['sim-db-tcp']); // 05:25 회차는 이미 무응답으로 기록됨
  assert.equal(state(db).state, 'down');

  const next = await (await report(db, '2026-11-10T05:30:05Z')).json();
  assert.equal(next.accepted, 1);
  assert.equal(state(db).state, 'up');
});
