// 공개 API(/api/status) 테스트 — 가짜 D1에 실제 시드(seed/sample.sql)를 넣고 응답을 확인
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeD1 } from './helpers/fake-d1.js';
import { buildStatus, displayState, BAR_DAYS } from '../src/api.js';
import worker from '../src/index.js';

const SEED_SQL = readFileSync(new URL('../seed/sample.sql', import.meta.url), 'utf8');

// 시드는 SQLite의 'now'(현재 시각) 기준으로 날짜를 만들기 때문에 API도 현재 시각으로 부릅니다.
function seeded() {
  const db = createFakeD1();
  db.sqlite.exec(SEED_SQL);
  return db;
}

test('displayState: 비활성 실제 대상은 점검 대기, 상태가 없으면 확인 중', () => {
  assert.equal(displayState({ isActive: false, source: 'real', state: null }), 'paused');
  assert.equal(displayState({ isActive: true, source: 'real', state: null }), 'unknown');
  assert.equal(displayState({ isActive: true, source: 'real', state: 'down' }), 'down');
  assert.equal(displayState({ isActive: false, source: 'sample', state: 'up' }), 'up');
});

test('시드 + API: 서비스 6개(실제 HTTP·DNS + 데모 4), 출처·상태·30일 막대', async () => {
  const body = await buildStatus(seeded(), new Date());

  assert.equal(body.services.length, 6);
  const byName = Object.fromEntries(body.services.map((s) => [s.name, s]));

  // 실제 대상(gochyeora)은 비활성 → 점검 대기, 기록 없음
  const real = byName['고쳐라! 웹게임'];
  assert.equal(real.source, 'real');
  assert.equal(real.state, 'paused');
  assert.equal(real.uptime30d, null);

  // 가상 서비스는 모두 sample 표시
  for (const name of ['사내 ERP', '그룹웨어', '고객센터']) {
    assert.equal(byName[name].source, 'sample', name);
    assert.equal(byName[name].daily.length, BAR_DAYS, name);
    // 30일 모두 기록이 있어야 함 (29일 집계 + 오늘 원본 계산)
    assert.ok(byName[name].daily.every((d) => d.total > 0), `${name}: 빈 날이 있음`);
  }
  assert.equal(byName['고객센터'].state, 'down');
  assert.equal(byName['사내 ERP'].state, 'up');
  assert.ok(byName['사내 ERP'].uptime30d < 100);

  // 공개 응답에는 점검 주소를 넣지 않음
  assert.ok(body.services.every((s) => !('url' in s)));
});

test('시드 + API: 최근 알림은 최신 순, 모두 sample 표시', async () => {
  const { notifications } = await buildStatus(seeded(), new Date());

  assert.ok(notifications.length > 0 && notifications.length <= 20);
  assert.ok(notifications.every((n) => n.source === 'sample'));
  const times = notifications.map((n) => n.createdAt);
  assert.deepEqual(times, [...times].sort().reverse());
  // 가장 최근 알림 = 지금 장애 중인 고객센터
  assert.equal(notifications[0].monitorName, '고객센터');
  assert.equal(notifications[0].event, 'down');
});

test('시드를 두 번 넣어도 결과가 같다 (멱등)', () => {
  const db = seeded();
  const count = () =>
    ['monitors', 'check_results', 'monitor_state', 'daily_stats', 'notifications'].map(
      (t) => db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
    );
  const first = count();
  db.sqlite.exec(SEED_SQL);
  assert.deepEqual(count(), first);
});

test('HTTP: /api/status는 JSON + 60초 캐시, 그 밖의 경로는 404', async () => {
  const env = { DB: seeded() };

  const ok = await worker.fetch(new Request('https://example.invalid/api/status'), env);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /application\/json/);
  assert.equal(ok.headers.get('cache-control'), 'public, max-age=60');
  assert.equal((await ok.json()).services.length, 6);

  const post = await worker.fetch(new Request('https://example.invalid/api/status', { method: 'POST' }), env);
  assert.equal(post.status, 405);

  const missing = await worker.fetch(new Request('https://example.invalid/api/nope'), env);
  assert.equal(missing.status, 404);
});
