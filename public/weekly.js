// 주간 점검 보고서 화면 (20단계) — /weekly.html?key=keychats&week=2026-11-16
//
// 서비스 하나의 한 주(월~일, 한국 시간)를 한 화면으로 보여 줍니다. 위에서 아래로:
//   ① 머리: 서비스·기간·한 줄 판정 + 주 선택 · 인쇄
//   ② 지표 4칸: 가동률(전주 대비) · 장애 · 배포 추정 · 측정 기간
//   ③ 안내: 진행 중인 주, 일부만 측정한 주 같은 "숫자를 읽을 때 주의할 점"
//   ④ 점검별 응답 시간(전주 대비) · 장애 목록 · 첫 화면 변경 시각
//   ⑤ 복사용 텍스트: 메신저·메일에 그대로 붙여 넣어 소유자에게 전달
//
// 데이터는 /api/services/:key/weekly 한 번이면 됩니다. 판정·문구·복사용 텍스트는 서버(src/weekly-report.js)가
// 만들어 주고, 여기서는 받은 값을 그리기만 합니다 (화면과 텍스트의 숫자가 어긋나지 않게).
// 서버에서 온 글자는 textContent로만 넣습니다 (common.js의 el) — 데이터에 HTML이 섞여도 실행되지 않게.
// 공용 도우미(el, icon, formatKst, formatMinutes, fetchJson)는 common.js에 있습니다.

const params = new URLSearchParams(location.search);
const key = params.get('key') ?? '';
const weekParam = params.get('week');

const VERDICT_META = {
  quiet: { tone: 'good', icon: 'check' },
  watch: { tone: 'warn', icon: 'clock' },
  incident: { tone: 'bad', icon: 'alert' },
  nodata: { tone: 'muted', icon: 'help' },
};

const pct = (v) => (v === null || v === undefined ? '-' : `${v}%`);
const signed = (n, unit) => `${n > 0 ? '+' : ''}${n}${unit}`;

// 가동률 → 글자 색 (서비스 상세와 같은 기준: 99.9% 이상 초록, 99% 이상 노랑, 그 아래 빨강)
const uptimeTone = (v) => (v === null || v === undefined ? '' : v >= 99.9 ? 'good' : v >= 99 ? 'warn' : 'bad');

/** 'YYYY-MM-DD'에 n일을 더한 날짜 (서버 aggregate.js addDays와 같은 계산) */
function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 지표 한 칸: 이름 · 값 · 작은 설명 */
function stat(label, value, tone, sub) {
  const box = el('div', 'sd-stat');
  box.append(el('div', 'sd-k', label), el('div', `sd-v${tone ? ` sd-v--${tone}` : ''}`, value));
  if (sub) box.append(el('div', 'sd-sub', sub));
  return box;
}

/** 표 만들기: 머리글 배열 + 줄(칸 배열의 배열). 칸은 글자 또는 요소 */
function table(headers, rows) {
  const t = el('table', 'sd-table');
  const hr = el('tr');
  for (const h of headers) hr.append(el('th', '', h));
  const thead = el('thead');
  thead.append(hr);
  const tbody = el('tbody');
  for (const cells of rows) {
    const tr = el('tr');
    for (const c of cells) {
      const td = el('td');
      td.append(c instanceof Node ? c : document.createTextNode(c ?? '-'));
      tr.append(td);
    }
    tbody.append(tr);
  }
  t.append(thead, tbody);
  const wrap = el('div', 'table-scroll');
  wrap.append(t);
  return wrap;
}

function panel(title, ...children) {
  const box = el('section', 'sd-events');
  box.append(el('h2', '', title), ...children);
  return box;
}

// ── ① 머리 ──
function renderHead(data) {
  const { service, summary: s } = data;
  document.title = `${service.name} 주간 점검 보고서 · Uptime Monitor`;
  const crumb = document.getElementById('crumb-service');
  crumb.textContent = service.name;
  crumb.href = `/service.html?key=${encodeURIComponent(service.key)}`;

  const head = el('section', 'wk-head');
  const who = el('div', 'wk-head__who');
  who.append(
    el('h1', '', `${service.name} 주간 점검 보고서`),
    el('div', 'sd-k', `${s.period.startDay} ~ ${s.period.endDay} (월~일, 한국 시간)${s.period.inProgress ? ' · 진행 중' : ''}`)
  );

  const meta = VERDICT_META[s.verdict] ?? VERDICT_META.nodata;
  const verdict = el('span', `pill pill--${meta.tone} wk-verdict`);
  verdict.append(icon(meta.icon, 'ico ico--xs'), document.createTextNode(s.verdictText));

  // 주 선택: 진행 중인 주부터 최근 8주. 보고 있는 주가 목록에 없으면(오래된 주소) 앞에 붙임
  const select = el('select', 'wk-select');
  select.id = 'wk-week';
  select.setAttribute('aria-label', '주 선택');
  const weeks = data.weeks.includes(data.week) ? data.weeks : [data.week, ...data.weeks];
  for (const w of weeks) {
    const opt = el('option', '', `${w} ~ ${addDays(w, 6)}${w === data.weeks[0] ? ' (진행 중)' : ''}`);
    opt.value = w;
    opt.selected = w === data.week;
    select.append(opt);
  }
  select.addEventListener('change', () => {
    location.search = `?key=${encodeURIComponent(service.key)}&week=${encodeURIComponent(select.value)}`;
  });

  const print = el('button', 'btn2 no-print', '인쇄 / PDF로 저장');
  print.type = 'button';
  print.addEventListener('click', () => window.print());

  const controls = el('div', 'wk-controls no-print');
  controls.append(select, print);
  head.append(who, verdict, controls);
  return head;
}

// ── ② 지표 4칸 ──
function renderStrip(s) {
  const strip = el('section', 'sd-strip');
  const prev = s.prevUptime === null ? '전주 기록 없음' : `전주 ${pct(s.prevUptime)}${s.uptimeDelta === null ? '' : ` (${signed(s.uptimeDelta, '%p')})`}`;
  strip.append(
    stat('가동률', pct(s.uptime), uptimeTone(s.uptime), prev),
    stat('장애', `${s.incidentCount}건`, s.incidentCount ? 'bad' : 'good', s.incidentCount ? `영향 ${formatMinutes(s.incidentMinutes)}${s.ongoingIncidents ? ` · 진행 중 ${s.ongoingIncidents}건` : ''}` : '이 주에는 없음'),
    stat('배포', `${s.deployCount ?? 0}회`, '', `첫 화면 변경 ${s.changeCount}회 중 빌드 파일이 바뀐 것`),
    stat('측정 기간', `${s.period.coverageDays}/${s.period.expectedDays}일`, s.period.coverageDays < s.period.expectedDays ? 'warn' : '', s.totalSlots ? `5분 회차 ${s.totalSlots.toLocaleString('ko-KR')}개` : '기록 없음')
  );
  return strip;
}

// ── ③ 안내 ──
function renderNotes(s) {
  if (s.notes.length === 0) return null;
  const box = el('section', 'wk-notes');
  box.setAttribute('role', 'note');
  const list = el('ul');
  for (const n of s.notes) list.append(el('li', '', n));
  box.append(el('b', '', '이 숫자를 읽을 때'), list);
  return box;
}

// ── ④-1 점검별 응답 시간 ──
function renderChecks(s) {
  const rows = s.checks.map((c) => {
    if (c.avgResponseMs === null) return [c.name, '기록 없음', '-', '-', '-', ''];
    let flag = '';
    if (c.slower) flag = '느려짐';
    else if (!c.trendReliable) flag = '비교 표본 부족';
    const flagCell = el('span', c.slower ? 'wk-flag wk-flag--warn' : 'wk-flag', flag);
    return [
      c.name,
      `${c.avgResponseMs.toLocaleString('ko-KR')}ms`,
      c.prevAvgResponseMs === null ? '-' : `${c.prevAvgResponseMs.toLocaleString('ko-KR')}ms`,
      c.changePercent === null ? '-' : signed(c.changePercent, '%'),
      c.p95WorstMs === null ? '-' : `${c.p95WorstMs.toLocaleString('ko-KR')}ms`,
      flagCell,
    ];
  });
  const body = rows.length
    ? table(['점검', '평균 응답', '전주 평균', '변화', '가장 느린 날 p95', ''], rows)
    : el('p', 'sd-empty', '이 서비스에 묶인 점검이 없습니다.');
  return panel('응답 시간 (점검별, 전주 대비)', body);
}

// ── ④-2 장애 ──
function renderIncidents(s) {
  if (s.incidents.length === 0) return panel('장애', el('p', 'sd-empty', '이 주에는 장애가 없었습니다.'));
  const rows = s.incidents.map((i) => {
    const link = el('a', '', `#${i.id}`);
    link.href = `/incident.html?id=${encodeURIComponent(i.id)}`;
    return [
      link,
      formatKst(i.startedAt),
      i.monitorName ?? '-',
      i.causeText ?? '-',
      i.ongoing ? '진행 중' : `복구됨 (${formatKst(i.resolvedAt)})`,
      formatMinutes(i.minutes),
    ];
  });
  return panel('장애', table(['장애', '시작', '점검', '원인', '상태', '이 주 영향'], rows));
}

// ── ④-3 첫 화면 변경 ──
function renderChanges(s) {
  if (s.changeCount === 0) return panel('첫 화면 변경', el('p', 'sd-empty', '이 주에는 첫 화면 내용이 바뀐 기록이 없습니다.'));
  const more = s.changeCount > s.changes.length ? ` · 전체 ${s.changeCount}회 중 최근 ${s.changes.length}회만 표시` : '';
  // 27단계: 배포 = 빌드 파일 이름(해시)이 바뀜, 내용 변경 = 파일은 그대로, 구별 불가 = 해시 파일이 없거나 비교할 기록이 없음
  const kindText = { deploy: '배포', content: '내용 변경' };
  return panel(
    '첫 화면 변경',
    el('p', 'sd-events__hint', `배포 ${s.deployCount ?? 0} · 내용 변경 ${s.contentCount ?? 0} · 구별 불가 ${s.unknownChangeCount ?? 0}. 같은 새 내용을 5분 점검에서 2회 연속 볼 때 기록합니다${more}`),
    table(['바뀐 것을 처음 본 시각', '구분', '점검'], s.changes.map((c) => [formatKst(c.firstSeenAt), kindText[c.kind] ?? '구별 불가', c.monitorName ?? '-']))
  );
}

// ── ⑤ 복사용 텍스트 ──
function renderText(text) {
  const area = el('textarea', 'wk-text');
  area.readOnly = true;
  area.value = text;
  area.rows = Math.min(16, text.split('\n').length + 1);
  area.setAttribute('aria-label', '복사용 주간 보고 텍스트');

  const msg = el('span', 'wk-copymsg');
  msg.setAttribute('role', 'status');
  const copy = el('button', 'btn2 btn2--primary', '텍스트 복사');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      msg.textContent = '복사했습니다. 메신저나 메일에 붙여 넣으세요.';
    } catch {
      // 클립보드 권한이 없는 환경(주소가 https가 아니거나 권한 거부): 글자를 선택해 두고 직접 복사하게 안내
      area.focus();
      area.select();
      msg.textContent = '자동 복사가 막혔습니다. 선택된 글자를 Ctrl+C로 복사하세요.';
    }
  });

  const bar = el('div', 'wk-textbar no-print');
  bar.append(copy, msg);
  return panel('소유자에게 보낼 텍스트', el('p', 'sd-events__hint', '서비스 소유자의 이름·연락처와 점검 주소는 들어 있지 않습니다. 그대로 붙여 넣어 전달하세요.'), area, bar);
}

async function load() {
  const status = document.getElementById('load-status');
  const root = document.getElementById('wk-root');
  const fail = (text) => {
    root.replaceChildren(el('p', 'sd-empty', text));
    status.textContent = '';
  };

  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(key)) return fail('서비스를 찾을 수 없습니다. 서비스 상세 화면의 "주간 보고서" 링크로 들어와 주세요.');
  if (weekParam !== null && !/^\d{4}-\d{2}-\d{2}$/.test(weekParam)) return fail('주 형식이 올바르지 않습니다. 월요일 날짜를 적어 주세요. (예: ?week=2026-11-16)');

  try {
    const url = `/api/services/${key}/weekly${weekParam ? `?week=${encodeURIComponent(weekParam)}` : ''}`;
    const res = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } });
    if (res.status === 404) return fail('없거나 점검을 내린 서비스입니다.');
    if (res.status === 400) return fail('볼 수 없는 주입니다. 월요일 날짜이고 아직 시작하지 않은 주가 아니어야 합니다. (예: ?week=2026-11-16)');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const s = data.summary;

    const children = [renderHead(data), renderStrip(s)];
    const notes = renderNotes(s);
    if (notes) children.push(notes);
    children.push(renderChecks(s), renderIncidents(s), renderChanges(s), renderText(data.text));
    root.replaceChildren(...children);
    document.getElementById('wk-updated').textContent = `작성 시각: ${formatKst(data.generatedAt)}`;
    status.textContent = '';
    status.classList.remove('is-error');
  } catch (err) {
    console.error(err);
    status.textContent = '보고서를 불러오지 못했습니다. 잠시 후 새로 고침해 주세요.';
    status.classList.add('is-error');
  }
}

load();
