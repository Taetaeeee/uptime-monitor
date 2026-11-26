// 대시보드 스크립트 (S2) — 두 API를 받아 화면을 그린다.
//   /api/services : 서비스 묶음(서비스 상태·회차 기준 가동률·묶인 점검) → 요약 카드, 서비스 줄, 운영 지표
//   /api/status   : 최근 알림·장애 이력·계획 작업, 점검별 상세 팝업 → 아래쪽 목록과 팝업
// 공용 도우미(formatKst, el, icon, statePill, kindMeta, sourceBadge, formatMinutes, fetchJson)는 common.js에,
// 대시보드 숫자 계산은 dashboard-model.js(DashboardModel)에, 그래프는 chart.js에,
// 점검 상세 팝업과 점검 공용 도우미(agoText·lastValue·uptimeText 등)는 detail.js에 있습니다.
//
// 화면 상태(검색어·선택한 점검)는 이 파일의 변수에 두고,
// 데이터를 새로 받아도(점검 회차 직후, 26단계부터 5분마다) 사용자가 고른 것은 그대로 유지합니다.
//
// 26단계 — D1 읽기 줄이기: 예전에는 회차 직후 + 60초마다 불렀지만, 데이터는 5분 점검 때만 바뀌므로 60초 새로고침을 없앴습니다.
// 열어 둔 화면 하나가 하루 1,440번 API를 불러 D1 무료 읽기 한도(하루 500만 행)를 크게 썼기 때문입니다.
// 탭이 숨어 있으면(다른 탭을 보는 중) 부르지 않고, 다시 보이면 마지막으로 받은 지 1분이 넘었을 때 바로 한 번 부릅니다.

const RETRY_MS = 60_000; // 불러오기에 실패하면 1분 뒤 다시 시도
const VISIBLE_STALE_MS = 60_000; // 탭이 다시 보일 때 이보다 오래된 화면이면 바로 새로 불러옴
const STALE_WARN_MS = 7 * 60_000; // 이보다 오래 새 데이터를 못 받으면 '연결 지연' (5분 회차 + 25초 여유보다 길게)
const INCIDENT_LIMIT = 10; // /api/status가 주는 장애 이력 개수 (src/api.js INCIDENT_LIMIT과 같게)

const view = {
  data: null, // /api/status 응답 (알림·장애 이력·점검 상세 팝업)
  svc: null, // /api/services 응답 (서비스 묶음)
  query: '',
  prevStates: null, // 직전에 불러온 서비스별 상태 (상태가 바뀐 줄을 찾기 위해)
  changed: new Set(), // 이번에 상태가 바뀐 서비스 key
  lastLoadedAt: 0, // 마지막으로 불러오기에 성공한 시각(ms)
  nextReloadAt: 0, // 다음 점검 회차 직후 다시 불러올 시각(ms)
};

// ─────────────────────────────────────────────
// 점검 주기 표시: 5분 점검 카운트다운(화면 갱신 주기는 별개), 상대 시간
// ─────────────────────────────────────────────
const CRON_DELAY_MS = 15 * 1000; // Cron은 정각보다 몇 초 늦게 돎 (실측 12초) → 15초로 잡음
const FETCH_AFTER_MS = 25 * 1000; // 점검이 끝나 저장될 여유를 두고 다시 불러옴

/** 다음 점검 예정 시각(ms): 다음 5분 회차 + 15초 */
function nextRunAt(nowMs) {
  return Math.floor((nowMs - CRON_DELAY_MS) / SLOT_MS) * SLOT_MS + SLOT_MS + CRON_DELAY_MS;
}

/** 1초마다: 카운트다운·상대 시간 글자 갱신, 점검 회차 직후 자동으로 다시 불러오기 */
function tickClock() {
  const now = Date.now();
  const next = nextRunAt(now);
  const left = Math.max(0, Math.round((next - now) / 1000));
  // 7분 넘게 새 데이터를 못 받았으면 '연결 지연'으로 (제목 줄 끝 점검 주기 표시: 점이 노란색으로).
  // 화면은 5분 회차 직후에만 새로 부르므로 3분 기준이면 정상인데도 노랗게 됨 (26단계에서 늘림). 숨은 탭은 일부러 안 불러서 제외
  const stale = !document.hidden && view.lastLoadedAt && now - view.lastLoadedAt > STALE_WARN_MS;
  const nextRun = document.getElementById('next-run');
  if (nextRun) nextRun.textContent = stale ? '연결 지연' : DashboardModel.mmss(left);
  document.getElementById('cycle')?.classList.toggle('is-stale', Boolean(stale));

  for (const node of document.querySelectorAll('[data-ago]')) {
    const text = agoText(node.dataset.ago, now);
    node.textContent = (node.dataset.agoPrefix ?? '') + (node.dataset.agoShort ? text.replace(' 점검', '') : text);
  }

  // 숨은 탭에서는 예약을 지키지 않고 기다렸다가, 다시 보일 때 visibilitychange에서 한 번 부름
  if (view.nextReloadAt && now >= view.nextReloadAt && !document.hidden) {
    view.nextReloadAt = 0;
    load();
  }
}

// 탭이 다시 보이면: 마지막으로 받은 지 1분이 넘었으면 바로 새로 불러옴 (숨어 있는 동안은 API를 부르지 않음)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - view.lastLoadedAt > VISIBLE_STALE_MS) load();
});

// ─────────────────────────────────────────────
// 상태 영역 + 요약 카드
// ─────────────────────────────────────────────

// 위 줄 작은 요약 3개 — 서비스 상태별 개수만 셉니다. (점검 시간은 '서비스 모니터링' 제목 줄 끝)
// 여러 서비스를 합친 '평균 가동률'은 만들지 않습니다: 서비스마다 점검 수·중요도가 달라 평균은 의미가 없기 때문이에요.
function renderStats(svc) {
  const c = DashboardModel.countByState(svc.services);
  // 정상·문제 칸에 들지 않는 상태(주의·계획 작업·점검 대기·확인 중)는 마우스를 올리면 보이게
  const rest = [['주의', c.degraded], ['계획 작업', c.maintenance], ['점검 대기', c.paused], ['확인 중', c.unknown]]
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label} ${n}`)
    .join(' · ');
  const cards = [
    ['layers', 'info', '전체 서비스', c.total, rest],
    ['check', 'good', '정상', c.up, ''],
    ['alert', c.problem ? 'bad' : 'warn', '부분 장애 · 장애', c.problem, ''],
  ];
  document.getElementById('stats').replaceChildren(
    ...cards.map(([ico, tone, label, value, title]) => {
      const card = el('div', 'kcard');
      if (title) card.title = title;
      const bub = el('span', `kcard__ico kcard__ico--${tone}`);
      bub.append(icon(ico));
      const body = el('div');
      const v = el('div', 'kcard__value', String(value));
      v.append(el('small', '', '개'));
      body.append(el('div', 'kcard__label', label), v);
      card.append(bub, body);
      return card;
    })
  );
}

function renderMaintenance(list) {
  document.getElementById('maintenance').replaceChildren(
    ...list.map((w) => {
      const box = el('div', 'maint');
      const ico = el('span', 'maint__icon');
      ico.append(icon('wrench', 'ico ico--sm'));
      const body = el('div');
      const head = el('div', 'maint__head', w.active ? '계획 작업 중' : '예정된 계획 작업');
      const badge = sourceBadge(w.source);
      if (badge) head.append(badge);
      body.append(
        head,
        el('div', 'maint__title', `${w.title} — ${w.monitorName ?? '모든 서비스'}`),
        el('div', 'maint__time', `${formatKst(w.startsAt)} ~ ${formatKst(w.endsAt)} · 이 시간의 점검은 장애로 보지 않고 가동률에서 제외`)
      );
      box.append(ico, body);
      return box;
    })
  );
}

// ─────────────────────────────────────────────
// 서비스 줄 (시안: 아이콘 | 이름·태그 | 상태 | 30일 가동률 | 최근 점검 | 세부 점검 상태 — 한 줄)
// ─────────────────────────────────────────────

// 칩 문구·아이콘, 서비스 아이콘, 상태 알약(serviceStatePill), 'HH:MM' 형식(kstHm)은 서비스 상세 화면과 함께 쓰므로 detail.js에 있습니다.

/** 점검 칩: 누르면 그 점검의 상세 팝업(기존 팝업, /api/status의 점검 정보)을 엽니다 */
function checkChip(check) {
  const state = DashboardModel.chipState(check);
  const chip = el('button', `chip chip--${state}`);
  chip.type = 'button';
  chip.dataset.detailId = String(check.id); // 팝업을 닫으면 이 칩으로 포커스가 돌아옴 (detail.js)
  chip.title = `${check.name} — 누르면 최근 기록`;
  const st = el('span', 'chip__state');
  st.append(icon(CHIP_ICON[state] ?? 'help', 'ico'), document.createTextNode(CHIP_TEXT[state] ?? state));
  chip.append(el('span', '', DashboardModel.chipLabel(check)), st);
  chip.addEventListener('click', () => select(check.id));
  return chip;
}

/** 최근 점검 글자: "17:40 · 5분 전" (상대 시간 부분은 tickClock이 1초마다 고침) */
function lastCheckNode(s) {
  const v = el('div', 'svc__v svc__v--sm');
  if (s.state === 'paused') {
    v.textContent = '현재 점검하지 않음';
  } else if (s.lastCheckedAt) {
    const ago = el('span', '', agoText(s.lastCheckedAt, Date.now()).replace(' 점검', ''));
    ago.dataset.ago = s.lastCheckedAt;
    ago.dataset.agoShort = '1';
    v.append(document.createTextNode(`${kstHm.format(new Date(s.lastCheckedAt))} · `), ago);
    v.title = formatKst(s.lastCheckedAt);
  } else {
    v.textContent = '아직 기록 없음';
  }
  return v;
}

function renderServiceRows(svc) {
  const root = document.getElementById('services');
  document.getElementById('svc-count').textContent = `전체 (${svc.services.length})`;
  const list = DashboardModel.searchServices(svc.services, view.query);
  if (svc.services.length === 0) {
    root.replaceChildren(el('div', 'svc__empty', '등록된 서비스가 없습니다.'));
    return;
  }
  if (list.length === 0) {
    root.replaceChildren(el('div', 'svc__empty', '검색어에 맞는 서비스가 없습니다.'));
    return;
  }
  const colors = DashboardModel.serviceColors(svc.services); // 전체 목록 기준: 검색으로 줄어도 색이 바뀌지 않음
  root.replaceChildren(
    ...list.map((s) => {
      const row = el('article', `svc svc--${s.state}`);
      // 줄을 누르면 서비스 상세 화면으로 (S3). 이름은 진짜 링크라 키보드(Tab·Enter)로도 열 수 있고,
      // 줄 안의 점검 칩은 지금처럼 그 점검의 팝업을 엽니다 (칩을 누른 경우에는 이동하지 않음)
      const href = `/service.html?key=${encodeURIComponent(s.key)}`;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.chip, a')) return;
        location.href = href;
      });
      if (view.changed.has(s.key)) row.classList.add('is-changed'); // 새로 불러온 데이터에서 상태가 바뀐 줄 강조

      // 서비스 고유색: 운영 지표의 막대·그래프와 같은 색이라 어느 서비스인지 바로 이어서 볼 수 있음
      const ico = el('span', `svc__ico ${colorClass(colors[s.key])}`);
      ico.append(serviceIcon(s)); // 종류별 아이콘 (28단계)
      ico.title = `종류: ${CATEGORY_TEXT[s.category] ?? CATEGORY_TEXT.other}`;

      const name = el('div');
      name.style.minWidth = '0';
      // 31단계: h1(서비스 모니터링) 바로 아래 단계라 h2 (h3이면 제목 단계를 건너뛰어 화면 읽기 프로그램의 제목 탐색이 끊김). 모양은 클래스가 정함
      const title = el('h2', 'svc__name');
      const link = el('a', 'svc__link', s.name);
      link.href = href;
      title.append(link);
      // 배포본은 실제 서비스만 두므로 '실제 점검' 배지는 줄마다 반복하지 않고, 실제가 아닌 서비스(로컬 시험)에만 붙입니다
      const badge = s.source === 'real' ? null : sourceBadge(s.source, s.state);
      if (badge) title.append(' ', badge);
      name.append(title);
      if (s.description) name.append(el('span', 'svc__tag', s.description));

      const uptime = el('div', 'svc__metric');
      uptime.append(el('div', 'svc__k', '30일 가동률'), el('div', 'svc__v', uptimeText(s.uptime30d)));
      uptime.title = '묶인 점검이 모두 성공한 5분 회차의 비율';

      const last = el('div', 'svc__metric');
      last.append(el('div', 'svc__k', '최근 점검'), lastCheckNode(s));

      const checks = el('div', 'svc__checks');
      const chips = el('div', 'chips');
      chips.append(...s.checks.map(checkChip));
      checks.append(el('div', 'svc__k', '세부 점검 상태'), chips);

      row.append(ico, name, serviceStatePill(s.state), uptime, last, checks);
      return row;
    })
  );
}

// ─────────────────────────────────────────────
// 운영 지표 요약 — 한눈에 (22단계: 숫자 타일 4개, 2×2)
//   타일:   큰 숫자 + 한 줄 설명(전주 대비·가장 느린 서비스·내려간 서비스·최근 7일) + 작은 선(서비스 평균 또는 내려간 서비스)
//           1440×900 화면에서 스크롤 없이 4개가 다 보이게 서비스별 선·범례는 타일에서 뺐습니다
//   팝업:   타일을 누르면 서비스별 자세한 그래프 — '겹쳐 보기'(범례 버튼으로 켜고 끔) · '순위(전체)' · '서비스별'
//   색:     서비스마다 고유색 하나 (DashboardModel.serviceColors) — 서비스 줄 아이콘·막대·그래프에서 같은 색
// 모두 이미 받은 두 응답으로 계산합니다 — 이 칸 때문에 API를 더 부르지 않습니다.
// ─────────────────────────────────────────────

const UPTIME_LINES = 5; // 가동률 칸에 그릴 선 수 (100% 아래로 내려간 서비스 중 가장 낮았던 순)
// 팝업에서 고른 탭·꺼 둔 서비스는 새로 불러와 다시 그려도 그대로 두려고 지표 제목별로 기억합니다
const metricUi = { tab: {}, hidden: {} };

/**
 * 지표 칸 하나. 칸 전체가 버튼이라 누르면(키보드 Enter·Space 포함) 자세히 보여 주는 팝업이 열립니다.
 * spec.renderSmall()은 작은 칸 안의 내용, spec.renderLarge()는 팝업 안의 내용을 새로 만들어 돌려주는 함수입니다.
 */
function metricBox(spec) {
  const box = el('button', 'mbox');
  box.type = 'button';
  box.setAttribute('aria-label', `${spec.title} 크게 보기`);
  box.append(metricHead(spec, false), spec.renderSmall());
  box.addEventListener('click', () => openMetric(spec));
  return box;
}

/**
 * 제목·숫자·설명 (타일과 팝업이 함께 씀).
 *   spec.tile: 타일에서만 바꿔 보여 줄 제목·숫자·단위 (예: 가동률 타일은 '가동률 100% 미만 3개', 팝업 제목은 '서비스 상태 추이')
 *   spec.sub:  긴 설명은 팝업에서만 (타일은 좁아서)
 *   spec.lines: 한 줄 설명들 — 타일과 팝업 모두. warn이면 주의색 (나빠졌을 때만 색을 칠해 화면이 덜 시끄럽게)
 */
function metricHead(spec, large) {
  const t = large ? spec : { ...spec, ...(spec.tile ?? {}) };
  const head = el('div', large ? 'mzoom__head' : '');
  head.append(el('div', 'mbox__t', t.title));
  if (t.value !== null && t.value !== undefined) {
    const n = el('div', 'mbox__n', String(t.value));
    n.append(el('small', '', t.unit));
    head.append(n);
  }
  if (large && spec.sub) head.append(el('div', 'mbox__sub', spec.sub));
  for (const line of spec.lines ?? []) head.append(el('div', `mbox__line${line.warn ? ' mbox__line--warn' : ''}`, line.text));
  return head;
}

// ── 지표 확대 팝업 ──
const metricDialog = () => document.getElementById('metric-dialog');
let metricOpener = null; // 팝업을 닫으면 포커스를 돌려줄 칸

function openMetric(spec) {
  metricOpener = document.activeElement;
  document.getElementById('metric-title').textContent = spec.title;
  const body = el('div', 'mzoom');
  body.append(metricHead(spec, true), spec.renderLarge());
  if (spec.note) body.append(el('p', 'mzoom__note', spec.note));
  document.getElementById('metric-body').replaceChildren(body);
  const d = metricDialog();
  if (!d.open) d.showModal();
}

const CHART_MIN_DAYS = 7; // 기록이 짧아도 그래프는 최소 7일 폭으로

function renderMetrics(svc, status) {
  const allDays = DashboardModel.lastDays(svc.today, svc.barDays);
  const first = DashboardModel.firstRecordedDay(svc.services);
  // x축은 기록 시작일부터 (30일 축에 9일치를 그리면 선이 오른쪽에 몰려 읽기 어려움)
  const start = DashboardModel.chartStart(allDays, first, CHART_MIN_DAYS);
  const days = allDays.slice(start);
  const big = (h) => ({ w: 880, h, l: 52, b: 28 }); // 팝업용 큰 그림
  const colors = DashboardModel.serviceColors(svc.services);
  const colorOf = (s) => colors[s.key];
  const specs = [];

  /**
   * 응답 시간 지표(HTTP·DNS): 타일은 평균 숫자 + 전주 대비(+ 가장 느린 서비스) + 서비스 평균 선 하나,
   * 팝업은 겹쳐 보기 · 순위(전체) · 서비스별. 점검 이름이 아니라 서비스 이름으로 보여 줍니다 (칸 제목이 이미 HTTP·DNS라서).
   */
  const responseSpec = ({ title, data, sub, note, label, showSlowest }) => {
    const full = DashboardModel.rankByLatest(data.series, data.series.length);
    const named = DashboardModel.sliceSeries(data.series, start).map((s) => ({ ...s, name: s.service }));
    const hidden = (metricUi.hidden[title] ??= new Set());
    const row = (s) => ({ name: s.service, value: s.latest, color: colorOf(s) });
    const lines = [];
    if (data.series.length) {
      // 전주 대비: 두 주 모두 기록이 있는 서비스만 비교 (새로 등록된 서비스가 평균을 바꾸지 않게) — 일부만 비교했으면 몇 개 기준인지 적음
      const wow = DashboardModel.weekOverWeek(data.series, svc.today);
      if (wow.compared === 0) lines.push({ text: '전주 대비: 비교할 지난주 기록 부족' });
      else {
        const arrow = wow.pct > 0 ? '↑' : wow.pct < 0 ? '↓' : '→';
        const basis = wow.compared < wow.total ? ` · ${wow.compared}/${wow.total}개 기준` : '';
        lines.push({ text: `전주 대비 ${arrow} ${Math.abs(wow.pct ?? 0)}%${basis}`, warn: wow.worse });
      }
      const top = full.ranked[0];
      if (showSlowest && top && top.latest !== null) lines.push({ text: `가장 느림 ${top.service} ${top.latest.toLocaleString('ko-KR')}ms` });
    }
    return {
      title, value: data.mean ?? '-', unit: 'ms', sub, note, lines,
      // 타일: 서비스 평균 선 하나 (그날 기록 있는 서비스만으로 평균). 서비스별 선은 팝업에서
      renderSmall: () => {
        if (data.series.length === 0) return el('p', 'mbox__empty', '기록이 아직 없습니다.');
        return sparkLine({ series: [{ name: '서비스 평균', points: DashboardModel.averageSeries(named) }], unit: 'ms', label: `${label} — 서비스 평균` });
      },
      // 팝업: 선 그래프('겹쳐 보기')를 첫 탭으로. 순위(전체)·서비스별은 그대로 남김
      renderLarge: () => {
        if (data.series.length === 0) return el('p', 'sd-empty', '기록이 아직 없습니다.');
        return metricTabs(
          [
            { label: '겹쳐 보기', build: () => seriesOverlay({ series: named, colorOf, unit: 'ms', label, box: big(300), hidden }) },
            { label: '순위 (전체)', build: () => barRank({ rows: full.ranked.map(row), max: full.max, unit: 'ms' }) },
            { label: '서비스별', build: () => seriesGrid({ series: named, colorOf, unit: 'ms', label }) },
          ],
          metricUi.tab[title] ?? 0,
          (i) => { metricUi.tab[title] = i; }
        );
      },
    };
  };

  // ① HTTP 평균 응답: 첫 화면 점검만 (DB 상태 확인 주소는 원래 약 1초라 섞으면 평균이 의미를 잃음)
  const http = DashboardModel.responseSeries(svc.services, 'http', 'HTTP');
  specs.push(responseSpec({
    title: 'HTTP 평균 응답', data: http, label: '첫 화면 일평균 응답 시간', showSlowest: true,
    sub: `${http.series.length}개 서비스 평균 · 첫 화면`,
    note: '성공한 점검의 하루 평균 응답 시간입니다. 큰 숫자는 서비스마다 가장 최근 일평균을 단순 평균한 값이고, 전주 대비는 어제까지 7일과 그 전 7일을 두 주 모두 기록이 3일 이상인 서비스만으로 비교합니다(+30% 이상이면서 +100ms 이상 느려지면 노란 글씨 — 주간 보고서와 같은 기준). 타일의 선은 날짜별 서비스 평균입니다. 순위 탭의 막대는 가장 최근 일평균이고 느린 순입니다. DB 상태 확인 주소(원래 약 1초)는 성격이 달라 이 평균에서 뺐고, 서비스 줄의 점검 칩을 누르면 따로 볼 수 있습니다. 점에 마우스를 올리면 날짜와 값이 보입니다.',
  }));

  // ② DNS 평균 응답
  const dns = DashboardModel.responseSeries(svc.services, 'dns');
  specs.push(responseSpec({
    title: 'DNS 평균 응답', data: dns, label: 'DNS 일평균 응답 시간',
    sub: `${dns.series.length}개 서비스 평균`,
    note: 'DNS-over-HTTPS로 이름을 푸는 데 걸린 시간의 하루 평균입니다(성공한 점검만). 전주 대비는 HTTP와 같은 방식이고, 값이 수십 ms라 +100ms 기준 때문에 노란 글씨는 거의 뜨지 않습니다. 기록이 없는 날은 선을 끊습니다.',
  }));

  // ③ 서비스 상태 추이: 예외 우선 — 100% 아래로 내려간 서비스만 선으로, 나머지는 개수만
  const upSplit = DashboardModel.splitUptimeByException(svc.services, start, UPTIME_LINES);
  const upAll = DashboardModel.sliceSeries(DashboardModel.uptimeSeries(svc.services), start);
  const upTitle = '서비스 상태 추이 (일 가동률)';
  const dippedKeys = new Set(DashboardModel.splitUptimeByException(svc.services, start, upAll.length).dipped.map((d) => d.key));
  // 겹쳐 보기는 처음에 내려간 서비스만 켜 둠 (100%인 서비스 선은 맨 위에 겹쳐 읽기만 어렵게 함). 이후는 사용자가 고른 대로
  if (!metricUi.hidden[upTitle]) {
    metricUi.hidden[upTitle] = new Set(upAll.map((s, i) => (dippedKeys.has(s.key) ? -1 : i)).filter((i) => i >= 0));
  }
  const dippedTotal = upSplit.dipped.length + upSplit.hidden;
  specs.push({
    title: upTitle, value: null,
    // 타일: 그래프 구간에서 100% 아래로 내려간 서비스 수 (기록이 하나도 없으면 '-')
    tile: { title: '가동률 100% 미만', value: dippedTotal || upSplit.perfectCount ? dippedTotal : '-', unit: '개' },
    lines: [{ text: DashboardModel.uptimeTileText(upSplit) }],
    sub: `${first ? `기록 시작 ${first} · ` : ''}세로축 95~100% (95% 아래는 바닥에 붙임)`,
    note: '서비스 가동률은 묶인 점검(HTTP·DNS·DB)이 모두 성공한 5분 회차의 비율입니다. 같은 5분에 여러 점검이 함께 실패해도 장애 한 번으로 셉니다. 작은 칸에는 그래프 구간에서 100% 아래로 내려간 날이 있는 서비스만 그리고, 100%만 있는 서비스는 개수로만 알립니다(선이 모두 맨 위에 겹쳐 읽을 수 없어서). 기록이 없는 서비스는 100%로 세지 않고 따로 셉니다.',
    // 타일: 내려간 서비스만 작은 선으로 (서비스 고유색, 95~100%). 없으면 선 없이 숫자·설명만
    renderSmall: () => {
      const lines = upSplit.dipped.map((d) => ({ name: d.name, cls: colorClass(colorOf(d)), points: d.points }));
      if (!lines.length) return el('div');
      return sparkLine({ series: lines, unit: '%', yMin: 95, yMax: 100, label: '100% 아래로 내려간 서비스의 일 가동률' });
    },
    renderLarge: () => {
      if (upAll.length === 0) return el('p', 'sd-empty', '기록이 아직 없습니다.');
      return metricTabs(
        [
          { label: '겹쳐 보기', build: () => seriesOverlay({ series: upAll, colorOf, unit: '%', yMin: 95, yMax: 100, label: '서비스별 일 가동률', box: big(320), hidden: metricUi.hidden[upTitle] }) },
          { label: '서비스별', build: () => seriesGrid({ series: upAll, colorOf, unit: '%', yMin: 95, yMax: 100, label: '일 가동률' }) },
        ],
        metricUi.tab[upTitle] ?? 0,
        (i) => { metricUi.tab[upTitle] = i; }
      );
    },
  });

  // ④ 최근 장애 수 (장애 이력에서 시작일 기준). 숫자는 30일 전체, 막대는 그래프 구간만
  const inc = DashboardModel.incidentsByDay(status.incidents ?? [], allDays, INCIDENT_LIMIT);
  const incValues = inc.perDay.slice(start);
  // 최근 7일(오늘 포함) 건수 — 장애 이력은 최근 10건까지만 오므로 10건이 모두 7일 안이면 '+'를 붙임
  const inc7 = DashboardModel.incidentsByDay(status.incidents ?? [], allDays.slice(-7), INCIDENT_LIMIT);
  specs.push({
    title: '최근 장애 수', value: inc.capped ? `${inc.count}+` : inc.count, unit: '건',
    sub: inc.capped ? `장애 이력 최근 ${INCIDENT_LIMIT}건이 모두 30일 안이라 더 있을 수 있음` : '30일 · 2회 연속 실패로 판정된 장애',
    lines: [{ text: `최근 7일 ${inc7.capped ? `${inc7.count}+` : inc7.count}건` }],
    note: '장애가 시작된 날(한국 시간) 기준으로 셉니다. 막대에 마우스를 올리면 날짜와 건수가 보이고, 장애 하나하나는 왼쪽 메뉴의 장애 이력에서 볼 수 있습니다.',
    renderSmall: () => sparkBars({ days, values: incValues, label: '날짜별 장애 수' }),
    renderLarge: () => dayBarChart({ days, values: incValues, label: '날짜별 장애 수', box: big(260) }),
  });

  document.getElementById('metrics').replaceChildren(...specs.map(metricBox));
  // 팝업이 열려 있으면 같은 지표를 새 데이터로 다시 그림 (점검 회차 직후 자동 갱신)
  const d = metricDialog();
  if (d?.open) {
    const same = specs.find((s) => s.title === document.getElementById('metric-title').textContent);
    if (same) openMetric(same);
  }
}

// 지표 팝업 닫기: ✕ 버튼, 바깥 클릭, Esc(브라우저 기본). 닫히면 눌렀던 칸으로 포커스를 돌려줌
document.getElementById('metric-close').addEventListener('click', () => metricDialog().close());
metricDialog().addEventListener('click', (e) => {
  if (e.target === e.currentTarget) metricDialog().close();
});
metricDialog().addEventListener('close', () => {
  if (metricOpener?.isConnected) metricOpener.focus({ preventScroll: true });
  metricOpener = null;
});

// ─────────────────────────────────────────────
// 최근 알림 (오른쪽 칸 맨 위, 운영 지표 요약과 같은 폭, 안에서 스크롤). 장애 이력은 /incidents.html(incidents.js)로 옮김
// ─────────────────────────────────────────────

function notificationItem(n) {
  const li = el('li', `note note--${n.event}`);
  const msg = el('div', 'note__msg', n.message);
  msg.title = n.message; // 한 줄로 줄여 보이므로 전체 문장은 마우스를 올리면
  const badge = n.source === 'real' ? null : sourceBadge(n.source); // 실제가 아닌 기록에만 표시
  if (badge) msg.append(' ', badge);
  li.append(el('span', 'note__icon'), msg, el('div', 'note__time', formatKst(n.createdAt)));
  return li;
}

function renderNotifications(notes) {
  // 최근 알림은 화면 위쪽에 있으므로 '더 보기'로 길어지지 않게, 높이를 고정하고 패널 안에서만 스크롤합니다
  // (펼치면 아래 서비스 현황이 밀려 내려가 화면이 흔들리기 때문)
  const root = document.getElementById('notifications');
  if (notes.length === 0) {
    root.replaceChildren(el('p', 'notes__empty', '아직 알림이 없습니다.'));
    return;
  }
  const prev = root.querySelector('.scroll-list')?.scrollTop ?? 0; // 자동 갱신 때 보던 위치 유지
  const list = el('ol', 'notes scroll-list');
  list.tabIndex = 0; // 키보드(화살표)로도 스크롤할 수 있게
  list.setAttribute('aria-label', `최근 알림 ${notes.length}건`);
  list.append(...notes.map(notificationItem));
  root.replaceChildren(list);
  list.scrollTop = prev;
}

// ─────────────────────────────────────────────
// 오른쪽 칸 (23단계): 오늘 확인할 것 · 최근 배포(추정)
// 이미 받은 /api/services(recentChanges 포함)·/api/status(장애 이력)만 씁니다 — 새 요청 없음.
// 무엇을 고르고 어떤 순서로 보일지는 DashboardModel.watchItems·changeFeed(순수 함수, 테스트 있음)가 정합니다.
// ─────────────────────────────────────────────

const WATCH_SHOW = 6;  // 확인할 것은 6줄까지, 나머지는 '외 N건'
const CHANGE_SHOW = 5; // 최근 배포는 5줄까지

// 변경 종류 표시 (27단계): 빌드 지문이 바뀌면 배포, 파일은 그대로 내용만 바뀌면 내용 변경, 근거가 없으면 첫 화면 변경
const CHANGE_KIND_TEXT = { deploy: '배포', content: '내용 변경', unknown: '첫 화면 변경' };
const CHANGE_KIND_TITLE = {
  deploy: '스크립트·스타일 파일 이름(빌드 해시)이 바뀌었습니다 — 새로 빌드해 배포한 것',
  content: '빌드 파일은 그대로이고 첫 화면 내용만 바뀌었습니다 — 데이터·문구 변경',
  unknown: '이 사이트는 빌드 해시가 붙은 파일이 없거나(직접 쓴 정적 페이지 등) 비교할 기록이 없어 배포인지 구별할 수 없습니다',
};

// 바이트 → '7.4KB' (첫 화면 크기 변화를 보여 줄 때)
const sizeText = (n) => (typeof n !== 'number' ? '-' : n < 1024 ? `${n}B` : `${(n / 1024).toFixed(1)}KB`);
// 좁은 칸용 짧은 한국 시각: 오늘이면 '14:05', 아니면 '11/24 14:05' (24시간제)
function shortKst(iso, today) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '-';
  const k = new Date(ms + 9 * 3600000).toISOString(); // KST로 옮긴 뒤 글자로 자름
  const hm = k.slice(11, 16);
  return k.slice(0, 10) === today ? hm : `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))} ${hm}`;
}

function renderWatch(svc, data) {
  const items = DashboardModel.watchItems({ services: svc.services, incidents: data.incidents ?? [], today: svc.today, now: Date.now() });
  document.getElementById('watch-count').textContent = items.length ? `${items.length}건` : '';
  const root = document.getElementById('watch');
  if (items.length === 0) {
    // 아무 일 없을 때도 '감시가 돌고 있다'는 근거(마지막 점검 시각)를 함께 보여 줍니다
    const last = svc.services.map((s) => s.lastCheckedAt).filter(Boolean).sort().at(-1);
    const ok = el('p', 'watch__ok');
    const lastText = last ? ` · 마지막 점검 ${shortKst(last, svc.today)}` : ''; // 아직 한 번도 점검하지 않았으면 시각은 빼고
    ok.append(icon('check', 'ico ico--sm'), document.createTextNode(` 확인할 것 없음 — ${svc.services.length}개 서비스${lastText}`));
    root.replaceChildren(ok);
    return;
  }
  const list = el('ul', 'watch');
  for (const it of items.slice(0, WATCH_SHOW)) {
    const li = el('li');
    const a = el('a', `watch__row watch__row--${it.kind}`);
    a.href = `/service.html?key=${encodeURIComponent(it.serviceKey)}`;
    a.append(el('i', 'watch__dot'), el('span', 'watch__name', `${it.serviceName} · ${it.check}`), el('span', 'watch__text', it.text));
    a.title = `${it.serviceName} · ${it.check} — ${it.text}`;
    li.append(a);
    list.append(li);
  }
  root.replaceChildren(list);
  if (items.length > WATCH_SHOW) root.append(el('p', 'side-card__more', `외 ${items.length - WATCH_SHOW}건`));
}

function renderChanges(svc, data) {
  const { items, noisyKeys } = DashboardModel.changeFeed({
    changes: svc.recentChanges ?? [], counts: svc.changeCounts, services: svc.services, incidents: data.incidents ?? [], now: Date.now(),
  });
  const root = document.getElementById('changes');
  if (items.length === 0) {
    root.replaceChildren(el('p', 'side-card__empty', '최근 7일 첫 화면 변경 없음'));
    return;
  }
  const noisy = new Set(noisyKeys);
  const list = el('ul', 'chg');
  for (const it of items.slice(0, CHANGE_SHOW)) {
    const li = el('li', 'chg__row');
    const name = el('a', 'chg__name', it.serviceName);
    name.href = `/service.html?key=${encodeURIComponent(it.serviceKey)}`;
    const time = el('span', 'chg__time', shortKst(it.at, svc.today));
    time.title = formatKst(it.at);
    const kind = el('span', `chg__kind chg__kind--${it.kind}`, CHANGE_KIND_TEXT[it.kind] ?? CHANGE_KIND_TEXT.unknown);
    kind.title = CHANGE_KIND_TITLE[it.kind] ?? CHANGE_KIND_TITLE.unknown;
    li.append(time, name, kind, el('span', 'chg__size', `${sizeText(it.oldSize)} → ${sizeText(it.newSize)}`));
    if (it.incidentId !== null) {
      // 변경 뒤 60분 안에 같은 서비스에서 장애가 시작됨 → 장애 상세(장애 직전 변경 타임라인, 17단계)로 연결
      const b = el('a', 'chg__badge chg__badge--bad', '직후 장애');
      b.href = `/incident.html?id=${encodeURIComponent(it.incidentId)}`;
      b.title = `변경 뒤 ${DashboardModel.CHANGE_INCIDENT_MIN}분 안에 장애가 시작됨`;
      li.append(b);
    }
    if (noisy.has(it.serviceKey)) {
      // 잦은 변경 서비스는 한 줄로 묶고 서버가 센 24시간 변경 수를 적음 (changeFeed).
      // 빌드할 때마다 첫 화면의 파일 이름(해시)이 바뀌는 서비스는 배포가 잦아도 이렇게 보이므로 '동적 내용'이라고 단정하지 않음
      // 27단계: 24시간 변경이 모두 빌드 파일이 바뀐 배포로 확인되면 '배포 잦음'으로 (동적 내용 안내를 붙이지 않음)
      const b = it.allDeploy
        ? el('span', 'chg__badge chg__badge--deploy', `배포 잦음 · 24시간 ${it.deployDay}번`)
        : el('span', 'chg__badge', `잦은 변경 · 24시간 ${it.day}번`);
      b.title = it.allDeploy
        ? `최근 7일 배포 ${it.deployWeek}번 (빌드 파일 이름이 바뀐 변경만 셈)`
        : `최근 7일 ${it.week}번 바뀜 — 배포가 잦거나(빌드할 때마다 첫 화면의 파일 이름이 바뀜) 날짜·광고 같은 동적 내용일 수 있음`;
      li.append(b);
    }
    list.append(li);
  }
  root.replaceChildren(list);
  if (items.length > CHANGE_SHOW) root.append(el('p', 'side-card__more', `외 ${items.length - CHANGE_SHOW}건`));
  root.append(el('p', 'side-card__foot', '처음 본 시각(5분 점검)입니다. 배포 = 빌드 파일 이름이 바뀜 · 내용 변경 = 파일은 그대로 · 첫 화면 변경 = 구별할 근거 없음'));
}

// ─────────────────────────────────────────────
// 불러오기
// ─────────────────────────────────────────────

async function load() {
  try {
    // cache: 'no-store' — 브라우저 캐시를 쓰지 않고 항상 최신을 받아 오게 (회차 직후에만 부르므로 늦은 캐시를 받지 않게)
    // 두 응답을 함께 받습니다. 하나라도 실패하면 이전 화면을 그대로 두고 안내만 바꿔요 (반쪽짜리 화면을 만들지 않으려고)
    const [svc, data] = await Promise.all([
      fetchJson('/api/services', { cache: 'no-store' }),
      fetchJson('/api/status', { cache: 'no-store' }),
    ]);
    view.svc = svc;
    view.data = data;
    // 서비스 추가 팝업의 '알림 받을 메일' 칸: 수신자 기능이 켜져 있을 때만 보임 (19단계, 기본은 꺼짐)
    document.getElementById('add-email-row').hidden = svc.subscribersEnabled !== true;
    view.lastLoadedAt = Date.now();
    // 다음 점검 회차가 끝난 직후(+25초)에 다시 불러오도록 예약 → 새 점검 결과가 바로 보임
    view.nextReloadAt = nextRunAt(Date.now()) + FETCH_AFTER_MS;

    // 직전 데이터와 비교해서 상태가 바뀐 서비스 찾기 (처음 불러올 때는 비교 대상이 없으므로 강조 안 함)
    const now = new Map(svc.services.map((x) => [x.key, x.state]));
    view.changed = new Set(
      view.prevStates ? [...now].filter(([key, st]) => view.prevStates.has(key) && view.prevStates.get(key) !== st).map(([key]) => key) : []
    );
    view.prevStates = now;
    const status = document.getElementById('load-status');
    status.textContent = '';
    status.classList.remove('is-error');
    renderStats(svc);
    renderServiceRows(svc);
    renderMetrics(svc, data);
    renderWatch(svc, data);
    renderChanges(svc, data);
    renderMaintenance(data.maintenance ?? []);
    refreshDetail(data); // 점검 상세 팝업(detail.js)에도 새 데이터 전달
    renderNotifications(data.notifications);
    document.getElementById('updated').textContent = `데이터 생성 시각: ${formatKst(data.generatedAt)}`;
  } catch (err) {
    // 불러오기에 실패해도 이전 화면은 그대로 두고 안내만 바꿉니다
    console.error(err);
    const status = document.getElementById('load-status');
    status.textContent = view.svc
      ? '최신 상태를 불러오지 못했습니다. 아래는 마지막으로 받은 화면이며, 잠시 후 자동으로 다시 시도합니다.'
      : '상태를 불러오지 못했습니다. 잠시 후 자동으로 다시 시도합니다.';
    // 60초 새로고침이 없으므로(26단계) 실패하면 1분 뒤 다시 시도하도록 예약 (다음 회차까지 기다리지 않게)
    view.nextReloadAt = Date.now() + RETRY_MS;
    status.classList.add('is-error');
  }
}

document.getElementById('search').addEventListener('input', (e) => {
  view.query = e.target.value;
  if (view.svc) renderServiceRows(view.svc);
});

load();
// 60초마다 부르던 것은 없앴습니다 (26단계): 새로 부르는 때는 점검 회차 직후(tickClock), 실패 뒤 1분, 탭이 다시 보일 때뿐
setInterval(tickClock, 1000);
tickClock();

// ─────────────────────────────────────────────
// 서비스 추가 (S4) — 주소 → [미리 점검] → [추가]
// 관리자 API(POST /api/admin/services/preview, /api/admin/services)를 부릅니다. 판단(주소 검사·동의·중복·상한)은 서버가 하고,
// 여기서는 결과를 사람이 읽을 문장으로 보여 주기만 합니다. 관리자 토큰은 입력칸에만 있고 어디에도 저장하지 않습니다.
// ─────────────────────────────────────────────

// 서버 오류 코드 → 화면 문구 (src/service-admin.js·src/admin.js의 코드와 같게)
const ADD_ERROR_TEXT = {
  category_invalid: '종류 값이 목록에 없습니다. 목록에서 골라 주세요.',
  url_required: '사이트 주소를 넣어 주세요.',
  url_invalid: '주소 형식이 올바르지 않습니다.',
  url_too_long: '주소가 너무 깁니다.',
  https_only: 'https:// 로 시작하는 주소만 받습니다.',
  credentials_not_allowed: '아이디·비밀번호가 들어간 주소는 받지 않습니다.',
  port_not_allowed: '기본 포트(443)가 아닌 주소는 받지 않습니다.',
  ip_not_allowed: 'IP 주소는 받지 않습니다. 도메인 이름을 넣어 주세요.',
  host_invalid: '도메인 이름이 올바르지 않습니다 (예: my-app.pages.dev).',
  host_not_public: '내부망·예약된 이름(localhost, .local, .test 등)은 받지 않습니다.',
  self_not_allowed: '이 모니터 자신의 주소는 점검 대상으로 받지 않습니다.',
  health_host_mismatch: '상태 확인 주소는 사이트 주소와 같은 사이트 안이어야 합니다.',
  keyword_without_health: '응답 글자는 상태 확인 주소와 함께 넣어 주세요.',
  name_invalid: '이름은 60자 이내로 넣어 주세요.',
  description_invalid: '설명은 100자 이내로 넣어 주세요.',
  keyword_invalid: '응답 글자는 100자 이내로 넣어 주세요.',
  consent_required: '운영자 동의 확인에 체크해야 추가할 수 있습니다.',
  already_exists: '이미 점검 중인 사이트입니다.',
  limit_reached: '켜진 서비스가 상한에 이르렀습니다. 다른 서비스를 끈 뒤 추가해 주세요.',
  // 29단계: 서비스 수는 상한 안이어도, 켜진 점검(HTTP·DNS)이 많으면 5분마다 보내는 요청이 무료 한도(회차당 50개)에 걸림
  check_limit_reached: '켜진 점검이 너무 많아 5분 점검 요청 한도를 넘습니다. 상태 확인 주소를 빼거나 다른 서비스를 끈 뒤 추가해 주세요.',
  unauthorized: '관리자 토큰이 맞지 않습니다.',
  admin_api_disabled: '서버에 관리자 토큰이 등록되지 않아 추가할 수 없습니다.',
  // 알림 받을 메일 (19단계)
  email_invalid: '메일 주소 형식이 올바르지 않습니다.',
  email_too_long: '메일 주소가 너무 깁니다.',
  subscribers_disabled: '장애 알림 수신 기능이 꺼져 있어 메일은 등록할 수 없습니다.',
};
const addErrorText = (code) =>
  ADD_ERROR_TEXT[code] ?? (code?.startsWith('health_') ? `상태 확인 주소: ${ADD_ERROR_TEXT[code.slice(7)] ?? code}` : `추가하지 못했습니다 (${code ?? '알 수 없는 오류'}).`);

const addDialog = () => document.getElementById('add-dialog');
const addForm = () => document.getElementById('add-form');

/** 입력값 → 요청 본문 (빈 칸은 보내지 않음) */
function addBody() {
  const f = addForm();
  const v = (n) => f.elements[n].value.trim();
  const body = { url: v('url'), consent: f.elements.consent.checked };
  for (const k of ['name', 'description', 'healthUrl', 'healthKeyword', 'category']) if (v(k)) body[k] = v(k); // category: 비우면 서버가 추천값으로 저장 (28단계)
  // 알림 받을 메일 (19단계): 칸이 보일 때(기능이 켜져 있을 때)만 보냄
  if (!document.getElementById('add-email-row').hidden && v('alertEmail')) body.alertEmail = v('alertEmail');
  return body;
}

async function addCall(path, body) {
  const token = addForm().elements.token.value;
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  let data = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  return { status: res.status, data };
}

/** 결과 칸에 문구(와 미리 점검 목록)를 보여 줌 */
function addShow(tone, text, checks) {
  const box = document.getElementById('add-result');
  const nodes = [el('p', `addform__msg addform__msg--${tone}`, text)];
  if (checks?.length) {
    const ul = el('ul', 'addform__checks');
    for (const c of checks) {
      const li = el('li', c.isSuccess ? 'is-ok' : 'is-bad');
      li.append(icon(c.isSuccess ? 'check' : 'x', 'ico ico--xs'));
      const detail = c.kind === 'dns'
        ? (c.isSuccess ? `레코드 ${c.records}개 · ${c.responseMs}ms` : c.failureText)
        : (c.isSuccess ? `${c.statusCode} · ${c.responseMs}ms${c.isSlow ? ' (느림)' : ''}` : `${c.failureText}${c.statusCode ? ` (${c.statusCode})` : ''}`);
      li.append(document.createTextNode(` ${c.name}: ${detail}`));
      ul.append(li);
    }
    nodes.push(ul);
  }
  box.replaceChildren(...nodes);
}

function addBusy(on) {
  for (const id of ['add-preview', 'add-submit']) document.getElementById(id).disabled = on;
}

async function addPreview() {
  if (!addForm().elements.token.value) return addShow('bad', '관리자 토큰을 넣어 주세요.');
  addBusy(true);
  addShow('info', '한 번 접속해 보는 중… (저장하지 않음)');
  try {
    const { status, data } = await addCall('/api/admin/services/preview', addBody());
    if (status !== 200) return addShow('bad', addErrorText(data?.error));
    const name = addForm().elements.name;
    if (!name.value.trim()) name.placeholder = `비우면 ${data.proposed.name}`;
    // 종류 추천 (28단계): 운영자가 아직 고르지 않았을 때만 추천값을 골라 둠 (직접 고른 값은 덮어쓰지 않음)
    const cat = addForm().elements.category;
    if (data.suggestedCategory && (!cat.value || cat.dataset.suggested === 'yes')) {
      cat.value = data.suggestedCategory;
      cat.dataset.suggested = 'yes';
    }
    const allOk = data.checks.every((c) => c.isSuccess);
    let text = allOk ? '모두 정상입니다. [추가]를 누르면 다음 5분 회차부터 점검합니다.' : '실패한 점검이 있습니다. 주소를 확인해 주세요. 그대로 추가하면 장애로 기록될 수 있습니다.';
    // 점검 예산 (29단계): 예전 서버 응답에는 checkLimit이 없으므로 있을 때만 봄
    const overChecks = data.checkLimit != null && data.checkCount > data.checkLimit;
    if (data.alreadyExists) text = ADD_ERROR_TEXT.already_exists;
    else if (data.activeCount >= data.limit) text = ADD_ERROR_TEXT.limit_reached;
    else if (overChecks) text = ADD_ERROR_TEXT.check_limit_reached;
    const room = data.checkLimit != null ? ` · 추가 뒤 서비스 ${Math.min(data.activeCount + 1, data.limit)}/${data.limit}개, 점검 ${data.checkCount}/${data.checkLimit}개` : '';
    addShow(allOk && !data.alreadyExists && data.activeCount < data.limit && !overChecks ? 'ok' : 'warn', `${text} (서비스 키: ${data.proposed.key}${room})`, data.checks);
  } catch (err) {
    console.error(err);
    addShow('bad', '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    addBusy(false);
  }
}

async function addSubmit(e) {
  e.preventDefault();
  if (!addForm().elements.token.value) return addShow('bad', '관리자 토큰을 넣어 주세요.');
  if (!addForm().elements.consent.checked) return addShow('bad', ADD_ERROR_TEXT.consent_required);
  addBusy(true);
  addShow('info', '추가하는 중…');
  try {
    const { status, data } = await addCall('/api/admin/services', addBody());
    if (status !== 201) return addShow('bad', addErrorText(data?.error));
    // 알림 메일을 함께 넣었으면 확인 메일 결과도 알려 줌 (주소는 다시 보여 주지 않음)
    const sub = data.subscriber;
    const subText = !sub ? '' : sub.confirmSent ? ' 알림 메일 주소로 확인 메일을 보냈습니다 — [받기]를 눌러야 등록됩니다.'
      : sub.status === 'active' ? ' 그 메일 주소는 이미 알림을 받고 있습니다.'
      : ' 다만 확인 메일을 보내지 못했습니다 (관리자 API로 다시 보낼 수 있습니다).';
    addShow(sub && !sub.confirmSent && sub.status !== 'active' ? 'bad' : 'ok', `'${data.name}'을(를) 추가했습니다. 다음 5분 회차부터 점검합니다.${subText}`);
    await load(); // 대시보드에 새 서비스 줄이 '확인 중'으로 나타남
    addForm().elements.token.value = ''; // 다 쓴 토큰은 바로 지움
    setTimeout(closeAdd, sub ? 4000 : 1200); // 확인 메일 안내가 있으면 읽을 시간을 조금 더
  } catch (err) {
    console.error(err);
    addShow('bad', '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    addBusy(false);
  }
}

document.getElementById('add-open').addEventListener('click', () => {
  document.getElementById('add-result').replaceChildren();
  addDialog().showModal();
  addForm().elements.url.focus();
});
/** 입력(특히 관리자 토큰)을 모두 지움 — 브라우저 화면에 토큰이 남지 않게 */
function clearAdd() {
  addForm().reset();
  delete addForm().elements.category.dataset.suggested; // 다음에 열 때 추천을 다시 받게
  addForm().elements.name.placeholder = '비우면 주소 이름';
  document.getElementById('add-result').replaceChildren();
}
/**
 * 닫기: 지우기를 'close' 이벤트에만 맡기지 않고 닫는 쪽에서 직접 합니다.
 * (close 이벤트는 브라우저가 나중에 보내는 알림이라, 화면이 숨겨진 탭 등에서는 늦게 오는 것을 확인함 — 토큰 지우기를 늦추지 않으려고)
 */
function closeAdd() {
  clearAdd();
  if (addDialog().open) addDialog().close();
  document.getElementById('add-open').focus({ preventScroll: true });
}
document.getElementById('add-close').addEventListener('click', closeAdd);
addDialog().addEventListener('click', (e) => { if (e.target === e.currentTarget) closeAdd(); });
// Esc로 닫을 때(cancel)도 바로 지움. close 이벤트에서도 한 번 더 지움(어느 길로 닫혀도 남지 않게)
addDialog().addEventListener('cancel', clearAdd);
addDialog().addEventListener('close', clearAdd);
document.getElementById('add-preview').addEventListener('click', addPreview);
// 운영자가 종류를 직접 고르면 그 뒤 [미리 점검]의 추천이 덮어쓰지 않게 (28단계)
document.getElementById('add-category').addEventListener('change', (e) => { e.target.dataset.suggested = 'no'; });
addForm().addEventListener('submit', addSubmit);
