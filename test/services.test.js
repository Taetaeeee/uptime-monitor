// 서비스 묶음 (마이그레이션 0015 + service-status.js + /api/services) 테스트
// 실제 사이트에는 요청하지 않고, 가짜 D1과 가짜 fetch로 "묶음 → 집계 → 공개 API"를 확인합니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeD1 } from './helpers/fake-d1.js';
import { serviceState, summarizeSlots, SERVICE_STATE } from '../src/service-status.js';
import { buildServices } from '../src/api.js';
import worker, { runChecks } from '../src/index.js';

const MIGRATION = readFileSync(new URL('../migrations/0015_services.sql', import.meta.url), 'utf8');

const membersOf = (db, key) =>
  db.sqlite
    .prepare('SELECT m.url FROM monitors m JOIN services s ON s.id = m.service_id WHERE s.service_key = ? ORDER BY m.id')
    .all(key)
    .map((r) => r.url);

// ── 마이그레이션 ──

test('0015: 서비스 2개가 실제(real)로 등록되고, 점검이 주소로 연결된다', () => {
  const db = createFakeD1();
  const services = db.sqlite.prepare('SELECT service_key, name, source, is_active FROM services ORDER BY sort_order').all();
  assert.deepEqual(services.map((s) => [s.service_key, s.name, s.source, s.is_active]), [
    ['gochyeora', '고쳐라!', 'real', 1],
    ['keychats', 'Keychats', 'real', 1],
  ]);
  assert.deepEqual(membersOf(db, 'gochyeora'), ['https://gochyeora.pages.dev', 'dns://gochyeora.pages.dev']);
  assert.deepEqual(membersOf(db, 'keychats'), [
    'https://keychats.vercel.app/',
    'dns://keychats.vercel.app',
    'https://keychats.vercel.app/chats/api/health',
  ]);
  // 훈련 대상처럼 실제 서비스가 아닌 점검은 어느 서비스에도 묶이지 않음
  const loose = db.sqlite.prepare('SELECT COUNT(*) AS n FROM monitors WHERE service_id IS NULL').get().n;
  assert.equal(loose, db.sqlite.prepare('SELECT COUNT(*) AS n FROM monitors').get().n - 5);
});

test('0015: 서비스 키는 영문 소문자·숫자·하이픈만 허용한다 (DB CHECK)', () => {
  const db = createFakeD1();
  const insert = (key) => () => db.sqlite.prepare("INSERT INTO services (service_key, name) VALUES (?, 'x')").run(key);
  assert.doesNotThrow(insert('my-app2'));
  for (const bad of ['My-App', '-app', 'a b', 'app/x', '']) assert.throws(insert(bad), /CHECK/, bad);
});

// ── 서비스 상태 판정 ──

test('serviceState: 장애는 느림보다 먼저, 일부만 장애면 부분 장애', () => {
  const S = (state, lastIsSlow = false) => ({ state, lastIsSlow });
  const cases = [
    [[S('up'), S('up')], SERVICE_STATE.UP],
    [[S('up', true), S('up')], SERVICE_STATE.DEGRADED],
    [[S('down'), S('up', true)], SERVICE_STATE.PARTIAL],
    [[S('down'), S('down')], SERVICE_STATE.DOWN],
    [[S('down'), S('paused')], SERVICE_STATE.DOWN], // 꺼진 점검은 판정에서 뺌
    [[S('paused'), S('paused')], SERVICE_STATE.PAUSED],
    [[], SERVICE_STATE.PAUSED],
    [[S('maintenance'), S('paused')], SERVICE_STATE.MAINTENANCE],
    [[S('maintenance'), S('up')], SERVICE_STATE.UP], // 작업 중이 아닌 점검으로 판정
    [[S('unknown'), S('unknown')], SERVICE_STATE.UNKNOWN],
    [[S('unknown'), S('up')], SERVICE_STATE.UP],
    [[S('unknown'), S('down')], SERVICE_STATE.PARTIAL],
  ];
  for (const [checks, expected] of cases) {
    assert.equal(serviceState(checks), expected, JSON.stringify(checks));
  }
});

// ── 회차 단위 가동률 ──

const T1 = '2026-11-19T00:00:00Z';
const T2 = '2026-11-19T00:05:00Z';
const T3 = '2026-11-19T00:10:00Z';
const r = (checkedAt, isSuccess, isSlow = false, inMaintenance = false) => ({ checkedAt, isSuccess, isSlow, inMaintenance });

test('summarizeSlots: 같은 회차에 두 점검이 함께 실패해도 장애 회차는 1번', () => {
  const rows = [r(T1, true), r(T1, true), r(T2, false), r(T2, false), r(T3, true, true), r(T3, true)];
  assert.deepEqual(summarizeSlots(rows), { totalSlots: 3, upSlots: 2, slowSlots: 1 });
});

test('summarizeSlots: 한 점검만 실패해도 그 회차는 장애, 계획 작업 중 결과는 뺀다', () => {
  const rows = [r(T1, true), r(T1, false), r(T2, false, false, true), r(T2, true)];
  // T1: 하나 실패 → 장애 회차. T2: 작업 중 실패는 빼고 성공 1건만 → 정상 회차
  assert.deepEqual(summarizeSlots(rows), { totalSlots: 2, upSlots: 1, slowSlots: 0 });
  assert.deepEqual(summarizeSlots([r(T1, false, false, true)]), { totalSlots: 0, upSlots: 0, slowSlots: 0 });
});

test('0015의 지난 기록 채우기 SQL과 summarizeSlots가 같은 결과를 낸다', () => {
  const db = createFakeD1();
  db.sqlite.exec("UPDATE monitors SET is_active = 1 WHERE service_id IS NOT NULL");
  const ids = db.sqlite.prepare("SELECT m.id FROM monitors m JOIN services s ON s.id = m.service_id WHERE s.service_key = 'keychats' ORDER BY m.id").all().map((x) => x.id);
  // 한국 날짜 경계(UTC 15:00)를 걸치게 넣습니다: 14:55는 19일, 15:00은 20일
  const rows = [
    [ids[0], '2026-11-19T14:55:00Z', 1, 0, 0], [ids[1], '2026-11-19T14:55:00Z', 1, 0, 0], [ids[2], '2026-11-19T14:55:00Z', 0, 0, 0],
    [ids[0], '2026-11-19T15:00:00Z', 1, 1, 0], [ids[1], '2026-11-19T15:00:00Z', 1, 0, 0], [ids[2], '2026-11-19T15:00:00Z', 1, 0, 0],
    [ids[0], '2026-11-19T15:05:00Z', 0, 0, 1], [ids[1], '2026-11-19T15:05:00Z', 1, 0, 0], [ids[2], '2026-11-19T15:05:00Z', 1, 0, 0],
  ];
  const ins = db.sqlite.prepare(
    "INSERT INTO check_results (monitor_id, checked_at, is_success, is_slow, in_maintenance, source) VALUES (?, ?, ?, ?, ?, 'real')"
  );
  for (const row of rows) ins.run(...row);

  // 마이그레이션 파일의 채우기 문장만 다시 실행
  const backfill = MIGRATION.slice(MIGRATION.indexOf('INSERT INTO service_daily_stats'));
  db.sqlite.exec('DELETE FROM service_daily_stats');
  db.sqlite.exec(backfill);
  const fromSql = db.sqlite.prepare('SELECT day, total_slots, up_slots, slow_slots FROM service_daily_stats ORDER BY day').all()
    .map((x) => [x.day, x.total_slots, x.up_slots, x.slow_slots]);

  const asRows = rows.map(([, checkedAt, s, slow, m]) => r(checkedAt, s === 1, slow === 1, m === 1));
  const day19 = summarizeSlots(asRows.filter((x) => x.checkedAt < '2026-11-19T15:00:00Z'));
  const day20 = summarizeSlots(asRows.filter((x) => x.checkedAt >= '2026-11-19T15:00:00Z'));
  assert.deepEqual(fromSql, [
    ['2026-11-19', day19.totalSlots, day19.upSlots, day19.slowSlots],
    ['2026-11-20', day20.totalSlots, day20.upSlots, day20.slowSlots],
  ]);
  assert.deepEqual(fromSql, [['2026-11-19', 1, 0, 0], ['2026-11-20', 2, 2, 1]]);
});

// ── Cron 집계 → 공개 API ──

/** 주소별로 응답을 돌려주는 가짜 fetch (고쳐라!·Keychats·DoH) */
function fakeFetch({ healthOk = true } = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes('cloudflare-dns.com')) {
      return new Response(JSON.stringify({ Status: 0, Answer: [{ name: 'x', type: 1, data: '192.0.2.1' }] }), { status: 200 });
    }
    if (u.endsWith('/chats/api/health')) {
      return new Response(healthOk ? '{"status":"ok"}' : '{"status":"error"}', { status: healthOk ? 200 : 503 });
    }
    return new Response('<title>Keychats</title> 고쳐라', { status: 200 });
  };
}

async function runCron(db, fetchFn, times) {
  const log = console.log;
  console.log = () => {};
  try {
    for (const t of times) await runChecks({ DB: db }, t, { fetchFn });
  } finally {
    console.log = log;
  }
}

test('Cron 회차마다 서비스 일별 집계가 쌓이고, DB 상태만 실패해도 Keychats 회차는 장애로 센다', async () => {
  const db = createFakeD1();
  db.sqlite.exec('UPDATE monitors SET is_active = 1 WHERE service_id IS NOT NULL');
  const at = (min) => new Date(Date.UTC(2026, 10, 19, 3, min, 12)); // KST 2026-11-19 12시대
  await runCron(db, fakeFetch(), [at(0), at(5)]);
  await runCron(db, fakeFetch({ healthOk: false }), [at(10)]);

  const stats = db.sqlite.prepare(
    'SELECT s.service_key, d.day, d.total_slots, d.up_slots, d.source FROM service_daily_stats d JOIN services s ON s.id = d.service_id ORDER BY s.sort_order'
  ).all().map((x) => [x.service_key, x.day, x.total_slots, x.up_slots, x.source]);
  assert.deepEqual(stats, [
    ['gochyeora', '2026-11-19', 3, 3, 'real'],
    ['keychats', '2026-11-19', 3, 2, 'real'],
  ]);

  const body = await buildServices(db, at(11));
  const keychats = body.services.find((s) => s.key === 'keychats');
  assert.equal(keychats.uptime30d, 66.66); // 2/3, 내림
  assert.equal(keychats.checks.length, 3);
  assert.equal(keychats.daily.length, body.barDays);
  // 1회 실패는 아직 장애 판정 전(연속 2회 기준)이라 서비스는 정상
  assert.equal(keychats.state, SERVICE_STATE.UP);
});

test('연속 실패로 DB 상태 점검이 장애가 되면 Keychats는 부분 장애', async () => {
  const db = createFakeD1();
  db.sqlite.exec('UPDATE monitors SET is_active = 1 WHERE service_id IS NOT NULL');
  const at = (min) => new Date(Date.UTC(2026, 10, 19, 3, min, 12));
  await runCron(db, fakeFetch({ healthOk: false }), [at(0), at(5)]);
  const { services } = await buildServices(db, at(6));
  assert.equal(services.find((s) => s.key === 'keychats').state, SERVICE_STATE.PARTIAL);
  assert.equal(services.find((s) => s.key === 'gochyeora').state, SERVICE_STATE.UP);
});

test('켜기 전(비활성)에는 서비스가 점검 대기로 나온다', async () => {
  const db = createFakeD1();
  db.sqlite.exec('UPDATE monitors SET is_active = 0');
  const { services } = await buildServices(db, new Date());
  assert.deepEqual(services.map((s) => [s.key, s.state, s.uptime30d]), [
    ['gochyeora', 'paused', null],
    ['keychats', 'paused', null],
  ]);
});

test('GET /api/services: 대표 주소만 공개하고 점검 주소는 없으며, 내린 서비스는 목록·상세에서 빠진다', async () => {
  const db = createFakeD1();
  const call = (path, method = 'GET') => worker.fetch(new Request(`https://example.test${path}`, { method }), { DB: db });

  const res = await call('/api/services');
  assert.equal(res.status, 200);
  const text = await res.text();
  // 점검 주소(DNS 점검·DB 상태 확인 주소)는 공개하지 않음
  assert.ok(!/dns:\/\/|\/api\/health/.test(text), '점검 주소를 공개하지 않음');
  const list = JSON.parse(text).services;
  assert.deepEqual(list.map((s) => s.key), ['gochyeora', 'keychats']);
  // 대표 주소는 공개 사이트 첫 화면만 (S3 '사이트 열기' 링크). 응답에 나오는 http 주소는 이것뿐
  assert.deepEqual(list.map((s) => s.homeUrl), ['https://gochyeora.pages.dev', 'https://keychats.vercel.app/']);
  const urls = [...new Set(text.match(/https?:\/\/[^"]+/g))].sort();
  assert.deepEqual(urls, ['https://gochyeora.pages.dev', 'https://keychats.vercel.app/']);

  const detail = await call('/api/services/keychats');
  assert.equal(detail.status, 200);
  const d = await detail.json();
  assert.equal(d.service.key, 'keychats');
  assert.ok(Array.isArray(d.incidents));

  assert.equal((await call('/api/services/nope')).status, 404);
  assert.equal((await call('/api/services/Bad_Key')).status, 404); // 모양이 다른 키는 라우팅 단계에서 거름
  assert.equal((await call('/api/services', 'POST')).status, 405);

  db.sqlite.exec("UPDATE services SET is_active = 0 WHERE service_key = 'keychats'");
  assert.deepEqual((await (await call('/api/services')).json()).services.map((s) => s.key), ['gochyeora']);
  assert.equal((await call('/api/services/keychats')).status, 404);
});

test('서비스 상세의 장애 이력은 그 서비스에 묶인 점검의 장애만 담는다', async () => {
  const db = createFakeD1();
  db.sqlite.exec('UPDATE monitors SET is_active = 1 WHERE service_id IS NOT NULL');
  const at = (min) => new Date(Date.UTC(2026, 10, 19, 3, min, 12));
  await runCron(db, fakeFetch({ healthOk: false }), [at(0), at(5)]);
  const call = (key) => worker.fetch(new Request(`https://example.test/api/services/${key}`), { DB: db });
  const k = await (await call('keychats')).json();
  const g = await (await call('gochyeora')).json();
  assert.equal(k.incidents.length, 1);
  assert.equal(k.incidents[0].monitorName, '사내 메신저 (DB 상태)');
  assert.equal(g.incidents.length, 0);
});

// ── 23단계: 대시보드 '최근 배포(추정)'·'오늘 확인할 것'용 자료 ──

test('GET /api/services의 recentChanges: 최근 7일 변경만, 서비스 키·이름·시각·크기만 공개 (지문·주소 없음)', async () => {
  const db = createFakeD1();
  const now = new Date(Date.UTC(2026, 10, 25, 5, 0, 0));
  const idOf = (url) => db.sqlite.prepare('SELECT id FROM monitors WHERE url = ?').get(url).id;
  const add = (monitorId, at) =>
    db.sqlite
      .prepare("INSERT INTO content_changes (monitor_id, first_seen_at, confirmed_at, old_hash, new_hash, old_size, new_size, source) VALUES (?, ?, ?, 'aaaaaaaaaaaa', 'bbbbbbbbbbbb', 100, 120, 'real')")
      .run(monitorId, at, at);
  const g = idOf('https://gochyeora.pages.dev');
  add(g, '2026-11-24T01:00:00Z');
  add(g, '2026-11-10T01:00:00Z'); // 7일보다 오래됨 → 빠짐

  const body = await buildServices(db, now);
  assert.equal(body.recentChanges.length, 1);
  const c = body.recentChanges[0];
  assert.deepEqual(Object.keys(c).sort(), ['confirmedAt', 'firstSeenAt', 'kind', 'monitorId', 'newSize', 'oldSize', 'serviceKey', 'serviceName']); // kind: 27단계
  assert.equal(c.serviceKey, 'gochyeora');
  assert.equal(c.firstSeenAt, '2026-11-24T01:00:00Z');
  assert.ok(!JSON.stringify(body.recentChanges).includes('aaaa'), '지문은 대시보드 응답에 넣지 않음');

  // 내린 서비스의 변경은 나오지 않음 (점검이 목록에 없으므로)
  db.sqlite.exec("UPDATE services SET is_active = 0 WHERE service_key = 'gochyeora'");
  assert.equal((await buildServices(db, now)).recentChanges.length, 0);
});

test('일별 자료의 failed와 /api/status 장애 이력의 monitorId (23단계)', async () => {
  const db = createFakeD1();
  db.sqlite.exec('UPDATE monitors SET is_active = 1 WHERE service_id IS NOT NULL');
  const at = (min) => new Date(Date.UTC(2026, 10, 19, 3, min, 12));
  await runCron(db, fakeFetch({ healthOk: false }), [at(0), at(5)]);

  const svc = await buildServices(db, at(6));
  const health = svc.services.find((s) => s.key === 'keychats').checks.find((c) => c.name === '사내 메신저 (DB 상태)');
  assert.equal(health.daily.at(-1).failed, 2); // 오늘 DB 상태 실패 2회
  assert.equal(svc.services.find((s) => s.key === 'gochyeora').checks[0].daily.at(-1).failed, 0);

  const status = await (await worker.fetch(new Request('https://example.test/api/status'), { DB: db })).json();
  assert.equal(status.incidents[0].monitorId, health.id); // 이름이 아니라 id로 서비스 줄의 점검과 맞출 수 있음
});

// ── 24단계: 서비스마다 나눠 가져오기 + 정확한 변경 수 ──

test('recentChanges는 서비스당 최근 3건씩이라 배포가 잦은 서비스가 목록을 다 차지하지 않고, changeCounts는 24시간·7일을 정확히 센다', async () => {
  const db = createFakeD1();
  const now = new Date(Date.UTC(2026, 10, 25, 5, 0, 0));
  const ago = (h) => new Date(now.getTime() - h * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const idOf = (url) => db.sqlite.prepare('SELECT id FROM monitors WHERE url = ?').get(url).id;
  const add = (monitorId, at) =>
    db.sqlite
      .prepare("INSERT INTO content_changes (monitor_id, first_seen_at, confirmed_at, old_hash, new_hash, old_size, new_size, source) VALUES (?, ?, ?, 'a', 'b', 668, 668, 'real')")
      .run(monitorId, at, at);
  const g = idOf('https://gochyeora.pages.dev');
  const k = idOf('https://keychats.vercel.app/');
  // 고쳐라!: 11번 (24시간 안 7번: 1~7시간 전, 그 밖 4번: 30·50·70·100시간 전) + 8일 전 1번(7일 밖)
  for (const h of [1, 2, 3, 4, 5, 6, 7, 30, 50, 70, 100]) add(g, ago(h));
  add(g, ago(8 * 24));
  // Keychats: 2번 (한참 전이라 전체 최신 20건 방식이었으면 밀리지 않았겠지만, 3건 제한에서도 둘 다 나와야 함)
  add(k, ago(120));
  add(k, ago(150));
  // 24시간 경계: 정확히 24시간 전은 포함, 24시간 + 1초 전은 제외
  const k2 = idOf('https://keychats.vercel.app/');
  add(k2, new Date(now.getTime() - 24 * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z'));
  add(k2, new Date(now.getTime() - 24 * 3600_000 - 1000).toISOString().replace(/\.\d+Z$/, 'Z'));

  const body = await buildServices(db, now);
  const byKey = (key) => body.recentChanges.filter((c) => c.serviceKey === key);
  assert.equal(byKey('gochyeora').length, 3); // 서비스당 3건
  assert.deepEqual(byKey('gochyeora').map((c) => c.firstSeenAt), [ago(1), ago(2), ago(3)]); // 가장 최근 3건
  assert.equal(byKey('keychats').length, 3); // 경계 2건 + 120시간 전 (150시간 전은 4번째라 빠짐)

  const count = (key) => body.changeCounts.find((c) => c.serviceKey === key);
  assert.deepEqual({ ...count('gochyeora') }, { serviceKey: 'gochyeora', day: 7, week: 11, deployDay: 0, deployWeek: 0 }); // 8일 전은 7일 밖
  assert.deepEqual({ ...count('keychats') }, { serviceKey: 'keychats', day: 1, week: 4, deployDay: 0, deployWeek: 0 }); // 정확히 24시간 전만 하루 안
});
