// 첫 화면 변경 감지 (17단계: 0018 + fingerprint.js + change-run.js + API) 테스트
// 실제 사이트에는 요청하지 않고, 가짜 D1과 "본문을 바꿀 수 있는" 가짜 fetch로 확인합니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFakeD1 } from './helpers/fake-d1.js';
import { sha256Hex, byteSize, nextFingerprint, isNoisy, changeView, CONFIRM_COUNT } from '../src/fingerprint.js';
import { runContentChanges } from '../src/change-run.js';
import { buildServiceDetail, buildIncidentDetail } from '../src/api.js';
import { runChecks } from '../src/index.js';

// ── 순수 함수 ──

test('sha256Hex·byteSize: Node crypto와 같은 해시, 한글은 UTF-8 바이트로 셈', async () => {
  for (const s of ['', 'abc', '<title>고쳐라</title>']) {
    assert.equal(await sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'));
  }
  assert.equal(byteSize('abc'), 3);
  assert.equal(byteSize('가'), 3);
});

const T = (min) => `2026-11-20T01:${String(min).padStart(2, '0')}:00Z`;

test('nextFingerprint: 처음은 기준만, 같은 지문이면 저장할 것 없음', () => {
  const first = nextFingerprint(null, 'A', 100, T(0));
  assert.equal(first.change, null);
  assert.equal(first.dirty, true);
  assert.equal(first.state.hash, 'A');
  assert.equal(first.state.since, T(0));
  const same = nextFingerprint(first.state, 'A', 100, T(5));
  assert.equal(same.dirty, false);
  assert.equal(same.change, null);
});

test('nextFingerprint: 새 지문이 2회 연속이면 변경 확정, 바뀐 시각은 처음 본 회차', () => {
  assert.equal(CONFIRM_COUNT, 2);
  let s = nextFingerprint(null, 'A', 100, T(0)).state;
  const r1 = nextFingerprint(s, 'B', 120, T(5));
  assert.equal(r1.change, null);
  assert.equal(r1.state.candidateHash, 'B');
  assert.equal(r1.state.candidateCount, 1);
  const r2 = nextFingerprint(r1.state, 'B', 120, T(10));
  assert.deepEqual(r2.change, { firstSeenAt: T(5), confirmedAt: T(10), oldHash: 'A', newHash: 'B', oldSize: 100, newSize: 120 });
  assert.equal(r2.state.hash, 'B');
  assert.equal(r2.state.since, T(5));
  assert.equal(r2.state.candidateHash, null);
  s = r2.state;
  assert.equal(nextFingerprint(s, 'B', 120, T(15)).dirty, false);
});

test('nextFingerprint: 한 번 섞인 응답은 무시, 계속 다른 응답이면 확정하지 않음', () => {
  const s = nextFingerprint(null, 'A', 100, T(0)).state;
  // A → B(1회) → A: 후보를 지우고 변경 없음
  const r1 = nextFingerprint(s, 'B', 120, T(5));
  const back = nextFingerprint(r1.state, 'A', 100, T(10));
  assert.equal(back.change, null);
  assert.equal(back.dirty, true);
  assert.equal(back.state.candidateHash, null);
  // A → B → C → D: 매번 새 후보 1회 → 확정 없음
  let st = s;
  for (const [h, m] of [['B', 5], ['C', 10], ['D', 15]]) {
    const r = nextFingerprint(st, h, 100, T(m));
    assert.equal(r.change, null, h);
    assert.equal(r.state.candidateCount, 1);
    st = r.state;
  }
});

test('isNoisy·changeView: 24시간 6건 이상이면 자주 바뀜, 지문은 앞 8자리만', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const at = (h) => ({ firstSeenAt: new Date(now.getTime() - h * 3600_000).toISOString() });
  assert.equal(isNoisy([1, 2, 3, 4, 5].map(at), now), false);
  assert.equal(isNoisy([1, 2, 3, 4, 5, 6].map(at), now), true);
  assert.equal(isNoisy([1, 2, 3, 4, 5, 30].map(at), now), false); // 하루 넘은 것은 안 셈
  const v = changeView({ id: 1, monitorId: 2, monitorName: 'x', firstSeenAt: 'a', confirmedAt: 'b', oldHash: 'a'.repeat(64), newHash: 'b'.repeat(64), oldSize: 1, newSize: 2, source: 'real' });
  assert.equal(v.oldHash, 'aaaaaaaa');
  assert.equal(v.newHash, 'bbbbbbbb');
});

// ── Cron 흐름 ──

/** 첫 화면 본문을 바꿀 수 있는 가짜 fetch */
function siteFetch(state) {
  return async (url) => {
    const u = String(url);
    if (u.includes('cloudflare-dns.com')) {
      return new Response(JSON.stringify({ Status: 0, Answer: [{ name: 'x', type: 1, data: '192.0.2.1' }] }), { status: 200 });
    }
    if (u.endsWith('/chats/api/health')) return new Response('{"status":"ok"}', { status: 200 });
    if (u.includes('gochyeora')) return new Response(state.gochyeora, { status: state.gochyeoraStatus ?? 200 });
    return new Response(state.keychats, { status: 200 });
  };
}

async function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}

const at = (min) => new Date(Date.UTC(2026, 10, 20, 1, min, 12));
const homeId = (db, key) =>
  db.sqlite.prepare("SELECT m.id FROM monitors m JOIN services s ON s.id = m.service_id WHERE s.service_key = ? AND m.kind = 'http' AND rtrim(m.url,'/') = rtrim(s.home_url,'/')").get(key).id;

test('Cron: 대표 주소 HTTP 점검만 지문을 남기고, 2회 연속 바뀌면 변경 1건 — 실패 응답은 무시', async () => {
  const db = createFakeD1();
  db.sqlite.exec('UPDATE monitors SET is_active = 1 WHERE service_id IS NOT NULL');
  const site = { gochyeora: '<title>고쳐라 v1</title>', keychats: '<title>Keychats</title>' };
  const run = (min) => quiet(() => runChecks({ DB: db }, at(min), { fetchFn: siteFetch(site) }));

  await run(0);
  const fps = db.sqlite.prepare('SELECT monitor_id FROM content_fingerprints ORDER BY monitor_id').all().map((r) => r.monitor_id);
  // 서비스 2개의 대표 주소 점검만 (DNS·상태 확인 주소는 제외)
  assert.deepEqual(fps, [homeId(db, 'gochyeora'), homeId(db, 'keychats')].sort((a, b) => a - b));

  // 오류 응답(503)은 장애이지 변경이 아님 → 지문에 안 들어감
  site.gochyeoraStatus = 503;
  site.gochyeora = '<h1>Service Unavailable</h1>';
  await run(5);
  assert.equal(db.sqlite.prepare('SELECT candidate_hash FROM content_fingerprints WHERE monitor_id = ?').get(homeId(db, 'gochyeora')).candidate_hash, null);

  site.gochyeoraStatus = 200;
  site.gochyeora = '<title>고쳐라 v2</title><p>새 단계</p>';
  await run(10);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM content_changes').get().n, 0); // 1회만 봄
  await run(15);
  const changes = db.sqlite.prepare('SELECT * FROM content_changes').all();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].monitor_id, homeId(db, 'gochyeora'));
  assert.equal(changes[0].first_seen_at, '2026-11-20T01:10:00Z');
  assert.equal(changes[0].confirmed_at, '2026-11-20T01:15:00Z');
  assert.equal(changes[0].old_size, byteSize('<title>고쳐라 v1</title>'));
  assert.equal(changes[0].new_size, byteSize(site.gochyeora));
  assert.equal(changes[0].source, 'real');

  // 같은 내용이 계속되면 더 기록하지 않음
  await run(20);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM content_changes').get().n, 1);
});

test('runContentChanges: 대상이 아닌 점검·실패 응답만 있으면 지문을 저장하지 않음', async () => {
  const db = createFakeD1();
  const dnsId = db.sqlite.prepare("SELECT id FROM monitors WHERE kind = 'dns' AND service_id IS NOT NULL").get().id;
  const out = await runContentChanges(db, [
    { monitorId: dnsId, isSuccess: true, body: 'x' },
    { monitorId: 999999, isSuccess: true, body: 'x' },
  ], '2026-11-20T01:00:00Z');
  assert.deepEqual(out, []);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM content_fingerprints').get().n, 0);
});

// ── 공개 API ──

test('/api/services/:key의 changes, 장애 상세의 장애 직전 변경(같은 서비스, 60분 안)', async () => {
  const db = createFakeD1();
  db.sqlite.exec('UPDATE monitors SET is_active = 1 WHERE service_id IS NOT NULL');
  const gHome = homeId(db, 'gochyeora');
  const gDns = db.sqlite.prepare("SELECT m.id FROM monitors m JOIN services s ON s.id = m.service_id WHERE s.service_key = 'gochyeora' AND m.kind = 'dns'").get().id;
  const kHome = homeId(db, 'keychats');
  const ins = db.sqlite.prepare(
    "INSERT INTO content_changes (monitor_id, first_seen_at, confirmed_at, old_hash, new_hash, old_size, new_size, source) VALUES (?, ?, ?, ?, ?, 100, 120, 'real')"
  );
  ins.run(gHome, '2026-11-20T00:30:00Z', '2026-11-20T00:35:00Z', 'a'.repeat(64), 'b'.repeat(64)); // 장애 50분 전
  ins.run(gHome, '2026-11-19T20:00:00Z', '2026-11-19T20:05:00Z', 'c'.repeat(64), 'a'.repeat(64)); // 5시간 전 → 범위 밖
  ins.run(kHome, '2026-11-20T01:00:00Z', '2026-11-20T01:05:00Z', 'd'.repeat(64), 'e'.repeat(64)); // 다른 서비스

  const detail = await buildServiceDetail(db, 'gochyeora', new Date('2026-11-20T02:00:00Z'));
  assert.deepEqual(detail.changes.map((c) => [c.firstSeenAt, c.oldHash, c.newHash]), [
    ['2026-11-20T00:30:00Z', 'aaaaaaaa', 'bbbbbbbb'],
    ['2026-11-19T20:00:00Z', 'cccccccc', 'aaaaaaaa'],
  ]);
  assert.equal(detail.changesNoisy, false);
  assert.ok(!JSON.stringify(detail.changes).includes('a'.repeat(9)), '지문 전체는 공개하지 않음');

  // DNS 점검의 장애라도 같은 서비스 첫 화면 변경을 보여 줌
  const incId = db.sqlite.prepare(
    "INSERT INTO incidents (monitor_id, started_at, detected_at, cause, source) VALUES (?, '2026-11-20T01:20:00Z', '2026-11-20T01:25:00Z', 'dns_error', 'real') RETURNING id"
  ).get(gDns).id;
  const inc = await buildIncidentDetail(db, incId, new Date('2026-11-20T02:00:00Z'));
  assert.equal(inc.changeLookbackMin, 60);
  assert.deepEqual(inc.changesBefore.map((c) => [c.monitorId, c.firstSeenAt]), [[gHome, '2026-11-20T00:30:00Z']]);
});
