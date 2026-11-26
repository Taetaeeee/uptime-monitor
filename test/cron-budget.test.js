// 서비스 상한 20 · 점검 예산 (29단계) 테스트
//   Workers 무료 플랜은 실행 1회에 바깥 요청 50개까지 → 켜진 HTTP·DNS 점검을 44개까지로 지킴
//   (가짜 D1 + 가짜 fetch, 실제 사이트에 요청하지 않음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './helpers/fake-d1.js';
import { MAX_SERVICES, MAX_ACTIVE_CHECKS, FETCH_LIMIT_PER_RUN, checkBudget } from '../src/service-admin.js';
import { handleAdmin } from '../src/admin.js';
import { runChecks } from '../src/index.js';

const TOKEN = 'test-admin-token'; // 테스트 전용 값 (실제 토큰 아님)
const SELF = 'status-monitor.example.workers.dev';

/** 가짜 fetch: 부른 횟수를 셈. DoH 질문이면 DNS 응답, 아니면 200 */
function countingFetch() {
  const fn = async (u) => {
    fn.calls += 1;
    if (String(u).includes('cloudflare-dns.com')) {
      return new Response(JSON.stringify({ Status: 0, Answer: [{ name: 'x', type: 1, data: '192.0.2.10' }] }), { status: 200 });
    }
    return new Response('<html>ok</html>', { status: 200 });
  };
  fn.calls = 0;
  return fn;
}
async function admin(db, method, path, body, fetchFn = countingFetch()) {
  const request = new Request(`https://${SELF}${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body),
  });
  const [log, err] = [console.log, console.error];
  console.log = console.error = () => {};
  try {
    return await handleAdmin(request, { DB: db, ADMIN_TOKEN: TOKEN }, new URL(request.url), { fetchFn, now: new Date('2026-11-26T03:00:00Z') });
  } finally {
    console.log = log; console.error = err;
  }
}
const add = (db, i, withHealth) => admin(db, 'POST', '/api/admin/services', {
  url: `https://app${i}.pages.dev`, consent: true, ...(withHealth ? { healthUrl: `https://app${i}.pages.dev/api/health` } : {}),
});
/** 마이그레이션의 고쳐라!·Keychats 점검은 비활성으로 들어가므로(원격에서 켬) 라이브처럼 켜 둔 DB */
function liveLikeDb() {
  const db = createFakeD1();
  db.sqlite.exec("UPDATE monitors SET is_active = 1 WHERE service_id IS NOT NULL");
  return db;
}
const activeChecks = (db) => db.sqlite.prepare("SELECT COUNT(*) AS n FROM monitors WHERE is_active = 1 AND kind IN ('http', 'dns')").get().n;

test('상수: 서비스 20개, 점검 예산 = 요청 한도 50 − 여유 6 = 44', () => {
  assert.equal(MAX_SERVICES, 20);
  assert.equal(FETCH_LIMIT_PER_RUN, 50);
  assert.equal(MAX_ACTIVE_CHECKS, 44);
  // 상태 확인 주소 없는 서비스(점검 2개) 20개는 예산 안에 들어가야 함 (서비스 상한과 점검 예산이 서로 모순되지 않게)
  assert.ok(MAX_SERVICES * 2 <= MAX_ACTIVE_CHECKS);
});

test('checkBudget: 44개까지는 되고, 넘으면 안 됨', () => {
  assert.deepEqual(checkBudget(41, 3), { ok: true, after: 44, limit: 44 });
  assert.deepEqual(checkBudget(42, 3), { ok: false, after: 45, limit: 44 });
  assert.deepEqual(checkBudget(44, 0), { ok: true, after: 44, limit: 44 });
});

test('추가: 서비스가 20개 안이어도 켜진 점검이 44개를 넘으면 409 check_limit_reached, 미리 점검은 남은 예산을 알려 줌', async () => {
  const db = liveLikeDb();
  assert.equal(activeChecks(db), 5); // 테스트 DB 기본: 고쳐라!(2) + Keychats(3)
  // 상태 확인 주소가 붙은 서비스(점검 3개) 13개 → 5 + 39 = 44 (서비스는 15개)
  for (let i = 0; i < 13; i += 1) assert.equal((await add(db, i, true)).status, 201, `app${i}`);
  assert.equal(activeChecks(db), 44);

  const pre = await admin(db, 'POST', '/api/admin/services/preview', { url: 'https://next.pages.dev' });
  const p = await pre.json();
  assert.deepEqual([p.activeCount, p.limit, p.checkCount, p.checkLimit], [15, 20, 46, 44]);

  const over = await add(db, 99, false); // 점검 2개만 더해도 46
  assert.equal(over.status, 409);
  assert.deepEqual(await over.json(), { error: 'check_limit_reached', checkCount: 46, checkLimit: 44 });
  assert.equal(activeChecks(db), 44, '거부되면 아무것도 만들지 않음');
});

test('다시 켜기: 그 서비스의 점검이 모두 다시 켜지므로 예산을 넘으면 409', async () => {
  const db = liveLikeDb();
  for (let i = 0; i < 13; i += 1) await add(db, i, true); // 점검 44개
  assert.equal((await admin(db, 'PATCH', '/api/admin/services/app0', { isActive: false })).status, 200); // 44 − 3 = 41
  assert.equal((await add(db, 50, false)).status, 201); // 41 + 2 = 43
  const back = await admin(db, 'PATCH', '/api/admin/services/app0', { isActive: true }); // 43 + 3 = 46
  assert.equal(back.status, 409);
  assert.deepEqual(await back.json(), { error: 'check_limit_reached', checkCount: 46, checkLimit: 44 });
  // 하나 더 끄면 다시 켤 수 있음: 43 − 2 + 3 = 44
  assert.equal((await admin(db, 'PATCH', '/api/admin/services/app50', { isActive: false })).status, 200);
  assert.equal((await admin(db, 'PATCH', '/api/admin/services/app0', { isActive: true })).status, 200);
  assert.equal(activeChecks(db), 44);
});

test('서비스 20개(점검 예산을 꽉 채움)에서 Cron 1회의 바깥 요청은 44개 = 한도 50 안, 21번째 서비스는 409', async () => {
  const db = liveLikeDb();
  // 기본 2개(점검 5) + 상태 확인 붙은 3개(9) + 점검 2개짜리 15개(30) = 서비스 20개, 점검 44개
  for (let i = 0; i < 3; i += 1) assert.equal((await add(db, i, true)).status, 201);
  for (let i = 10; i < 25; i += 1) assert.equal((await add(db, i, false)).status, 201, `app${i}`);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM services WHERE is_active = 1').get().n, 20);
  assert.equal(activeChecks(db), 44);
  const over = await add(db, 99, false);
  assert.deepEqual([over.status, (await over.json()).error], [409, 'limit_reached']); // 서비스 상한이 먼저

  // Cron 1회: 점검마다 요청 1개 (HTTP는 그 주소, DNS는 DoH 1번) → 44개
  const fetchFn = countingFetch();
  const log = console.log;
  console.log = () => {};
  try {
    const rows = await runChecks({ DB: db }, new Date('2026-11-26T03:00:00Z'), { fetchFn });
    assert.equal(rows.length, 44);
  } finally {
    console.log = log;
  }
  assert.equal(fetchFn.calls, 44);
  assert.ok(fetchFn.calls <= FETCH_LIMIT_PER_RUN - 6, '메일·리다이렉트 몫 6개를 남김');
});
