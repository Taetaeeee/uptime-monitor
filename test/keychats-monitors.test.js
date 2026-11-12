// 사내 메신저(Keychats) 점검 대상 3개 (마이그레이션 0011) 테스트
// 실제 사이트에는 요청하지 않고 가짜 fetch로 "켠 뒤에 어떻게 판정되는지"를 미리 확인합니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './helpers/fake-d1.js';
import { runChecks } from '../src/index.js';
import { getActiveMonitors } from '../src/db.js';
import { buildStatus } from '../src/api.js';

const NAMES = ['사내 메신저 (HTTP)', '사내 메신저 (DNS)', '사내 메신저 (DB 상태)'];
const get = (db) => db.sqlite.prepare("SELECT * FROM monitors WHERE name LIKE '사내 메신저%' ORDER BY id").all();

test('0011: 대상 3개가 실제(real)·비활성으로 등록되고, 종류·주소·키워드가 의도대로다', () => {
  const rows = get(createFakeD1());
  assert.deepEqual(rows.map((r) => r.name), NAMES);
  for (const r of rows) {
    assert.equal(r.source, 'real');
    assert.equal(r.is_active, 0, '켜기 전에는 점검하지 않음');
  }
  const [http, dns, health] = rows;
  assert.deepEqual([http.kind, http.url, http.expected_status, http.keyword], ['http', 'https://keychats.vercel.app/', 200, 'Keychats']);
  assert.deepEqual([dns.kind, dns.url, dns.keyword], ['dns', 'dns://keychats.vercel.app', null]);
  // Keychats는 basePath '/chats'를 쓰므로 상태 확인 주소도 /chats 아래
  assert.deepEqual([health.kind, health.url, health.expected_status, health.keyword], ['http', 'https://keychats.vercel.app/chats/api/health', 200, '"ok"']);
});

test('점검 금지 주소(채널·메시지)는 어떤 대상에도 쓰지 않는다', () => {
  for (const r of get(createFakeD1())) assert.ok(!/\/channel\/|\/dm\/|\/community\//.test(r.url), r.url);
});

test('비활성인 동안에는 점검 대상에서 빠지고, 화면에는 "점검 대기"로 나온다', async () => {
  const db = createFakeD1();
  const active = await getActiveMonitors(db);
  assert.ok(!active.some((m) => m.name.startsWith('사내 메신저')));
  const status = await buildStatus(db, new Date());
  const mine = status.services.filter((s) => s.name.startsWith('사내 메신저'));
  assert.equal(mine.length, 3);
  assert.ok(mine.every((s) => s.state === 'paused' && s.source === 'real'));
  assert.ok(mine.every((s) => !('url' in s)), '공개 응답에 주소를 넣지 않음');
});

/** URL별로 응답을 돌려주는 가짜 fetch: Keychats 루트·상태 확인·DoH */
function fakeFetch({ health = { status: 200, body: '{"status":"ok"}' }, root = { status: 200, body: '<title>Keychats</title>' } } = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes('cloudflare-dns.com')) {
      return new Response(JSON.stringify({ Status: 0, Answer: [{ name: 'keychats.vercel.app', type: 1, data: '76.76.21.21' }] }), { status: 200 });
    }
    if (u.endsWith('/chats/api/health')) return new Response(health.body, { status: health.status });
    return new Response(root.body, { status: root.status });
  };
}

async function runWith(fetchFn, count = 1) {
  const db = createFakeD1();
  db.sqlite.exec("UPDATE monitors SET is_active = 1 WHERE name LIKE '사내 메신저%'"); // 켠 상태를 흉내
  const log = console.log;
  console.log = () => {};
  try {
    for (let i = 0; i < count; i += 1) await runChecks({ DB: db }, new Date(Date.UTC(2026, 10, 12, 3, i * 5, 12)), { fetchFn });
  } finally {
    console.log = log;
  }
  return db;
}
const results = (db) =>
  Object.fromEntries(db.sqlite.prepare(
    "SELECT m.name, r.is_success, r.failure_reason FROM check_results r JOIN monitors m ON m.id = r.monitor_id WHERE m.name LIKE '사내 메신저%'"
  ).all().map((r) => [r.name, [r.is_success, r.failure_reason]]));

test('켠 뒤: 세 점검이 모두 정상이면 모두 성공으로 기록된다', async () => {
  const r = results(await runWith(fakeFetch()));
  assert.deepEqual(r, {
    '사내 메신저 (HTTP)': [1, null],
    '사내 메신저 (DNS)': [1, null],
    '사내 메신저 (DB 상태)': [1, null],
  });
});

test('DB 상태 주소가 503 {"status":"error"}면 DB 상태만 실패하고, 페이지(HTTP)는 정상으로 남는다', async () => {
  const r = results(await runWith(fakeFetch({ health: { status: 503, body: '{"status":"error"}' } })));
  assert.deepEqual(r['사내 메신저 (DB 상태)'], [0, 'status_mismatch']);
  assert.deepEqual(r['사내 메신저 (HTTP)'], [1, null]); // "페이지는 뜨는데 DB가 멈춘" 장애를 구분
});

test('상태 확인 주소가 200이어도 본문이 ok가 아니면 실패한다 (키워드 검사)', async () => {
  const r = results(await runWith(fakeFetch({ health: { status: 200, body: '{"status":"error"}' } })));
  assert.deepEqual(r['사내 메신저 (DB 상태)'], [0, 'keyword_missing']);
});

test('상태 확인 주소가 아직 없으면(404) 실패한다 — 그래서 배포 전에는 켜지 않는다', async () => {
  const r = results(await runWith(fakeFetch({ health: { status: 404, body: 'not found' } })));
  assert.deepEqual(r['사내 메신저 (DB 상태)'], [0, 'status_mismatch']);
});

test('연속 2회 실패에서 DB 상태 장애가 열리고, 알림 문구에 사용자 정보가 없다', async () => {
  const db = await runWith(fakeFetch({ health: { status: 503, body: '{"status":"error"}' } }), 2);
  const n = db.sqlite.prepare("SELECT event, message, source FROM notifications").all();
  assert.equal(n.length, 1);
  assert.equal(n[0].event, 'down');
  assert.equal(n[0].source, 'real');
  assert.match(n[0].message, /사내 메신저 \(DB 상태\)/);
});
