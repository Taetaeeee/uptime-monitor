// 상태 페이지 요약 계산 — 순수 함수 (화면 DOM을 건드리지 않음)
//
// 왜 따로 뒀나?
//   "모두 정상"이라는 문구는 방문자가 가장 먼저 믿는 문장이라, 잘못 나오면 안 됩니다.
//   판정 규칙을 app.js(DOM 코드) 안에 두면 테스트하기 어려워서, 입력(/api/status의 services)만 받는 함수로 뺐어요.
//
// 빌드 도구가 없으므로 모듈(import/export)이 아니라 전역 객체 하나(UptimeSummary)로 노출합니다.
// HTML에서 app.js보다 먼저 불러와야 합니다. 테스트(test/summary.test.js)는 node:vm으로 이 파일을 읽어요.
(function (root) {
  'use strict';

  // 서비스 상태(state)의 의미 (src/api.js displayState 기준)
  //   up / down      : 판정된 상태
  //   maintenance    : 계획 작업 중 (실패해도 장애로 보지 않음)
  //   paused         : 실제 대상인데 점검을 켜지 않음(점검 대기) — 현재 점검하지 않음
  //   unknown        : 상태 기록 자체가 아직 없음(판정 전, 화면 글자 '확인 중')
  // lastCheckedAt이 null이면 "점검 결과 기록이 한 번도 없음"입니다. unknown(상태 미확인)과는 다른 이야기라 따로 셉니다.

  /** 실제 점검 중인 대상 = 출처 real 이면서 점검 대기(paused)가 아닌 것 */
  function isRealActive(s) {
    return s.source === 'real' && s.state !== 'paused';
  }

  const STALE_MS = 30 * 60 * 1000; // 5분마다 점검하는 대상이 30분 넘게 기록이 없으면 "최신 상태"라고 믿지 않음
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;

  /** 점검 시각 문자열 → ms. null(기록 없음)·형식이 틀린 값은 NaN */
  function parseTime(v) {
    return typeof v === 'string' && ISO_RE.test(v) ? Date.parse(v) : NaN;
  }

  /**
   * 판정 기준 시각(ms). 방문자 PC 시계는 틀릴 수 있어서(시계가 늦으면 오래된 기록이 최신처럼 보임)
   * API가 만든 시각(generatedAt)을 씁니다. 읽을 수 없으면 NaN → "최신 여부를 알 수 없음"으로 처리합니다.
   */
  function statusNow(data) {
    return parseTime(data && data.generatedAt);
  }

  /**
   * 실제 활성 대상 하나의 "기록 상태" (서로 겹치지 않는 하나의 값):
   *   down / maintenance        : 서버가 정한 상태 (우선순위가 높아 그대로 둠)
   *   noRecord                  : 점검 시각이 null — 한 번도 기록이 없음
   *   invalid                   : 점검 시각이 있는데 읽을 수 없음(형식 오류) — 기록 없음과 다른 문제
   *   unknown                   : 상태가 아직 판정 전(확인 중)
   *   unverified                : up이고 시각은 유효하지만 기준 시각을 몰라 최신 여부를 확인할 수 없음
   *   stale                     : up이고 시각은 유효하지만 30분 넘게 지남
   *   up                        : up + 유효한 시각 + 30분 이내  ← "정상"은 이것만
   * counts.up, tone, realTitle이 모두 이 한 가지 분류만 씁니다(서로 어긋나지 않게).
   */
  function classify(s, nowMs) {
    if (s.state === 'down') return 'down';
    if (s.state === 'maintenance') return 'maintenance';
    if (s.lastCheckedAt === null || s.lastCheckedAt === undefined || s.lastCheckedAt === '') return 'noRecord';
    const t = parseTime(s.lastCheckedAt);
    if (!Number.isFinite(t)) return 'invalid';
    if (s.state !== 'up') return 'unknown';
    if (!Number.isFinite(nowMs)) return 'unverified';
    return nowMs - t > STALE_MS ? 'stale' : 'up';
  }

  /**
   * 첫 상태 띠(실제 점검 기준) 계산.
   * 우선순위: down > maintenance > (기록 없음·시각 오류·확인 중·오래됨·기준 시각 불명) > 대상 0건 > 모두 정상
   * 재생·시뮬레이터·데모는 여기에 영향을 주지 않습니다(summarizeDemo가 따로 다룸).
   * "모두 정상"은 모든 실제 활성 대상이 up이고, 점검 시각이 모두 유효하며, 모두 최근일 때만 나옵니다.
   */
  function summarizeReal(services, nowMs) {
    const active = services.filter(isRealActive);
    const counts = { up: 0, down: 0, maintenance: 0, noRecord: 0, invalid: 0, unknown: 0, unverified: 0, stale: 0 };
    for (const s of active) counts[classify(s, nowMs)] += 1;

    let tone;
    if (active.length === 0) tone = 'idle';
    else if (counts.down) tone = 'bad';
    else if (counts.maintenance) tone = 'info';
    else if (counts.up === active.length) tone = 'good';
    else tone = 'idle';

    // 유효한 시각만으로 가장 최근·가장 오래된 시각을 구합니다 (잘못된 시각은 제외)
    const times = active.map((s) => parseTime(s.lastCheckedAt)).filter(Number.isFinite);
    return {
      tone,
      total: active.length,
      counts,
      downNames: active.filter((s) => s.state === 'down').map((s) => s.name),
      maintenanceNames: active.filter((s) => s.state === 'maintenance').map((s) => s.name),
      newestCheckedAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
      oldestCheckedAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
      staleCount: counts.stale,       // 30분 넘게 점검 기록이 없는 up 대상 (서버가 장애로 판정한 것이 아님)
      invalidCount: counts.invalid,   // 점검 시각을 읽을 수 없는 대상
      clockKnown: Number.isFinite(nowMs),
    };
  }

  /** 상태 띠의 제목 문장. "모두 정상"은 tone이 good일 때만 나옵니다. */
  function realTitle(r) {
    const n = r.total;
    const c = r.counts;
    if (n === 0) return '실제 점검 중인 대상이 없습니다 — 정상 여부를 알 수 없음';
    if (c.down > 0) return `실제 점검 ${n}건 중 ${c.down}건 장애: ${r.downNames.join(', ')}`;
    if (c.maintenance > 0) return `실제 점검 ${n}건 중 ${c.maintenance}건 계획 작업 중: ${r.maintenanceNames.join(', ')}`;
    if (r.tone === 'good') return `실제 점검 ${n}건 모두 정상`;
    const parts = [];
    if (c.noRecord) parts.push(`${c.noRecord}건 점검 기록 없음`);
    if (c.invalid) parts.push(`${c.invalid}건 점검 시각 확인 불가`);
    if (c.unknown) parts.push(`${c.unknown}건 상태 확인 중`);
    if (c.stale) parts.push(`${c.stale}건 30분 넘게 점검 기록 없음`);
    if (c.unverified) parts.push(`${c.unverified}건 기준 시각을 몰라 최신 여부 확인 불가`);
    return `실제 점검 ${n}건 중 ${parts.join(', ')} — 전체 정상으로 판단하지 않음`;
  }

  /** 요약 카드 보조 글자: 정상 집계에서 빠진 대상과 그 이유를 숫자로 설명 (분자와 어긋나지 않게 같은 counts 사용) */
  function realHelper(r) {
    if (r.total === 0) return '실제 활성 점검 대상 없음';
    const c = r.counts;
    const rest = [['장애', c.down], ['계획 작업', c.maintenance], ['점검 기록 없음', c.noRecord], ['시각 확인 불가', c.invalid],
      ['상태 확인 중', c.unknown], ['30분 넘게 기록 없음', c.stale], ['최신 여부 불명', c.unverified]]
      .filter(([, k]) => k > 0).map(([label, k]) => `${label} ${k}`);
    const base = `실제 활성 ${r.total}건 기준 · 점검 대기 제외`;
    return rest.length ? `${base} · 정상 집계 제외: ${rest.join(', ')}` : base;
  }

  /**
   * 재생·시뮬레이터·데모(실제 점검이 아닌 것)의 장애 요약. 실제 띠의 색에는 쓰지 않습니다.
   * 대상이 하나도 없으면 null(보조 줄 숨김).
   */
  function summarizeDemo(services) {
    const others = services.filter((s) => s.source !== 'real');
    if (others.length === 0) return null;
    const down = others.filter((s) => s.state === 'down');
    return { total: others.length, down: down.map((s) => ({ name: s.name, source: s.source })) };
  }

  /**
   * 점검 대상 수 분해. 합계가 항상 services.length와 같아야 합니다.
   * 알 수 없는 출처는 '기타'에 넣어서 합이 어긋나지 않게 합니다.
   */
  function breakdown(services) {
    const out = { total: services.length, realActive: 0, realPaused: 0, replay: 0, simulator: 0, sample: 0, other: 0 };
    for (const s of services) {
      if (s.source === 'real') out[s.state === 'paused' ? 'realPaused' : 'realActive'] += 1;
      else if (s.source === 'replay' || s.source === 'simulator' || s.source === 'sample') out[s.source] += 1;
      else out.other += 1;
    }
    return out;
  }

  /** 진행 중 장애 수: 실제 / 그 밖(재생·시뮬레이터·데모) 으로 나눠 셉니다. */
  function ongoingIncidents(incidents) {
    const ongoing = incidents.filter((i) => i.ongoing);
    const real = ongoing.filter((i) => i.source === 'real').length;
    return { real, other: ongoing.length - real, total: ongoing.length };
  }

  /** 서비스 목록을 출처·상태 필터로 거른다 (두 필터는 서로 독립). 'all'이면 해당 필터를 적용하지 않음 */
  function filterServices(services, { source = 'all', state = 'all', query = '' } = {}) {
    const q = String(query).trim().toLowerCase();
    return services.filter(
      (s) => (source === 'all' || s.source === source)
        && (state === 'all' || s.state === state)
        && (!q || s.name.toLowerCase().includes(q))
    );
  }

  root.UptimeSummary = { isRealActive, parseTime, statusNow, summarizeReal, realTitle, realHelper, summarizeDemo, breakdown, ongoingIncidents, filterServices };
})(typeof globalThis !== 'undefined' ? globalThis : this);
