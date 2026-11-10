// 월간 가용성 보고서 페이지 — /api/reports/monthly 를 받아 출처별 표를 그린다.
// 공용 도우미(formatKst, el, sourceBadge, formatMinutes, fetchJson)는 common.js에 있습니다.

const GROUP_TITLE = {
  real: '실제 점검',
  simulator: '시뮬레이터 (가짜 측정값)',
  sample: '데모 데이터 (시드)',
};

const KIND_TEXT = { http: 'HTTP', ping: 'ping', tcp: 'TCP', ssl: 'SSL 인증서', disk: '디스크', service: '서비스' };

const pct = (v) => (v === null || v === undefined ? '-' : `${v}%`);
const num = (v) => (v === null || v === undefined ? '-' : v.toLocaleString('ko-KR'));

// 'YYYY-MM' → '2026년 11월'
const monthLabel = (m) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;

function slaCell(s, target) {
  if (s.slaMet === null) return el('td', 'muted', '판단 불가');
  return el('td', s.slaMet ? 'ok' : 'bad', s.slaMet ? `달성 (≥ ${target}%)` : `미달 (< ${target}%)`);
}

function budgetText(s) {
  if (s.allowedMinutes === null) return '-';
  return `허용 ${s.allowedMinutes}분 / 사용 ${s.usedMinutes}분 / 남음 ${pct(s.remainingPercent)}`;
}

function renderGroup(group, data) {
  const section = el('section', 'report-group');
  const h2 = el('h2', '', GROUP_TITLE[group.source] ?? group.source);
  const badge = sourceBadge(group.source);
  if (badge) h2.append(' ', badge);
  section.append(h2);

  // 표가 넓어서 좁은 화면에서는 이 상자 안에서만 가로 스크롤 (페이지 전체가 밀리지 않게)
  const scroller = el('div', 'table-scroll');
  const table = el('table', 'report-table');
  const head = el('tr');
  for (const h of ['대상', '가동률', 'SLA', '에러 버짓', '장애', '장애 시간', '평균 감지 / 복구', '가장 긴 장애', '계획 작업', '평균 응답', '측정 기간']) {
    head.append(el('th', '', h));
  }
  const thead = el('thead');
  thead.append(head);
  const tbody = el('tbody');

  for (const s of group.services) {
    const tr = el('tr');
    const name = el('td', 'name');
    name.append(el('div', '', s.name), el('div', 'muted small-inline', KIND_TEXT[s.kind] ?? s.kind));

    let longest = el('td', '', '-');
    if (s.longestIncident) {
      longest = el('td');
      const a = el('a', '', formatMinutes(s.longestIncident.minutes));
      a.href = `/incident.html?id=${encodeURIComponent(s.longestIncident.id)}`;
      longest.append(a);
    }

    const coverage = el('td', '', `${s.coverageDays}/${data.period.daysInMonth}일`);
    if (s.coverageDays > 0 && s.coverageDays < data.period.daysInMonth) coverage.append(el('div', 'muted small-inline', '부분 측정'));

    tr.append(
      name,
      el('td', 'strong', pct(s.uptime)),
      slaCell(s, data.targetPercent),
      el('td', 'small-cell', budgetText(s)),
      el('td', '', s.ongoingIncidents ? `${s.incidentCount}건 (진행 중 ${s.ongoingIncidents})` : `${s.incidentCount}건`),
      el('td', '', s.incidentCount ? formatMinutes(s.incidentMinutes) : '-'),
      el('td', '', s.incidentCount ? `${formatMinutes(s.avgDetectMinutes)} / ${formatMinutes(s.avgRecoverMinutes)}` : '-'),
      longest,
      el('td', '', s.maintenanceMinutes ? formatMinutes(s.maintenanceMinutes) : '-'),
      el('td', '', s.avgResponseMs === null ? '-' : `${num(s.avgResponseMs)}ms`),
      coverage
    );
    tbody.append(tr);
  }

  table.append(thead, tbody);
  scroller.append(table);
  section.append(scroller);
  return section;
}

function renderMonths(data) {
  const select = document.getElementById('month');
  const months = data.months.includes(data.month) ? data.months : [data.month, ...data.months];
  select.replaceChildren(
    ...months.map((m) => {
      const opt = el('option', '', monthLabel(m));
      opt.value = m;
      opt.selected = m === data.month;
      return opt;
    })
  );
}

async function load() {
  const params = new URLSearchParams(location.search);
  const month = params.get('month');
  const url = month ? `/api/reports/monthly?month=${encodeURIComponent(month)}` : '/api/reports/monthly';
  try {
    const data = await fetchJson(url);
    document.getElementById('title').textContent = `${monthLabel(data.month)} 가용성 보고서`;
    document.title = `${monthLabel(data.month)} 가용성 보고서 · ○○산업`;
    document.getElementById('subtitle').textContent =
      `${data.period.startDay} ~ ${data.period.endDay} (한국 시간) · SLA 목표 ${data.targetPercent}%` +
      (data.period.inProgress ? ' · 진행 중인 달이라 숫자가 계속 바뀝니다' : '');
    renderMonths(data);
    document.getElementById('groups').replaceChildren(...data.groups.map((g) => renderGroup(g, data)));
    document.getElementById('updated').textContent = `작성 시각: ${formatKst(data.generatedAt)}`;
  } catch (err) {
    console.error(err);
    document.getElementById('subtitle').textContent = String(err.message).includes('400')
      ? '기간 형식이 올바르지 않습니다. (예: ?month=2026-11)'
      : '보고서를 불러오지 못했습니다.';
  }
}

document.getElementById('month').addEventListener('change', (e) => {
  location.search = `?month=${encodeURIComponent(e.target.value)}`;
});
document.getElementById('print').addEventListener('click', () => window.print());

load();
