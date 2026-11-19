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
