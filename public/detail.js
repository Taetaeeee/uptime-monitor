// 점검 상세 팝업 + 점검 공용 도우미 — 대시보드(app.js)와 서비스 페이지(services.js)가 함께 씁니다.
//   - 점검 하나(monitor)의 상세 팝업: 핵심 지표, 최근 24시간 그래프, 30일 막대, 최근 장애
//   - 공용 도우미: 종류별 설명, 마지막 측정값, 막대 색, 상대 시간("2분 전 점검")
// 같은 코드를 두 페이지에 복사하지 않으려고 app.js에서 떼어 냈습니다.
// 쓰는 쪽은 /api/status 응답을 받을 때마다 refreshDetail(data)를 부르고, 점검을 누르면 select(id)를 부릅니다.
// 먼저 불러와야 하는 것: common.js(el·icon·formatKst …), chart.js(lineChart·statusStrip)

const SLOT_MS = 5 * 60 * 1000; // 점검 간격 5분 (서버 Cron과 같음)

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

// 2026-11-19부터 배포본에는 실제 점검 대상만 둡니다(데모·재생 데이터 삭제). 그래서 출처 필터는 없앴습니다.
// 다만 에이전트 시뮬레이터는 로컬 시험용으로 남아 있으므로, 실제가 아닌 기록이 들어오면 여전히 구분해 보여 줍니다.
const SOURCE_TEXT = {
  real: '실제 점검 (Worker 또는 에이전트 실제 모드)',
  simulator: '시뮬레이터 (가짜 측정값, 로컬 시험용)',
};

// "N분 전 점검" 앞에 붙이는 말: 실제 점검이 아닌 기록은 시간 표시 옆에서도 그 사실을 알립니다
const AGO_PREFIX = { simulator: '시뮬레이터(수동 전송) · ' };

/** 경과 시간 → "방금" / "3분 전" / "2시간 전" */
function agoText(iso, nowMs) {
  if (!Number.isFinite(Date.parse(iso))) return '점검 시각 확인 불가';
  const sec = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (sec < 60) return '방금 점검';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전 점검`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}시간 전 점검`;
  return `${Math.floor(h / 24)}일 전 점검`;
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

/** 측정값 종류(disk·ssl·domain)의 그래프·표시 설정. 그 밖의 종류는 null(응답 시간 그래프). */
function valueSpec(s) {
  return VALUE_KINDS[s.kind] ?? null;
}

// 상세 팝업의 화면 상태 (페이지 스크립트의 view와 따로 둠)
const detailView = {
  data: null, // /api/status 응답 (점검 목록·최근 장애)
  selectedId: null, // 지금 팝업으로 보고 있는 점검 id
  history: new Map(), // 점검 id → { at, data } 그래프용 기록 (60초 동안 재사용)
};

// ─────────────────────────────────────────────
// 상세 패널
// ─────────────────────────────────────────────

// 상세 팝업(<dialog>) 열기·닫기
const dialog = () => document.getElementById('detail-dialog');

function select(id) {
  detailView.selectedId = id;
  renderDetail(detailView.data);
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
  const cached = detailView.history.get(id);
  if (!force && cached && !cached.error && Date.now() - cached.at < 60_000) {
    renderCharts();
    return;
  }
  try {
    const data = await fetchJson(`/api/monitors/${id}/history?hours=${HISTORY_HOURS}`, { cache: 'no-store' });
    detailView.history.set(id, { at: Date.now(), data });
  } catch (err) {
    console.error(err);
    detailView.history.set(id, { at: Date.now(), error: true });
  }
  if (detailView.selectedId === id) renderCharts(); // 그사이 다른 카드를 열었으면 그리지 않음
}

// 회차 1개를 그래프 점으로 (마우스를 올리면 보일 설명 포함)
function toPoint(p, kind) {
  const t = Date.parse(p.checkedAt);
  const time = formatKst(p.checkedAt);
  const k = kind; // 측정값 종류의 설정(valueSpec) 또는 null(응답 시간 종류)
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

function chartSection(title, sub, node, extraClass = '') {
  const box = el('section', `chart-box ${extraClass}`.trim());
  const head = el('div', 'chart-box__head');
  head.append(el('h4', 'chart-box__title', title), el('span', 'chart-box__sub', sub));
  box.append(head, node);
  return box;
}

// 24시간 가동률: 팝업이 불러온 그 서비스의 기록만으로 계산 (계획 작업 중 점검은 제외 — 서버 집계와 같은 규칙)
function uptimeOf(points) {
  const counted = points.filter((p) => !p.inMaintenance);
  if (counted.length === 0) return null;
  return Math.floor((counted.filter((p) => p.isSuccess).length * 10000) / counted.length) / 100; // 내림 (보수적으로)
}

/**
 * 팝업 안에서 기록(24시간)에 따라 바뀌는 부분: ② 핵심 지표 4칸, ③ 그래프
 * 기록을 불러오기 전에는 '…'으로 자리만 잡아 두고, 불러오면 다시 그립니다.
 */
function renderDetailLive() {
  const s = detailView.data?.services.find((x) => x.id === detailView.selectedId);
  const kpiRoot = document.getElementById('detail-kpis');
  const chartRoot = document.getElementById('detail-charts');
  if (!s || !kpiRoot || !chartRoot) return;
  const cached = detailView.history.get(s.id);
  const h = cached && !cached.error ? cached.data : null;
  const k = valueSpec(s);
  const tone = { up: 'good', down: 'bad', maintenance: 'info' }[s.state] ?? 'muted';
  const agoPrefix = AGO_PREFIX[s.source] ?? '';

  // ── ② 핵심 지표 4칸 ──
  const lv = lastValue(s);
  let secondSub = '';
  if (k) secondSub = `기준 ${h?.monitor.threshold ?? k.threshold}${k.unit}`;
  else if (RESPONSE_KINDS.includes(s.kind)) secondSub = h ? `느림 기준 ${h.monitor.maxResponseMs}ms` : '';
  else if (s.kind === 'service') secondSub = 'Windows 서비스 실행 여부';
  const up24 = h ? uptimeOf(h.points) : undefined;
  const days = s.daily.filter((d) => d.total > 0).length;

  const kpis = [
    { label: '현재 상태', value: (STATE_META[s.state] ?? STATE_META.unknown).text, tone, sub: s.state === 'paused' ? '현재 점검하지 않음' : s.lastCheckedAt ? null : '아직 점검 기록 없음', ago: s.state === 'paused' ? null : s.lastCheckedAt, agoPrefix },
    { label: lv.label, value: lv.value, sub: secondSub },
    { label: '24시간 가동률', value: up24 === undefined ? '…' : uptimeText(up24), sub: h ? `기록 ${h.points.length}회` : '불러오는 중' },
    { label: '30일 가동률', value: uptimeText(s.uptime30d), sub: `기록 ${days}/${s.daily.length}일` },
  ];
  kpiRoot.replaceChildren(
    ...kpis.map((x) => {
      const box = el('div', 'kpi');
      const value = el('div', `kpi__value${x.tone ? ` kpi__value--${x.tone}` : ''}`, x.value);
      const sub = el('div', 'kpi__sub', x.sub ?? '');
      if (x.ago) {
        sub.dataset.ago = x.ago; // tickClock()이 1초마다 "N분 전 점검"으로 갱신
        if (x.agoPrefix) sub.dataset.agoPrefix = x.agoPrefix;
        sub.textContent = (x.agoPrefix ?? '') + agoText(x.ago, Date.now());
      }
      box.append(el('div', 'kpi__label', x.label), value, sub);
      return box;
    })
  );

  // ── ③ 추세 그래프 ──
  const nodes = [];
  const titleMain = s.kind === 'service' ? '최근 실행 여부' : k ? `최근 ${k.name}` : '최근 응답 시간';
  if (!cached) {
    nodes.push(chartSection(titleMain, '불러오는 중…', el('div', 'chart-empty', '기록을 불러오는 중입니다…'), 'chart-box--main'));
  } else if (cached.error) {
    nodes.push(chartSection(titleMain, '', el('div', 'chart-empty', '기록을 불러오지 못했습니다. 잠시 후 다시 시도합니다.'), 'chart-box--main'));
  } else {
    const points = h.points.map((p) => toPoint(p, k));
    const fromMs = Date.parse(h.from);
    const toMs = Date.parse(h.to);
    // x축을 실제 기록이 있는 구간에 맞춤 (최소 1시간, 최대 24시간)
    //   기록이 40분뿐인데 24시간 축으로 그리면 선이 오른쪽 끝에 손톱만큼만 보이기 때문
    const firstT = points.length ? points[0].t : toMs;
    const xMin = Math.max(fromMs, Math.min(toMs - 3600_000, firstT - SLOT_MS));
    const range = { xMin, xMax: toMs };
    const spanH = Math.round((toMs - xMin) / 3600_000);
    const gapMs = 12 * 60_000; // 5분 간격이므로 12분 넘게 비면 기록이 빠진 것 → 선을 끊음
    let node;
    if (points.length === 0) {
      node = el('div', 'chart-empty', s.state === 'paused' ? '아직 점검을 켜지 않아 기록이 없습니다.' : '최근 24시간 기록이 없습니다.');
    } else if (s.kind === 'service') {
      node = statusStrip({ points, ...range, label: titleMain });
    } else if (k) {
      // 측정값 종류의 기준선: 서버 판정 기준(없으면 기본값)
      const th = h.monitor.threshold ?? k.threshold;
      node = lineChart({ points, ...range, gapMs, unit: k.unit, yMax: k.yMax, threshold: th === undefined ? undefined : { v: th, label: k.label(th) }, label: titleMain });
    } else {
      const th = h.monitor.maxResponseMs;
      node = lineChart({ points, ...range, gapMs, unit: 'ms', threshold: { v: th, label: `느림 기준 ${th}ms` }, label: titleMain });
    }
    const sub = points.length ? `최근 ${spanH}시간 · 기록 ${points.length}개 · 5분 간격` : '최근 24시간 기록 없음';
    nodes.push(chartSection(titleMain, sub, node, 'chart-box--main'));
  }

  // 30일 가동률 (큰 막대, 마우스를 올리면 평균 응답까지)
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
  const pair = el('div', 'chart-pair');
  pair.append(chartSection('30일 가동률', uptimeText(s.uptime30d), barsBox));

  // 30일 일평균 응답 시간 (응답 시간이 있는 종류만) — "요즘 느려지고 있나?"
  if (RESPONSE_KINDS.includes(s.kind)) {
    const daily = s.daily.map((d) => ({
      t: Date.parse(`${d.day}T03:00:00Z`), // 한국 시간 정오 위치에 점을 찍음
      v: d.avgResponseMs,
      tip: `${d.day} · ${d.avgResponseMs === null ? '기록 없음' : `평균 ${d.avgResponseMs}ms`}`,
    }));
    const withValue = daily.filter((d) => d.v !== null).length;
    const node = withValue === 0
      ? el('div', 'chart-empty', '일별 평균 응답 기록이 없습니다.')
      : lineChart({ points: daily, xMin: daily[0].t, xMax: daily[daily.length - 1].t, gapMs: 36 * 3600_000, unit: 'ms', xFormat: 'date', label: '최근 30일 일평균 응답 시간', box: { w: 360, h: 150, l: 44 } });
    pair.append(chartSection('30일 일평균 응답', `기록 있는 날 ${withValue}일`, node));
  } else {
    pair.classList.add('chart-pair--single');
  }
  nodes.push(pair);
  chartRoot.replaceChildren(...nodes);
}

// 이전 이름 유지 (loadHistory 등에서 호출)
const renderCharts = renderDetailLive;

function closeDetail() {
  const d = dialog();
  if (d?.open) d.close();
}

// 닫힐 때(✕·바깥 클릭·Esc 모두) 선택을 지우고, 눌렀던 점검 칩으로 키보드 포커스를 돌려줌
function onDetailClosed() {
  const id = detailView.selectedId;
  document.getElementById('detail-title').textContent = '점검 상세';
  detailView.selectedId = null;
  // 눌렀던 것(대시보드의 점검 칩 또는 서비스 페이지의 카드)으로 키보드 포커스를 돌려줌
  const opener = document.querySelector(`[data-detail-id="${id}"]`);
  if (opener) opener.focus({ preventScroll: true });
}

/**
 * 상세 팝업 내용 — 보는 사람의 질문 순서대로 위에서 아래로:
 *   ① 머리(팝업 제목 자리): 이름·상태·출처      → "어떤 서비스?"
 *   ② 핵심 지표 4칸(큰 숫자)                     → "지금 괜찮나?"
 *   ③ 추세 그래프(가장 크게)                     → "최근 어땠나?"
 *   ④ 최근 장애                                  → "문제가 있었나?"
 *   ⑤ 바닥 정보(작은 글씨): 종류·출처·안내·보고서 → "그 밖의 정보"
 */
function renderDetail(data) {
  const root = document.getElementById('detail');
  const s = data.services.find((x) => x.id === detailView.selectedId);
  if (!s) {
    root.replaceChildren();
    return;
  }
  const kind = kindMeta(s.kind);

  // ① 머리: 팝업 제목 자리에 서비스 이름과 상태·출처
  document.getElementById('detail-title').textContent = s.name;
  document.getElementById('detail-kind').replaceChildren(icon(kind.icon));
  const tags = document.getElementById('detail-tags');
  tags.replaceChildren(statePill(s.state));
  const badge = sourceBadge(s.source, s.state);
  if (badge) tags.append(badge);
  tags.append(el('span', 'card__kind', kind.text));

  const desc = el('p', 'detail__desc', KIND_DESC[s.kind] ?? '점검 정보');

  // ② 핵심 지표, ③ 그래프 자리 (내용은 renderDetailLive가 기록을 받아 채움)
  const kpis = el('div', 'kpis');
  kpis.id = 'detail-kpis';
  const charts = el('div', 'detail-charts');
  charts.id = 'detail-charts';

  // ④ 최근 장애 (상태 페이지가 받은 최근 장애 목록 중 이 서비스 것)
  const incBox = el('section', 'detail-section');
  const incHead = el('h4', 'subhead', '최근 장애');
  incHead.prepend(icon('alert', 'ico ico--sm'));
  incBox.append(incHead);
  const mine = data.incidents.filter((i) => i.monitorName === s.name).slice(0, 3);
  if (mine.length === 0) {
    incBox.append(el('p', 'detail__empty', '최근 장애 이력에 이 서비스의 장애가 없습니다.'));
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
      a.append(topRow, el('div', 'mini-list__time', `${formatKst(i.startedAt)} · ${formatMinutes(i.durationMinutes)}${i.hasReport ? ' · 보고서 있음' : ''}`));
      li.append(a);
      ul.append(li);
    }
    incBox.append(ul);
  }

  // ⑤ 바닥 정보: 덜 중요한 사실은 작은 글씨 한 줄로
  const foot = el('div', 'detail-foot');
  const facts = el('dl', 'detail-foot__facts');
  for (const [k, v] of [
    ['점검 종류', kind.text],
    ['데이터 출처', SOURCE_TEXT[s.source] ?? s.source],
    [s.state === 'paused' ? '마지막 점검(현재는 점검 안 함)' : '마지막 점검', s.lastCheckedAt ? formatKst(s.lastCheckedAt) : '-'],
  ]) {
    const item = el('div');
    item.append(el('dt', '', k), el('dd', '', v));
    facts.append(item);
  }
  foot.append(facts);
  const notice = {
    paused: '실제 대상으로 등록만 되어 있고 아직 점검을 켜지 않았습니다.',
    simulator: '시뮬레이터: 에이전트 시뮬레이터가 보낸 가짜 측정값입니다(로컬 시험용). 판정·장애·알림은 실제와 같은 경로를 거칩니다.',
  }[s.state === 'paused' ? 'paused' : s.source];
  if (notice) foot.append(el('p', 'detail-foot__notice', notice));
  const link = el('a', 'detail-foot__link', '월간 가용성 보고서 보기');
  link.href = '/report.html';
  link.append(icon('arrowRight', 'ico ico--xs'));
  foot.append(link);

  root.replaceChildren(desc, kpis, charts, incBox, foot);
  renderDetailLive();
}


/**
 * 새 /api/status 응답을 받았을 때 부릅니다.
 *   - 보고 있던 점검이 사라졌으면 팝업을 닫고
 *   - 팝업이 열려 있으면 내용과 그래프 기록만 최신으로 (닫지 않음)
 */
function refreshDetail(data) {
  detailView.data = data;
  if (detailView.selectedId !== null && !data.services.some((s) => s.id === detailView.selectedId)) closeDetail();
  if (dialog()?.open) {
    renderDetail(data);
    loadHistory(detailView.selectedId, true);
  }
}

// 팝업 닫기: ✕ 버튼, 바깥(어두운 배경) 클릭, Esc(브라우저 기본). 팝업이 없는 페이지에서는 건너뜀
if (dialog()) {
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  dialog().addEventListener('click', (e) => {
    // 배경을 누르면 클릭 대상이 <dialog> 자신이 됨 (안쪽 상자를 누르면 그 안의 요소가 대상)
    if (e.target === e.currentTarget) closeDetail();
  });
  dialog().addEventListener('close', onDetailClosed);
}
