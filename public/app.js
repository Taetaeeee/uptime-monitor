// 상태 페이지 스크립트 — /api/status를 받아 화면을 그린다.
//
// 안전: 서버에서 온 글자(서비스 이름, 알림 메시지)는 innerHTML이 아니라 textContent로 넣습니다.
//       그래야 데이터에 HTML 태그가 섞여 있어도 실행되지 않아요(XSS 방지).

const REFRESH_MS = 60_000; // 60초마다 새로 고침 (API 캐시 시간과 같게)

const STATE_TEXT = {
  up: '정상',
  down: '장애',
  unknown: '확인 중',
  paused: '점검 대기',
};

// UTC ISO → 한국 시간 문자열 (예: 11. 10. 오후 12:05)
const kstFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const formatKst = (iso) => (iso ? kstFormat.format(new Date(iso)) : '-');

// 작은 요소 생성 도우미: el('span', 'class', '글자')
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

// 출처 표시: sample(시드) → '데모 데이터', simulator(에이전트 시뮬레이터) → '시뮬레이터', real → 표시 없음
function sourceBadge(source) {
  if (source === 'sample') return el('span', 'badge badge--demo', '데모 데이터');
  if (source === 'simulator') return el('span', 'badge badge--sim', '시뮬레이터');
  return null;
}

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
  // 점검 대기(비활성 실제 대상)는 전체 판단에서 뺍니다
  const watched = services.filter((s) => s.state !== 'paused');
  const down = watched.filter((s) => s.state === 'down');

  box.className = 'summary ' + (down.length ? 'summary--down' : 'summary--up');
  text.textContent = down.length
    ? `${down.length}개 서비스 장애: ${down.map((s) => s.name).join(', ')}`
    : '모든 서비스 정상';
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
    const res = await fetch('/api/status', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    renderSummary(data.services);
    renderServices(data.services);
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
