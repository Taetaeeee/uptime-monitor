// 오래 가는 장애 메일 알림 테스트 (15단계) — 가짜 시계·가짜 D1·가짜 메일 API (실제 메일을 보내지 않음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './helpers/fake-d1.js';
import { decideEscalations, buildEscalationMail, buildRecoveryMail, ESCALATE_AFTER_MIN } from '../src/escalation.js';
import { runEscalation } from '../src/escalation-run.js';
import { runChecks } from '../src/index.js';
import { handleAdmin } from '../src/admin.js';
import { RESEND_URL } from '../src/channels/email.js';

// ── 판단 (순수 함수) ──

const KC = { id: 2, key: 'keychats', name: 'Keychats', monitorIds: [48, 49, 50] };
const GO = { id: 1, key: 'gochyeora', name: '고쳐라!', monitorIds: [1, 25] };
const inc = (monitorId, startedAt, monitorName = `점검${monitorId}`, cause = 'status_mismatch') => ({ monitorId, monitorName, startedAt, cause });
const T0 = '2026-11-20T03:00:00Z';
const at = (min) => new Date(Date.parse(T0) + min * 60000).toISOString().replace('.000', '');

test('decideEscalations: 첫 실패부터 14분이면 안 보내고 15분이면 보낸다', () => {
  const base = { services: [KC], openIncidents: [inc(50, T0)], openEscalations: [] };
  assert.equal(decideEscalations({ ...base, now: at(14) }).escalate.length, 0);
  const r = decideEscalations({ ...base, now: at(15) });
  assert.equal(r.escalate.length, 1);
  assert.deepEqual([r.escalate[0].service.key, r.escalate[0].minutes, r.escalate[0].state, r.escalate[0].startedAt], ['keychats', 15, 'partial', T0]);
  assert.equal(ESCALATE_AFTER_MIN, 15);
});

test('decideEscalations: 점검 3개가 함께 죽어도 서비스당 1통, 모두 죽으면 "장애", 구간 시작은 가장 이른 첫 실패', () => {
  const r = decideEscalations({
    services: [KC, GO],
    openIncidents: [inc(48, at(5)), inc(49, at(0)), inc(50, at(10))],
    openEscalations: [],
    now: at(20),
  });
  assert.equal(r.escalate.length, 1);
  assert.deepEqual([r.escalate[0].state, r.escalate[0].startedAt, r.escalate[0].minutes, r.escalate[0].incidents.length], ['down', at(0), 20, 3]);
});

test('decideEscalations: 이미 보낸 구간에는 다시 안 보내고, 장애가 모두 끝나면 복구 메일', () => {
  const sent = [{ id: 7, serviceId: 2, startedAt: T0 }];
  assert.deepEqual(decideEscalations({ services: [KC], openIncidents: [inc(50, T0)], openEscalations: sent, now: at(60) }), { escalate: [], resolve: [] });
  const r = decideEscalations({ services: [KC], openIncidents: [], openEscalations: sent, now: at(23) });
  assert.deepEqual([r.resolve.length, r.resolve[0].escalationId, r.resolve[0].minutes], [1, 7, 23]);
  // 메일을 안 보낸(15분 전에 끝난) 장애는 복구 메일도 없음
  assert.deepEqual(decideEscalations({ services: [KC], openIncidents: [], openEscalations: [], now: at(10) }), { escalate: [], resolve: [] });
});

test('메일 문구: 제목에 서비스·상태·시간, 본문에 한국 시각·원인·상세 링크, 점검 주소는 넣지 않음', () => {
  const item = { service: KC, startedAt: T0, minutes: 15, state: 'partial', incidents: [inc(50, T0, '사내 메신저 (DB 상태)')] };
  const m = buildEscalationMail(item, 'https://status.example.dev/');
  assert.equal(m.subject, '[Uptime Monitor] Keychats 부분 장애 15분째');
  assert.match(m.text, /시작: 2026-11-20 12:00 \(한국 시간/);
  assert.match(m.text, /사내 메신저 \(DB 상태\): 상태 코드 불일치/);
  assert.match(m.text, /https:\/\/status\.example\.dev\/service\.html\?key=keychats/);
  assert.ok(!/api\/health|dns:\/\//.test(m.text));
  const r = buildRecoveryMail({ service: KC, startedAt: T0, minutes: 23 }, at(23), null);
  assert.equal(r.subject, '[Uptime Monitor] Keychats 복구 (약 23분)');
  assert.match(r.text, /2026-11-20 12:00 ~ 2026-11-20 12:23/);
  assert.ok(!r.text.includes('서비스 상세'), 'SITE_URL이 없으면 링크 줄을 넣지 않음');
});

// ── Cron 흐름 (가짜 D1 + 가짜 사이트·메일 API) ──

const ENV_MAIL = { RESEND_API_KEY: 'test-key', ALERT_EMAIL_TO: 'owner@example.invalid', SITE_URL: 'https://status.example.dev' }; // 테스트 전용 값

/** 사이트 응답(상태 확인 주소만 healthOk에 따라 실패)과 메일 API 응답을 흉내 내는 가짜 fetch */
function world() {
  const state = { healthOk: true, mailOk: true, mails: [] };
  state.fetchFn = async (u, init) => {
    const s = String(u);
    if (s === RESEND_URL) {
      state.mails.push(JSON.parse(init.body));
      return new Response('{}', { status: state.mailOk ? 200 : 500 });
    }
    if (s.includes('cloudflare-dns.com')) return new Response(JSON.stringify({ Status: 0, Answer: [{ name: 'x', type: 1, data: '192.0.2.1' }] }), { status: 200 });
    if (s.endsWith('/chats/api/health')) return new Response(state.healthOk ? '{"status":"ok"}' : '{"status":"error"}', { status: state.healthOk ? 200 : 503 });
    return new Response('<title>Keychats</title> 고쳐라', { status: 200 });
  };
  return state;
}

/** 5분 회차 하나: 점검 → 기록 → 메일 판단 (index.js scheduled와 같은 순서) */
async function tick(db, w, min, env = ENV_MAIL) {
  const runTime = new Date(Date.parse(T0) + min * 60000 + 12_000);
  const [log, err] = [console.log, console.error];
  console.log = console.error = () => {};
  try {
    await runChecks({ DB: db }, runTime, { fetchFn: w.fetchFn });
    return await runEscalation({ DB: db, ...env }, runTime, { fetchFn: w.fetchFn });
  } finally {
    console.log = log;
    console.error = err;
  }
}

function freshDb() {
  const db = createFakeD1();
  db.sqlite.exec('UPDATE monitors SET is_active = 1 WHERE service_id IS NOT NULL');
  return db;
}

test('DB 상태만 20분 장애 → 15분째 장애 메일 1통, 복구 회차에 복구 메일 1통 (그 사이 반복 없음)', async () => {
  const db = freshDb();
  const w = world();
  await tick(db, w, 0); // 정상
  w.healthOk = false;
  for (const min of [5, 10, 15, 20]) await tick(db, w, min); // 첫 실패 5분 → 20분에 15분째
  assert.equal(w.mails.length, 1);
  assert.equal(w.mails[0].subject, '[Uptime Monitor] Keychats 부분 장애 15분째');
  assert.deepEqual(w.mails[0].to, ['owner@example.invalid']);
  await tick(db, w, 25); // 계속 장애: 반복 메일 없음
  assert.equal(w.mails.length, 1);
  w.healthOk = true;
  await tick(db, w, 30); // 복구
  assert.equal(w.mails.length, 2);
  assert.equal(w.mails[1].subject, '[Uptime Monitor] Keychats 복구 (약 25분)');
  const rows = db.sqlite.prepare('SELECT started_at, escalated_at, resolved_at FROM service_escalations').all();
  assert.equal(rows.length, 1);
  assert.ok(rows[0].resolved_at);
});

test('10분 만에 끝난 장애는 메일 0통 (지금처럼 화면 기록만)', async () => {
  const db = freshDb();
  const w = world();
  await tick(db, w, 0);
  w.healthOk = false;
  for (const min of [5, 10]) await tick(db, w, min);
  w.healthOk = true;
  for (const min of [15, 20, 25]) await tick(db, w, min);
  assert.equal(w.mails.length, 0);
  assert.ok(db.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE event = 'down'").get().n >= 1, '장애 기록은 남음');
});

test('메일 발송이 실패하면 기록하지 않고 다음 회차에 다시 보낸다', async () => {
  const db = freshDb();
  const w = world();
  w.healthOk = false;
  w.mailOk = false;
  for (const min of [0, 5, 10, 15]) await tick(db, w, min);
  assert.equal(w.mails.length, 1, '15분째 시도');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM service_escalations').get().n, 0, '실패는 기록 안 함');
  w.mailOk = true;
  await tick(db, w, 20);
  assert.equal(w.mails.length, 2, '다음 회차에 다시 보냄');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM service_escalations').get().n, 1);
});

test('메일 설정(비밀 값)이 없으면 메일 API를 한 번도 부르지 않고, 점검은 그대로 기록된다', async () => {
  const db = freshDb();
  const w = world();
  w.healthOk = false;
  for (const min of [0, 5, 10, 15, 20]) {
    const r = await tick(db, w, min, { RESEND_API_KEY: '', ALERT_EMAIL_TO: '' });
    assert.equal(r.skipped, true);
  }
  assert.equal(w.mails.length, 0);
  assert.ok(db.sqlite.prepare('SELECT COUNT(*) AS n FROM check_results').get().n > 0);
});

test('0016: 같은 서비스에 열린 메일 구간은 DB에서도 하나만', () => {
  const db = freshDb();
  const ins = db.sqlite.prepare("INSERT INTO service_escalations (service_id, started_at, escalated_at) VALUES (1, 'a', 'b')");
  ins.run();
  assert.throws(() => ins.run(), /UNIQUE/);
  db.sqlite.exec("UPDATE service_escalations SET resolved_at = 'c'");
  assert.doesNotThrow(() => ins.run(), '닫힌 구간 뒤에는 새 구간을 열 수 있음');
});

// ── 시험 메일 API ──

async function testMail(env, token = 'test-admin-token', fetchFn) {
  const req = new Request('https://status.example.dev/api/admin/alerts/test', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });
  const [log, err] = [console.log, console.error];
  console.log = console.error = () => {};
  try {
    return await handleAdmin(req, { DB: createFakeD1(), ADMIN_TOKEN: 'test-admin-token', ...env }, new URL(req.url), { fetchFn });
  } finally {
    console.log = log;
    console.error = err;
  }
}

test('시험 메일: 토큰 필요, 설정 없으면 503, 성공 200, 실패 502, 응답에 받는 주소 없음', async () => {
  const w = world();
  assert.equal((await testMail(ENV_MAIL, null, w.fetchFn)).status, 401);
  assert.equal((await testMail({}, undefined, w.fetchFn)).status, 503);
  assert.equal(w.mails.length, 0);
  const ok = await testMail(ENV_MAIL, undefined, w.fetchFn);
  const text = await ok.text();
  assert.equal(ok.status, 200);
  assert.ok(!text.includes('owner@example.invalid'));
  assert.equal(w.mails[0].subject, '[Uptime Monitor] 시험 메일');
  w.mailOk = false;
  assert.equal((await testMail(ENV_MAIL, undefined, w.fetchFn)).status, 502);
});
