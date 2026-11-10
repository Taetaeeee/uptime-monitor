// 장애 상세 페이지 스크립트 — /api/incidents/:id 를 받아 지표·타임라인·보고서를 그린다.
// 공용 도우미(formatKst, el, sourceBadge, formatMinutes, fetchJson)는 common.js에 있습니다.

const REPORT_SECTIONS = [
  ['summary', '요약'],
  ['impact', '영향'],
  ['rootCause', '원인'],
  ['action', '조치'],
  ['prevention', '재발 방지'],
];

function renderHeader(inc) {
  const title = document.getElementById('title');
  title.textContent = `${inc.monitorName} 장애`;
  const badge = sourceBadge(inc.source);
  if (badge) title.append(' ', badge);
  document.title = `${inc.monitorName} 장애 · ○○산업 서비스 상태`;

  document.getElementById('subtitle').textContent = inc.ongoing
    ? `진행 중 · ${formatKst(inc.startedAt)} 시작`
    : `${formatKst(inc.startedAt)} ~ ${formatKst(inc.resolvedAt)}`;
}

// 지표: 지속 시간, 감지까지 걸린 시간, 원인
function renderMetrics(inc) {
  const dl = document.getElementById('metrics');
  const items = [
    [inc.ongoing ? '경과 시간' : '장애 지속 시간', formatMinutes(inc.durationMinutes), '첫 실패부터 복구까지'],
    ['감지까지 걸린 시간', formatMinutes(inc.detectMinutes), '첫 실패부터 장애 판정(알림)까지'],
    ['원인 (자동 판정)', inc.causeText ?? '-', '장애 판정 때의 실패 이유'],
  ];
  dl.replaceChildren(
    ...items.map(([label, value, hint]) => {
      const box = el('div', 'metric');
      box.append(el('dt', 'metric__label', label), el('dd', 'metric__value', value), el('dd', 'metric__hint', hint));
      return box;
    })
  );
}

// 타임라인: 첫 실패 → 판정 → (관련 알림) → 복구
function renderTimeline(inc) {
  const rows = [
    { at: inc.startedAt, text: '첫 실패 (영향 시작)', kind: 'down' },
    { at: inc.detectedAt, text: '연속 실패로 장애 판정', kind: 'down' },
  ];
  for (const n of inc.notifications) rows.push({ at: n.createdAt, text: `알림: ${n.message}`, kind: n.event });
  if (inc.resolvedAt) rows.push({ at: inc.resolvedAt, text: '정상 응답 확인 (복구)', kind: 'recovered' });
  // 같은 시각이면 위에 넣은 순서를 지키도록 안정 정렬
  rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  document.getElementById('timeline').replaceChildren(
    ...rows.map((r) => {
      const li = el('li', `note note--${r.kind}`);
      li.append(el('span', 'note__icon'), el('div', 'note__msg', r.text), el('div', 'note__time', formatKst(r.at)));
      return li;
    })
  );
}

function renderReport(inc) {
  const root = document.getElementById('report');
  const hasAny = REPORT_SECTIONS.some(([key]) => inc.report[key]);
  if (!hasAny) {
    root.replaceChildren(el('p', 'muted', '아직 보고서가 작성되지 않았습니다.'));
    return;
  }
  const nodes = [];
  for (const [key, label] of REPORT_SECTIONS) {
    nodes.push(el('h3', 'report__label', label));
    // 줄바꿈은 CSS(white-space: pre-line)로 살립니다. HTML로 해석하지 않아요.
    nodes.push(el('p', `report__text ${inc.report[key] ? '' : 'muted'}`, inc.report[key] ?? '작성 전'));
  }
  if (inc.report.updatedAt) nodes.push(el('p', 'muted small', `마지막 수정: ${formatKst(inc.report.updatedAt)}`));
  root.replaceChildren(...nodes);
}

async function load() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id || !/^\d+$/.test(id)) {
    document.getElementById('subtitle').textContent = '장애 번호가 올바르지 않습니다.';
    return;
  }
  try {
    const inc = await fetchJson(`/api/incidents/${id}`);
    renderHeader(inc);
    renderMetrics(inc);
    renderTimeline(inc);
    renderReport(inc);
  } catch (err) {
    console.error(err);
    document.getElementById('subtitle').textContent = String(err.message).includes('404')
      ? '해당 장애를 찾을 수 없습니다.'
      : '장애 정보를 불러오지 못했습니다.';
  }
}

load();
