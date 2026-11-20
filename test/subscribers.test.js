// 서비스별 장애 메일 수신자 (19단계: 틀만, 기본은 꺼짐) 테스트
// 실제 메일·사이트에는 요청하지 않습니다. 주소는 모두 example.invalid(존재할 수 없는 테스트 전용 도메인)입니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './helpers/fake-d1.js';
import {
  subscribersStatus,
  normalizeEmail,
  maskEmail,
  signToken,
  verifyToken,
  confirmStillValid,
  pickDeliveries,
  withUnsubscribe,
  confirmMail,
  MAX_PER_SERVICE,
} from '../src/subscribers.js';
import { runEscalation } from '../src/escalation-run.js';
import { handleSubscribePage, inviteSubscriber } from '../src/subscribe-api.js';
import { handleAdmin } from '../src/admin.js';
import worker, { runChecks } from '../src/index.js';
import { RESEND_URL } from '../src/channels/email.js';

const SECRET = 'test-subscribe-secret-0123456789'; // 테스트 전용 값
const ON = {
  RESEND_API_KEY: 'test-key',
  ALERT_EMAIL_TO: 'owner@example.invalid',
  ALERT_EMAIL_FROM: 'Uptime Monitor <alert@example.invalid>',
  SUBSCRIBERS_ENABLED: '1',
  SUBSCRIBE_SECRET: SECRET,
  SITE_URL: 'https://status.example.invalid',
};
const T0 = '2026-11-20T03:00:00Z';
const at = (min) => new Date(Date.parse(T0) + min * 60000);

// ── 켜짐 조건 ──

test('subscribersStatus: 일부러 켜고, 내 도메인 발신 주소·비밀 값·사이트 주소가 모두 있어야 켜짐', () => {
  assert.deepEqual(subscribersStatus({}), { enabled: false, reason: 'not_enabled' });
  assert.equal(subscribersStatus({ ...ON, SUBSCRIBERS_ENABLED: 'true' }).reason, 'not_enabled'); // '1'만 인정
  assert.equal(subscribersStatus({ ...ON, RESEND_API_KEY: '' }).reason, 'email_not_configured');
  assert.equal(subscribersStatus({ ...ON, ALERT_EMAIL_FROM: '' }).reason, 'own_domain_required');
  assert.equal(subscribersStatus({ ...ON, ALERT_EMAIL_FROM: 'Uptime Monitor <onboarding@resend.dev>' }).reason, 'own_domain_required');
  assert.equal(subscribersStatus({ ...ON, SUBSCRIBE_SECRET: 'short' }).reason, 'secret_missing');
  assert.equal(subscribersStatus({ ...ON, SITE_URL: '' }).reason, 'site_url_missing');
  assert.deepEqual(subscribersStatus(ON), { enabled: true, reason: null });
});

// ── 순수 함수 ──

test('normalizeEmail·maskEmail', () => {
  assert.deepEqual(normalizeEmail(' Owner.Name+ops@Example.INVALID '), { ok: true, email: 'owner.name+ops@example.invalid' });
  for (const bad of ['', 'a', 'a@b', 'a@@b.c', 'Name <a@b.c>', 'a b@c.d', 'a@-b.c', 'a@b..c', 'a@1.2.3.4', 'a,b@c.d']) {
    assert.equal(normalizeEmail(bad).ok, false, bad);
  }
  assert.equal(normalizeEmail(`${'a'.repeat(250)}@b.cd`).error, 'email_too_long');
  assert.equal(maskEmail('qudgo@naver.example'), 'q***@naver.example');
  assert.equal(maskEmail('broken'), '***');
});

test('signToken·verifyToken: 용도·주소·추가 시각이 다르면 안 맞음', async () => {
  const sub = { id: 3, email: 'a@example.invalid', createdAt: T0 };
  const t = await signToken(SECRET, 'confirm', sub);
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await verifyToken(SECRET, 'confirm', sub, t), true);
  assert.equal(await verifyToken(SECRET, 'unsubscribe', sub, t), false);
  assert.equal(await verifyToken(SECRET, 'confirm', { ...sub, createdAt: '2026-11-21T00:00:00Z' }, t), false, '다시 추가하면 예전 링크는 무효');
  assert.equal(await verifyToken('other-secret-0123456789', 'confirm', sub, t), false);
  assert.equal(await verifyToken(SECRET, 'confirm', sub, ''), false);
  assert.equal(confirmStillValid(T0, at(7 * 24 * 60)), true);
  assert.equal(confirmStillValid(T0, at(7 * 24 * 60 + 1)), false);
});

test('pickDeliveries: 열린 구간엔 장애 메일, 복구 60분 안엔 장애 메일 받은 사람에게만 복구 메일, 보낸 건 다시 안 보냄', () => {
  const E = (id, o = {}) => ({ id, serviceId: 1, resolvedAt: null, escalationSubject: 'S', escalationBody: 'B', recoverySubject: 'RS', recoveryBody: 'RB', ...o });
  const subs = [{ id: 10, serviceId: 1 }, { id: 11, serviceId: 1 }, { id: 12, serviceId: 2 }];
  const now = at(0);
  const open = pickDeliveries({ escalations: [E(1)], subscribers: subs, deliveries: [{ escalationId: 1, subscriberId: 10, kind: 'escalation' }], now });
  assert.deepEqual(open.map((d) => [d.subscriber.id, d.kind]), [[11, 'escalation']]);

  const resolved = E(2, { resolvedAt: '2026-11-20T02:30:00Z' }); // 30분 전 복구
  const rec = pickDeliveries({ escalations: [resolved], subscribers: subs, deliveries: [{ escalationId: 2, subscriberId: 10, kind: 'escalation' }], now });
  assert.deepEqual(rec.map((d) => [d.subscriber.id, d.kind, d.mail.subject]), [[10, 'recovery', 'RS']], '장애 메일을 못 받은 11에게는 복구 메일도 안 보냄');

  const old = E(3, { resolvedAt: '2026-11-20T01:30:00Z' }); // 90분 전 → 너무 늦음
  assert.equal(pickDeliveries({ escalations: [old], subscribers: subs, deliveries: [{ escalationId: 3, subscriberId: 10, kind: 'escalation' }], now }).length, 0);
  assert.equal(pickDeliveries({ escalations: [E(4, { escalationSubject: null })], subscribers: subs, deliveries: [], now }).length, 0, '0019 이전 구간');
});

test('메일 문구: 확인 메일은 링크·유효 기간, 수신자 메일엔 그만 받기 링크', () => {
  const c = confirmMail('Keychats', 'https://x/confirm');
  assert.match(c.subject, /Keychats 장애 알림을 받으시겠어요/);
  assert.match(c.text, /https:\/\/x\/confirm/);
  assert.match(c.text, /7일/);
  const m = withUnsubscribe({ subject: 'S', text: '본문' }, 'Keychats', 'https://x/unsub');
  assert.ok(m.text.startsWith('본문'));
  assert.match(m.text, /그만 받기: https:\/\/x\/unsub$/);
});

// ── 흐름 (가짜 D1 + 가짜 사이트·메일 API) ──

function world() {
  const state = { healthOk: true, mailOk: true, failFor: null, mails: [] };
  state.fetchFn = async (u, init) => {
    const s = String(u);
    if (s === RESEND_URL) {
      const body = JSON.parse(init.body);
      state.mails.push(body);
      const fail = !state.mailOk || (state.failFor && body.to[0] === state.failFor);
      return new Response('{}', { status: fail ? 500 : 200 });
    }
    if (s.includes('cloudflare-dns.com')) return new Response(JSON.stringify({ Status: 0, Answer: [{ name: 'x', type: 1, data: '192.0.2.1' }] }), { status: 200 });
    if (s.endsWith('/chats/api/health')) return new Response(state.healthOk ? '{"status":"ok"}' : '{"status":"error"}', { status: state.healthOk ? 200 : 503 });
    return new Response('<title>Keychats</title> 고쳐라', { status: 200 });
  };
  return state;
}

async function quiet(fn) {
  const [log, err] = [console.log, console.error];
  console.log = console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = err;
  }
}

async function tick(db, w, min, env = ON) {
  const runTime = new Date(at(min).getTime() + 12_000);
  return quiet(async () => {
    await runChecks({ DB: db }, runTime, { fetchFn: w.fetchFn });
    return runEscalation({ DB: db, ...env }, runTime, { fetchFn: w.fetchFn });
  });
}

function freshDb() {
  const db = createFakeD1();
  db.sqlite.exec('UPDATE monitors SET is_active = 1 WHERE service_id IS NOT NULL');
  return db;
}

const keychats = (db) => db.sqlite.prepare("SELECT id, service_key AS key, name FROM services WHERE service_key = 'keychats'").get();

/** 수신자를 바로 활성으로 넣기 (확인 흐름은 아래 테스트에서 따로) */
function addActive(db, email) {
  return db.sqlite.prepare("INSERT INTO service_subscribers (service_id, email, status, created_at, confirmed_at) VALUES (?, ?, 'active', ?, ?) RETURNING id").get(keychats(db).id, email, T0, T0).id;
}

const toOf = (w) => w.mails.map((m) => m.to[0]);

test('꺼져 있으면(기본) 지금과 똑같이 운영자에게만, 수신자 표는 읽지도 않음', async () => {
  const db = freshDb();
  addActive(db, 'friend@example.invalid');
  const w = world();
  const OFF = { ...ON, SUBSCRIBERS_ENABLED: undefined };
  w.healthOk = false;
  let last;
  for (const min of [0, 5, 10, 15]) last = await tick(db, w, min, OFF);
  assert.deepEqual(toOf(w), ['owner@example.invalid']);
  assert.deepEqual(last.subscribers, { skipped: true, reason: 'not_enabled' });
  // 운영자 문구는 구간에 남음 (나중에 켜도 같은 문구)
  assert.equal(db.sqlite.prepare('SELECT escalation_subject FROM service_escalations').get().escalation_subject, '[Uptime Monitor] Keychats 부분 장애 15분째');
});

test('켜져 있으면: 운영자 + 활성 수신자에게 한 사람씩, 대기 수신자·다른 서비스 수신자는 제외, 복구도 한 번씩', async () => {
  const db = freshDb();
  const a = addActive(db, 'a@example.invalid');
  addActive(db, 'b@example.invalid');
  db.sqlite.prepare("INSERT INTO service_subscribers (service_id, email, status, created_at) VALUES (?, 'pending@example.invalid', 'pending', ?)").run(keychats(db).id, T0);
  const gochyeora = db.sqlite.prepare("SELECT id FROM services WHERE service_key = 'gochyeora'").get().id;
  db.sqlite.prepare("INSERT INTO service_subscribers (service_id, email, status, created_at) VALUES (?, 'other@example.invalid', 'active', ?)").run(gochyeora, T0);
  const w = world();
  await tick(db, w, 0);
  w.healthOk = false;
  for (const min of [5, 10, 15, 20]) await tick(db, w, min);
  assert.deepEqual(toOf(w), ['owner@example.invalid', 'a@example.invalid', 'b@example.invalid']);
  assert.ok(w.mails.every((m) => m.to.length === 1), '한 통에 한 사람');
  const toA = w.mails[1];
  assert.match(toA.text, /그만 받기: https:\/\/status\.example\.invalid\/subscribe\/unsubscribe\?id=\d+&t=/);
  assert.match(toA.headers['List-Unsubscribe'], /^<https:\/\/status\.example\.invalid\/subscribe\/unsubscribe/);
  assert.equal(toA.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(!w.mails[0].text.includes('그만 받기'), '운영자 메일에는 그만 받기 없음');
  await tick(db, w, 25); // 반복 없음
  assert.equal(w.mails.length, 3);
  w.healthOk = true;
  await tick(db, w, 30);
  assert.deepEqual(toOf(w).slice(3), ['owner@example.invalid', 'a@example.invalid', 'b@example.invalid']);
  assert.match(w.mails[4].subject, /복구/);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM alert_deliveries WHERE subscriber_id = ?').get(a).n, 2);
});

test('수신자 한 명만 실패하면 그 사람에게만 다음 회차에 다시 (받은 사람에게 중복 없음)', async () => {
  const db = freshDb();
  addActive(db, 'a@example.invalid');
  addActive(db, 'b@example.invalid');
  const w = world();
  w.healthOk = false;
  w.failFor = 'b@example.invalid';
  for (const min of [0, 5, 10, 15]) await tick(db, w, min);
  assert.deepEqual(toOf(w), ['owner@example.invalid', 'a@example.invalid', 'b@example.invalid']);
  w.failFor = null;
  await tick(db, w, 20);
  assert.deepEqual(toOf(w).slice(3), ['b@example.invalid']);
  await tick(db, w, 25);
  assert.equal(w.mails.length, 4);
});

// ── 초대 → 확인 → 그만 받기 ──

function page(db, path, { method = 'GET', form, env = ON, now = at(0) } = {}) {
  const init = { method };
  if (form) {
    init.body = new URLSearchParams(form).toString();
    init.headers = { 'content-type': 'application/x-www-form-urlencoded' };
  }
  const req = new Request(`https://status.example.invalid${path}`, init);
  return quiet(() => handleSubscribePage(req, { DB: db, ...env }, new URL(req.url), now));
}

test('초대 → 확인 메일 → 링크 열기(GET)만으로는 안 바뀜 → [받기](POST) → 활성 → 그만 받기 → 주소 삭제', async () => {
  const db = freshDb();
  const w = world();
  const svc = keychats(db);
  const r = await quiet(() => inviteSubscriber({ DB: db, ...ON }, svc, 'New@Example.INVALID', at(0), { fetchFn: w.fetchFn }));
  assert.equal(r.status, 201);
  assert.deepEqual(r.body, { ok: true, id: r.body.id, status: 'pending', confirmSent: true });
  assert.equal(w.mails[0].to[0], 'new@example.invalid');
  const link = w.mails[0].text.match(/https:\/\/status\.example\.invalid(\/subscribe\/confirm\?id=(\d+)&t=([A-Za-z0-9_-]+))/);
  assert.ok(link, '확인 링크');
  const [, path, id, t] = link;

  const get = await page(db, path);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('referrer-policy'), 'no-referrer');
  assert.match(await get.text(), /<button type="submit">받기<\/button>/);
  assert.equal(db.sqlite.prepare('SELECT status FROM service_subscribers WHERE id = ?').get(id).status, 'pending', 'GET만으로는 안 바뀜');

  assert.equal((await page(db, '/subscribe/confirm', { method: 'POST', form: { id, t: 'wrong' } })).status, 400);
  const post = await page(db, '/subscribe/confirm', { method: 'POST', form: { id, t } });
  assert.match(await post.text(), /등록되었습니다/);
  assert.equal(db.sqlite.prepare('SELECT status FROM service_subscribers WHERE id = ?').get(id).status, 'active');

  // 그만 받기: 메일 프로그램의 한 번에 구독 취소(주소에 id·t, 본문은 List-Unsubscribe=One-Click)
  const sub = { id: Number(id), email: 'new@example.invalid', createdAt: db.sqlite.prepare('SELECT created_at FROM service_subscribers WHERE id = ?').get(id).created_at };
  const ut = await signToken(SECRET, 'unsubscribe', sub);
  const one = await quiet(() => handleSubscribePage(
    new Request(`https://status.example.invalid/subscribe/unsubscribe?id=${id}&t=${ut}`, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
    { DB: db, ...ON }, new URL(`https://status.example.invalid/subscribe/unsubscribe?id=${id}&t=${ut}`), at(1)));
  assert.equal(one.status, 200);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM service_subscribers WHERE id = ?').get(id).n, 0, '주소 삭제');
  assert.match(await (await page(db, `/subscribe/unsubscribe?id=${id}&t=${ut}`)).text(), /이미 처리되었거나/);
});

test('확인 링크는 7일 뒤 무효, 확인 안 한 주소는 7일 뒤 Cron이 지움, 그만 받기는 기능을 꺼도 동작', async () => {
  const db = freshDb();
  const w = world();
  const r = await quiet(() => inviteSubscriber({ DB: db, ...ON }, keychats(db), 'late@example.invalid', at(0), { fetchFn: w.fetchFn }));
  const [, path] = w.mails[0].text.match(/https:\/\/status\.example\.invalid(\/subscribe\/confirm\S+)/);
  assert.equal((await page(db, path, { now: at(7 * 24 * 60 + 5) })).status, 400);
  assert.equal((await page(db, path, { env: { ...ON, SUBSCRIBERS_ENABLED: undefined } })).status, 503, '꺼지면 받기 불가');

  const sub = { id: r.body.id, email: 'late@example.invalid', createdAt: '2026-11-20T03:00:00Z' };
  const ut = await signToken(SECRET, 'unsubscribe', sub);
  const off = await page(db, '/subscribe/unsubscribe', { method: 'POST', form: { id: String(sub.id), t: ut }, env: { ...ON, SUBSCRIBERS_ENABLED: undefined } });
  assert.equal(off.status, 200, '꺼져도 주소는 지울 수 있음');

  await quiet(() => inviteSubscriber({ DB: db, ...ON }, keychats(db), 'old@example.invalid', at(0), { fetchFn: w.fetchFn }));
  await tick(db, w, 7 * 24 * 60 + 10);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM service_subscribers WHERE email = 'old@example.invalid'").get().n, 0);
});

test('초대: 꺼져 있으면 503(저장 안 함), 잘못된 주소 400, 서비스당 5명 제한 409, 이미 활성이면 메일 다시 안 보냄', async () => {
  const db = freshDb();
  const w = world();
  const svc = keychats(db);
  const off = await quiet(() => inviteSubscriber({ DB: db }, svc, 'a@example.invalid', at(0), { fetchFn: w.fetchFn }));
  assert.equal(off.status, 503);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM service_subscribers').get().n, 0);
  assert.equal((await quiet(() => inviteSubscriber({ DB: db, ...ON }, svc, 'not-an-email', at(0), { fetchFn: w.fetchFn }))).status, 400);
  for (let i = 0; i < MAX_PER_SERVICE; i += 1) {
    assert.equal((await quiet(() => inviteSubscriber({ DB: db, ...ON }, svc, `u${i}@example.invalid`, at(0), { fetchFn: w.fetchFn }))).status, 201);
  }
  assert.equal((await quiet(() => inviteSubscriber({ DB: db, ...ON }, svc, 'six@example.invalid', at(0), { fetchFn: w.fetchFn }))).status, 409);
  // 이미 있는 대기 주소는 제한에 걸리지 않고 확인 메일만 다시
  assert.equal((await quiet(() => inviteSubscriber({ DB: db, ...ON }, svc, 'u0@example.invalid', at(1), { fetchFn: w.fetchFn }))).status, 200);
  db.sqlite.exec("UPDATE service_subscribers SET status = 'active' WHERE email = 'u1@example.invalid'");
  const before = w.mails.length;
  const act = await quiet(() => inviteSubscriber({ DB: db, ...ON }, svc, 'u1@example.invalid', at(2), { fetchFn: w.fetchFn }));
  assert.deepEqual(act.body.status, 'active');
  assert.equal(w.mails.length, before);
});

// ── 관리자 API · 공개 API ──

function admin(db, path, { method = 'GET', body, env = ON, fetchFn } = {}) {
  const req = new Request(`https://status.example.invalid${path}`, {
    method,
    headers: { authorization: 'Bearer test-admin-token', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return quiet(() => handleAdmin(req, { DB: db, ADMIN_TOKEN: 'test-admin-token', ...env }, new URL(req.url), { now: at(0), fetchFn }));
}

test('관리자 목록은 주소를 가리고, 삭제하면 주소가 지워짐, 서비스 추가 때 알림 메일(꺼져 있으면 거부)', async () => {
  const db = freshDb();
  const w = world();
  addActive(db, 'qudgo@example.invalid');
  const list = await admin(db, '/api/admin/subscribers');
  const text = await list.text();
  assert.ok(!text.includes('qudgo@'), '전체 주소 없음');
  const body = JSON.parse(text);
  assert.equal(body.enabled, true);
  assert.equal(body.items[0].email, 'q***@example.invalid');

  assert.equal((await admin(db, `/api/admin/subscribers/${body.items[0].id}`, { method: 'DELETE' })).status, 200);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM service_subscribers').get().n, 0);
  assert.equal((await admin(db, '/api/admin/subscribers/999', { method: 'DELETE' })).status, 404);

  assert.equal((await admin(db, '/api/admin/services/keychats/subscribers', { method: 'POST', body: { email: 'x@example.invalid' }, fetchFn: w.fetchFn })).status, 201);
  assert.equal((await admin(db, '/api/admin/services/nope/subscribers', { method: 'POST', body: { email: 'x@example.invalid' } })).status, 404);

  const svcBody = { url: 'https://new-app.example.com', consent: true, alertEmail: 'owner2@example.invalid' };
  const offAdd = await admin(db, '/api/admin/services', { method: 'POST', body: svcBody, env: { SUBSCRIBERS_ENABLED: undefined } });
  assert.equal(offAdd.status, 400);
  assert.equal((await offAdd.json()).error, 'subscribers_disabled');
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM services WHERE home_url LIKE '%new-app%'").get().n, 0, '서비스도 안 만들어짐');
  const onAdd = await admin(db, '/api/admin/services', { method: 'POST', body: svcBody, fetchFn: w.fetchFn });
  assert.equal(onAdd.status, 201);
  const made = await onAdd.json();
  assert.equal(made.subscriber.confirmSent, true);
  assert.ok(!JSON.stringify(made).includes('owner2@'), '응답에 주소 없음');
});

test('공개 /api/services는 켜짐 여부만 알려 주고, 기본은 false', async () => {
  const db = freshDb();
  const call = (env) => worker.fetch(new Request('https://status.example.invalid/api/services'), { DB: db, ...env });
  assert.equal((await (await call({})).json()).subscribersEnabled, false);
  const on = await (await call(ON)).text();
  assert.equal(JSON.parse(on).subscribersEnabled, true);
  assert.ok(!on.includes('reason') && !on.includes('@'), '이유·주소는 공개하지 않음');
});

test('화면: 알림 메일 칸은 기본 hidden이고, CSS가 hidden을 덮어쓰지 않음 (라이브에서 display:grid에 덮인 것을 고침)', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<label class="addform__row" id="add-email-row" hidden>/);
  const css = readFileSync(new URL('../public/dashboard.css', import.meta.url), 'utf8');
  assert.match(css, /\.addform__row\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
});
