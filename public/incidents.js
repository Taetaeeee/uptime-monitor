// 장애 이력 페이지 스크립트 — /api/status의 장애 이력(최근 10건)을 목록으로 그린다.
// 대시보드(app.js)에 있던 목록을 이 페이지로 옮겼습니다. 대시보드는 "지금 괜찮은가"를,
// 이 페이지는 "지난 장애가 무엇이었고 어떻게 처리했나"를 보는 곳이라 나눴어요.
// 공용 도우미(el, icon, formatKst, formatMinutes, sourceBadge, fetchJson)는 common.js에 있습니다.

const REFRESH_MS = 60_000; // 60초마다 새로 고침 (API 캐시 시간과 같게)

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
  const badge = i.source === 'real' ? null : sourceBadge(i.source); // 실제가 아닌 기록에만 표시
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

async function load() {
  const status = document.getElementById('load-status');
  try {
    const data = await fetchJson('/api/status', { cache: 'no-store' });
    const list = data.incidents ?? [];
    const root = document.getElementById('incidents');
    if (list.length === 0) {
      root.replaceChildren(el('p', 'notes__empty', '기록된 장애가 없습니다.'));
    } else {
      const ol = el('ol', 'incidents');
      ol.append(...list.map(incidentItem));
      root.replaceChildren(ol);
    }
    document.getElementById('incident-count').textContent = `최근 ${list.length}건`;
    status.textContent = '';
    status.classList.remove('is-error');
  } catch (err) {
    console.error(err);
    status.textContent = '장애 이력을 불러오지 못했습니다. 잠시 후 자동으로 다시 시도합니다.';
    status.classList.add('is-error');
  }
}

load();
setInterval(load, REFRESH_MS);
