// '+ 서비스 추가' 테스트 (S4) — 입력 검사 순수 함수 + 관리자 API (가짜 D1 + 가짜 fetch, 실제 사이트에 요청하지 않음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './helpers/fake-d1.js';
import { checkPublicUrl, validateServiceInput, serviceKeyFor, buildMonitors, MAX_SERVICES } from '../src/service-admin.js';
import { handleAdmin } from '../src/admin.js';
import { buildServices } from '../src/api.js';
import { runChecks } from '../src/index.js';

const TOKEN = 'test-admin-token'; // 테스트 전용 값 (실제 토큰 아님)
const SELF = 'status-monitor.example.workers.dev'; // 이 Worker 자신의 주소 (테스트용 가짜 이름)

// ── 주소 검사 ──

test('checkPublicUrl: 공개 https 도메인만 받고, 쿼리·#은 버린다', () => {
  assert.deepEqual(checkPublicUrl('https://my-app.pages.dev', SELF), { ok: true, url: 'https://my-app.pages.dev/', host: 'my-app.pages.dev' });
  assert.deepEqual(checkPublicUrl('  https://My-App.Pages.dev/chats?token=abc#x ', SELF), { ok: true, url: 'https://my-app.pages.dev/chats', host: 'my-app.pages.dev' });
});

test('checkPublicUrl: 거부해야 하는 주소들', () => {
  const cases = [
    [undefined, 'url_required'], ['', 'url_required'], ['not a url', 'url_invalid'],
    ['http://my-app.pages.dev', 'https_only'], ['ftp://my-app.pages.dev', 'https_only'],
    ['https://user:pw@my-app.pages.dev', 'credentials_not_allowed'],
    ['https://my-app.pages.dev:8443', 'port_not_allowed'],
    ['https://127.0.0.1', 'ip_not_allowed'], ['https://10.0.0.5/admin', 'ip_not_allowed'],
    ['https://127.1', 'ip_not_allowed'], // URL이 127.0.0.1로 풀어 줌
    ['https://[::1]', 'ip_not_allowed'],
    ['https://localhost', 'host_invalid'], // 점이 없는 이름
    ['https://intranet', 'host_invalid'],
    ['https://app.localhost', 'host_not_public'], ['https://nas.local', 'host_not_public'],
    ['https://db.internal', 'host_not_public'], ['https://shop.test', 'host_not_public'],
    ['https://printer.home.arpa', 'host_not_public'],
    [`https://${SELF}`, 'self_not_allowed'], [`https://x.${SELF}/`, 'self_not_allowed'],
    [`https://${'a'.repeat(300)}.dev`, 'url_too_long'],
  ];
  for (const [input, error] of cases) assert.equal(checkPublicUrl(input, SELF).error, error, String(input));
});

test('validateServiceInput: 이름 기본값은 호스트, 동의는 추가에만 필수, 상태 확인 주소는 같은 호스트만', () => {
  const ok = validateServiceInput({ url: 'https://my-app.pages.dev', consent: true }, { selfHost: SELF });
  assert.deepEqual(ok, { ok: true, value: { homeUrl: 'https://my-app.pages.dev/', host: 'my-app.pages.dev', name: 'my-app.pages.dev', description: null, healthUrl: null, healthKeyword: null } });

  assert.equal(validateServiceInput({ url: 'https://my-app.pages.dev' }, { selfHost: SELF }).error, 'consent_required');
  assert.equal(validateServiceInput({ url: 'https://my-app.pages.dev', consent: 'yes' }, { selfHost: SELF }).error, 'consent_required');
  assert.equal(validateServiceInput({ url: 'https://my-app.pages.dev' }, { selfHost: SELF, requireConsent: false }).ok, true);

  const base = { url: 'https://my-app.pages.dev', consent: true };
  assert.equal(validateServiceInput({ ...base, healthUrl: 'https://other.dev/api/health' }, { selfHost: SELF }).error, 'health_host_mismatch');
  assert.equal(validateServiceInput({ ...base, healthUrl: 'http://my-app.pages.dev/h' }, { selfHost: SELF }).error, 'health_https_only');
  assert.equal(validateServiceInput({ ...base, healthKeyword: 'ok' }, { selfHost: SELF }).error, 'keyword_without_health');
  assert.equal(validateServiceInput({ ...base, name: 'x'.repeat(61) }, { selfHost: SELF }).error, 'name_invalid');
  assert.equal(validateServiceInput([], { selfHost: SELF }).error, 'invalid_body');

  const h = validateServiceInput({ ...base, name: ' 내 앱 ', healthUrl: 'https://my-app.pages.dev/api/health', healthKeyword: '"ok"' }, { selfHost: SELF });
  assert.equal(h.value.name, '내 앱');
  assert.equal(h.value.healthUrl, 'https://my-app.pages.dev/api/health');
  assert.equal(h.value.healthKeyword, '"ok"');
});

test('serviceKeyFor: 호스트 첫 덩어리, 겹치면 -2, -3 (꺼진 서비스 키도 다시 쓰지 않음)', () => {
  assert.equal(serviceKeyFor('my-app.pages.dev', []), 'my-app');
  assert.equal(serviceKeyFor('my-app.vercel.app', ['my-app']), 'my-app-2');
  assert.equal(serviceKeyFor('my-app.netlify.app', ['my-app', 'my-app-2']), 'my-app-3');
  assert.equal(serviceKeyFor('xn--3e0b707e.kr', []), 'xn--3e0b707e');
  assert.equal(serviceKeyFor('-a-.dev', []), 'a');
  assert.ok(serviceKeyFor(`${'a'.repeat(63)}.dev`, []).length <= 30);
});

test('buildMonitors: HTTP·DNS 기본 2개, 상태 확인 주소가 있으면 3개 (칩 이름은 이름 끝 괄호)', () => {
  const two = buildMonitors({ name: '내 앱', homeUrl: 'https://my-app.pages.dev/', host: 'my-app.pages.dev', healthUrl: null, healthKeyword: null });
  assert.deepEqual(two.map((m) => [m.name, m.kind, m.url, m.maxResponseMs]), [
    ['내 앱 (HTTP)', 'http', 'https://my-app.pages.dev/', 3000],
    ['내 앱 (DNS)', 'dns', 'dns://my-app.pages.dev', 1000],
  ]);
  const three = buildMonitors({ name: '내 앱', homeUrl: 'https://my-app.pages.dev/', host: 'my-app.pages.dev', healthUrl: 'https://my-app.pages.dev/h', healthKeyword: 'ok' });
  assert.deepEqual([three[2].name, three[2].url, three[2].keyword], ['내 앱 (상태 확인)', 'https://my-app.pages.dev/h', 'ok']);
});

// ── 관리자 API (가짜 D1 + 가짜 fetch) ──

/** 미리 점검·Cron이 보내는 요청에 대답하는 가짜 fetch: DoH는 레코드 1개, 상태 확인은 {"status":"ok"}, 나머지는 200 */
function fakeFetch({ siteStatus = 200 } = {}) {
  const calls = [];
  const fn = async (u) => {
    const s = String(u);
    calls.push(s);
    if (s.includes('cloudflare-dns.com')) return new Response(JSON.stringify({ Status: 0, Answer: [{ name: 'x', type: 1, data: '192.0.2.10' }] }), { status: 200 });
    if (s.endsWith('/api/health')) return new Response('{"status":"ok"}', { status: 200 });
    return new Response('<html>내 앱</html>', { status: siteStatus });
  };
  fn.calls = calls;
  return fn;
}

function admin(db, method, path, body, { token = TOKEN, fetchFn = fakeFetch() } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const request = new Request(`https://${SELF}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const [log, err] = [console.log, console.error];
  console.log = console.error = () => {};
  return handleAdmin(request, { DB: db, ADMIN_TOKEN: TOKEN }, new URL(request.url), { fetchFn, now: new Date('2026-11-20T03:00:00Z') })
    .finally(() => { console.log = log; console.error = err; });
}

const NEW = { url: 'https://my-app.pages.dev', name: '내 앱', description: '팀 프로젝트', healthUrl: 'https://my-app.pages.dev/api/health', healthKeyword: '"ok"', consent: true };

test('관리자 토큰이 없거나 틀리면 미리 점검·추가·끄기 모두 401이고 아무것도 바뀌지 않는다', async () => {
  const db = createFakeD1();
  const before = db.sqlite.prepare('SELECT COUNT(*) AS n FROM services').get().n;
  const fetchFn = fakeFetch();
  for (const [method, path, body] of [['POST', '/api/admin/services/preview', NEW], ['POST', '/api/admin/services', NEW], ['PATCH', '/api/admin/services/keychats', { isActive: false }]]) {
    assert.equal((await admin(db, method, path, body, { token: null, fetchFn })).status, 401, path);
    assert.equal((await admin(db, method, path, body, { token: 'wrong', fetchFn })).status, 401, path);
  }
  assert.equal(fetchFn.calls.length, 0, '인증 전에는 외부로 요청하지 않음');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM services').get().n, before);
});

test('미리 점검: 저장하지 않고 3개 점검을 한 번씩 돌려 결과와 제안 키를 돌려준다', async () => {
  const db = createFakeD1();
  const fetchFn = fakeFetch();
  const res = await admin(db, 'POST', '/api/admin/services/preview', { url: NEW.url, healthUrl: NEW.healthUrl, healthKeyword: NEW.healthKeyword }, { fetchFn });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.proposed, { key: 'my-app', name: 'my-app.pages.dev', homeUrl: 'https://my-app.pages.dev/' });
  assert.equal(body.alreadyExists, false);
  assert.equal(body.limit, MAX_SERVICES);
  assert.deepEqual(body.checks.map((c) => [c.kind, c.isSuccess]), [['http', true], ['dns', true], ['http', true]]);
  assert.equal(body.checks[1].records, 1);
  assert.equal(fetchFn.calls.length, 3);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM services WHERE service_key = 'my-app'").get().n, 0, '저장 안 함');
});

test('미리 점검: 사이트가 503이면 실패와 이유를 알려 준다 (추가를 막지는 않음)', async () => {
  const res = await admin(createFakeD1(), 'POST', '/api/admin/services/preview', { url: NEW.url }, { fetchFn: fakeFetch({ siteStatus: 503 }) });
  const body = await res.json();
  assert.deepEqual([body.checks[0].isSuccess, body.checks[0].statusCode, body.checks[0].failureText], [false, 503, '상태 코드 불일치']);
});

test('추가: 서비스 1개 + 점검 3개를 실제(real)·켜짐으로 만들고, 대시보드 목록 맨 뒤에 나온다', async () => {
  const db = createFakeD1();
  const res = await admin(db, 'POST', '/api/admin/services', NEW);
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), {
    ok: true, key: 'my-app', name: '내 앱',
    checks: [{ name: '내 앱 (HTTP)', kind: 'http' }, { name: '내 앱 (DNS)', kind: 'dns' }, { name: '내 앱 (상태 확인)', kind: 'http' }],
  });
  const svc = db.sqlite.prepare("SELECT * FROM services WHERE service_key = 'my-app'").get();
  assert.deepEqual([svc.name, svc.description, svc.home_url, svc.is_active, svc.source], ['내 앱', '팀 프로젝트', 'https://my-app.pages.dev/', 1, 'real']);
  const mons = db.sqlite.prepare('SELECT name, kind, url, keyword, is_active, source FROM monitors WHERE service_id = ? ORDER BY id').all(svc.id);
  assert.equal(mons.length, 3);
  assert.ok(mons.every((m) => m.is_active === 1 && m.source === 'real'));
  assert.equal(mons[2].keyword, '"ok"');

  const { services } = await buildServices(db, new Date('2026-11-20T03:00:00Z'));
  assert.equal(services.at(-1).key, 'my-app');
  assert.equal(services.at(-1).checks.length, 3);
});

test('추가한 서비스는 다음 Cron 회차부터 점검되고 서비스 집계가 쌓인다', async () => {
  const db = createFakeD1();
  db.sqlite.exec('UPDATE monitors SET is_active = 0'); // 기존 대상은 꺼서 이번 테스트만 보이게
  await admin(db, 'POST', '/api/admin/services', NEW);
  const log = console.log;
  console.log = () => {};
  try {
    await runChecks({ DB: db }, new Date('2026-11-20T03:05:12Z'), { fetchFn: fakeFetch() });
  } finally {
    console.log = log;
  }
  const row = db.sqlite.prepare("SELECT d.total_slots, d.up_slots FROM service_daily_stats d JOIN services s ON s.id = d.service_id WHERE s.service_key = 'my-app'").get();
  assert.deepEqual([row.total_slots, row.up_slots], [1, 1]);
});

test('추가 거부: 동의 없음 400, 같은 주소 409(끝의 / 차이 무시), 상한 409', async () => {
  const db = createFakeD1();
  assert.equal((await admin(db, 'POST', '/api/admin/services', { ...NEW, consent: false })).status, 400);
  // 이미 있는 고쳐라!(home_url은 끝에 / 없이 저장됨)
  const dup = await admin(db, 'POST', '/api/admin/services', { url: 'https://gochyeora.pages.dev/', consent: true });
  assert.deepEqual([dup.status, (await dup.json()).error], [409, 'already_exists']);
  // 상한: 지금 켜진 2개 + 8개 = 10개까지
  for (let i = 0; i < MAX_SERVICES - 2; i += 1) {
    assert.equal((await admin(db, 'POST', '/api/admin/services', { url: `https://app${i}.pages.dev`, consent: true })).status, 201, `app${i}`);
  }
  const over = await admin(db, 'POST', '/api/admin/services', { url: 'https://one-more.pages.dev', consent: true });
  assert.deepEqual([over.status, (await over.json()).error], [409, 'limit_reached']);
});

test('끄기: 서비스와 점검이 꺼져 목록·Cron에서 빠지고 기록은 남는다. 다시 켜기도 상한을 지킨다', async () => {
  const db = createFakeD1();
  await admin(db, 'POST', '/api/admin/services', NEW);
  const off = await admin(db, 'PATCH', '/api/admin/services/my-app', { isActive: false });
  assert.deepEqual(await off.json(), { ok: true, key: 'my-app', isActive: false });
  const svcId = db.sqlite.prepare("SELECT id FROM services WHERE service_key = 'my-app'").get().id;
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM monitors WHERE service_id = ? AND is_active = 1').get(svcId).n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM monitors WHERE service_id = ?').get(svcId).n, 3, '점검 행은 지우지 않음');
  const { services } = await buildServices(db, new Date());
  assert.ok(!services.some((s) => s.key === 'my-app'));

  assert.equal((await admin(db, 'PATCH', '/api/admin/services/my-app', { isActive: true })).status, 200);
  assert.equal((await admin(db, 'PATCH', '/api/admin/services/nope', { isActive: false })).status, 404);
  assert.equal((await admin(db, 'PATCH', '/api/admin/services/my-app', { isActive: 'no' })).status, 400);
  assert.equal((await admin(db, 'POST', '/api/admin/services/my-app', { isActive: false })).status, 405);

  // 같은 호스트를 다시 추가하면(꺼져 있어도 키는 재사용하지 않음) my-app-2
  await admin(db, 'PATCH', '/api/admin/services/my-app', { isActive: false });
  const again = await admin(db, 'POST', '/api/admin/services', { url: 'https://my-app.pages.dev', consent: true });
  assert.equal((await again.json()).key, 'my-app-2');
});
