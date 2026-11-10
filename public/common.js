// 상태 페이지(app.js)·장애 상세(incident.js)·월간 보고서(report.js)가 함께 쓰는 도우미
//
// 빌드 도구 없이 쓰기 위해 모듈이 아니라 전역 함수로 둡니다.
// HTML에서 common.js를 먼저 불러온 뒤 각 페이지 스크립트를 불러와요.
//
// 안전: 서버에서 온 글자(서비스 이름, 메시지, 보고서)는 innerHTML이 아니라 textContent로 넣습니다.
//       그래야 데이터에 HTML 태그가 섞여 있어도 실행되지 않아요(XSS 방지).

// ─────────────────────────────────────────────
// 시각·숫자 표시
// ─────────────────────────────────────────────

// UTC ISO → 한국 시간 문자열 (예: 11. 10. 오후 12:05)
const kstFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
function formatKst(iso) {
  return iso ? kstFormat.format(new Date(iso)) : '-';
}

// 분 → "1시간 5분" / "15분"
function formatMinutes(min) {
  if (min === null || min === undefined) return '-';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

// ─────────────────────────────────────────────
// 요소 만들기
// ─────────────────────────────────────────────

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

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────
// 아이콘 (lucide 아이콘과 같은 모양의 SVG를 직접 그림 — 외부 라이브러리 없이)
// 각 아이콘은 [태그, 속성] 목록입니다. 선 굵기·색은 CSS(currentColor)를 따릅니다.
// ─────────────────────────────────────────────
const ICONS = {
  activity: [['path', { d: 'M22 12h-4l-3 9L9 3l-3 9H2' }]],
  check: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'm9 12 2 2 4-4' }]],
  alert: [
    ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z' }],
    ['path', { d: 'M12 9v4' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  x: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'm15 9-6 6' }], ['path', { d: 'm9 9 6 6' }]],
  pause: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'M10 15V9' }], ['path', { d: 'M14 15V9' }]],
  help: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  wrench: [
    ['path', { d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' }],
  ],
  globe: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', { d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' }],
    ['path', { d: 'M2 12h20' }],
  ],
  network: [
    ['rect', { x: 16, y: 16, width: 6, height: 6, rx: 1 }],
    ['rect', { x: 2, y: 16, width: 6, height: 6, rx: 1 }],
    ['rect', { x: 9, y: 2, width: 6, height: 6, rx: 1 }],
    ['path', { d: 'M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3' }],
    ['path', { d: 'M12 12V8' }],
  ],
  database: [
    ['ellipse', { cx: 12, cy: 5, rx: 9, ry: 3 }],
    ['path', { d: 'M3 5V19A9 3 0 0 0 21 19V5' }],
    ['path', { d: 'M3 12A9 3 0 0 0 21 12' }],
  ],
  server: [
    ['rect', { x: 2, y: 2, width: 20, height: 8, rx: 2 }],
    ['rect', { x: 2, y: 14, width: 20, height: 8, rx: 2 }],
    ['path', { d: 'M6 6h.01' }],
    ['path', { d: 'M6 18h.01' }],
  ],
  cpu: [
    ['rect', { x: 4, y: 4, width: 16, height: 16, rx: 2 }],
    ['rect', { x: 9, y: 9, width: 6, height: 6 }],
    ['path', { d: 'M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2' }],
  ],
  disk: [
    ['path', { d: 'M22 12H2' }],
    ['path', { d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' }],
    ['path', { d: 'M6 16h.01' }],
    ['path', { d: 'M10 16h.01' }],
  ],
  lock: [['rect', { x: 3, y: 11, width: 18, height: 11, rx: 2 }], ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }]],
  calendar: [
    ['rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }],
    ['path', { d: 'M16 2v4M8 2v4M3 10h18' }],
  ],
  clock: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'M12 6v6l4 2' }]],
  shield: [
    ['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }],
    ['path', { d: 'm9 12 2 2 4-4' }],
  ],
  chart: [['path', { d: 'M3 3v18h18' }], ['path', { d: 'M18 17V9' }], ['path', { d: 'M13 17V5' }], ['path', { d: 'M8 17v-3' }]],
  bell: [['path', { d: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9' }], ['path', { d: 'M10.3 21a1.94 1.94 0 0 0 3.4 0' }]],
  layers: [
    ['path', { d: 'm12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z' }],
    ['path', { d: 'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65' }],
    ['path', { d: 'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65' }],
  ],
  search: [['circle', { cx: 11, cy: 11, r: 8 }], ['path', { d: 'm21 21-4.3-4.3' }]],
  report: [
    ['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }],
    ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }],
    ['path', { d: 'M16 13H8M16 17H8M10 9H8' }],
  ],
  github: [
    ['path', { d: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4' }],
    ['path', { d: 'M9 18c-4.51 2-5-2-7-2' }],
  ],
  arrowRight: [['path', { d: 'M5 12h14' }], ['path', { d: 'm12 5 7 7-7 7' }]],
  arrowUpRight: [['path', { d: 'M7 7h10v10' }], ['path', { d: 'M7 17 17 7' }]],
  arrowLeft: [['path', { d: 'm12 19-7-7 7-7' }], ['path', { d: 'M19 12H5' }]],
  printer: [
    ['path', { d: 'M6 9V2h12v7' }],
    ['path', { d: 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2' }],
    ['rect', { x: 6, y: 14, width: 12, height: 8 }],
  ],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 아이콘 SVG 요소 만들기: icon('check', 'ico ico--sm') */
function icon(name, className = 'ico') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  for (const [tag, attrs] of ICONS[name] ?? ICONS.help) {
    const child = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) child.setAttribute(k, String(v));
    svg.append(child);
  }
  return svg;
}

/** HTML에 적어 둔 <span data-icon="이름"></span> 자리에 아이콘을 채워 넣는다 */
function hydrateIcons(root = document) {
  for (const slot of root.querySelectorAll('[data-icon]')) {
    if (slot.firstChild) continue;
    slot.append(icon(slot.dataset.icon, slot.dataset.iconClass || 'ico'));
  }
}

// ─────────────────────────────────────────────
// 상태 표시 (상태 페이지·상세 패널 공용)
// ─────────────────────────────────────────────
const STATE_META = {
  up: { text: '정상', icon: 'check', tone: 'good' },
  down: { text: '장애', icon: 'x', tone: 'bad' },
  maintenance: { text: '계획 작업 중', icon: 'wrench', tone: 'info' },
  unknown: { text: '확인 중', icon: 'help', tone: 'muted' },
  paused: { text: '점검 대기', icon: 'pause', tone: 'muted' },
};

/** 상태 알약: ● 정상 */
function statePill(state) {
  const meta = STATE_META[state] ?? STATE_META.unknown;
  const pill = el('span', `pill pill--${meta.tone}`);
  pill.append(icon(meta.icon, 'ico ico--xs'), document.createTextNode(meta.text));
  return pill;
}

// 점검 종류 → 아이콘·이름
const KIND_META = {
  http: { icon: 'globe', text: 'HTTP 웹' },
  dns: { icon: 'network', text: 'DNS' },
  domain: { icon: 'calendar', text: '도메인 만료' },
  ping: { icon: 'activity', text: 'ping' },
  tcp: { icon: 'database', text: 'TCP 포트' },
  ssl: { icon: 'lock', text: 'SSL 인증서' },
  disk: { icon: 'disk', text: '디스크' },
  service: { icon: 'cpu', text: 'Windows 서비스' },
};
function kindMeta(kind) {
  return KIND_META[kind] ?? { icon: 'server', text: kind };
}

document.addEventListener('DOMContentLoaded', () => hydrateIcons());
