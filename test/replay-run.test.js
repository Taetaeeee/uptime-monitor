// 공개 데이터셋 재생 실행(src/replay-run.js) 테스트
//
// 실제 시드 파일(seed/replay/*.sql)을 가짜 D1에 올리고, 시계를 앞으로 돌려 가며 runReplay를 실행해서
// "장애가 열리고 닫히는지, 출처가 replay로 남는지, 한 대상이 고장 나도 나머지는 계속되는지"를 확인합니다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createFakeD1 } from './helpers/fake-d1.js';
import { parseRule, planReplay, runReplay } from '../src/replay-run.js';
import { replayIndex, buildReplayRow, REPLAY_FAILURE } from '../src/replay.js';
import { initialState, nextState, TRANSITION } from '../src/state.js';
import { REASON_TEXT } from '../src/notify.js';
import { toCheckSlot } from '../src/time.js';
import { buildStatus, buildMonthlyReport } from '../src/api.js';
import { kstMonthOf } from '../src/report.js';
import worker from '../src/index.js';

const SEED = fileURLToPath(new URL('../seed/replay/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(SEED, 'manifest.json'), 'utf8'));
const read = (f) => readFileSync(join(SEED, f), 'utf8');
const STEP = 5 * 60_000;

/** B-7f 컷오버를 흉내: 데이터셋 → 대상 등록·설정 → 시계열 적재 */
function loadedDb() {
  const db = createFakeD1();
  db.sqlite.exec(read('datasets.sql'));
  db.sqlite.exec(read('monitors.sql'));
  for (const m of manifest.monitors) db.sqlite.exec(read(m.file));
  return db;
}

const all = (db, sql, ...p) => db.sqlite.prepare(sql).all(...p);
const one = (db, sql, ...p) => db.sqlite.prepare(sql).get(...p);

// ───────── parseRule ─────────
test('parseRule: 올바른 규칙은 읽고, 잘못된 규칙은 거부', () => {
  assert.deepEqual(parseRule('{"type":"high","slowAt":10,"failAt":20}'), { type: 'high', slowAt: 10, failAt: 20 });
  assert.deepEqual(parseRule('{"type":"smart","slowAbove":0}'), { type: 'smart', slowAbove: 0 });
  assert.throws(() => parseRule('not json'), SyntaxError);
  assert.throws(() => parseRule('null'), RangeError);
  assert.throws(() => parseRule('{"type":"magic"}'), RangeError);
  assert.throws(() => parseRule('{"type":"high","slowAt":10}'), RangeError); // failAt 없음
  assert.throws(() => parseRule('{"type":"deviation","slowPct":"10","failPct":20}'), RangeError); // 숫자가 아님
});

// ───────── planReplay ─────────
test('planReplay: 대상마다 자기 기준 시각·간격·길이로 순번을 계산한다', () => {
  const anchor = '2026-11-12T00:00:00Z';
  const configs = [
    { monitorId: 1, length: 100, stepMinutes: 5, anchorAt: anchor },
    { monitorId: 2, length: 30, stepMinutes: 1440, anchorAt: anchor },
  ];
  assert.deepEqual(planReplay(configs, new Date('2026-11-12T00:12:12Z')), [
    { monitorId: 1, seq: 2 }, // 12분 12초 → 5분 회차 00:10 → 2번째
    { monitorId: 2, seq: 0 },
  ]);
  assert.deepEqual(planReplay(configs, new Date('2026-11-13T00:00:30Z')), [
    { monitorId: 1, seq: (288 % 100) },
    { monitorId: 2, seq: 1 },
  ]);
});

// ───────── 대상 등록 SQL (monitors.sql) ─────────
test('monitors.sql: 대상 5개와 설정이 만들어지고, 시작 기준 시각은 5분 단위이며 첫 이상 1시간 전에 맞춰진다', () => {
  const db = loadedDb();
  const monitors = all(db, "SELECT * FROM monitors WHERE source = 'replay' ORDER BY id");
  assert.equal(monitors.length, manifest.monitors.length);
  for (const m of monitors) {
    assert.equal(m.kind, 'replay');
    assert.equal(m.is_active, 1);
    assert.ok(m.dataset_id > 0, `${m.check_key}: 데이터셋 연결`);
  }

  const nowSlot = Date.parse(toCheckSlot(new Date()));
  for (const e of manifest.monitors) {
    const c = one(db, 'SELECT c.* FROM replay_config c JOIN monitors m ON m.id = c.monitor_id WHERE m.check_key = ?', e.checkKey);
    assert.equal(c.length, e.length);
    assert.equal(c.step_minutes, e.stepMinutes);
    assert.deepEqual(JSON.parse(c.rule), e.rule);
    assert.equal(c.metric_label, e.metric);
    const anchorMs = Date.parse(c.anchor_at);
    assert.equal(anchorMs % STEP, 0, '5분 경계');
    // 지금(적재 시각)의 순번이 "첫 이상 − 여유"가 되도록: 5분 데이터는 12칸, 하루 데이터는 1칸 전
    const lead = e.stepMinutes >= 1440 ? 1 : 12;
    const expectedSeq = Math.max(e.firstAnomalySeq - lead, 0);
    const nowSeq = replayIndex(nowSlot, anchorMs, c.length, c.step_minutes);
    assert.ok(Math.abs(nowSeq - expectedSeq) <= 1, `${e.checkKey}: 지금 순번 ${nowSeq}, 기대 ${expectedSeq}`);
  }
});

test('monitors.sql을 다시 실행해도 대상이 늘지 않고, 시작 기준 시각은 그대로다 (재생이 처음으로 되돌아가지 않음)', () => {
  const db = loadedDb();
  db.sqlite.exec("UPDATE replay_config SET anchor_at = '2026-01-01T00:00:00Z'");
  db.sqlite.exec(read('monitors.sql'));
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM monitors WHERE source = 'replay'").n, manifest.monitors.length);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM replay_config').n, manifest.monitors.length);
  assert.deepEqual(all(db, 'SELECT DISTINCT anchor_at FROM replay_config').map((r) => r.anchor_at), ['2026-01-01T00:00:00Z']);
});

// ───────── runReplay ─────────
test('재생 대상이 없으면 아무 것도 하지 않는다', async () => {
  const db = createFakeD1();
  const rows = await runReplay(db, new Date('2026-11-12T00:00:00Z'));
  assert.deepEqual(rows, []);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM check_results').n, 0);
});

test('시계를 돌려 보면: 기록은 모두 replay 출처이고, 알림·장애 이력이 순수 계산과 정확히 같다', async () => {
  const db = loadedDb();
  const T0 = Date.parse(toCheckSlot(new Date()));
  const K = 900; // 약 75시간
  for (let k = 0; k < K; k += 1) await runReplay(db, new Date(T0 + k * STEP));

  // 1) 출처: 이 DB에는 실제 점검이 없으므로 모든 결과가 replay
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM check_results WHERE source != 'replay'").n, 0);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM check_results').n, K * manifest.monitors.length);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM notifications WHERE source != 'replay'").n, 0);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM incidents WHERE source != 'replay'").n, 0);

  // 2) 대상마다, 같은 값 순서를 순수 함수(buildReplayRow + nextState)로 따로 계산한 결과와 알림 횟수가 같아야 한다
  let totalDown = 0;
  let totalRecovered = 0;
  for (const e of manifest.monitors) {
    const m = one(db, 'SELECT m.id, c.* FROM monitors m JOIN replay_config c ON c.monitor_id = m.id WHERE m.check_key = ?', e.checkKey);
    const series = all(db, 'SELECT value, is_anomaly FROM replay_series WHERE monitor_id = ? ORDER BY seq', m.id);
    let state = initialState();
    let down = 0;
    let recovered = 0;
    for (let k = 0; k < K; k += 1) {
      const seq = replayIndex(T0 + k * STEP, Date.parse(m.anchor_at), m.length, m.step_minutes);
      const row = buildReplayRow({
        monitorId: m.id,
        checkedAt: `t${k}`,
        value: series[seq].value,
        rule: JSON.parse(m.rule),
        baseline: m.baseline ?? undefined,
        failed: JSON.parse(m.rule).type === 'smart' && series[seq].is_anomaly === 1,
      });
      const r = nextState(state, row.isSuccess, row.checkedAt);
      state = r.next;
      if (r.transition === TRANSITION.DOWN) down += 1;
      if (r.transition === TRANSITION.RECOVERED) recovered += 1;
    }
    const gotDown = one(db, "SELECT COUNT(*) AS n FROM notifications WHERE monitor_id = ? AND event = 'down'", m.id).n;
    const gotRec = one(db, "SELECT COUNT(*) AS n FROM notifications WHERE monitor_id = ? AND event = 'recovered'", m.id).n;
    assert.equal(gotDown, down, `${e.checkKey}: 장애 알림 수`);
    assert.equal(gotRec, recovered, `${e.checkKey}: 복구 알림 수`);
    assert.equal(one(db, 'SELECT COUNT(*) AS n FROM incidents WHERE monitor_id = ?', m.id).n, down, `${e.checkKey}: 장애 이력 수`);
    totalDown += down;
    totalRecovered += recovered;
  }
  // 이 구간 안에서 실제로 장애가 열리고 닫히는 대상이 여러 개 있어야 한다 (화면이 "아무 일도 없는" 상태가 아님)
  assert.ok(totalDown >= 4, `장애 알림 ${totalDown}건`);
  assert.ok(totalRecovered >= 3, `복구 알림 ${totalRecovered}건`);

  // 3) 알림 문구는 코드가 아니라 한국어 문장이다
  const msgs = all(db, "SELECT message, failure_reason FROM notifications WHERE event = 'down'");
  for (const n of msgs) {
    assert.ok(n.message.includes(REASON_TEXT[n.failure_reason]), n.message);
    assert.ok(!n.message.includes('metric_') && !n.message.includes('disk_failure'), n.message);
  }
  assert.ok(Object.values(REPLAY_FAILURE).every((c) => REASON_TEXT[c]));
});

test('첫 이상 구간은 적재 후 약 1시간 안쪽에서 시작된다 (한참 동안 조용한 화면이 아님)', async () => {
  const db = loadedDb();
  const T0 = Date.parse(toCheckSlot(new Date()));
  for (let k = 0; k < 40; k += 1) await runReplay(db, new Date(T0 + k * STEP)); // 약 3시간 20분
  // SMD 3대와 NAB는 이 사이에 적어도 한 대상은 장애가 열려야 한다
  const n = one(db, "SELECT COUNT(*) AS n FROM notifications WHERE event = 'down'").n;
  assert.ok(n >= 1, `3시간 20분 동안 장애 알림 ${n}건`);
});

test('한 대상의 규칙이 깨져도 나머지는 계속 기록된다 (예외는 로그만)', async (t) => {
  const db = loadedDb();
  const errors = t.mock.method(console, 'error', () => {});
  db.sqlite.exec("UPDATE replay_config SET rule = 'broken' WHERE monitor_id = (SELECT id FROM monitors WHERE check_key = 'replay-smd-1-1')");

  const rows = await runReplay(db, new Date());
  assert.equal(rows.length, manifest.monitors.length - 1);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM check_results').n, manifest.monitors.length - 1);
  assert.equal(errors.mock.callCount(), 1);
  assert.match(String(errors.mock.calls[0].arguments[0]), /재생 건너뜀/);
});

test('시계열이 적재되지 않은 대상은 건너뛰고, 비활성 대상은 실행하지 않는다', async (t) => {
  const db = loadedDb();
  t.mock.method(console, 'error', () => {});
  db.sqlite.exec("DELETE FROM replay_series WHERE monitor_id = (SELECT id FROM monitors WHERE check_key = 'replay-nab-machine-temp')");
  db.sqlite.exec("UPDATE monitors SET is_active = 0 WHERE check_key = 'replay-smd-2-1'");

  const rows = await runReplay(db, new Date());
  assert.equal(rows.length, manifest.monitors.length - 2);
});

test('디스크: 하루 단위 값은 같은 날 안에서는 그대로, 고장 표시일에는 실패로 판정된다', async () => {
  const db = loadedDb();
  const m = one(db, "SELECT m.id, c.* FROM monitors m JOIN replay_config c ON c.monitor_id = m.id WHERE m.check_key = 'replay-backblaze-disk'");
  const anchor = Date.parse(m.anchor_at);
  const failSeq = all(db, 'SELECT seq FROM replay_series WHERE monitor_id = ? AND is_anomaly = 1', m.id)[0].seq;
  const failTime = anchor + failSeq * 86_400_000; // 고장 표시일의 시작 시각

  const rows = await runReplay(db, new Date(failTime + 3 * 3_600_000));
  const r = rows.find((x) => x.monitorId === m.id);
  assert.equal(r.isSuccess, false);
  assert.equal(r.failureReason, REPLAY_FAILURE.DISK_FAILURE);

  const before = await runReplay(db, new Date(failTime - 86_400_000 + 3_600_000));
  assert.equal(before.find((x) => x.monitorId === m.id).failureReason, null);
});

// ───────── Cron 연결 ─────────
test('Cron: 재생이 완전히 고장 나도(설정 표가 없어도) scheduled는 예외 없이 끝난다 — 실제 점검에 영향 없음', async (t) => {
  const db = createFakeD1();
  const errors = t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
  db.sqlite.exec('UPDATE monitors SET is_active = 0'); // 실제 점검 대상 없음 → 네트워크 요청이 일어나지 않음
  db.sqlite.exec('DROP TABLE replay_config');

  await worker.scheduled({ scheduledTime: Date.parse('2026-11-12T03:00:00Z') }, { DB: db }, {});
  assert.ok(errors.mock.calls.some((c) => String(c.arguments[0]).includes('[재생]')));
});

// ───────── 화면·보고서 API ─────────
test('상태·월간 보고서 API에 replay 대상이 출처 replay로 나온다 (실제 다음, 시뮬레이터 앞)', async () => {
  const db = loadedDb();
  const now = new Date();
  const T0 = Date.parse(toCheckSlot(now));
  for (let k = 0; k < 6; k += 1) await runReplay(db, new Date(T0 + k * STEP));

  const status = await buildStatus(db, now);
  const replay = status.services.filter((s) => s.source === 'replay');
  assert.equal(replay.length, manifest.monitors.length);
  assert.ok(replay.every((s) => ['up', 'down'].includes(s.state)));

  const report = await buildMonthlyReport(db, kstMonthOf(now), now);
  // 마이그레이션이 넣어 둔 실제 대상(고쳐라!)이 있으므로 real 다음에 replay 순서로 나온다
  assert.deepEqual(report.groups.map((g) => g.source), ['real', 'replay']);
  assert.equal(report.groups.find((g) => g.source === 'replay').services.length, manifest.monitors.length);
});
