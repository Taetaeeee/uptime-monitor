// 대시보드 계산 — 순수 함수 (화면 DOM을 건드리지 않음, S2)
//
// 대시보드 숫자(정상 몇 개, 장애 몇 건, 응답 시간 범위)는 방문자가 가장 먼저 믿는 값이라,
// app.js(DOM 코드)와 분리해서 node --test로 확인합니다. 입력은 /api/services·/api/status 응답 그대로입니다.
//
// summary.js와 같은 방식: 빌드 도구가 없으므로 전역 객체 하나(DashboardModel)로 노출하고,
// 테스트(test/dashboard-model.test.js)는 node:vm으로 이 파일을 읽어 실행합니다.
(function (root) {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const KST_MS = 9 * 60 * 60 * 1000;

  /** UTC ISO → 한국 날짜 'YYYY-MM-DD' (서버 aggregate.js toKstDay와 같은 규칙). 읽을 수 없으면 null */
  function kstDay(iso) {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? new Date(ms + KST_MS).toISOString().slice(0, 10) : null;
  }

  /**
   * 서비스 상태별 개수 (위쪽 요약 카드).
   * '부분 장애'와 '장애'는 한 칸에 합칩니다: 둘 다 "지금 조치가 필요한 서비스"이기 때문이에요.
   * 여러 서비스를 합친 평균 가동률은 만들지 않습니다 (서비스마다 점검 수·중요도가 달라 평균은 의미가 없음).
   */
  function countByState(services) {
    const c = { total: services.length, up: 0, degraded: 0, problem: 0, maintenance: 0, paused: 0, unknown: 0 };
    for (const s of services) {
      if (s.state === 'partial' || s.state === 'down') c.problem += 1;
      else if (s.state in c) c[s.state] += 1;
      else c.unknown += 1; // 모르는 값은 '확인 중'으로 (정상으로 세지 않음)
    }
    return c;
  }

  /** 남은 초 → 'MM:SS' (항상 두 자리씩: 숫자가 바뀔 때 글자 폭이 흔들리지 않게) */
  function mmss(sec) {
    const s = Math.max(0, Math.floor(sec));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  /** 검색: 서비스 이름·설명·묶인 점검 이름에서 찾습니다 (대소문자 무시) */
  function searchServices(services, query) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) =>
      [s.name, s.description ?? '', ...(s.checks ?? []).map((c) => c.name)].some((t) => t.toLowerCase().includes(q))
    );
  }

  /**
   * 세부 점검 칩에 쓸 짧은 이름.
   *   '사내 메신저 (DB 상태)' → 'DB 상태'   (이름 끝 괄호가 점검의 역할을 말해 줌)
   *   '고쳐라! 웹게임'        → 'HTTP'      (괄호가 없으면 점검 종류로)
   */
  function chipLabel(check) {
    const m = /\(([^()]+)\)\s*$/.exec(check.name ?? '');
    // 'DB 상태' → 'DB': 칩 안에 이미 상태(정상·오류)가 붙으므로 '상태'를 두 번 쓰지 않음 (시안과 같게)
    if (m) return m[1].trim().replace(/\s*상태$/, '');
    return { http: 'HTTP', dns: 'DNS', tcp: 'TCP', ping: 'ping', ssl: 'SSL', disk: '디스크', service: '서비스' }[check.kind] ?? check.kind;
  }

  /**
   * 칩 상태: 서버가 준 점검 상태에 '느림'을 더합니다.
   * 정상인데 마지막 결과가 느렸으면 'slow' — 서비스 '주의'가 어느 점검 때문인지 칩에서 보이게 하려고요.
   */
  function chipState(check) {
    if (check.state === 'up' && check.lastIsSlow) return 'slow';
    return check.state ?? 'unknown';
  }

  /**
   * 최근 N일 날짜 목록 (오래된 → 오늘). 서버 막대(daily)와 같은 날짜를 만듭니다.
   * @param {string} today  'YYYY-MM-DD' (API의 today 값)
   */
  function lastDays(today, n) {
    const end = Date.parse(`${today}T00:00:00Z`);
    const out = [];
    for (let i = n - 1; i >= 0; i -= 1) out.push(new Date(end - i * DAY_MS).toISOString().slice(0, 10));
    return out;
  }

  /**
   * 최근 장애 수와 일별 개수.
   * /api/status의 장애 이력은 최근 limit건만 오므로, limit건이 모두 기간 안이면 "그 이상일 수 있음"(capped)으로 알립니다.
   * 모르는 것을 정확한 숫자처럼 보이지 않게 하려는 것입니다.
   */
  function incidentsByDay(incidents, days, limit) {
    const set = new Set(days);
    const inRange = incidents.filter((i) => set.has(kstDay(i.startedAt)));
    const perDay = days.map((d) => inRange.filter((i) => kstDay(i.startedAt) === d).length);
    return { count: inRange.length, perDay, capped: incidents.length >= limit && inRange.length === incidents.length };
  }

  /**
   * 종류별 응답 시간 선 그래프 자료: 점검마다 한 줄, 값은 서버의 일평균 응답(성공한 점검만).
   * 여러 점검을 하나로 평균 내지 않습니다. DB 상태 확인(약 1초)과 첫 화면(수백 ms)을 섞으면 숫자가 의미를 잃어요.
   * label을 주면 칩 이름이 같은 점검만 고릅니다 ('HTTP' → 첫 화면 점검만, 'DB 상태' 같은 상태 확인 주소는 뺌).
   * @returns {{series: Array<{name:string, service:string, latest:number|null, points:Array<{day:string, v:number|null}>}>,
   *            latest: {min:number, max:number}|null, mean: number|null}}
   */
  function responseSeries(services, kind, label) {
    const series = [];
    for (const s of services) {
      for (const c of s.checks ?? []) {
        if (c.kind !== kind) continue;
        if (label && chipLabel(c) !== label) continue;
        const points = (c.daily ?? []).map((d) => ({ day: d.day, v: d.avgResponseMs }));
        // 가장 최근 일평균 (오늘 기록이 없으면 그 전 날)
        const last = [...points].reverse().find((p) => p.v !== null && p.v !== undefined);
        // key: 서비스 키 (서비스마다 정한 고유색을 찾는 데 씀)
        series.push({ name: `${s.name} ${chipLabel(c)}`, service: s.name, key: s.key, latest: last ? last.v : null, points });
      }
    }
    const latest = series.map((x) => x.latest).filter((v) => v !== null);
    return {
      series,
      latest: latest.length ? { min: Math.min(...latest), max: Math.max(...latest) } : null,
      // 같은 종류(첫 화면끼리, DNS끼리)의 단순 평균. 성격이 다른 점검은 label로 미리 빼고 씁니다
      mean: latest.length ? Math.round(latest.reduce((a, b) => a + b, 0) / latest.length) : null,
    };
  }

  /** 서비스별 일 가동률 선 (서버가 회차 기준으로 계산한 service.daily를 그대로) */
  function uptimeSeries(services) {
    return services.map((s) => ({ name: s.name, key: s.key, points: (s.daily ?? []).map((d) => ({ day: d.day, v: d.uptime })) }));
  }

  // ─────────────────────────────────────────────
  // 서비스가 10개가 넘어도 읽히는 운영 지표: 서비스별 고유색 · 순위 · 예외 우선
  // ─────────────────────────────────────────────

  const SERIES_COLORS = 10; // 서로 구별되는 고유색 개수 (색값은 dashboard.css의 --sc-1 ~ --sc-10)

  /**
   * 서비스마다 고유색 번호를 정한다. 서비스 목록 순서(서버의 sort_order, id)대로 1번부터.
   * 10개를 넘으면 색을 다시 쓰되 dashed: true를 붙여서 선 모양(점선)으로 구별합니다.
   * 한계: 서비스를 끄거나 중간에 끼워 넣으면 뒤 서비스의 색이 한 칸씩 밀립니다 (색 번호를 DB에 저장하지 않아서).
   * @returns {Object<string, {n:number, dashed:boolean}>} 서비스 key → 색 번호(1~10)
   */
  function serviceColors(services) {
    const out = {};
    services.forEach((s, i) => {
      out[s.key] = { n: (i % SERIES_COLORS) + 1, dashed: i >= SERIES_COLORS };
    });
    return out;
  }

  /**
   * 응답 시간이 느린 순으로 줄 세우기 (가로 막대 순위용).
   *   - 값이 없는 점검(latest null)은 맨 아래 ('기록 없음'으로 보이게). 값이 같으면 원래 순서 유지.
   *   - top: 위에서 limit개, rest: 나머지 개수 ("외 N개"), max: 막대 길이의 기준 (전체 중 가장 큰 값)
   *   막대 길이 기준을 전체에서 잡아야 작은 칸과 팝업에서 같은 값이 같은 비율로 보입니다.
   */
  function rankByLatest(series, limit) {
    const withIndex = series.map((s, i) => ({ s, i }));
    withIndex.sort((a, b) => {
      const av = a.s.latest;
      const bv = b.s.latest;
      const an = av === null || av === undefined;
      const bn = bv === null || bv === undefined;
      if (an !== bn) return an ? 1 : -1;
      if (an && bn) return a.i - b.i;
      return bv - av || a.i - b.i;
    });
    const ranked = withIndex.map((x) => x.s);
    const values = ranked.map((s) => s.latest).filter((v) => v !== null && v !== undefined);
    return {
      ranked,
      top: ranked.slice(0, limit),
      rest: Math.max(0, ranked.length - limit),
      max: values.length ? Math.max(...values) : 0,
    };
  }

  /**
   * 일 가동률을 "예외 우선"으로 나눈다: 그래프 구간(start부터)에서 100% 아래로 내려간 날이 있는 서비스만 선으로 그립니다.
   * 100%만 있는 서비스는 선이 전부 맨 위에 겹쳐서 읽을 수 없으므로 개수만 알려 줍니다.
   *   - 기록이 하나도 없는 서비스는 '100%'가 아니라 noDataCount (모르는 것을 100%로 보이지 않게)
   *   - dipped는 가장 낮았던 값이 낮은 순. limit개를 넘으면 hidden에 나머지 수
   * @param {Array<{key:string, name:string, daily:Array<{day:string, uptime:number|null}>}>} services
   * @param {number} start  sliceSeries와 같은 시작 위치
   */
  function splitUptimeByException(services, start, limit) {
    const dipped = [];
    let perfectCount = 0;
    let noDataCount = 0;
    for (const s of services) {
      const points = (s.daily ?? []).slice(start).map((d) => ({ day: d.day, v: d.uptime }));
      const values = points.map((p) => p.v).filter((v) => v !== null && v !== undefined);
      if (values.length === 0) {
        noDataCount += 1;
        continue;
      }
      const min = Math.min(...values);
      if (min < 100) dipped.push({ key: s.key, name: s.name, min, points });
      else perfectCount += 1;
    }
    dipped.sort((a, b) => a.min - b.min); // 정렬은 안정적이라 값이 같으면 원래 순서
    return { dipped: dipped.slice(0, limit), hidden: Math.max(0, dipped.length - limit), perfectCount, noDataCount };
  }

  /** 기록이 시작된 첫 날 (모든 서비스 중 가장 이른 날). 없으면 null */
  function firstRecordedDay(services) {
    const days = services.flatMap((s) => (s.daily ?? []).filter((d) => d.total > 0).map((d) => d.day));
    return days.length ? days.sort()[0] : null;
  }

  /**
   * 그래프 x축을 어디서 시작할지: 기록이 시작된 날부터 (단, 최소 minDays일은 보여 줌).
   * 실제 점검은 2026-11-11부터라 30일 축에 그리면 앞 3분의 2가 빈칸이 되고 선이 오른쪽에 몰려 읽기 어렵습니다.
   * @returns {number} days 배열에서 시작할 위치
   */
  function chartStart(days, firstDay, minDays) {
    const idx = firstDay ? days.indexOf(firstDay) : -1;
    const latestStart = Math.max(0, days.length - minDays);
    if (idx < 0) return firstDay && firstDay < days[0] ? 0 : latestStart;
    return Math.min(idx, latestStart);
  }

  /** 선 자료를 start부터 자르기 (모든 줄을 같은 날짜로) */
  function sliceSeries(series, start) {
    return series.map((s) => ({ ...s, points: s.points.slice(start) }));
  }

  // ─────────────────────────────────────────────
  // 서비스 상세 화면 (S3): 점검별 최근 24시간 기록(/api/monitors/:id/history)으로 계산
  // 기록 한 점: { checkedAt, isSuccess, isSlow, responseMs, inMaintenance }
  // ─────────────────────────────────────────────

  /**
   * 24시간 서비스 가동률: 묶인 점검들의 기록을 회차(checkedAt)별로 묶어 "모두 성공한 회차 비율".
   * 서버 src/service-status.js summarizeSlots와 같은 규칙입니다 (계획 작업 중 기록은 빼고, 내림 표시).
   * @param {Array<Array<object>>} histories  점검마다 기록 배열
   * @returns {{totalSlots:number, upSlots:number, percent:number|null}}
   */
  function serviceUptimeFromHistories(histories) {
    const slots = new Map();
    for (const points of histories) {
      for (const p of points) {
        if (p.inMaintenance) continue;
        const ok = slots.get(p.checkedAt) ?? true;
        slots.set(p.checkedAt, ok && p.isSuccess);
      }
    }
    const totalSlots = slots.size;
    const upSlots = [...slots.values()].filter(Boolean).length;
    return { totalSlots, upSlots, percent: totalSlots ? Math.floor((upSlots * 10000) / totalSlots) / 100 : null };
  }

  /** 성공한 점검의 평균 응답 시간(ms, 반올림). 없으면 null — 실패는 응답이 없거나 의미가 달라서 뺌 */
  function avgResponse(points) {
    const ms = points.filter((p) => p.isSuccess && !p.inMaintenance && p.responseMs !== null && p.responseMs !== undefined).map((p) => p.responseMs);
    return ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null;
  }

  /**
   * 성공/실패 칸: [from, to) 구간을 cellMin분 칸으로 나눠 칸마다 상태를 정합니다.
   * 회차 수가 아니라 시각으로 칸을 정하는 이유: 기록이 빠진 시간이 있으면 그 칸을 '기록 없음'으로 보여 주려고요
   * (회차 수로 묶으면 빠진 시간이 앞으로 당겨져 시각이 어긋나 보임).
   * 칸 상태 우선순위: 실패 > 느림 > 정상 > 계획 작업 > 기록 없음
   * @returns {Array<{start:string, state:'fail'|'slow'|'ok'|'maint'|'none', count:number, fails:number}>}
   */
  function timeCells(points, fromIso, toIso, cellMin) {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    const size = cellMin * 60 * 1000;
    const n = Math.max(1, Math.ceil((to - from) / size));
    const cells = Array.from({ length: n }, (_, i) => ({ start: new Date(from + i * size).toISOString(), state: 'none', count: 0, fails: 0, slow: 0, maint: 0 }));
    for (const p of points) {
      const i = Math.floor((Date.parse(p.checkedAt) - from) / size);
      if (i < 0 || i >= n) continue;
      const c = cells[i];
      c.count += 1;
      if (p.inMaintenance) c.maint += 1;
      else if (!p.isSuccess) c.fails += 1;
      else if (p.isSlow) c.slow += 1;
    }
    return cells.map(({ slow, maint, ...c }) => ({
      ...c,
      state: c.fails ? 'fail' : slow ? 'slow' : c.count > maint ? 'ok' : maint ? 'maint' : 'none',
    }));
  }

  /**
   * 백분위수 (nearest-rank): 정렬 후 ceil(p% × n)번째 값. 서버 src/analysis.js의 percentile과 같은 규칙입니다.
   * (화면은 빌드 도구 없는 일반 스크립트라 서버 모듈을 불러올 수 없어서 같은 규칙을 한 번 더 둡니다 — 테스트로 결과를 맞춤)
   */
  function percentile(values, p) {
    const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
    if (xs.length === 0) return null;
    return xs[Math.max(1, Math.ceil((p / 100) * xs.length)) - 1];
  }

  /** 최근 기록의 p95 응답 시간 — 성공한 점검만, 계획 작업 중 제외 (평균과 같은 대상) */
  function p95Response(points) {
    return percentile(points.filter((p) => p.isSuccess && !p.inMaintenance).map((p) => p.responseMs), 95);
  }

  /**
   * 열지도 칸 색 단계 — 실패가 느림보다 먼저 (실패 1번이 느림 여러 번보다 중요)
   *   none: 기록 없음 · ok: 문제 없음 · slow1/slow2: 느림 5% 미만/이상 · bad1/bad2: 실패 5% 미만/이상
   */
  function heatLevel(cell) {
    if (!cell || !cell.total) return 'none';
    if (cell.fail) return cell.fail / cell.total >= 0.05 ? 'bad2' : 'bad1';
    if (cell.slow) return cell.slow / cell.total >= 0.05 ? 'slow2' : 'slow1';
    return 'ok';
  }

  root.DashboardModel = {
    percentile, p95Response, heatLevel,
    serviceUptimeFromHistories, avgResponse, timeCells,
    kstDay, countByState, searchServices, chipLabel, chipState, lastDays, incidentsByDay, responseSeries, uptimeSeries, firstRecordedDay,
    chartStart, sliceSeries, mmss,
    SERIES_COLORS, serviceColors, rankByLatest, splitUptimeByException,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
