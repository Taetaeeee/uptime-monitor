// 상태 페이지 스크립트 — /api/status를 받아 화면을 그린다.
// 공용 도우미(formatKst, el, sourceBadge, formatMinutes, fetchJson)는 common.js에 있습니다.

const REFRESH_MS = 60_000; // 60초마다 새로 고침 (API 캐시 시간과 같게)

const STATE_TEXT = {
  up: '정상',
  down: '장애',
  unknown: '확인 중',
  paused: '점검 대기',
  maintenance: '계획 작업 중',
};

// 점검 종류별 "마지막 측정값" 문구
//   HTTP·ping·TCP는 응답 시간, 디스크는 사용률, 인증서는 남은 일수, 서비스는 실행 여부
function describeLast(s) {
  if (s.state === 'paused') return '실제 점검 연결 예정 (아직 점검하지 않음)';
  const when = `마지막 점검 ${formatKst(s.lastCheckedAt)}`;
  switch (s.kind) {
    case 'disk':
      return `${when} · 디스크 사용 ${s.lastValue ?? '-'}%`;
    case 'ssl':
      return `${when} · 인증서 ${s.lastValue ?? '-'}일 남음`;
    case 'service':
      return `${when} · 서비스 ${s.state === 'down' ? '중지' : '실행 중'}`;
    default: // http, ping, tcp
      return `${when} · 응답 ${s.lastResponseMs ?? '-'}ms`;
  }
}

// 가동률 → 막대 색 등급
function barClass(uptime) {
  if (uptime === null) return 'bar--empty';
  if (uptime >= 99.9) return 'bar--good';
  if (uptime >= 99) return 'bar--warn';
  return 'bar--bad';
}

function renderSummary(services) {
  const box = document.getElementById('summary');
  const text = document.getElementById('summary-text');
  // 점검 대기(비활성 실제 대상)·계획 작업 중인 대상은 장애 판단에서 뺍니다
  const down = services.filter((s) => s.state === 'down');

  box.className = 'summary ' + (down.length ? 'summary--down' : 'summary--up');
  text.textContent = down.length
    ? `${down.length}개 서비스 장애: ${down.map((s) => s.name).join(', ')}`
    : '모든 서비스 정상';
}

// 계획 작업 안내 (진행 중 + 예정)
function renderMaintenance(list) {
  const root = document.getElementById('maintenance');
  root.replaceChildren(
    ...list.map((w) => {
      const box = el('div', `maint ${w.active ? 'maint--active' : ''}`);
      const head = el('div', 'maint__head', w.active ? '계획 작업 중' : '예정된 계획 작업');
      const badge = sourceBadge(w.source);
      if (badge) head.append(' ', badge);
      const target = w.monitorName ?? '모든 서비스';
      box.append(
        head,
        el('div', 'maint__title', `${w.title} — ${target}`),
        el('div', 'maint__time', `${formatKst(w.startsAt)} ~ ${formatKst(w.endsAt)} (이 시간의 점검은 가동률에서 제외)`)
      );
      return box;
    })
  );
}

function renderServices(services) {
  const root = document.getElementById('services');
  root.replaceChildren(
    ...services.map((s) => {
      const card = el('article', 'card');

      const top = el('div', 'card__top');
      const name = el('div', 'card__name', s.name);
      const badge = sourceBadge(s.source);
      if (badge) name.append(badge);
      top.append(name, el('span', `state state--${s.state}`, STATE_TEXT[s.state] ?? s.state));

      const meta = el('div', 'card__meta', describeLast(s));

      // 30일 막대: 마우스를 올리면 날짜와 가동률 (title), 화면 낭독기용 설명은 aria-label
      const bars = el('div', 'bars');
      bars.setAttribute('role', 'img');
      bars.setAttribute(
        'aria-label',
        `최근 ${s.daily.length}일 가동률 ${s.uptime30d === null ? '기록 없음' : s.uptime30d + '%'}`
      );
      for (const d of s.daily) {
        const bar = el('span', `bar ${barClass(d.uptime)}`);
        bar.title = d.uptime === null ? `${d.day} · 기록 없음` : `${d.day} · ${d.uptime}% (${d.total}회 점검)`;
        bars.append(bar);
      }

      const foot = el('div', 'card__foot');
      foot.append(
        // 첫 막대는 오늘로부터 (막대 수 - 1)일 전 (30개면 29일 전 ~ 오늘)
        el('span', '', `${s.daily.length - 1}일 전`),
        el('span', '', s.uptime30d === null ? '가동률 기록 없음' : `가동률 ${s.uptime30d}%`),
        el('span', '', '오늘')
      );

      card.append(top, meta, bars, foot);
      return card;
    })
  );
}

// 장애 이력 (최근 10건) — 각 줄은 상세 페이지로 가는 링크
function renderIncidents(list) {
  const root = document.getElementById('incidents');
  if (list.length === 0) {
    root.replaceChildren(el('li', 'notes__empty', '기록된 장애가 없습니다.'));
    return;
  }
  root.replaceChildren(
    ...list.map((i) => {
      const li = el('li', `inc ${i.ongoing ? 'inc--ongoing' : ''}`);
      const link = el('a', 'inc__link');
      link.href = `/incident.html?id=${encodeURIComponent(i.id)}`;

      const title = el('div', 'inc__title', i.monitorName);
      const badge = sourceBadge(i.source);
      if (badge) title.append(' ', badge);
      title.append(' ', el('span', `inc__state ${i.ongoing ? 'inc__state--ongoing' : ''}`, i.ongoing ? '진행 중' : '복구됨'));

      const when = i.ongoing
        ? `${formatKst(i.startedAt)} ~ 진행 중 (${formatMinutes(i.durationMinutes)} 경과)`
        : `${formatKst(i.startedAt)} ~ ${formatKst(i.resolvedAt)} (${formatMinutes(i.durationMinutes)})`;
      const meta = el('div', 'inc__meta', `${when} · 원인: ${i.causeText ?? '-'}`);
      const summary = el('div', 'inc__summary', i.hasReport ? i.summary : '보고서 작성 전');
      if (!i.hasReport) summary.classList.add('muted');

      link.append(title, meta, summary);
      li.append(link);
      return li;
    })
  );
}

function renderNotifications(notes) {
  const root = document.getElementById('notifications');
  if (notes.length === 0) {
    root.replaceChildren(el('li', 'notes__empty', '아직 알림이 없습니다.'));
    return;
  }
  root.replaceChildren(
    ...notes.map((n) => {
      const li = el('li', `note note--${n.event}`);
      const msg = el('div', 'note__msg', n.message);
      const badge = sourceBadge(n.source);
      if (badge) msg.append(' ', badge);
      li.append(el('span', 'note__icon'), msg, el('div', 'note__time', formatKst(n.createdAt)));
      return li;
    })
  );
}

async function load() {
  try {
    const data = await fetchJson('/api/status');
    renderSummary(data.services);
    renderMaintenance(data.maintenance ?? []);
    renderServices(data.services);
    renderIncidents(data.incidents ?? []);
    renderNotifications(data.notifications);
    document.getElementById('updated').textContent = `마지막 갱신: ${formatKst(data.generatedAt)}`;
  } catch (err) {
    // 불러오기에 실패해도 이전 화면은 그대로 두고 안내만 바꿉니다
    console.error(err);
    const box = document.getElementById('summary');
    box.className = 'summary summary--error';
    document.getElementById('summary-text').textContent =
      '상태를 불러오지 못했습니다. 잠시 후 자동으로 다시 시도합니다.';
  }
}

load();
setInterval(load, REFRESH_MS);
