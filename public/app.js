// 상태 페이지 스크립트 — /api/status를 받아 화면을 그린다.
// 공용 도우미(formatKst, el, icon, statePill, kindMeta, sourceBadge, formatMinutes, fetchJson)는 common.js에 있습니다.
//
// 화면 상태(검색어·필터·선택한 서비스)는 이 파일의 변수에 두고,
// 60초마다 데이터를 새로 받아도 사용자가 고른 것은 그대로 유지합니다.

const REFRESH_MS = 60_000; // 60초마다 새로 고침 (API 캐시 시간과 같게)

const FILTERS = [
  ['all', '전체'],
  ['up', '정상'],
  ['down', '장애'],
  ['maintenance', '작업 중'],
  ['paused', '점검 대기'],
];

// 종류별 설명 (상세 패널) — 무엇을 어떻게 점검하는지
const KIND_DESC = {
  http: 'Worker가 5분마다 HTTP 요청을 보내 상태 코드·응답 시간·본문 키워드를 확인합니다.',
  dns: 'Worker가 5분마다 DNS-over-HTTPS로 이름이 풀리는지, 기대한 값으로 풀리는지 확인합니다.',
  domain: '도메인 만료일까지 남은 날을 확인합니다. 30일 전부터 만료 임박으로 판정합니다.',
  ping: '사내 PC의 에이전트가 ping 응답과 응답 시간을 측정해 보고합니다.',
  tcp: '사내 PC의 에이전트가 TCP 포트에 연결되는지 측정해 보고합니다.',
  ssl: '사내 PC의 에이전트가 인증서 만료까지 남은 날을 측정합니다. 14일 미만이면 실패입니다.',
  disk: '사내 PC의 에이전트가 디스크 사용률을 측정합니다. 기준(90%) 이상이면 실패입니다.',
  service: '사내 PC의 에이전트가 Windows 서비스가 실행 중인지 확인합니다.',
};

const SOURCE_TEXT = { real: '실제 점검', sample: '데모 데이터 (시드)', simulator: '시뮬레이터 (가짜 측정값)' };

const view = {
  data: null,
  filter: 'all',
  query: '',
  selectedId: null,
  open: {}, // 접기 상자(<details>)를 펼쳐 두었는지 — 자동 갱신 후에도 유지
  prevStates: null, // 직전에 불러온 서비스별 상태 (상태가 바뀐 카드를 찾기 위해)
  changed: new Set(), // 이번에 상태가 바뀐 서비스 id
  lastLoadedAt: 0, // 마지막으로 불러오기에 성공한 시각(ms)
  nextReloadAt: 0, // 다음 점검 회차 직후 다시 불러올 시각(ms)
  history: new Map(), // 서비스 id → { at, data } 상세 팝업 그래프용 기록 (60초 동안 재사용)
};

// ─────────────────────────────────────────────
// LIVE 표시: 다음 점검까지 카운트다운, 상대 시간
// ─────────────────────────────────────────────
const SLOT_MS = 5 * 60 * 1000;   // 점검 간격 5분 (서버 Cron과 같음)
const CRON_DELAY_MS = 15 * 1000; // Cron은 정각보다 몇 초 늦게 돎 (실측 12초) → 15초로 잡음
const FETCH_AFTER_MS = 25 * 1000; // 점검이 끝나 저장될 여유를 두고 다시 불러옴

/** 다음 점검 예정 시각(ms): 다음 5분 회차 + 15초 */
function nextRunAt(nowMs) {
  return Math.floor((nowMs - CRON_DELAY_MS) / SLOT_MS) * SLOT_MS + SLOT_MS + CRON_DELAY_MS;
}

/** 경과 시간 → "방금" / "3분 전" / "2시간 전" */
function agoText(iso, nowMs) {
  const sec = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (sec < 60) return '방금 점검';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전 점검`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}시간 전 점검`;
  return `${Math.floor(h / 24)}일 전 점검`;
}

/** 1초마다: 카운트다운·상대 시간 글자 갱신, 점검 회차 직후 자동으로 다시 불러오기 */
function tickClock() {
  const now = Date.now();
  const next = nextRunAt(now);
  const left = Math.max(0, Math.round((next - now) / 1000));
  const live = document.getElementById('live');
  // 3분 넘게 새 데이터를 못 받았으면 LIVE를 노란색 '연결 지연'으로
  const stale = view.lastLoadedAt && now - view.lastLoadedAt > 3 * 60 * 1000;
  live.classList.toggle('is-stale', Boolean(stale));
  document.getElementById('live-next').textContent = stale
    ? '연결 지연 · 다시 시도 중'
    : `다음 점검까지 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  for (const node of document.querySelectorAll('[data-ago]')) node.textContent = agoText(node.dataset.ago, now);

  if (view.nextReloadAt && now >= view.nextReloadAt) {
    view.nextReloadAt = 0;
    load();
  }
}

// ─────────────────────────────────────────────
// 작은 계산
// ─────────────────────────────────────────────

// 종류별 "마지막 측정값" — 카드의 두 번째 칸과 상세 패널에 사용
function lastValue(s) {
  if (s.state === 'paused' || !s.lastCheckedAt) return { label: '마지막 측정', value: '-' };
  switch (s.kind) {
    case 'disk': return { label: '디스크 사용률', value: s.lastValue === null ? '-' : `${s.lastValue}%` };
    case 'ssl': return { label: '인증서 남은 날', value: s.lastValue === null ? '-' : `${s.lastValue}일` };
    case 'domain': return { label: '만료까지', value: s.lastValue === null ? '-' : `${s.lastValue}일` };
    case 'service': return { label: '서비스', value: s.state === 'down' ? '중지' : '실행 중' };
    case 'dns': return { label: 'DNS 응답', value: s.lastResponseMs === null ? '-' : `${s.lastResponseMs}ms · ${s.lastValue ?? 0}개` };
    default: return { label: '응답 시간', value: s.lastResponseMs === null ? '-' : `${s.lastResponseMs}ms` };
  }
}

// 가동률 → 막대 색 등급
function barClass(uptime) {
  if (uptime === null) return 'bar--empty';
  if (uptime >= 99.9) return 'bar--good';
  if (uptime >= 99) return 'bar--warn';
  return 'bar--bad';
}

const uptimeText = (v) => (v === null || v === undefined ? '-' : `${v}%`);

// ─────────────────────────────────────────────
// 상태 영역 + 요약 카드
// ─────────────────────────────────────────────

function renderHero(data) {
  const bar = document.getElementById('hero');
  const down = data.services.filter((s) => s.state === 'down');
  const working = data.services.filter((s) => s.state === 'maintenance');

  let tone = 'good', ico = 'check', title = '모든 서비스 정상';
  if (down.length) {
    tone = 'bad'; ico = 'x';
    title = `${down.length}개 서비스 장애: ${down.map((s) => s.name).join(', ')}`;
  } else if (working.length) {
    tone = 'info'; ico = 'wrench';
    title = `계획 작업 진행 중: ${working.map((s) => s.name).join(', ')}`;
  }
  bar.className = `statusbar${tone === 'good' ? '' : ` statusbar--${tone}`}`;
  document.getElementById('hero-title').textContent = title;
  document.getElementById('hero-icon').replaceChildren(icon(ico, 'ico ico--sm'));
  document.getElementById('hero-updated').textContent = `마지막 갱신 ${formatKst(data.generatedAt)} · 화면은 자동으로 새로 불러옵니다`;
}

// 요약 카드 — 여러 서비스를 합친 '평균 가동률'은 만들지 않습니다.
// 실제·데모·시뮬레이터 데이터를 합친 숫자는 의미가 없기 때문이에요(출처 규칙). 대신 개수만 셉니다.
function renderStats(data) {
  const watched = data.services.filter((s) => s.state !== 'paused');
  const up = watched.filter((s) => s.state === 'up').length;
  const ongoing = data.incidents.filter((i) => i.ongoing).length;
  const activeMaint = data.maintenance.filter((w) => w.active).length;
  const bySource = (src) => data.services.filter((s) => s.source === src).length;

  const cards = [
    ['activity', '정상 운영', `${up}/${watched.length}`, '점검 대기를 뺀 서비스 중 정상'],
    ['alert', '진행 중 장애', String(ongoing), `최근 장애 ${data.incidents.length}건 중`],
    ['wrench', '계획 작업', `${activeMaint}건 진행`, `예정 포함 ${data.maintenance.length}건`],
    ['layers', '점검 대상', `${data.services.length}개`, `실제 ${bySource('real')} · 시뮬 ${bySource('simulator')} · 데모 ${bySource('sample')}`],
  ];
  document.getElementById('stats').replaceChildren(
    ...cards.map(([ico, label, value, helper]) => {
      const card = el('div', 'stat');
      const top = el('div', 'stat__top', label);
      top.append(icon(ico, 'ico ico--sm'));
      card.append(top, el('div', 'stat__value', value), el('div', 'stat__helper', helper));
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
// 검색·필터·서비스 카드
// ─────────────────────────────────────────────

function renderFilters(data) {
  const counts = { all: data.services.length };
  for (const s of data.services) counts[s.state] = (counts[s.state] ?? 0) + 1;
  document.getElementById('filters').replaceChildren(
    ...FILTERS.map(([key, label]) => {
      const b = el('button', `filter${view.filter === key ? ' is-active' : ''}`, label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(view.filter === key));
      b.append(el('span', 'filter__count', String(counts[key] ?? 0)));
      b.addEventListener('click', () => {
        view.filter = key;
        renderFilters(view.data);
        renderServices(view.data);
      });
      return b;
    })
  );
}

function visibleServices(data) {
  const q = view.query.trim().toLowerCase();
  return data.services.filter(
    (s) => (view.filter === 'all' || s.state === view.filter) && (!q || s.name.toLowerCase().includes(q))
  );
}

function renderServices(data) {
  const root = document.getElementById('services');
  const list = visibleServices(data);
  if (list.length === 0) {
    root.replaceChildren(el('div', 'services__empty', '조건에 맞는 서비스가 없습니다.'));
    return;
  }
  root.replaceChildren(
    ...list.map((s) => {
      const card = el('button', `card${s.id === view.selectedId ? ' is-selected' : ''}`);
      card.type = 'button';
      card.setAttribute('aria-pressed', String(s.id === view.selectedId));
      card.dataset.id = String(s.id);
      card.addEventListener('click', () => select(s.id));

      // 위: 종류 아이콘 + 이름 + 상태·출처
      const top = el('div', 'card__top');
      const kind = kindMeta(s.kind);
      const kindIco = el('span', 'kind-ico');
      kindIco.append(icon(kind.icon));
      const title = el('div');
      title.style.minWidth = '0';
      const tags = el('div', 'card__tags');
      tags.append(statePill(s.state));
      const badge = sourceBadge(s.source);
      if (badge) tags.append(badge);
      tags.append(el('span', 'card__kind', kind.text));
      title.append(el('h3', 'card__name', s.name), tags);
      top.append(kindIco, title);

      // 가운데: 30일 가동률 / 마지막 측정값
      const lv = lastValue(s);
      const minis = el('div', 'minis');
      for (const [label, value] of [['30일 가동률', uptimeText(s.uptime30d)], [lv.label, lv.value]]) {
        const m = el('div', 'mini');
        m.append(el('div', 'mini__label', label), el('div', 'mini__value', value));
        minis.append(m);
      }

      // 아래: 30일 막대 (마우스를 올리면 날짜와 가동률, 화면 낭독기용 설명은 aria-label)
      const head = el('div', 'bars-head');
      head.append(el('span', '', `${s.daily.length - 1}일 전`), el('span', '', '오늘'));
      const bars = el('div', 'bars');
      bars.setAttribute('role', 'img');
      bars.setAttribute('aria-label', `최근 ${s.daily.length}일 가동률 ${s.uptime30d === null ? '기록 없음' : s.uptime30d + '%'}`);
      for (const d of s.daily) {
        const bar = el('span', `bar ${barClass(d.uptime)}`);
        bar.title = d.uptime === null ? `${d.day} · 기록 없음` : `${d.day} · ${d.uptime}% (${d.total}회 점검)`;
        bars.append(bar);
      }

      // 마지막 점검 상대 시간 ("2분 전 점검") — tickClock()이 1초마다 글자만 고칩니다
      const ago = el('div', 'card__ago');
      ago.append(icon('clock', 'ico ico--xs'));
      const agoLabel = el('span', '', s.lastCheckedAt ? agoText(s.lastCheckedAt, Date.now()) : '아직 점검 기록 없음');
      if (s.lastCheckedAt) agoLabel.dataset.ago = s.lastCheckedAt;
      ago.append(agoLabel);

      // 새로 불러온 데이터에서 상태가 바뀐 카드는 잠깐 노랗게 강조
      if (view.changed.has(s.id)) card.classList.add('is-changed');

      card.append(top, minis, head, bars, ago);
      return card;
    })
  );
}

// ─────────────────────────────────────────────
// 상세 패널
// ─────────────────────────────────────────────

// 상세 팝업(<dialog>) 열기·닫기
const dialog = () => document.getElementById('detail-dialog');

function select(id) {
  view.selectedId = id;
  renderServices(view.data); // 선택한 카드 테두리 표시
  renderDetail(view.data);
  const d = dialog();
  if (!d.open) d.showModal(); // showModal: 뒤 화면을 막고 가운데 띄움 (Esc로 닫힘)
  d.querySelector('.modal__box').scrollTop = 0;
  loadHistory(id);
}

// ─────────────────────────────────────────────
// 상세 팝업 그래프 (최근 24시간 기록은 팝업을 열 때만 불러옴 — /api/status를 가볍게 유지)
// ─────────────────────────────────────────────
const HISTORY_HOURS = 24;
const RESPONSE_KINDS = ['http', 'dns', 'ping', 'tcp']; // 응답 시간이 있는 종류
// 측정값 종류: 단위, y축 최댓값, 기준선 기본값 (서버 판정의 기본값과 같음)
const VALUE_KINDS = {
  disk: { unit: '%', yMax: 100, threshold: 90, label: (v) => `기준 ${v}%`, name: '디스크 사용률' },
  ssl: { unit: '일', threshold: 14, label: (v) => `기준 ${v}일`, name: '인증서 남은 날' },
  domain: { unit: '일', threshold: 30, label: (v) => `기준 ${v}일`, name: '도메인 만료까지' },
};

async function loadHistory(id, force = false) {
  const cached = view.history.get(id);
  if (!force && cached && !cached.error && Date.now() - cached.at < 60_000) {
    renderCharts();
    return;
  }
  try {
    const data = await fetchJson(`/api/monitors/${id}/history?hours=${HISTORY_HOURS}`, { cache: 'no-store' });
    view.history.set(id, { at: Date.now(), data });
  } catch (err) {
    console.error(err);
    view.history.set(id, { at: Date.now(), error: true });
  }
  if (view.selectedId === id) renderCharts(); // 그사이 다른 카드를 열었으면 그리지 않음
}

// 회차 1개를 그래프 점으로 (마우스를 올리면 보일 설명 포함)
function toPoint(p, kind) {
  const t = Date.parse(p.checkedAt);
  const time = formatKst(p.checkedAt);
  const k = VALUE_KINDS[kind];
  const unit = k?.unit ?? 'ms';
  // 응답 시간 종류는 실패하면 값이 없음(null) → 선을 끊고 빨간 막대, 측정값 종류는 실패해도 값이 있음
  const v = k ? p.value : p.isSuccess ? p.responseMs : null;
  const valueText = v === null || v === undefined ? '' : ` · ${v}${unit}`;
  let tip;
  if (p.inMaintenance) tip = `${time} · 계획 작업 중${valueText}`;
  else if (!p.isSuccess) tip = `${time} · 실패: ${p.failureText ?? p.failureReason}${valueText}`;
  else tip = `${time} · ${p.isSlow ? '느림' : '정상'}${valueText}`;
  return { t, v, fail: !p.isSuccess && !p.inMaintenance, slow: p.isSlow, maint: p.inMaintenance, tip };
}

function chartSection(title, sub, node) {
  const box = el('section', 'chart-box');
  const head = el('div', 'chart-box__head');
  head.append(el('h4', 'chart-box__title', title), el('span', 'chart-box__sub', sub));
  box.append(head, node);
  return box;
}

function renderCharts() {
  const root = document.getElementById('detail-charts');
  const s = view.data?.services.find((x) => x.id === view.selectedId);
  if (!root || !s) return;
  const cached = view.history.get(s.id);
  const nodes = [];
  const k = VALUE_KINDS[s.kind];
  const title24 = s.kind === 'service' ? '최근 24시간 실행 여부' : k ? `최근 24시간 ${k.name}` : '최근 24시간 응답 시간';

  // ① 최근 24시간 (응답 시간 / 측정값 / 실행 여부)
  if (!cached) {
    nodes.push(chartSection(title24, '불러오는 중…', el('div', 'chart-empty', '기록을 불러오는 중입니다…')));
  } else if (cached.error) {
    nodes.push(chartSection(title24, '', el('div', 'chart-empty', '기록을 불러오지 못했습니다. 잠시 후 다시 시도합니다.')));
  } else {
    const h = cached.data;
    const points = h.points.map((p) => toPoint(p, s.kind));
    const range = { xMin: Date.parse(h.from), xMax: Date.parse(h.to) };
    const gapMs = 12 * 60_000; // 5분 간격이므로 12분 넘게 비면 기록이 빠진 것 → 선을 끊음
    let node;
    if (points.length === 0) {
      node = el('div', 'chart-empty', s.state === 'paused' ? '아직 점검을 켜지 않아 기록이 없습니다.' : '최근 24시간 기록이 없습니다.');
    } else if (s.kind === 'service') {
      node = statusStrip({ points, ...range, label: title24 });
    } else if (k) {
      const th = h.monitor.threshold ?? k.threshold;
      node = lineChart({ points, ...range, gapMs, unit: k.unit, yMax: k.yMax, threshold: { v: th, label: k.label(th) }, label: title24 });
    } else {
      const th = h.monitor.maxResponseMs;
      node = lineChart({ points, ...range, gapMs, unit: 'ms', threshold: { v: th, label: `느림 기준 ${th}ms` }, label: title24 });
    }
    nodes.push(chartSection(title24, `기록 ${points.length}개 · 5분 간격`, node));
  }

  // ② 최근 30일 가동률 (카드의 막대를 크게, 마우스를 올리면 평균 응답까지)
  const bars = el('div', 'bars bars--lg');
  bars.setAttribute('role', 'img');
  bars.setAttribute('aria-label', `최근 30일 가동률 ${uptimeText(s.uptime30d)}`);
  for (const d of s.daily) {
    const bar = el('span', `bar ${barClass(d.uptime)}`);
    bar.title = d.uptime === null
      ? `${d.day} · 기록 없음`
      : `${d.day} · 가동률 ${d.uptime}% · ${d.total}회 점검${d.avgResponseMs !== null ? ` · 평균 ${d.avgResponseMs}ms` : ''}`;
    bars.append(bar);
  }
  const barsBox = el('div');
  const barsHead = el('div', 'bars-head');
  barsHead.style.marginTop = '6px';
  barsHead.append(el('span', '', `${s.daily.length - 1}일 전`), el('span', '', '오늘'));
  barsBox.append(bars, barsHead);
  nodes.push(chartSection('최근 30일 가동률', `30일 ${uptimeText(s.uptime30d)}`, barsBox));

  // ③ 최근 30일 일평균 응답 시간 (응답 시간이 있는 종류만) — "요즘 느려지고 있나?"
  if (RESPONSE_KINDS.includes(s.kind)) {
    const daily = s.daily.map((d) => ({
      t: Date.parse(`${d.day}T03:00:00Z`), // 한국 시간 정오 위치에 점을 찍음
      v: d.avgResponseMs,
      tip: `${d.day} · ${d.avgResponseMs === null ? '기록 없음' : `평균 ${d.avgResponseMs}ms`}`,
    }));
    const withValue = daily.filter((d) => d.v !== null).length;
    const node = withValue === 0
      ? el('div', 'chart-empty', '일별 평균 응답 시간 기록이 없습니다.')
      : lineChart({ points: daily, xMin: daily[0].t, xMax: daily[daily.length - 1].t, gapMs: 36 * 3600_000, unit: 'ms', xFormat: 'date', label: '최근 30일 일평균 응답 시간' });
    nodes.push(chartSection('최근 30일 일평균 응답 시간', `기록 있는 날 ${withValue}일`, node));
  }

  root.replaceChildren(...nodes);
}

function closeDetail() {
  const d = dialog();
  if (d.open) d.close();
}

// 닫힐 때(✕·바깥 클릭·Esc 모두) 선택 표시를 지우고, 눌렀던 카드로 키보드 포커스를 돌려줌
function onDetailClosed() {
  const id = view.selectedId;
  view.selectedId = null;
  if (view.data) renderServices(view.data);
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (card) card.focus({ preventScroll: true });
}

function renderDetail(data) {
  const root = document.getElementById('detail');
  const s = data.services.find((x) => x.id === view.selectedId);
  if (!s) {
    root.replaceChildren();
    return;
  }
  const kind = kindMeta(s.kind);

  // 이름·상태·설명
  const card = el('div', 'detail__card');
  const head = el('div', 'detail__head');
  const kindIco = el('span', 'kind-ico');
  kindIco.append(icon(kind.icon));
  const nameBox = el('div');
  nameBox.style.minWidth = '0';
  const tags = el('div', 'card__tags');
  tags.append(statePill(s.state));
  const badge = sourceBadge(s.source);
  if (badge) tags.append(badge);
  nameBox.append(el('h3', 'detail__name', s.name), tags);
  head.append(kindIco, nameBox);
  card.append(head, el('p', 'detail__desc', KIND_DESC[s.kind] ?? '점검 정보'));

  // 사실 4칸
  const lv = lastValue(s);
  const facts = el('dl', 'facts');
  for (const [k, v] of [
    ['점검 종류', kind.text],
    ['데이터 출처', SOURCE_TEXT[s.source] ?? s.source],
    ['마지막 점검', s.lastCheckedAt ? formatKst(s.lastCheckedAt) : '-'],
    ['30일 가동률', uptimeText(s.uptime30d)],
    [lv.label, lv.value],
    ['기록이 있는 날', `${s.daily.filter((d) => d.total > 0).length}/${s.daily.length}일`],
  ]) {
    const f = el('div', 'fact');
    f.append(el('dt', '', k), el('dd', '', v));
    facts.append(f);
  }

  // 넓은 화면에서는 왼쪽(이름·사실 칸)과 오른쪽(안내·최근 장애)으로 나눠 보여 줍니다 (.detail-grid)
  const left = [card, facts];
  const nodes = []; // 오른쪽 칸

  // 안내 상자: 점검 대기 / 데모 / 시뮬레이터
  const notice = {
    paused: ['점검 대기', '실제 대상으로 등록만 되어 있고 아직 점검을 켜지 않았습니다. 켜면 5분마다 실제 기록이 쌓입니다.'],
    sample: ['데모 데이터', '시드 스크립트로 넣은 가짜 기록입니다. 실제로 점검하지 않으며, 보고서에서도 실제 데이터와 합산하지 않습니다.'],
    simulator: ['시뮬레이터', '에이전트 시뮬레이터가 시나리오 파일의 가짜 측정값을 보낸 기록입니다. 판정·장애·알림은 실제와 같은 경로를 거칩니다.'],
  }[s.state === 'paused' ? 'paused' : s.source];
  if (notice) {
    const box = el('div', 'note-box');
    const t = el('div', 'note-box__title', notice[0]);
    t.prepend(icon('shield', 'ico ico--sm'));
    box.append(t, el('div', '', notice[1]));
    nodes.push(box);
  }

  // 이 서비스의 최근 장애
  const mine = data.incidents.filter((i) => i.monitorName === s.name).slice(0, 3);
  const sub = el('div', 'subhead', '이 서비스의 최근 장애');
  sub.prepend(icon('alert', 'ico ico--sm'));
  nodes.push(sub);
  if (mine.length === 0) {
    nodes.push(el('p', 'detail__empty', '최근 장애가 없습니다.'));
  } else {
    const ul = el('ul', 'mini-list');
    for (const i of mine) {
      const li = el('li');
      const a = el('a');
      a.href = `/incident.html?id=${encodeURIComponent(i.id)}`;
      const topRow = el('div', 'mini-list__top');
      const pill = statePill(i.ongoing ? 'down' : 'up');
      pill.lastChild.textContent = i.ongoing ? '진행 중' : '복구됨'; // 장애 이력에서는 '정상' 대신 '복구됨'
      topRow.append(el('span', '', i.causeText ?? '원인 미상'), pill);
      a.append(topRow, el('div', 'mini-list__time', `${formatKst(i.startedAt)} · ${formatMinutes(i.durationMinutes)}`));
      li.append(a);
      ul.append(li);
    }
    nodes.push(ul);
  }

  const btn = el('a', 'btn btn--block', '월간 가용성 보고서 보기');
  btn.href = '/report.html';
  btn.append(icon('arrowRight', 'ico ico--sm'));
  nodes.push(btn);

  const grid = el('div', 'detail-grid');
  const leftCol = el('div');
  const rightCol = el('div');
  leftCol.append(...left);
  rightCol.append(...nodes);
  grid.append(leftCol, rightCol);
  const charts = el('div', 'detail-charts');
  charts.id = 'detail-charts';
  root.replaceChildren(grid, charts);
  renderCharts();
}

// ─────────────────────────────────────────────
// 장애 이력·최근 알림
// ─────────────────────────────────────────────

const SHOW_FIRST = 5; // 알림·장애 이력은 최근 5건만 먼저 보여 줌

/**
 * 목록을 "앞 5건 + 나머지는 접기(<details>)"로 그린다.
 * <details>는 HTML 기본 기능이라 자바스크립트 없이 열고 닫히고, 키보드·화면 낭독기에서도 동작합니다.
 * 60초마다 다시 그려도 사용자가 펼쳐 둔 상태는 유지합니다(view.open).
 */
function renderCollapsible(rootId, items, makeItem, { listClass, emptyText, moreLabel }) {
  const root = document.getElementById(rootId);
  if (items.length === 0) {
    root.replaceChildren(el('p', 'notes__empty', emptyText));
    return;
  }
  const first = el('ol', listClass);
  first.append(...items.slice(0, SHOW_FIRST).map(makeItem));
  const nodes = [first];

  const rest = items.slice(SHOW_FIRST);
  if (rest.length > 0) {
    const details = el('details', 'more');
    details.open = Boolean(view.open[rootId]);
    details.addEventListener('toggle', () => { view.open[rootId] = details.open; });
    details.append(el('summary', '', `${moreLabel} ${rest.length}건 더 보기`));
    const more = el('ol', listClass);
    more.append(...rest.map(makeItem));
    details.append(more);
    nodes.push(details);
  }
  root.replaceChildren(...nodes);
}

function incidentItem(i) {
  const li = el('li', 'incident');
  const a = el('a');
  a.href = `/incident.html?id=${encodeURIComponent(i.id)}`;

  const top = el('div', 'incident__top');
  const left = el('div');
  left.style.minWidth = '0';
  const tags = el('div', 'incident__tags');
  const pill = el('span', `pill ${i.ongoing ? 'pill--bad' : 'pill--good'}`);
  pill.append(icon(i.ongoing ? 'x' : 'check', 'ico ico--xs'), document.createTextNode(i.ongoing ? '진행 중' : '복구됨'));
  tags.append(pill);
  const badge = sourceBadge(i.source);
  if (badge) tags.append(badge);
  left.append(tags, el('h3', 'incident__title', i.causeText ?? '원인 미상'), el('div', 'incident__service', i.monitorName));

  const time = el('div', 'incident__time');
  time.append(
    el('div', '', `시작 ${formatKst(i.startedAt)}`),
    el('div', '', i.ongoing ? `${formatMinutes(i.durationMinutes)} 경과` : `복구 ${formatKst(i.resolvedAt)} · ${formatMinutes(i.durationMinutes)}`)
  );
  top.append(left, time);

  const summary = el('p', `incident__summary${i.hasReport ? '' : ' is-empty'}`, i.hasReport ? i.summary : '사후 보고서 작성 전');
  a.append(top, summary);
  li.append(a);
  return li;
}

function notificationItem(n) {
  const li = el('li', `note note--${n.event}`);
  const msg = el('div', 'note__msg', n.message);
  const badge = sourceBadge(n.source);
  if (badge) msg.append(' ', badge);
  li.append(el('span', 'note__icon'), msg, el('div', 'note__time', formatKst(n.createdAt)));
  return li;
}

function renderIncidents(list) {
  renderCollapsible('incidents', list, incidentItem, {
    listClass: 'incidents', emptyText: '기록된 장애가 없습니다.', moreLabel: '이전 장애',
  });
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
    const data = await fetchJson('/api/status', { cache: 'no-store' });
    view.data = data;
    view.lastLoadedAt = Date.now();
    // 다음 점검 회차가 끝난 직후(+25초)에 다시 불러오도록 예약 → 새 점검 결과가 바로 보임
    view.nextReloadAt = nextRunAt(Date.now()) + FETCH_AFTER_MS;

    // 직전 데이터와 비교해서 상태가 바뀐 서비스 찾기 (처음 불러올 때는 비교 대상이 없으므로 강조 안 함)
    const now = new Map(data.services.map((x) => [x.id, x.state]));
    view.changed = new Set(
      view.prevStates ? [...now].filter(([id, st]) => view.prevStates.has(id) && view.prevStates.get(id) !== st).map(([id]) => id) : []
    );
    view.prevStates = now;
    // 팝업으로 보고 있던 서비스가 사라졌으면 팝업을 닫음
    if (view.selectedId !== null && !data.services.some((s) => s.id === view.selectedId)) closeDetail();
    renderHero(data);
    renderStats(data);
    renderMaintenance(data.maintenance ?? []);
    renderFilters(data);
    renderServices(data);
    if (dialog().open) {
      renderDetail(data); // 팝업이 열려 있으면 내용만 최신으로 (닫지 않음)
      loadHistory(view.selectedId, true); // 그래프 기록도 새로
    }
    renderIncidents(data.incidents ?? []);
    renderNotifications(data.notifications);
    document.getElementById('updated').textContent = `데이터 생성 시각: ${formatKst(data.generatedAt)}`;
  } catch (err) {
    // 불러오기에 실패해도 이전 화면은 그대로 두고 안내만 바꿉니다
    console.error(err);
    document.getElementById('hero').className = 'statusbar statusbar--error';
    document.getElementById('hero-title').textContent = '상태를 불러오지 못했습니다';
    document.getElementById('hero-icon').replaceChildren(icon('alert', 'ico ico--sm'));
    document.getElementById('hero-updated').textContent = '잠시 후 자동으로 다시 시도합니다.';
  }
}

document.getElementById('search').addEventListener('input', (e) => {
  view.query = e.target.value;
  if (view.data) renderServices(view.data);
});

// 팝업 닫기: ✕ 버튼, 바깥(어두운 배경) 클릭, Esc(브라우저 기본)
document.getElementById('detail-close').addEventListener('click', closeDetail);
dialog().addEventListener('click', (e) => {
  // 배경을 누르면 클릭 대상이 <dialog> 자신이 됨 (안쪽 상자를 누르면 그 안의 요소가 대상)
  if (e.target === e.currentTarget) closeDetail();
});
dialog().addEventListener('close', onDetailClosed);

load();
setInterval(load, REFRESH_MS); // 점검 회차와 별개로 60초마다도 새로 불러옴 (계획 작업·알림 변화 반영)
setInterval(tickClock, 1000);
tickClock();
