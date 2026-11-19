// 서비스 상세 화면 스크립트 (S3) — /service.html?key=keychats
//
// 서비스 하나에 묶인 점검(HTTP·DNS·DB 상태)을 한 화면에서 봅니다. 위에서 아래로:
//   ① 머리: 이름·설명·사이트 주소·상태·최근 점검·점검 주기·점검 항목
//   ② 지표 4칸: 서비스 가동률(30일·24시간), 첫 화면 평균 응답(24시간), 장애(30일) — 어떤 서비스든 같은 4칸
//   ③ 점검 카드: 점검마다 가용성·평균 응답·최근 값, 24시간 응답 시간 선, 15분 칸 성공/실패, 30일 일별 막대
//   ④ 최근 이벤트: 이 서비스 점검들의 장애·복구 (누르면 사후 보고서)
//
// 데이터 (새 서버 API 없음):
//   /api/services/:key            서비스·묶인 점검·최근 장애
//   /api/monitors/:id/history     점검마다 최근 24시간 기록 (점검 수만큼 요청, 60초 캐시)
//   /api/status                   카드를 누르면 여는 점검 상세 팝업(detail.js)용
// 계산은 dashboard-model.js(DashboardModel)의 순수 함수, 그래프는 chart.js, 공용 표시는 detail.js에 있습니다.

const REFRESH_MS = 60_000; // 60초마다 새로 고침 (API 캐시 시간과 같게)
const HOURS = 24; // 그래프 기간 (기록 API는 최대 48시간)
const CELL_MIN = 15; // 성공/실패 칸 1개 = 15분 → 24시간 96칸
const INCIDENT_LIMIT = 10; // /api/services/:key가 주는 장애 수 (src/api.js SERVICE_INCIDENT_LIMIT)

// 점검 이름 끝 괄호(칩 이름)로 고르는 부제목 — 무엇을 확인하는 점검인지
const CHECK_SUB = { HTTP: '웹 접근', DNS: '도메인 이름 해석', DB: '데이터베이스 상태 확인 주소' };

const key = new URLSearchParams(location.search).get('key') ?? '';

/** 주소를 화면용으로 짧게: https://keychats.vercel.app/ → keychats.vercel.app */
function shortUrl(u) {
  try {
    const x = new URL(u);
    return (x.host + x.pathname).replace(/\/$/, '');
  } catch {
    return u;
  }
}

/** 지표 한 칸 (이름·값·작은 설명) */
function stat(label, value, tone, sub) {
  const box = el('div', 'sd-stat');
  box.append(el('div', 'sd-k', label), el('div', `sd-v${tone ? ` sd-v--${tone}` : ''}`, value));
  if (sub) box.append(el('div', 'sd-sub', sub));
  return box;
}

// 가동률 → 글자 색 (99.9% 이상 초록, 99% 이상 노랑, 그 아래 빨강) — 30일 막대 색과 같은 기준
const uptimeTone = (v) => (v === null || v === undefined ? '' : v >= 99.9 ? 'good' : v >= 99 ? 'warn' : 'bad');

// ── ① 머리 ──
function renderHead(s) {
  document.title = `${s.name} · Uptime Monitor`;
  document.getElementById('crumb-name').textContent = s.name;

  const head = el('section', 'sd-head');
  const ico = el('span', 'sd-head__ico');
  ico.append(icon(SERVICE_ICON[s.key] ?? 'globe'));

  const who = el('div', 'sd-head__who');
  who.append(el('h1', '', s.name));
  if (s.description) who.append(el('div', 'sd-k', s.description));
  if (s.homeUrl) {
    // 공개 사이트 첫 화면 주소만 (점검 주소는 API가 주지 않음). 새 탭에서 열고, 이 페이지 정보를 넘기지 않음
    const a = el('a', 'sd-head__link', shortUrl(s.homeUrl));
    a.href = s.homeUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.append(icon('arrowUpRight', 'ico ico--xs'));
    who.append(a);
  }

  const last = el('div', 'sd-sep');
  const lastV = el('b', '', s.lastCheckedAt ? `${agoText(s.lastCheckedAt, Date.now()).replace(' 점검', '')} (${kstHm.format(new Date(s.lastCheckedAt))})` : '아직 기록 없음');
  if (s.lastCheckedAt) {
    lastV.dataset.agoHead = s.lastCheckedAt; // 1초마다 상대 시간 갱신
    lastV.title = formatKst(s.lastCheckedAt);
  }
  last.append(el('div', 'sd-k', '최근 점검'), lastV);

  const cycle = el('div', 'sd-sep');
  cycle.append(el('div', 'sd-k', '점검 주기'), el('b', '', '5분'));

  const items = el('div', 'sd-sep');
  const chips = el('div', 'chips');
  for (const c of s.checks) chips.append(el('span', 'chip chip--static', DashboardModel.chipLabel(c)));
  items.append(el('div', 'sd-k', '점검 항목'), chips);

  head.append(ico, who, serviceStatePill(s.state), last, cycle, items);
  return head;
}

// ── ② 지표 4칸 ──
function renderStrip(s, histories, incidents, today) {
  const up24 = DashboardModel.serviceUptimeFromHistories(histories.map((h) => h?.points ?? []));
  // 첫 화면 점검 = 칩 이름이 'HTTP'인 점검 (DB 상태 확인 주소는 원래 느려서 섞지 않음)
  const frontIdx = s.checks.findIndex((c) => DashboardModel.chipLabel(c) === 'HTTP');
  const frontAvg = frontIdx >= 0 && histories[frontIdx] ? DashboardModel.avgResponse(histories[frontIdx].points) : null;
  const inc = DashboardModel.incidentsByDay(incidents, DashboardModel.lastDays(today, 30), INCIDENT_LIMIT);

  const strip = el('section', 'sd-strip');
  strip.append(
    stat('서비스 가동률 (30일)', uptimeText(s.uptime30d), uptimeTone(s.uptime30d), '묶인 점검이 모두 성공한 5분 회차 비율'),
    stat('서비스 가동률 (24시간)', uptimeText(up24.percent), uptimeTone(up24.percent), up24.totalSlots ? `${up24.totalSlots}회차 중 ${up24.upSlots}회차 정상` : '기록 없음'),
    stat('첫 화면 평균 응답 (24시간)', frontAvg === null ? '-' : `${frontAvg} ms`, '', '성공한 HTTP 점검만'),
    stat('장애 (30일)', `${inc.capped ? `${inc.count}+` : inc.count}건`, inc.count ? 'bad' : 'good', inc.capped ? `최근 ${INCIDENT_LIMIT}건이 모두 30일 안이라 더 있을 수 있음` : '2회 연속 실패로 판정된 장애'),
  );
  return strip;
}

// ── ③ 점검 카드 ──
function thirdValue(c, h) {
  const label = DashboardModel.chipLabel(c);
  const lastPt = h?.points.at(-1);
  if (c.kind === 'dns') return ['받은 레코드', lastPt?.value === null || lastPt?.value === undefined ? '-' : `${lastPt.value}개`];
  if (label === 'HTTP') return ['최근 응답', c.lastResponseMs === null ? '-' : `${c.lastResponseMs} ms`];
  return ['최근 결과', !lastPt ? '-' : lastPt.isSuccess ? 'OK' : '실패'];
}

function checkCard(c, h) {
  const label = DashboardModel.chipLabel(c);
  const card = el('section', 'sd-card');

  // 머리: 종류 아이콘 · 이름(부제목) · 상태 · 자세히(팝업)
  const hd = el('div', 'sd-card__hd');
  const kind = kindMeta(c.kind);
  const ico = el('span', 'sd-card__ico');
  ico.append(icon(label === 'DB' ? 'database' : kind.icon));
  const title = el('div', 'sd-card__title');
  title.append(el('b', '', label), el('small', '', `(${CHECK_SUB[label] ?? kind.text})`));
  const more = el('button', 'sd-card__more', '자세히');
  more.type = 'button';
  more.dataset.detailId = String(c.id); // 팝업을 닫으면 이 버튼으로 포커스가 돌아옴 (detail.js)
  more.addEventListener('click', () => select(c.id));
  hd.append(ico, title, serviceStatePill(DashboardModel.chipState(c) === 'slow' ? 'degraded' : c.state), more);

  // 지표 3칸
  const avg = h ? DashboardModel.avgResponse(h.points) : null;
  const [k3, v3] = thirdValue(c, h);
  const m3 = el('div', 'sd-m3');
  for (const [k, v, tone] of [['가용성 (30일)', uptimeText(c.uptime30d), uptimeTone(c.uptime30d)], ['평균 응답 (24시간)', avg === null ? '-' : `${avg} ms`, ''], [k3, v3, v3 === '실패' ? 'bad' : '']]) {
    const box = el('div');
    box.append(el('div', 'sd-k', k), el('div', `sd-v${tone ? ` sd-v--${tone}` : ''}`, v));
    m3.append(box);
  }
  card.append(hd, m3);

  if (!h) {
    card.append(el('p', 'sd-empty', '최근 24시간 기록을 불러오지 못했습니다. 잠시 후 자동으로 다시 시도합니다.'));
    return card;
  }

  // 응답 시간 선 (24시간). 실패 회차는 선을 끊고 아래쪽 빨간 표시, 느림은 노란 점 (chart.js lineChart)
  const th = h.monitor.maxResponseMs;
  card.append(el('div', 'sd-subt', `응답 시간 (최근 ${HOURS}시간, 실패 회차는 선을 끊음) · 느림 기준 ${th} ms`));
  if (h.points.length) {
    const points = h.points.map((p) => toPoint(p, null));
    card.append(lineChart({
      points, xMin: Date.parse(h.from), xMax: Date.parse(h.to), gapMs: 12 * 60_000, unit: 'ms',
      threshold: { v: th, label: `느림 기준 ${th}ms` }, label: `${c.name} 최근 ${HOURS}시간 응답 시간`, box: { w: 560, h: 150, l: 44 },
    }));
  } else {
    card.append(el('p', 'sd-empty', '최근 24시간 기록이 없습니다.'));
  }

  // 성공/실패 칸 (15분 × 96)
  const cells = DashboardModel.timeCells(h.points, h.from, h.to, CELL_MIN);
  const fails = h.points.filter((p) => !p.isSuccess && !p.inMaintenance).length;
  card.append(el('div', 'sd-subt', `성공/실패 이력 (최근 ${HOURS}시간 · 칸 1개 = ${CELL_MIN}분, 실패 ${fails}회)`));
  const slots = el('div', 'sd-slots');
  slots.setAttribute('role', 'img');
  slots.setAttribute('aria-label', `최근 ${HOURS}시간 성공/실패, 실패 ${fails}회`);
  const stateText = { fail: '실패 포함', slow: '느림 포함', ok: '정상', maint: '계획 작업', none: '기록 없음' };
  for (const cell of cells) {
    const i = el('i', `sd-slot sd-slot--${cell.state}`);
    i.title = `${formatKst(cell.start)}부터 ${CELL_MIN}분 · ${stateText[cell.state]}${cell.count ? ` (${cell.count}회${cell.fails ? `, 실패 ${cell.fails}` : ''})` : ''}`;
    slots.append(i);
  }
  card.append(slots);

  // 30일 일별 가용성 막대 (7일·30일 원본 그래프 대신 — 기록 API가 최대 48시간이라)
  card.append(el('div', 'sd-subt', `일별 가용성 (최근 ${c.daily.length}일)`));
  const bars = el('div', 'bars bars--sd');
  bars.setAttribute('role', 'img');
  bars.setAttribute('aria-label', `최근 ${c.daily.length}일 가동률 ${uptimeText(c.uptime30d)}`);
  for (const d of c.daily) {
    const bar = el('span', `bar ${barClass(d.uptime)}`);
    bar.title = d.uptime === null ? `${d.day} · 기록 없음` : `${d.day} · ${d.uptime}% (${d.total}회 점검)`;
    bars.append(bar);
  }
  card.append(bars);
  return card;
}

// ── ④ 최근 이벤트 ──
function renderEvents(incidents) {
  const box = el('section', 'sd-events');
  box.append(el('h2', '', '최근 이벤트'));
  const table = el('table', 'sd-table');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['발생 시각 (KST)', '구분', '내용', '결과']) hr.append(el('th', '', h));
  thead.append(hr);
  const tbody = el('tbody');
  if (incidents.length === 0) {
    const tr = el('tr');
    const td = el('td', 'sd-empty', '최근 장애·복구 기록이 없습니다.');
    td.colSpan = 4;
    tr.append(td);
    tbody.append(tr);
  }
  for (const i of incidents) {
    const tr = el('tr');
    const kind = el('td');
    kind.append(el('span', 'sd-dot sd-dot--bad'), document.createTextNode(' 장애'));
    const what = el('td');
    const a = el('a', '', `${i.monitorName}: ${i.causeText ?? '원인 미상'} (${formatMinutes(i.durationMinutes)})`);
    a.href = `/incident.html?id=${encodeURIComponent(i.id)}`; // 사후 보고서
    what.append(a);
    const result = el('td', i.ongoing ? 'sd-v--bad' : '', i.ongoing ? '진행 중' : `복구됨 (${formatKst(i.resolvedAt)})${i.hasReport ? ' · 보고서 있음' : ''}`);
    tr.append(el('td', '', formatKst(i.startedAt)), kind, what, result);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  box.append(table);
  return box;
}

async function load() {
  const status = document.getElementById('load-status');
  const root = document.getElementById('sd-root');
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(key)) {
    root.replaceChildren(el('p', 'sd-empty', '서비스를 찾을 수 없습니다. 대시보드에서 서비스를 골라 주세요.'));
    status.textContent = '';
    return;
  }
  try {
    const res = await fetch(`/api/services/${key}`, { cache: 'no-store' });
    if (res.status === 404) {
      root.replaceChildren(el('p', 'sd-empty', '없거나 점검을 내린 서비스입니다. 대시보드에서 서비스를 골라 주세요.'));
      status.textContent = '';
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const detail = await res.json();
    const s = detail.service;
    // 점검마다 24시간 기록 (하나가 실패해도 나머지는 그림 → allSettled)
    const [histories, statusData] = await Promise.all([
      Promise.allSettled(s.checks.map((c) => fetchJson(`/api/monitors/${c.id}/history?hours=${HOURS}`, { cache: 'no-store' })))
        .then((rs) => rs.map((r) => (r.status === 'fulfilled' ? r.value : null))),
      fetchJson('/api/status', { cache: 'no-store' }).catch(() => null),
    ]);

    const grid = el('div', 'sd-grid');
    grid.append(...s.checks.map((c, i) => checkCard(c, histories[i])));
    root.replaceChildren(renderHead(s), renderStrip(s, histories, detail.incidents, detail.today), grid, renderEvents(detail.incidents));
    if (statusData) refreshDetail(statusData); // 카드의 '자세히' 팝업(detail.js)용
    status.textContent = histories.some((h) => !h) ? '일부 점검의 기록을 불러오지 못했습니다.' : '';
    status.classList.toggle('is-error', histories.some((h) => !h));
  } catch (err) {
    console.error(err);
    status.textContent = '서비스 정보를 불러오지 못했습니다. 잠시 후 자동으로 다시 시도합니다.';
    status.classList.add('is-error');
  }
}

// 1초마다 '최근 점검'의 상대 시간 글자만 갱신
setInterval(() => {
  const node = document.querySelector('[data-ago-head]');
  if (node) node.textContent = `${agoText(node.dataset.agoHead, Date.now()).replace(' 점검', '')} (${kstHm.format(new Date(node.dataset.agoHead))})`;
}, 1000);

load();
setInterval(load, REFRESH_MS);
