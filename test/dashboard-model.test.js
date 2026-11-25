// public/dashboard-model.js 테스트 — 대시보드 숫자가 잘못 말하지 않는지 (S2)
// 브라우저용 클래식 스크립트라서 import 대신 node:vm으로 읽어 실행합니다 (summary.test.js와 같은 방식).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.runInNewContext(readFileSync(new URL('../public/dashboard-model.js', import.meta.url), 'utf8'), ctx);
const M = ctx.DashboardModel;
// vm 안에서 만든 배열·객체는 프로토타입이 달라 deepStrictEqual이 실패하므로 JSON으로 한 번 옮겨서 비교
const plain = (v) => JSON.parse(JSON.stringify(v));

test('countByState: 부분 장애와 장애는 한 칸, 모르는 상태는 정상으로 세지 않음', () => {
  const c = M.countByState([
    { state: 'up' }, { state: 'up' }, { state: 'degraded' }, { state: 'partial' }, { state: 'down' },
    { state: 'paused' }, { state: 'maintenance' }, { state: 'weird' },
  ]);
  assert.deepEqual(plain(c), { total: 8, up: 2, degraded: 1, problem: 2, maintenance: 1, paused: 1, unknown: 1 });
});

test('searchServices: 이름·설명·점검 이름에서 대소문자 없이 찾음, 빈 검색어는 전체', () => {
  const list = [
    { name: '고쳐라!', description: '웹게임', checks: [{ name: '고쳐라! 웹게임 (DNS)' }] },
    { name: 'Keychats', description: '학원 팀 채팅', checks: [{ name: '사내 메신저 (DB 상태)' }] },
  ];
  assert.equal(M.searchServices(list, '').length, 2);
  assert.equal(M.searchServices(list, '  ').length, 2);
  assert.deepEqual(plain(M.searchServices(list, 'keychats').map((s) => s.name)), ['Keychats']);
  assert.deepEqual(plain(M.searchServices(list, '채팅').map((s) => s.name)), ['Keychats']);
  assert.deepEqual(plain(M.searchServices(list, 'db').map((s) => s.name)), ['Keychats']);
  assert.deepEqual(plain(M.searchServices(list, '없는이름').map((s) => s.name)), []);
});

test('chipLabel: 이름 끝 괄호를 쓰고, 없으면 점검 종류', () => {
  assert.equal(M.chipLabel({ name: '사내 메신저 (DB 상태)', kind: 'http' }), 'DB'); // '상태'는 칩에 따로 붙으므로 뺌
  assert.equal(M.chipLabel({ name: '고쳐라! 웹게임 (DNS)', kind: 'dns' }), 'DNS');
  assert.equal(M.chipLabel({ name: '고쳐라! 웹게임', kind: 'http' }), 'HTTP');
  assert.equal(M.chipLabel({ name: '이상한 (괄호) 이름', kind: 'dns' }), 'DNS'); // 끝에 있는 괄호만
});

test('chipState: 정상인데 마지막이 느리면 slow, 그 밖에는 서버 상태 그대로', () => {
  assert.equal(M.chipState({ state: 'up', lastIsSlow: true }), 'slow');
  assert.equal(M.chipState({ state: 'up', lastIsSlow: false }), 'up');
  assert.equal(M.chipState({ state: 'down', lastIsSlow: true }), 'down');
  assert.equal(M.chipState({}), 'unknown');
});

test('kstDay·lastDays: 한국 날짜 경계와 30일 목록', () => {
  assert.equal(M.kstDay('2026-11-19T14:59:00Z'), '2026-11-19');
  assert.equal(M.kstDay('2026-11-19T15:00:00Z'), '2026-11-20');
  assert.equal(M.kstDay('엉터리'), null);
  const days = M.lastDays('2026-11-19', 30);
  assert.equal(days.length, 30);
  assert.equal(days[0], '2026-10-21');
  assert.equal(days.at(-1), '2026-11-19');
});

test('incidentsByDay: 기간 안 장애만 날짜별로 세고, 받은 이력이 모두 기간 안이면 capped', () => {
  const days = M.lastDays('2026-11-19', 30);
  const inc = [
    { startedAt: '2026-11-19T15:30:00Z' }, // KST 11-20 → 기간 밖
    { startedAt: '2026-11-18T01:00:00Z' },
    { startedAt: '2026-11-18T02:00:00Z' },
    { startedAt: '2026-10-01T00:00:00Z' }, // 30일 전보다 이전
  ];
  const r = M.incidentsByDay(inc, days, 10);
  assert.equal(r.count, 2);
  assert.equal(r.perDay[days.indexOf('2026-11-18')], 2);
  assert.equal(r.capped, false);

  // 최근 2건만 받았고(limit 2) 둘 다 기간 안 → 더 있을 수 있음
  const r2 = M.incidentsByDay(inc.slice(1, 3), days, 2);
  assert.equal(r2.capped, true);
});

test('responseSeries: 점검마다 한 줄, 평균을 섞지 않고 최근 값의 범위만', () => {
  const services = [
    { name: '고쳐라!', checks: [
      { name: '고쳐라! 웹게임', kind: 'http', daily: [{ day: 'a', avgResponseMs: 80 }, { day: 'b', avgResponseMs: 76 }] },
      { name: '고쳐라! 웹게임 (DNS)', kind: 'dns', daily: [{ day: 'a', avgResponseMs: 30 }, { day: 'b', avgResponseMs: 41 }] },
    ] },
    { name: 'Keychats', checks: [
      { name: '사내 메신저 (HTTP)', kind: 'http', daily: [{ day: 'a', avgResponseMs: 250 }, { day: 'b', avgResponseMs: null }] },
      { name: '사내 메신저 (DB 상태)', kind: 'http', daily: [{ day: 'a', avgResponseMs: 1038 }, { day: 'b', avgResponseMs: 1029 }] },
    ] },
  ];
  const http = M.responseSeries(services, 'http');
  assert.deepEqual(plain(http.series.map((s) => s.name)), ['고쳐라! HTTP', 'Keychats HTTP', 'Keychats DB']);
  // Keychats HTTP는 오늘(b) 값이 없어서 전날(a) 250을 씀
  assert.deepEqual(plain(http.latest), { min: 76, max: 1029 });
  assert.equal(M.responseSeries(services, 'ping').latest, null);
  assert.equal(M.responseSeries(services, 'ping').mean, null);

  // 첫 화면 점검만(칩 이름 'HTTP') 고르면 DB 상태 확인(약 1초)은 평균에서 빠짐: (76 + 250) / 2 = 163
  const front = M.responseSeries(services, 'http', 'HTTP');
  assert.deepEqual(plain(front.series.map((s) => [s.service, s.latest])), [['고쳐라!', 76], ['Keychats', 250]]);
  assert.equal(front.mean, 163);
});

test('uptimeSeries·firstRecordedDay: 서버 서비스 가동률을 그대로, 기록 시작일은 가장 이른 날', () => {
  const services = [
    { name: 'A', daily: [{ day: '2026-11-10', total: 0, uptime: null }, { day: '2026-11-11', total: 167, uptime: 98.2 }] },
    { name: 'B', daily: [{ day: '2026-11-10', total: 0, uptime: null }, { day: '2026-11-11', total: 0, uptime: null }] },
  ];
  assert.deepEqual(plain(M.uptimeSeries(services)[0].points), [{ day: '2026-11-10', v: null }, { day: '2026-11-11', v: 98.2 }]);
  assert.equal(M.firstRecordedDay(services), '2026-11-11');
  assert.equal(M.firstRecordedDay([]), null);
});

test('chartStart: 기록 시작일부터, 최소 일수는 보장, 30일보다 오래된 기록이면 처음부터', () => {
  const days = M.lastDays('2026-11-19', 30); // 10-21 ~ 11-19
  assert.equal(days[M.chartStart(days, '2026-11-11', 7)], '2026-11-11');
  assert.equal(days[M.chartStart(days, '2026-11-17', 7)], '2026-11-13'); // 3일뿐이면 최근 7일
  assert.equal(M.chartStart(days, '2026-09-01', 7), 0); // 30일 전부터 기록이 있으면 30일 전체
  assert.equal(days[M.chartStart(days, null, 7)], '2026-11-13'); // 기록이 없으면 최근 7일
  const sliced = M.sliceSeries([{ name: 'A', points: [{ v: 1 }, { v: 2 }, { v: 3 }] }], 1);
  assert.deepEqual(plain(sliced), [{ name: 'A', points: [{ v: 2 }, { v: 3 }] }]);
});

test('mmss: 남은 시간은 항상 두 자리:두 자리', () => {
  assert.equal(M.mmss(276), '04:36');
  assert.equal(M.mmss(0), '00:00');
  assert.equal(M.mmss(-5), '00:00');
});

// ── 서비스 상세 (S3) ──
const pt = (checkedAt, isSuccess, extra = {}) => ({ checkedAt, isSuccess, isSlow: false, responseMs: isSuccess ? 100 : null, inMaintenance: false, ...extra });

test('serviceUptimeFromHistories: 서버와 같은 회차 규칙 (한 점검만 실패해도 장애 회차, 계획 작업은 뺌, 내림)', () => {
  const http = [pt('T1', true), pt('T2', true), pt('T3', true)];
  const dns = [pt('T1', true), pt('T2', false), pt('T3', false, { inMaintenance: true })];
  // T1 정상, T2 장애(dns 실패), T3 dns는 작업 중이라 빼고 http 성공 → 정상 → 2/3 = 66.66
  assert.deepEqual(plain(M.serviceUptimeFromHistories([http, dns])), { totalSlots: 3, upSlots: 2, percent: 66.66 });
  assert.equal(M.serviceUptimeFromHistories([[], []]).percent, null);
});

test('avgResponse: 성공한 점검만 평균, 없으면 null', () => {
  assert.equal(M.avgResponse([pt('a', true, { responseMs: 100 }), pt('b', true, { responseMs: 201 }), pt('c', false)]), 151);
  assert.equal(M.avgResponse([pt('a', false)]), null);
  assert.equal(M.avgResponse([pt('a', true, { responseMs: 999, inMaintenance: true })]), null);
});

test('timeCells: 시각으로 칸을 나누고, 실패 > 느림 > 정상 > 작업 > 기록 없음', () => {
  const from = '2026-11-19T00:00:00Z';
  const to = '2026-11-19T01:00:00Z'; // 15분 칸 4개
  const cells = M.timeCells([
    pt('2026-11-19T00:00:00Z', true), pt('2026-11-19T00:05:00Z', false), // 칸0: 실패 포함
    pt('2026-11-19T00:15:00Z', true, { isSlow: true }), pt('2026-11-19T00:20:00Z', true), // 칸1: 느림
    // 칸2: 기록 없음
    pt('2026-11-19T00:45:00Z', false, { inMaintenance: true }), // 칸3: 계획 작업뿐
    pt('2026-11-19T01:00:00Z', false), // 구간 밖(끝은 포함 안 함)
  ], from, to, 15);
  assert.deepEqual(plain(cells.map((c) => [c.state, c.count, c.fails])), [['fail', 2, 1], ['slow', 2, 0], ['none', 0, 0], ['maint', 1, 0]]);
  assert.equal(cells[0].start, '2026-11-19T00:00:00.000Z');
  assert.equal(M.timeCells([], from, '2026-11-20T00:00:00Z', 15).length, 96); // 24시간 = 96칸
});

// ── 16단계: 점검 기록 분석 화면 ──

test('percentile: 서버(src/analysis.js)와 같은 결과', async () => {
  const server = await import('../src/analysis.js');
  const cases = [[], [42], [300, 100, 200], Array.from({ length: 37 }, (_, i) => (i * 7919) % 101), [null, 5, NaN, 1]];
  for (const xs of cases) {
    for (const p of [50, 95, 99]) assert.equal(M.percentile(xs, p), server.percentile(xs, p), `${JSON.stringify(xs)} p${p}`);
  }
});

test('p95Response: 성공한 점검만, 계획 작업 중 제외', () => {
  const pt = (ms, isSuccess = true, inMaintenance = false) => ({ responseMs: ms, isSuccess, inMaintenance });
  const pts = [...Array.from({ length: 19 }, () => pt(100)), pt(900), pt(null, false), pt(5000, true, true)];
  assert.equal(M.p95Response(pts), 100); // 20개 중 19번째
  assert.equal(M.p95Response([pt(null, false)]), null);
});

test('heatLevel: 실패가 느림보다 먼저, 5% 경계', () => {
  assert.equal(M.heatLevel({ total: 0, fail: 0, slow: 0 }), 'none');
  assert.equal(M.heatLevel(undefined), 'none');
  assert.equal(M.heatLevel({ total: 100, fail: 0, slow: 0 }), 'ok');
  assert.equal(M.heatLevel({ total: 100, fail: 0, slow: 4 }), 'slow1');
  assert.equal(M.heatLevel({ total: 100, fail: 0, slow: 5 }), 'slow2');
  assert.equal(M.heatLevel({ total: 100, fail: 1, slow: 50 }), 'bad1');
  assert.equal(M.heatLevel({ total: 100, fail: 5, slow: 0 }), 'bad2');
});

// ── 서비스가 10개가 넘어도 읽히는 운영 지표 (색·순위·예외 우선) ──

test('serviceColors: 서비스 순서대로 1번부터, 10개를 넘으면 색을 다시 쓰고 점선 표시', () => {
  const services = Array.from({ length: 12 }, (_, i) => ({ key: `s${i + 1}` }));
  const colors = plain(M.serviceColors(services));
  assert.deepEqual(colors.s1, { n: 1, dashed: false });
  assert.deepEqual(colors.s10, { n: 10, dashed: false });
  assert.deepEqual(colors.s11, { n: 1, dashed: true }); // 11번째는 1번 색 + 점선
  assert.deepEqual(colors.s12, { n: 2, dashed: true });
  assert.equal(M.SERIES_COLORS, 10);
  assert.deepEqual(plain(M.serviceColors([])), {});
  // 같은 순서면 같은 색 (60초마다 새로 그려도 색이 바뀌지 않음)
  assert.deepEqual(plain(M.serviceColors(services)), colors);
});

test('rankByLatest: 느린 순, 값 없는 점검은 맨 아래, 같으면 원래 순서, 상위 N과 나머지 수', () => {
  const s = (name, latest) => ({ name, latest });
  const r = M.rankByLatest([s('a', 100), s('b', null), s('c', 300), s('d', 100), s('e', 50), s('f', 700)], 3);
  assert.deepEqual(plain(r.ranked.map((x) => x.name)), ['f', 'c', 'a', 'd', 'e', 'b']); // a와 d는 같은 100 → 입력 순서
  assert.deepEqual(plain(r.top.map((x) => x.name)), ['f', 'c', 'a']);
  assert.equal(r.rest, 3);
  assert.equal(r.max, 700); // 막대 길이 기준은 전체 중 최댓값 (작은 칸과 팝업에서 같은 비율)

  // 전부 값이 없으면 max 0, 개수가 limit 이하면 rest 0
  const none = M.rankByLatest([s('x', null), s('y', undefined)], 5);
  assert.equal(none.max, 0);
  assert.equal(none.rest, 0);
  assert.deepEqual(plain(none.top.map((x) => x.name)), ['x', 'y']);
  assert.equal(M.rankByLatest([], 5).top.length, 0);
});

test('splitUptimeByException: 100% 아래로 내려간 서비스만 선으로, 기록 없음은 100%로 세지 않음', () => {
  const day = (d, uptime, total = 288) => ({ day: d, uptime, total });
  const services = [
    { key: 'a', name: 'A', daily: [day('d1', 100), day('d2', 100)] }, // 계속 100%
    { key: 'b', name: 'B', daily: [day('d1', 99.4), day('d2', 100)] }, // 하루 내려감
    { key: 'c', name: 'C', daily: [day('d1', null, 0), day('d2', null, 0)] }, // 기록 없음
    { key: 'd', name: 'D', daily: [day('d1', 100), day('d2', 97.5)] }, // 더 많이 내려감
  ];
  const r = plain(M.splitUptimeByException(services, 0, 5));
  assert.deepEqual(r.dipped.map((x) => [x.key, x.min]), [['d', 97.5], ['b', 99.4]]); // 가장 낮았던 값이 낮은 순
  assert.equal(r.perfectCount, 1);
  assert.equal(r.noDataCount, 1);
  assert.equal(r.hidden, 0);
  assert.deepEqual(r.dipped[1].points, [{ day: 'd1', v: 99.4 }, { day: 'd2', v: 100 }]);

  // start 이후만 본다: d1의 99.4%는 그래프 구간 밖이라 B도 100%로 취급
  const later = plain(M.splitUptimeByException(services, 1, 5));
  assert.deepEqual(later.dipped.map((x) => x.key), ['d']);
  assert.equal(later.perfectCount, 2); // A, B

  // limit을 넘으면 가장 낮은 것부터 limit개만, 나머지는 hidden
  const capped = plain(M.splitUptimeByException(services, 0, 1));
  assert.deepEqual(capped.dipped.map((x) => x.key), ['d']);
  assert.equal(capped.hidden, 1);

  // 서비스가 없으면 전부 0
  assert.deepEqual(plain(M.splitUptimeByException([], 0, 5)), { dipped: [], hidden: 0, perfectCount: 0, noDataCount: 0 });
});

test('responseSeries·uptimeSeries: 서비스 key를 함께 줘서 고유색을 찾을 수 있다', () => {
  const services = [{ key: 'k1', name: 'K', checks: [{ name: 'K 웹', kind: 'http', daily: [{ day: 'a', avgResponseMs: 10 }] }], daily: [{ day: 'a', uptime: 99 }] }];
  assert.equal(M.responseSeries(services, 'http').series[0].key, 'k1');
  assert.equal(M.uptimeSeries(services)[0].key, 'k1');
});

// ── 22단계: 운영 지표 숫자 타일 ──

// today 기준으로 offset일 전 날짜 (테스트 자료 만들기용)
const dayBefore = (today, n) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
// 15일치 점: values[0]이 14일 전, values[14]가 오늘
const pts = (today, values) => values.map((v, i) => ({ day: dayBefore(today, 14 - i), v }));

test('averageSeries: 그날 기록이 있는 서비스만으로 평균, 아무도 없으면 null', () => {
  const s = [
    { points: [{ day: 'd1', v: 100 }, { day: 'd2', v: null }, { day: 'd3', v: null }] },
    { points: [{ day: 'd1', v: 201 }, { day: 'd2', v: 300 }, { day: 'd3', v: null }] },
  ];
  assert.deepEqual(plain(M.averageSeries(s)), [
    { day: 'd1', v: 151, n: 2 }, // (100 + 201) / 2 = 150.5 → 반올림
    { day: 'd2', v: 300, n: 1 }, // 기록 없는 서비스를 0으로 세지 않음
    { day: 'd3', v: null, n: 0 },
  ]);
  assert.deepEqual(plain(M.averageSeries([])), []);
});

test('weekOverWeek: 어제까지 7일과 그 전 7일을 비교하고 오늘은 뺀다', () => {
  const today = '2026-11-25';
  // 지난주 7일 100ms, 최근 주 7일 120ms, 오늘 9999ms(반영되면 안 됨)
  const s = [{ points: pts(today, [...Array(7).fill(100), ...Array(7).fill(120), 9999]) }];
  const r = M.weekOverWeek(s, today);
  assert.deepEqual(plain(r), { compared: 1, total: 1, cur: 120, prev: 100, diffMs: 20, pct: 20, worse: false });
});

test('weekOverWeek: 한 주라도 기록이 3일 미만인 서비스는 비교에서 빼고, 남는 게 없으면 기록 부족', () => {
  const today = '2026-11-25';
  const old = { points: pts(today, [...Array(7).fill(200), ...Array(7).fill(220), null]) };
  // 이번 주에 새로 등록된 서비스: 지난주 기록 없음, 이번 주 2일 → 비교 대상 아님
  const fresh = { points: pts(today, [...Array(12).fill(null), 5000, 5000, 5000]) };
  const r = M.weekOverWeek([old, fresh], today);
  assert.equal(r.compared, 1);
  assert.equal(r.total, 2);
  assert.equal(r.cur, 220); // 새 서비스의 5000ms가 평균을 끌어올리지 않음
  assert.equal(r.prev, 200);

  // 지난주 2일만 있는 서비스 하나뿐 → 비교할 수 없음
  const thin = { points: pts(today, [null, null, null, null, null, 90, 90, ...Array(7).fill(95), null]) };
  assert.deepEqual(plain(M.weekOverWeek([thin], today)), { compared: 0, total: 1, cur: null, prev: null, diffMs: null, pct: null, worse: false });
  assert.equal(M.weekOverWeek([], today).compared, 0);
});

test('weekOverWeek: 나빠짐은 +30% 이상 그리고 +100ms 이상일 때만 (주간 보고서와 같은 기준)', () => {
  const today = '2026-11-25';
  const wow = (prev, cur) => M.weekOverWeek([{ points: pts(today, [...Array(7).fill(prev), ...Array(7).fill(cur), null]) }], today);
  assert.equal(wow(300, 400).worse, true);   // +33%, +100ms → 경계에서 나빠짐
  assert.equal(wow(400, 500).worse, false);  // +25% → %가 모자람
  assert.equal(wow(20, 40).worse, false);    // +100%지만 +20ms → 작은 값의 잡음 (DNS)
  assert.equal(wow(500, 400).worse, false);  // 빨라짐
  assert.equal(wow(500, 400).pct, -20);
  assert.equal(M.SLOWDOWN_PERCENT, 30);
  assert.equal(M.SLOWDOWN_MIN_MS, 100);
});

test('uptimeTileText: 가장 낮았던 서비스 이름 하나 + 나머지는 개수, 기록 없음은 따로', () => {
  const d = (name) => ({ name, key: name, min: 99, points: [] });
  assert.equal(M.uptimeTileText({ dipped: [d('Keychats'), d('고쳐라!')], hidden: 0, perfectCount: 8, noDataCount: 0 }), 'Keychats 외 1개 · 나머지 8개 100%');
  assert.equal(M.uptimeTileText({ dipped: [d('A')], hidden: 2, perfectCount: 0, noDataCount: 1 }), 'A 외 2개 · 기록 없음 1개'); // 선에 못 그린 hidden도 개수에 포함
  assert.equal(M.uptimeTileText({ dipped: [d('A')], hidden: 0, perfectCount: 0, noDataCount: 0 }), 'A');
  assert.equal(M.uptimeTileText({ dipped: [], hidden: 0, perfectCount: 10, noDataCount: 0 }), '10개 모두 100%');
  assert.equal(M.uptimeTileText({ dipped: [], hidden: 0, perfectCount: 0, noDataCount: 0 }), '기록이 아직 없습니다');
});

// ── 23단계: 오늘 확인할 것 · 최근 배포(추정) ──

const NOW = Date.parse('2026-11-25T05:00:00Z'); // KST 14:00
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString().replace(/\.\d+Z$/, 'Z');
const chk = (id, over = {}) => ({ id, name: `점검 ${id}`, kind: 'http', state: 'up', lastCheckedAt: minsAgo(2), lastIsSlow: false, lastResponseMs: 200, daily: [{ day: '2026-11-25', failed: 0 }], ...over });

test('watchItems: 장애 중 > 점검 끊김 > 느림 > 오늘 단발 실패 > 계획 작업 중, 점검마다 한 줄', () => {
  const services = [
    { key: 'a', name: 'A', checks: [chk(1, { daily: [{ day: '2026-11-25', failed: 2 }] })] },                  // 단발 실패
    { key: 'b', name: 'B', checks: [chk(2, { state: 'down', daily: [{ day: '2026-11-25', failed: 5 }] })] },    // 장애 중 (실패로 또 세지 않음)
    { key: 'c', name: 'C', checks: [chk(3, { lastIsSlow: true, lastResponseMs: 1469 }), chk(4, { kind: 'dns', name: 'C (DNS)', lastCheckedAt: minsAgo(18) })] },
    { key: 'd', name: 'D', checks: [chk(5, { state: 'maintenance', daily: [{ day: '2026-11-25', failed: 9 }] }), chk(6, { state: 'paused', lastCheckedAt: minsAgo(999) })] },
    { key: 'e', name: 'E', checks: [chk(7)] }, // 아무 일 없음
  ];
  const incidents = [{ id: 9, monitorId: 2, startedAt: minsAgo(12), resolvedAt: null }];
  const items = M.watchItems({ services, incidents, today: '2026-11-25', now: NOW });
  assert.deepEqual(plain(items.map((i) => [i.serviceKey, i.check, i.kind, i.text])), [
    ['b', 'HTTP', 'down', '장애 중 12분'],
    ['c', 'DNS', 'stale', '점검 기록 18분째 없음'],
    ['c', 'HTTP', 'slow', '응답 느림 (마지막 1,469ms)'],
    ['a', 'HTTP', 'fail', '오늘 실패 2회 · 장애 판정 전 단발 실패'],
    ['d', 'HTTP', 'maint', '계획 작업 중'], // 계획 작업 중에는 실패를 경고하지 않음, 점검 대기는 빠짐
  ]);
});

test('watchItems: 끊김 경계는 15분 초과, 오늘 복구된 장애가 있으면 단발 실패가 아니라고 적음', () => {
  const at15 = [{ key: 'a', name: 'A', checks: [chk(1, { lastCheckedAt: minsAgo(15) })] }];
  assert.equal(M.watchItems({ services: at15, incidents: [], today: '2026-11-25', now: NOW }).length, 0);
  const at16 = [{ key: 'a', name: 'A', checks: [chk(1, { lastCheckedAt: minsAgo(16) })] }];
  assert.equal(M.watchItems({ services: at16, incidents: [], today: '2026-11-25', now: NOW })[0].kind, 'stale');

  const healed = [{ key: 'a', name: 'A', checks: [chk(1, { daily: [{ day: '2026-11-25', failed: 3 }] })] }];
  const inc = [{ id: 1, monitorId: 1, startedAt: minsAgo(90), resolvedAt: minsAgo(80) }];
  assert.equal(M.watchItems({ services: healed, incidents: inc, today: '2026-11-25', now: NOW })[0].text, '오늘 실패 3회 · 장애 1건 복구됨');
  // 장애 중인데 장애 이력(최근 10건)에서 못 찾으면 시간 없이
  const down = [{ key: 'a', name: 'A', checks: [chk(1, { state: 'down' })] }];
  assert.equal(M.watchItems({ services: down, incidents: [], today: '2026-11-25', now: NOW })[0].text, '장애 중');
  assert.equal(M.minutesText(65), '1시간 5분');
  assert.equal(M.minutesText(120), '2시간');
});

test('changeFeed: 최신 순, 변경 뒤 60분 안 같은 서비스 장애만 직후 장애, 24시간 6번 이상이면 자주 바뀜', () => {
  const services = [{ key: 'a', checks: [{ id: 1 }, { id: 2 }] }, { key: 'b', checks: [{ id: 3 }] }];
  const ch = (key, m) => ({ serviceKey: key, serviceName: key.toUpperCase(), firstSeenAt: minsAgo(m), oldSize: 100, newSize: 120 });
  const changes = [ch('a', 300), ch('a', 100), ch('b', 200)];
  const incidents = [
    { id: 11, monitorId: 2, startedAt: minsAgo(40) },  // a의 100분 전 변경 뒤 60분 → 직후 장애
    { id: 12, monitorId: 3, startedAt: minsAgo(130) }, // b의 200분 전 변경 뒤 70분 → 60분 넘음
    { id: 13, monitorId: 1, startedAt: minsAgo(310) }, // a 변경보다 먼저 시작 → 아님
  ];
  const r = M.changeFeed({ changes, services, incidents, now: NOW });
  assert.deepEqual(plain(r.items.map((i) => [i.serviceKey, i.incidentId])), [['a', 11], ['b', null], ['a', null]]);
  assert.deepEqual(plain(r.noisyKeys), []);

  const many = Array.from({ length: 6 }, (_, k) => ch('b', 10 + k * 60)); // 24시간 안 6번
  const noisy = M.changeFeed({ changes: [...many, ch('a', 30)], services, incidents: [], now: NOW });
  assert.deepEqual(plain(noisy.noisyKeys), ['b']);
  // 자주 바뀌는 b는 가장 최근 한 줄로 묶여서 a의 변경이 밀려나지 않음
  assert.deepEqual(plain(noisy.items.map((i) => [i.serviceKey, i.count])), [['b', 6], ['a', 1]]);
  // 직후 장애가 붙은 변경(250분 전 변경 → 240분 전 장애)은 묶지 않음
  const withInc = M.changeFeed({ changes: many, services, incidents: [{ id: 21, monitorId: 3, startedAt: minsAgo(240) }], now: NOW });
  assert.deepEqual(plain(withInc.items.map((i) => [i.count, i.incidentId])), [[5, null], [1, 21]]);
  assert.deepEqual(plain(M.changeFeed({ changes: [], services, incidents: [], now: NOW })), { items: [], noisyKeys: [] });
});

test('화면 기준 값이 서버 모듈의 같은 기준과 어긋나지 않는다', async () => {
  const fp = await import('../src/fingerprint.js');
  const api = await import('../src/api.js');
  const wr = await import('../src/weekly-report.js');
  assert.equal(M.NOISY_PER_DAY, fp.NOISY_PER_DAY);
  assert.equal(M.CHANGE_INCIDENT_MIN, api.CHANGE_LOOKBACK_MIN);
  assert.equal(M.SLOWDOWN_PERCENT, wr.SLOWDOWN_PERCENT);
  assert.equal(M.SLOWDOWN_MIN_MS, wr.SLOWDOWN_MIN_MS);
});
