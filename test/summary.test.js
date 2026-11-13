// public/summary.js 테스트 — 첫 상태 띠가 "모두 정상"을 잘못 말하지 않는지
// summary.js는 브라우저용 클래식 스크립트라서 import 대신 node:vm으로 읽어 실행합니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.runInNewContext(readFileSync(new URL('../public/summary.js', import.meta.url), 'utf8'), ctx);
const S = ctx.UptimeSummary;

const NOW = Date.parse('2026-11-13T03:00:00Z');
const T = '2026-11-13T02:58:00Z';
let seq = 0;
const svc = (over = {}) => ({ id: ++seq, name: `대상${seq}`, source: 'real', state: 'up', lastCheckedAt: T, ...over });

const title = (services) => S.realTitle(S.summarizeReal(services, NOW));

test('실제 활성 대상 전부 up + 기록 있음 → good, "모두 정상"', () => {
  const r = S.summarizeReal([svc(), svc()], NOW);
  assert.equal(r.tone, 'good');
  assert.equal(S.realTitle(r), '실제 점검 2건 모두 정상');
});

test('실제 활성 대상 0건 → 정상 문구 없음 (0/0, 빈 배열 every 함정)', () => {
  for (const list of [[], [svc({ source: 'replay' })], [svc({ state: 'paused' })]]) {
    const r = S.summarizeReal(list, NOW);
    assert.equal(r.total, 0);
    assert.equal(r.tone, 'idle');
    assert.ok(!S.realTitle(r).includes('모두 정상'), S.realTitle(r));
    assert.ok(S.realTitle(r).includes('알 수 없음'));
  }
});

test('모든 실제 대상이 점검 대기(paused) → 대상 0건으로 취급', () => {
  const r = S.summarizeReal([svc({ state: 'paused' }), svc({ state: 'paused' })], NOW);
  assert.equal(r.total, 0);
  assert.equal(r.tone, 'idle');
});

test('일부 up + 일부 기록 없음 → 모두 정상이 아님', () => {
  const r = S.summarizeReal([svc(), svc({ state: 'unknown', lastCheckedAt: null })], NOW);
  assert.equal(r.tone, 'idle');
  assert.equal(S.realTitle(r), '실제 점검 2건 중 1건 점검 기록 없음 — 전체 정상으로 판단하지 않음');
  assert.ok(!S.realTitle(r).includes('모두 정상'));
});

test('기록 없음과 상태 확인 중(unknown)은 따로 표현', () => {
  const t = title([svc(), svc({ state: 'unknown', lastCheckedAt: null }), svc({ state: 'unknown' })]);
  assert.match(t, /1건 점검 기록 없음/);
  assert.match(t, /1건 상태 확인 중/);
});

test('up인데 점검 기록이 비어 있으면 정상으로 세지 않음', () => {
  const r = S.summarizeReal([svc({ lastCheckedAt: null })], NOW);
  assert.equal(r.tone, 'idle');
  assert.equal(r.counts.up, 0);
  assert.equal(r.counts.noRecord, 1);
});

test('up + maintenance 혼합 → info, 모두 정상 아님', () => {
  const r = S.summarizeReal([svc(), svc({ state: 'maintenance', name: '점검중' })], NOW);
  assert.equal(r.tone, 'info');
  assert.equal(S.realTitle(r), '실제 점검 2건 중 1건 계획 작업 중: 점검중');
});

test('down은 maintenance·unknown보다 우선', () => {
  const r = S.summarizeReal([svc({ name: 'A', state: 'down' }), svc({ state: 'maintenance' }), svc({ state: 'unknown', lastCheckedAt: null })], NOW);
  assert.equal(r.tone, 'bad');
  assert.equal(S.realTitle(r), '실제 점검 3건 중 1건 장애: A');
});

test('maintenance는 unknown보다 우선', () => {
  const r = S.summarizeReal([svc({ state: 'maintenance' }), svc({ state: 'unknown', lastCheckedAt: null })], NOW);
  assert.equal(r.tone, 'info');
});

test('재생만 장애여도 실제 띠는 good, 보조 줄에만 나옴', () => {
  const list = [svc(), svc({ source: 'replay', state: 'down', name: '재생NAS' }), svc({ source: 'simulator', state: 'up' })];
  assert.equal(S.summarizeReal(list, NOW).tone, 'good');
  const d = S.summarizeDemo(list);
  assert.deepEqual(JSON.parse(JSON.stringify(d.down)), [{ name: '재생NAS', source: 'replay' }]);
  assert.equal(d.total, 2);
});

test('실제 down이 없어도 시연 장애는 실제 장애 수에 안 섞임', () => {
  const r = S.summarizeReal([svc({ source: 'sample', state: 'down' })], NOW);
  assert.equal(r.counts.down, 0);
  assert.equal(r.tone, 'idle');
});

test('시연 대상이 하나도 없으면 summarizeDemo는 null', () => {
  assert.equal(S.summarizeDemo([svc()]), null);
});

test('sample이 있어도 실제 분모에 들어가지 않음', () => {
  const list = [svc(), svc({ source: 'sample', state: 'down' }), svc({ source: 'sample', state: 'paused' })];
  const r = S.summarizeReal(list, NOW);
  assert.equal(r.total, 1);
  assert.equal(r.tone, 'good');
});

test('마지막 점검 시각: 가장 최근과 가장 오래된 값을 따로 주고, 30분 넘은 대상 수를 센다', () => {
  const r = S.summarizeReal([svc({ lastCheckedAt: '2026-11-13T02:55:00Z' }), svc({ lastCheckedAt: '2026-11-13T01:00:00Z' })], NOW);
  assert.equal(r.newestCheckedAt, '2026-11-13T02:55:00.000Z');
  assert.equal(r.oldestCheckedAt, '2026-11-13T01:00:00.000Z');
  assert.equal(r.staleCount, 1);
});

test('breakdown: 합계는 항상 전체와 같고 점검 대기(real)는 따로 센다', () => {
  const list = [
    svc(), svc({ state: 'down' }), svc({ state: 'paused' }),
    svc({ source: 'replay' }), svc({ source: 'replay', state: 'paused' }),
    svc({ source: 'simulator' }), svc({ source: 'sample' }), svc({ source: 'mystery' }),
  ];
  const b = S.breakdown(list);
  assert.equal(b.total, list.length);
  assert.equal(b.realActive + b.realPaused + b.replay + b.simulator + b.sample + b.other, b.total);
  assert.equal(b.realActive, 2);
  assert.equal(b.realPaused, 1);
  assert.equal(b.other, 1);
  assert.equal(S.breakdown([]).total, 0);
});

test('ongoingIncidents: 실제와 그 밖을 나눠 센다', () => {
  const o = S.ongoingIncidents([
    { ongoing: true, source: 'real' }, { ongoing: true, source: 'replay' },
    { ongoing: false, source: 'real' }, { ongoing: true, source: 'simulator' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(o)), { real: 1, other: 2, total: 3 });
});

test('filterServices: 출처와 상태 필터가 독립적으로 적용되고 검색과 함께 동작', () => {
  const list = [
    svc({ name: 'Alpha', source: 'real', state: 'up' }),
    svc({ name: 'Beta', source: 'real', state: 'paused' }),
    svc({ name: 'Alpha NAS', source: 'replay', state: 'down' }),
  ];
  const names = (f) => S.filterServices(list, f).map((s) => s.name);
  assert.deepEqual(names({}), ['Alpha', 'Beta', 'Alpha NAS']);
  assert.deepEqual(names({ source: 'real' }), ['Alpha', 'Beta']);
  assert.deepEqual(names({ source: 'real', state: 'up' }), ['Alpha']);
  assert.deepEqual(names({ state: 'down' }), ['Alpha NAS']);
  assert.deepEqual(names({ source: 'real', query: ' alpha ' }), ['Alpha']);
  assert.deepEqual(names({ source: 'replay', state: 'up' }), []);
});

test('30분 넘게 점검 기록이 없는 대상이 있으면 모두 정상이라고 하지 않음', () => {
  const r = S.summarizeReal([svc(), svc({ lastCheckedAt: '2026-11-13T01:00:00Z' })], NOW);
  assert.equal(r.tone, 'idle');
  assert.ok(!S.realTitle(r).includes('모두 정상'));
  assert.match(S.realTitle(r), /1건 30분 넘게 점검 기록 없음/);
});

// ── C 리뷰 회귀: counts.up · tone · 제목 · 카드 문구가 같은 규칙을 쓰는지 ──
const ms = (iso) => Date.parse(iso);
const AT = (minAgo) => new Date(NOW - minAgo * 60000).toISOString();

test('stale: 5건 중 1건이 오래되면 counts.up은 4, 띠·카드가 같은 사실을 말함', () => {
  const list = [svc(), svc(), svc(), svc(), svc({ lastCheckedAt: AT(95) })];
  const r = S.summarizeReal(list, NOW);
  assert.equal(r.counts.up, 4);
  assert.equal(r.staleCount, 1);
  assert.equal(r.tone, 'idle');
  assert.ok(!S.realTitle(r).includes('모두 정상'));
  const helper = S.realHelper(r);
  assert.match(helper, /30분 넘게 기록 없음 1/);
  assert.ok(!/서버.*판정/.test(S.realTitle(r) + helper)); // 서버가 장애로 판정한 것처럼 쓰지 않음
});

test('정확히 30분은 최신, 30분 1초 초과는 오래됨', () => {
  const edge = (sec) => S.summarizeReal([svc({ lastCheckedAt: new Date(NOW - sec * 1000).toISOString() })], NOW);
  assert.equal(edge(30 * 60).tone, 'good');
  assert.equal(edge(30 * 60).counts.up, 1);
  assert.equal(edge(30 * 60 + 1).tone, 'idle');
  assert.equal(edge(30 * 60 + 1).counts.stale, 1);
});

test('읽을 수 없는 점검 시각: 단독이어도, 정상과 섞여도 정상으로 세지 않음 (기록 없음과 구분)', () => {
  for (const bad of ['garbage', '2026-13-99', '12345', 12345, {}]) {
    const alone = S.summarizeReal([svc({ lastCheckedAt: bad })], NOW);
    assert.equal(alone.tone, 'idle', String(bad));
    assert.equal(alone.counts.up, 0);
    assert.equal(alone.counts.invalid, 1);
    assert.equal(alone.counts.noRecord, 0);
    assert.match(S.realTitle(alone), /1건 점검 시각 확인 불가/);
    const mixed = S.summarizeReal([svc(), svc({ lastCheckedAt: bad })], NOW);
    assert.equal(mixed.counts.up, 1);
    assert.ok(!S.realTitle(mixed).includes('모두 정상'));
    assert.equal(mixed.newestCheckedAt, T.replace('Z', '.000Z')); // 잘못된 시각은 최근·오래된 시각 계산에서 제외
  }
  assert.match(S.realTitle(S.summarizeReal([svc({ lastCheckedAt: null })], NOW)), /점검 기록 없음/);
});

test('장애가 있으면 시각이 잘못돼도 장애가 우선', () => {
  const r = S.summarizeReal([svc({ state: 'down', lastCheckedAt: 'garbage' })], NOW);
  assert.equal(r.tone, 'bad');
});

test('기준 시각이 없거나 잘못되면 최신 정상이라고 하지 않음', () => {
  for (const now of [NaN, undefined, null, S.statusNow({ generatedAt: 'garbage' }), S.statusNow({})]) {
    const r = S.summarizeReal([svc()], now);
    assert.equal(r.tone, 'idle');
    assert.equal(r.counts.up, 0);
    assert.equal(r.clockKnown, false);
    assert.match(S.realTitle(r), /최신 여부 확인 불가/);
  }
});

test('판정 기준은 API 생성 시각: 방문자 PC 시계(Date.now)와 무관하고 같은 입력이면 같은 결과', () => {
  const data = { generatedAt: '2026-11-13T03:00:00Z' };
  assert.equal(S.statusNow(data), NOW);
  const list = [svc({ lastCheckedAt: '2026-11-13T02:40:00Z' })];
  const realNow = Date.now;
  try {
    for (const fake of [0, NOW - 5 * 3600_000, NOW + 5 * 3600_000]) { // 방문자 시계가 과거·미래로 틀려도
      Date.now = () => fake;
      const r = S.summarizeReal(list, S.statusNow(data));
      assert.equal(r.tone, 'good');
      assert.equal(r.counts.up, 1);
    }
  } finally { Date.now = realNow; }
  // 같은 목록이라도 API 생성 시각이 늦으면 오래된 것으로 판정
  assert.equal(S.summarizeReal(list, ms('2026-11-13T04:00:00Z')).counts.stale, 1);
});

test('counts.up + 나머지 분류의 합은 항상 실제 활성 수', () => {
  const list = [svc(), svc({ lastCheckedAt: AT(90) }), svc({ lastCheckedAt: 'x' }), svc({ lastCheckedAt: null }), svc({ state: 'unknown' }), svc({ state: 'down' }), svc({ state: 'maintenance' })];
  const r = S.summarizeReal(list, NOW);
  assert.equal(Object.values(r.counts).reduce((a, b) => a + b, 0), r.total);
});
