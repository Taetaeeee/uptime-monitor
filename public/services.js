// 서비스 페이지 스크립트 — 점검 하나하나를 카드로 보여 준다.
// 대시보드는 "서비스 단위(고쳐라!·Keychats)"로 묶어 보고, 이 페이지는 묶인 점검(HTTP·DNS·DB 상태)을
// 하나씩 카드로 펼쳐 봅니다. 카드 모양은 S2 이전 상태 페이지의 카드를 그대로 가져왔습니다.
//   /api/status   : 점검별 상태·30일 가동률·막대 (카드와 상세 팝업)
//   /api/services : 카드 순서를 서비스별(고쳐라! → Keychats)로 맞추는 데만 사용
// 공용 도우미(el, icon, statePill, kindMeta, sourceBadge, formatKst, fetchJson)는 common.js,
// 점검 상세 팝업과 lastValue·barClass·uptimeText·agoText는 detail.js에 있습니다.

const REFRESH_MS = 60_000; // 60초마다 새로 고침 (API 캐시 시간과 같게)

const page = {
  lastStates: null, // 직전에 불러온 점검별 상태 (상태가 바뀐 카드를 잠깐 강조하려고)
  changed: new Set(),
};

/**
 * 카드 순서: 서비스 정렬 순서대로 그 서비스의 점검들, 그다음 어느 서비스에도 묶이지 않은 점검.
 * 같은 서비스 안에서는 /api/services가 준 순서(id 순).
 */
function orderChecks(status, svc) {
  const order = new Map();
  let i = 0;
  for (const s of svc.services) for (const c of s.checks) order.set(c.id, i++);
  return [...status.services].sort((a, b) => (order.get(a.id) ?? 1e9 + a.id) - (order.get(b.id) ?? 1e9 + b.id));
}

function checkCard(s) {
  const card = el('button', 'card');
  card.type = 'button';
  card.dataset.detailId = String(s.id); // 팝업을 닫으면 이 카드로 포커스가 돌아옴 (detail.js)
  card.addEventListener('click', () => select(s.id));
  if (page.changed.has(s.id)) card.classList.add('is-changed'); // 새로 불러온 데이터에서 상태가 바뀐 카드 강조

  // 위: 종류 아이콘 + 이름 + 상태·출처·종류
  const top = el('div', 'card__top');
  const kind = kindMeta(s.kind);
  const kindIco = el('span', 'kind-ico');
  kindIco.append(icon(kind.icon));
  const title = el('div');
  title.style.minWidth = '0';
  const tags = el('div', 'card__tags');
  tags.append(statePill(s.state));
  // 점검 하나하나를 보는 화면이라 출처 배지(실제 점검)를 그대로 보여 줍니다
  const badge = sourceBadge(s.source, s.state);
  if (badge) tags.append(badge);
  tags.append(el('span', 'card__kind', kind.text));
  title.append(el('h2', 'card__name', s.name), tags); // 31단계: h1 바로 아래라 h2 (모양은 .card__name이 정함)
  top.append(kindIco, title);

  // 가운데: 30일 가동률 / 마지막 측정값
  const lv = lastValue(s);
  const minis = el('div', 'minis');
  for (const [label, value] of [['30일 가동률', uptimeText(s.uptime30d)], [lv.label, lv.value]]) {
    const m = el('div', 'mini');
    m.append(el('div', 'mini__label', label), el('div', 'mini__value', value));
    minis.append(m);
  }

  // 아래: 30일 막대 (마우스를 올리면 날짜와 가동률)
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

  // 마지막 점검 상대 시간 ("2분 전 점검") — 1초마다 글자만 고칩니다
  const ago = el('div', 'card__ago');
  ago.append(icon('clock', 'ico ico--xs'));
  const agoPrefix = AGO_PREFIX[s.source] ?? ''; // 시뮬레이터는 실제 점검이 아니므로 시간 표시 앞에 그 사실을 붙임
  // 점검 대기(paused) 대상은 지금 점검하지 않으므로 "N분 전 점검"처럼 쓰지 않습니다.
  const isPaused = s.state === 'paused';
  const agoLabel = el('span', '', isPaused ? `현재 점검하지 않음${s.lastCheckedAt ? ` · 마지막 점검 ${formatKst(s.lastCheckedAt)}` : ''}`
    : s.lastCheckedAt ? agoPrefix + agoText(s.lastCheckedAt, Date.now()) : '아직 점검 기록 없음');
  if (s.lastCheckedAt && !isPaused) {
    agoLabel.dataset.ago = s.lastCheckedAt;
    if (agoPrefix) agoLabel.dataset.agoPrefix = agoPrefix;
  }
  ago.append(agoLabel);

  card.append(top, minis, head, bars, ago);
  return card;
}

async function load() {
  const status = document.getElementById('load-status');
  try {
    const [data, svc] = await Promise.all([
      fetchJson('/api/status', { cache: 'no-store' }),
      fetchJson('/api/services', { cache: 'no-store' }),
    ]);
    const now = new Map(data.services.map((s) => [s.id, s.state]));
    page.changed = new Set(page.lastStates ? [...now].filter(([id, st]) => page.lastStates.has(id) && page.lastStates.get(id) !== st).map(([id]) => id) : []);
    page.lastStates = now;

    const list = orderChecks(data, svc);
    const root = document.getElementById('services');
    root.replaceChildren(...(list.length ? list.map(checkCard) : [el('div', 'services__empty', '등록된 점검이 없습니다.')]));
    document.getElementById('check-count').textContent = `${list.length}개`;
    refreshDetail(data); // 상세 팝업(detail.js)에도 새 데이터 전달
    status.textContent = '';
    status.classList.remove('is-error');
  } catch (err) {
    console.error(err);
    status.textContent = '점검 상태를 불러오지 못했습니다. 잠시 후 자동으로 다시 시도합니다.';
    status.classList.add('is-error');
  }
}

// 1초마다 "N분 전 점검" 글자만 갱신
setInterval(() => {
  const now = Date.now();
  for (const node of document.querySelectorAll('[data-ago]')) node.textContent = (node.dataset.agoPrefix ?? '') + agoText(node.dataset.ago, now);
}, 1000);

load();
setInterval(load, REFRESH_MS);
