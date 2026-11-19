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
        series.push({ name: `${s.name} ${chipLabel(c)}`, service: s.name, latest: last ? last.v : null, points });
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
    return services.map((s) => ({ name: s.name, points: (s.daily ?? []).map((d) => ({ day: d.day, v: d.uptime })) }));
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

  root.DashboardModel = {
    kstDay, countByState, searchServices, chipLabel, chipState, lastDays, incidentsByDay, responseSeries, uptimeSeries, firstRecordedDay,
    chartStart, sliceSeries,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
