// 대시보드 스크립트 (S2) — 두 API를 받아 화면을 그린다.
//   /api/services : 서비스 묶음(서비스 상태·회차 기준 가동률·묶인 점검) → 요약 카드, 서비스 줄, 운영 지표
//   /api/status   : 최근 알림·장애 이력·계획 작업, 점검별 상세 팝업 → 아래쪽 목록과 팝업
// 공용 도우미(formatKst, el, icon, statePill, kindMeta, sourceBadge, formatMinutes, fetchJson)는 common.js에,
// 대시보드 숫자 계산은 dashboard-model.js(DashboardModel)에, 그래프는 chart.js에,
// 점검 상세 팝업과 점검 공용 도우미(agoText·lastValue·uptimeText 등)는 detail.js에 있습니다.
//
// 화면 상태(검색어·선택한 점검)는 이 파일의 변수에 두고,
// 60초마다 데이터를 새로 받아도 사용자가 고른 것은 그대로 유지합니다.

const REFRESH_MS = 60_000; // 60초마다 새로 고침 (API 캐시 시간과 같게)
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
  // 3분 넘게 새 데이터를 못 받았으면 '연결 지연'으로 (제목 줄 끝 점검 주기 표시: 점이 노란색으로)
  const stale = view.lastLoadedAt && now - view.lastLoadedAt > 3 * 60 * 1000;
  const nextRun = document.getElementById('next-run');
  if (nextRun) nextRun.textContent = stale ? '연결 지연' : DashboardModel.mmss(left);
  document.getElementById('cycle')?.classList.toggle('is-stale', Boolean(stale));

  for (const node of document.querySelectorAll('[data-ago]')) {
    const text = agoText(node.dataset.ago, now);
    node.textContent = (node.dataset.agoPrefix ?? '') + (node.dataset.agoShort ? text.replace(' 점검', '') : text);
  }

  if (view.nextReloadAt && now >= view.nextReloadAt) {
    view.nextReloadAt = 0;
    load();
  }
}

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

      const ico = el('span', 'svc__ico');
      ico.append(icon(SERVICE_ICON[s.key] ?? 'globe'));

      const name = el('div');
      name.style.minWidth = '0';
      const title = el('h3', 'svc__name');
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
// 운영 지표 요약 (시안: 2×2 — HTTP 평균 응답 | 최근 장애 수 / DNS 평균 응답(넓게) / 서비스 상태 추이(넓게))
// 모두 이미 받은 두 응답으로 계산합니다 — 이 칸 때문에 API를 더 부르지 않습니다.
// ─────────────────────────────────────────────

/**
 * 지표 칸 하나. 칸 전체가 버튼이라 누르면(키보드 Enter·Space 포함) 같은 그래프를 크게 보여 주는 팝업이 열립니다.
 * spec.draw(box)는 주어진 크기로 그래프를 새로 그리는 함수 — 작은 칸과 팝업이 같은 함수를 크기만 바꿔 씁니다.
 */
function metricBox(spec) {
  const box = el('button', `mbox${spec.wide ? ' mbox--wide' : ''}`);
  box.type = 'button';
  box.setAttribute('aria-label', `${spec.title} 크게 보기`);
  box.append(metricHead(spec, false));
  if (spec.draw) box.append(spec.draw(spec.small));
  if (spec.legend?.length) box.append(metricLegend(spec));
  box.addEventListener('click', () => openMetric(spec));
  return box;
}

/** 제목·숫자·설명 (작은 칸과 팝업이 함께 씀) */
function metricHead(spec, large) {
  const head = el('div', large ? 'mzoom__head' : '');
  head.append(el('div', 'mbox__t', spec.title));
  if (spec.value !== null && spec.value !== undefined) {
    const n = el('div', 'mbox__n', String(spec.value));
    n.append(el('small', '', spec.unit));
    head.append(n);
  }
  if (spec.sub) head.append(el('div', 'mbox__sub', spec.sub));
  return head;
}

function metricLegend(spec) {
  const lg = el('div', 'mlegend');
  spec.legend.forEach((name, k) => {
    const item = el('span');
    item.append(el('i', spec.classes?.[k] ?? `chart__series--${(k % 4) + 1}`), document.createTextNode(name));
    lg.append(item);
  });
  return lg;
}

// ── 지표 확대 팝업 ──
const metricDialog = () => document.getElementById('metric-dialog');
let metricOpener = null; // 팝업을 닫으면 포커스를 돌려줄 칸

function openMetric(spec) {
  metricOpener = document.activeElement;
  document.getElementById('metric-title').textContent = spec.title;
  const body = el('div', 'mzoom');
  body.append(metricHead(spec, true));
  if (spec.draw) body.append(spec.draw(spec.large));
  if (spec.legend?.length) body.append(metricLegend(spec));
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
  const specs = [];

  // ① HTTP 평균 응답: 첫 화면 점검만 (DB 상태 확인 주소는 원래 약 1초라 섞으면 평균이 의미를 잃음)
  const http = DashboardModel.responseSeries(svc.services, 'http', 'HTTP');
  const httpCls = ['chart__c--blue', 'chart__c--violet', 'chart__c--teal', 'chart__c--amber'];
  const httpSeries = DashboardModel.sliceSeries(http.series, start);
  specs.push({
    title: 'HTTP 평균 응답', value: http.mean ?? '-', unit: 'ms',
    sub: http.series.map((x) => `${x.service} ${x.latest ?? '-'}ms`).join(' · ') + ' · 첫 화면, 가장 최근 일평균',
    draw: httpSeries.length ? (box) => multiLineChart({ series: httpSeries, classes: httpCls, unit: box.w > 400 ? 'ms' : '', label: '첫 화면 점검별 일평균 응답 시간', box }) : null,
    small: { w: 360, h: 90, l: 34 }, large: big(320),
    legend: http.series.map((x) => `${x.service} 첫 화면`), classes: httpCls,
    note: '성공한 점검의 하루 평균 응답 시간입니다. DB 상태 확인 주소(원래 약 1초)는 성격이 달라 이 평균에서 뺐고, 점검 칩을 누르면 따로 볼 수 있습니다. 점에 마우스를 올리면 날짜와 값이 보입니다.',
  });

  // ② 최근 장애 수 (장애 이력에서 시작일 기준). 숫자는 30일 전체, 막대는 그래프 구간만
  const inc = DashboardModel.incidentsByDay(status.incidents ?? [], allDays, INCIDENT_LIMIT);
  const incValues = inc.perDay.slice(start);
  specs.push({
    title: '최근 장애 수', value: inc.capped ? `${inc.count}+` : inc.count, unit: '건',
    sub: inc.capped ? `장애 이력 최근 ${INCIDENT_LIMIT}건이 모두 30일 안이라 더 있을 수 있음` : '30일 · 2회 연속 실패로 판정된 장애',
    draw: (box) => dayBarChart({ days, values: incValues, label: '날짜별 장애 수', box }),
    small: { w: 360, h: 90, l: 24 }, large: big(260),
    note: '장애가 시작된 날(한국 시간) 기준으로 셉니다. 막대에 마우스를 올리면 날짜와 건수가 보이고, 장애 하나하나는 왼쪽 메뉴의 장애 이력에서 볼 수 있습니다.',
  });

  // ③ DNS 평균 응답 (넓게)
  const dns = DashboardModel.responseSeries(svc.services, 'dns');
  const dnsCls = ['chart__c--teal', 'chart__c--amber', 'chart__c--blue', 'chart__c--violet'];
  const dnsSeries = DashboardModel.sliceSeries(dns.series, start);
  specs.push({
    title: 'DNS 평균 응답', value: dns.mean ?? '-', unit: 'ms',
    sub: `${dns.series.length}개 서비스 DNS 점검의 가장 최근 일평균 · 기록이 없는 날은 선을 끊음`,
    draw: dnsSeries.length ? (box) => multiLineChart({ series: dnsSeries, classes: dnsCls, unit: box.w > 800 ? 'ms' : '', label: 'DNS 점검별 일평균 응답 시간', box }) : null,
    small: { w: 720, h: 90, l: 34 }, large: big(300),
    legend: dns.series.map((x) => `${x.service} DNS`), classes: dnsCls, wide: true,
    note: 'DNS-over-HTTPS로 이름을 푸는 데 걸린 시간의 하루 평균입니다(성공한 점검만).',
  });

  // ④ 서비스 상태 추이: 서버가 회차 기준으로 계산한 서비스별 일 가동률. 95% 아래는 바닥에 붙여 위쪽 차이를 보이게
  const up = DashboardModel.sliceSeries(DashboardModel.uptimeSeries(svc.services), start);
  const upCls = ['chart__c--green', 'chart__c--amber', 'chart__c--blue', 'chart__c--violet'];
  specs.push({
    title: '서비스 상태 추이 (일 가동률)', value: null,
    sub: `${first ? `기록 시작 ${first} — 그 전은 빈칸. ` : ''}세로축 95~100% (95% 아래는 바닥에 붙임)`,
    draw: up.length ? (box) => multiLineChart({ series: up, classes: upCls, unit: '%', yMin: 95, yMax: 100, label: '서비스별 일 가동률', box }) : null,
    small: { w: 720, h: 130, l: 40 }, large: big(340),
    legend: up.map((x) => x.name), classes: upCls, wide: true,
    note: '서비스 가동률은 묶인 점검(HTTP·DNS·DB)이 모두 성공한 5분 회차의 비율입니다. 같은 5분에 여러 점검이 함께 실패해도 장애 한 번으로 셉니다.',
  });

  document.getElementById('metrics').replaceChildren(...specs.map(metricBox));
  // 팝업이 열려 있으면 같은 지표를 새 데이터로 다시 그림 (60초 자동 갱신)
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
// 불러오기
// ─────────────────────────────────────────────

async function load() {
  try {
    // cache: 'no-store' — 브라우저가 60초 캐시를 쓰지 않고 항상 최신을 받아 오게 (실시간 표시를 위해)
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
    status.classList.add('is-error');
  }
}

document.getElementById('search').addEventListener('input', (e) => {
  view.query = e.target.value;
  if (view.svc) renderServiceRows(view.svc);
});

load();
setInterval(load, REFRESH_MS); // 점검 회차와 별개로 60초마다도 새로 불러옴 (계획 작업·알림 변화 반영)
setInterval(tickClock, 1000);
tickClock();

// ─────────────────────────────────────────────
// 서비스 추가 (S4) — 주소 → [미리 점검] → [추가]
// 관리자 API(POST /api/admin/services/preview, /api/admin/services)를 부릅니다. 판단(주소 검사·동의·중복·상한)은 서버가 하고,
// 여기서는 결과를 사람이 읽을 문장으로 보여 주기만 합니다. 관리자 토큰은 입력칸에만 있고 어디에도 저장하지 않습니다.
// ─────────────────────────────────────────────

// 서버 오류 코드 → 화면 문구 (src/service-admin.js·src/admin.js의 코드와 같게)
const ADD_ERROR_TEXT = {
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
  for (const k of ['name', 'description', 'healthUrl', 'healthKeyword']) if (v(k)) body[k] = v(k);
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
    const allOk = data.checks.every((c) => c.isSuccess);
    let text = allOk ? '모두 정상입니다. [추가]를 누르면 다음 5분 회차부터 점검합니다.' : '실패한 점검이 있습니다. 주소를 확인해 주세요. 그대로 추가하면 장애로 기록될 수 있습니다.';
    if (data.alreadyExists) text = ADD_ERROR_TEXT.already_exists;
    else if (data.activeCount >= data.limit) text = ADD_ERROR_TEXT.limit_reached;
    addShow(allOk && !data.alreadyExists && data.activeCount < data.limit ? 'ok' : 'warn', `${text} (서비스 키: ${data.proposed.key})`, data.checks);
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
addForm().addEventListener('submit', addSubmit);
