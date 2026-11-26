// 서비스 종류 (28단계) 테스트 — 추천 단어 표 · 입력 검사 · 관리자 추가/PATCH · 공개 응답 · 0022 · 화면 아이콘 짝
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createFakeD1 } from './helpers/fake-d1.js';
import { SERVICE_CATEGORIES, CATEGORY_LABEL, suggestCategory, checkCategory, validateServiceInput } from '../src/service-admin.js';
import { handleAdmin } from '../src/admin.js';
import { buildServices } from '../src/api.js';

const TOKEN = 'test-admin-token'; // 테스트 전용 값 (실제 토큰 아님)
const SELF = 'status-monitor.example.workers.dev';

function fakeFetch() {
  return async (u) => {
    const s = String(u);
    if (s.includes('cloudflare-dns.com')) return new Response(JSON.stringify({ Status: 0, Answer: [{ name: 'x', type: 1, data: '192.0.2.10' }] }), { status: 200 });
    return new Response('<html>ok</html>', { status: 200 });
  };
}
function admin(db, method, path, body) {
  const request = new Request(`https://${SELF}${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const [log, err] = [console.log, console.error];
  console.log = console.error = () => {};
  return handleAdmin(request, { DB: db, ADMIN_TOKEN: TOKEN }, new URL(request.url), { fetchFn: fakeFetch(), now: new Date('2026-11-26T03:00:00Z') })
    .finally(() => { console.log = log; console.error = err; });
}

test('suggestCategory: 지금 켜진 10개 서비스의 이름·설명으로 0022 초기값과 같은 종류를 추천한다', () => {
  // 2026-11-26 공개 API(/api/services)의 이름·설명 그대로
  const cases = [
    ['고쳐라!', '웹게임 (Cloudflare Pages)', 'game'],
    ['Keychats', '학원 팀 채팅 (Vercel)', 'chat'], // '학원'(교육)보다 채팅이 먼저
    ['FITLOG 핏로그', '내 체형과 옷장 기준으로 살지 말지 같이 보는 옷 쇼핑 도우미', 'lifestyle'], // 쇼핑보다 패션·생활이 먼저, 'LOG'는 기록 아님
    ['기록 보관소', '나의 모든 기록', 'note'],
    ['할머니, 김장 어떻게 해요?', '김장 시뮬레이션 게임', 'game'],
    ['일어나 백수야', '백수 갱생 시뮬레이션 게임', 'game'],
    ['이글루 빌리지', '나만의 이글루', 'community'],
    ['이음 [신장 기증 공여자 추적기록]', '신장 기증자인 공여자를 추적하며 검사 결과 기록', 'health'], // '기록'보다 의료가 먼저
    ['의원 인트라넷', '병원 인트라넷 경험 프로젝트', 'work'], // '병원'(의료)보다 사내 업무가 먼저
    ['SceneWalk AI', '덕질 성지를 3D 가상 골목으로 옮겨, 캐릭터로 걸으며 스탬프를 모으고 동네 가게 쿠폰을 받는 웹 서비스', 'ai'],
  ];
  for (const [name, desc, want] of cases) assert.equal(suggestCategory(name, desc), want, name);
  // 단어 경계: 'daily mail' 안의 ai는 AI가 아님, 아무 단어도 없으면 기타
  assert.equal(suggestCategory('Daily Mail', ''), 'other');
  assert.equal(suggestCategory('팀 프로젝트', null), 'other');
  assert.equal(suggestCategory('Study Group', ''), 'education');
});

test('checkCategory·validateServiceInput: 목록 안의 종류만, 안 고르면 추천값', () => {
  assert.deepEqual(checkCategory(undefined), { ok: true, value: null });
  assert.deepEqual(checkCategory('game'), { ok: true, value: 'game' });
  assert.equal(checkCategory('weird').ok, false);
  const base = { url: 'https://my-app.pages.dev', consent: true };
  assert.equal(validateServiceInput({ ...base, description: '퍼즐 게임' }, { selfHost: SELF }).value.category, 'game');
  assert.equal(validateServiceInput({ ...base, description: '퍼즐 게임', category: 'education' }, { selfHost: SELF }).value.category, 'education'); // 운영자가 고른 값이 이김
  assert.deepEqual(validateServiceInput({ ...base, category: 'nope' }, { selfHost: SELF }), { ok: false, error: 'category_invalid' });
});

test('관리자: 미리 점검은 추천 종류를 주고, 추가는 고른 종류를 저장하고, PATCH로 바꾼다', async () => {
  const db = createFakeD1();
  const pre = await admin(db, 'POST', '/api/admin/services/preview', { url: 'https://my-app.pages.dev', description: '팀 채팅 앱' });
  assert.equal((await pre.json()).suggestedCategory, 'chat');

  const add = await admin(db, 'POST', '/api/admin/services', { url: 'https://my-app.pages.dev', description: '팀 채팅 앱', category: 'work', consent: true });
  assert.equal(add.status, 201);
  assert.equal((await add.json()).category, 'work');
  const row = () => db.sqlite.prepare("SELECT category, is_active FROM services WHERE service_key = 'my-app'").get();
  assert.equal(row().category, 'work');

  // 종류만 바꾸기
  const p1 = await admin(db, 'PATCH', '/api/admin/services/my-app', { category: 'education' });
  assert.deepEqual([p1.status, (await p1.json()).category], [200, 'education']);
  assert.equal(row().category, 'education');
  // 잘못된 종류 400, 없는 서비스 404, 둘 다 없으면 400 (예전 끄기·켜기는 그대로)
  assert.equal((await admin(db, 'PATCH', '/api/admin/services/my-app', { category: 'nope' })).status, 400);
  assert.equal((await admin(db, 'PATCH', '/api/admin/services/nope', { category: 'game' })).status, 404);
  assert.equal((await admin(db, 'PATCH', '/api/admin/services/my-app', {})).status, 400);
  // 종류와 끄기를 함께
  const p2 = await admin(db, 'PATCH', '/api/admin/services/my-app', { category: 'game', isActive: false });
  assert.equal(p2.status, 200);
  assert.deepEqual({ ...row() }, { category: 'game', is_active: 0 });
});

test('0022: 기본값은 other, 목록 밖 값은 DB가 막고, 초기값이 들어간 서비스는 공개 응답에 category로 나온다', async () => {
  const db = createFakeD1();
  // 테스트 DB에는 고쳐라!·Keychats만 있음 → 0022의 UPDATE로 game·chat
  const { services } = await buildServices(db, new Date('2026-11-26T03:00:00Z'));
  assert.deepEqual(Object.fromEntries(services.map((s) => [s.key, s.category])), { gochyeora: 'game', keychats: 'chat' });
  assert.throws(() => db.sqlite.exec("UPDATE services SET category = 'oops'"));
  const ddl = readFileSync(new URL('../migrations/0022_service_category.sql', import.meta.url), 'utf8');
  for (const c of SERVICE_CATEGORIES) assert.ok(ddl.includes(`'${c}'`), `0022 CHECK에 ${c}`); // 서버 목록과 DB CHECK가 같음
});

test('화면: 모든 종류에 아이콘과 한글 이름이 있고, 아이콘은 common.js 모음에 있다', () => {
  // 클래식 스크립트라 vm으로 읽음: common.js(ICONS) + detail.js의 CATEGORY_ICON 줄만
  const common = readFileSync(new URL('../public/common.js', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('../public/detail.js', import.meta.url), 'utf8');
  const iconsSrc = common.slice(common.indexOf('const ICONS = {'), common.indexOf('const SVG_NS'));
  const mapSrc = detail.match(/const CATEGORY_ICON = \{[^}]*\};/)[0];
  const labelSrc = detail.match(/const CATEGORY_TEXT = \{[^}]*\};/)[0];
  const ctx = {};
  vm.runInNewContext(`${iconsSrc}\n${mapSrc}\n${labelSrc}\nthis.ICONS = ICONS; this.CATEGORY_ICON = CATEGORY_ICON; this.CATEGORY_TEXT = CATEGORY_TEXT;`, ctx);
  for (const c of SERVICE_CATEGORIES) {
    assert.ok(ctx.CATEGORY_ICON[c], `아이콘 짝: ${c}`);
    assert.ok(ctx.ICONS[ctx.CATEGORY_ICON[c]], `아이콘 모양: ${ctx.CATEGORY_ICON[c]}`);
    assert.equal(ctx.CATEGORY_TEXT[c], CATEGORY_LABEL[c], `한글 이름: ${c}`); // 화면과 서버의 이름이 같음
  }
});
