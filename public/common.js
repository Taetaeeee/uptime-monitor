// 상태 페이지(app.js)와 장애 상세 페이지(incident.js)가 함께 쓰는 도우미
//
// 빌드 도구 없이 쓰기 위해 모듈이 아니라 전역 함수로 둡니다.
// HTML에서 common.js를 먼저 불러온 뒤 각 페이지 스크립트를 불러와요.
//
// 안전: 서버에서 온 글자(서비스 이름, 메시지, 보고서)는 innerHTML이 아니라 textContent로 넣습니다.
//       그래야 데이터에 HTML 태그가 섞여 있어도 실행되지 않아요(XSS 방지).

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
