// '+ 서비스 추가' 입력 검사·서비스 키·점검 목록 만들기 — 순수 함수 (S4)
//
// 링크 하나를 넣으면 서비스 1개와 점검 2~3개(HTTP·DNS·선택한 상태 확인)를 만듭니다.
// 이 기능은 "Worker가 그 주소로 5분마다 요청을 보내게" 만드는 것이라, 아무 주소나 받으면 안 됩니다.
//   - 관리자 토큰이 있어야 하고(admin.js), 운영자 동의 확인이 없으면 거부합니다 (CLAUDE.md: 남의 사이트는 점검하지 않는다)
//   - 공개 인터넷의 https 사이트만 받습니다 (IP 주소·내부용 이름·이 Worker 자신은 거부)
// 판단은 모두 이 파일의 순수 함수에 모아서 node --test로 경계 사례를 확인합니다. DB·네트워크는 admin.js가 맡습니다.

/** 켜진 서비스 상한: D1 무료 한도와 Worker가 5분마다 보내는 요청 수를 생각한 값 (바꾸기 쉽게 상수 하나로)
 *  10 → 20 (29단계, 2026-11-26). 서비스 개수만으로는 요청 수를 못 지켜서 아래 점검 예산을 함께 봅니다. */
export const MAX_SERVICES = 20;

// ─────────────────────────────────────────────
// 점검 예산 (29단계) — Cron 1회가 바깥으로 보내는 요청 수 지키기
// ─────────────────────────────────────────────
// Workers 무료 플랜은 실행 1회에 바깥 요청(fetch)을 50개까지만 보낼 수 있습니다 (공식 문서 Workers limits, 2026-11-25 수정본).
// 리다이렉트도 1개씩 세고, 넘으면 그 뒤 요청은 실패합니다 → 점검이 '네트워크 오류'로 기록되어 가짜 장애가 됩니다.
// HTTP·DNS 점검은 회차마다 요청 1개씩(DNS는 DoH 조회 1개), 상태 확인 주소가 붙은 서비스는 점검이 3개라
// 서비스 수만 세면 20개 × 3 = 60으로 넘칠 수 있어요. 그래서 켜진 점검 수에도 상한을 둡니다.
//   50 − 6(여유: 장애 메일 몇 통 + 리다이렉트 몇 번. 2026-11-26 실측 리다이렉트 1번) = 44
// D1 호출은 이 50개에 넣지 않습니다: 50번이 넘는 04:00 정리 회차가 라이브에서 성공했고, 문서에도 '내부 서비스 1,000'으로 따로 적혀 있음
export const FETCH_LIMIT_PER_RUN = 50;
export const FETCH_RESERVE = 6;
export const MAX_ACTIVE_CHECKS = FETCH_LIMIT_PER_RUN - FETCH_RESERVE;

/**
 * 점검을 더 켜도 예산 안인지 (순수 함수)
 * @param {number} activeChecks  지금 켜진 HTTP·DNS 점검 수
 * @param {number} adding        새로 켜질 점검 수 (서비스 추가 2~3개, 다시 켜기는 그 서비스의 점검 수)
 * @returns {{ ok: boolean, after: number, limit: number }}
 */
export function checkBudget(activeChecks, adding) {
  const after = activeChecks + adding;
  return { ok: after <= MAX_ACTIVE_CHECKS, after, limit: MAX_ACTIVE_CHECKS };
}

// ─────────────────────────────────────────────
// 서비스 종류 (28단계) — 대시보드·서비스 상세의 아이콘을 종류로 고릅니다 (0022 services.category, DB CHECK와 같은 목록)
// ─────────────────────────────────────────────
export const SERVICE_CATEGORIES = ['game', 'chat', 'ai', 'note', 'lifestyle', 'health', 'work', 'education', 'shopping', 'community', 'other'];
export const CATEGORY_LABEL = {
  game: '게임', chat: '채팅', ai: 'AI', note: '기록·메모', lifestyle: '패션·생활', health: '의료·건강',
  work: '사내 업무', education: '교육', shopping: '쇼핑', community: '커뮤니티', other: '기타',
};

// 추천 단어 표: 위에서부터 먼저 맞는 종류로 정합니다 (순서가 곧 우선순위).
//   - '학원 팀 채팅'은 교육보다 채팅, '병원 인트라넷'은 의료보다 사내 업무, '공여자 추적 … 검사 결과 기록'은 기록보다 의료가 맞아서 이 순서
//   - 영어 짧은 단어(ai 등)는 단어 경계(\b)로만 찾음 ('mail'·'daily' 안의 ai를 잡지 않게)
//   - 'log'는 넣지 않음 ('FITLOG' 같은 이름에 섞여 기록으로 잘못 잡혀서)
const CATEGORY_RULES = [
  ['game', /게임|시뮬레이션|퍼즐|\bgames?\b/i],
  ['chat', /채팅|메신저|대화방|\bchat\b|\bmessenger\b/i],
  ['ai', /인공지능|\bai\b|\bgpt\b|\bllm\b|챗봇/i],
  ['work', /인트라넷|사내|업무|그룹웨어|\berp\b|\bintranet\b/i],
  ['health', /의료|건강|병원|환자|기증|진료|헬스|\bhealth\b|\bmedical\b/i],
  ['note', /기록|메모|일기|노트|\bnotes?\b|\bdiary\b/i],
  ['lifestyle', /옷장|체형|패션|코디|스타일|요리|레시피|\bfashion\b/i],
  ['education', /교육|학습|강의|공부|학원|\bstudy\b|\blearn/i],
  ['shopping', /쇼핑|상점|마켓|주문|장바구니|쿠폰|\bshop\b|\bstore\b|\bmarket\b/i],
  ['community', /커뮤니티|게시판|이웃|마을|빌리지|\bcommunity\b|\bvillage\b/i],
];

/**
 * 이름·설명으로 서비스 종류를 추천한다 (순수 함수, 28단계). 못 찾으면 'other'.
 * 추천은 '+ 서비스 추가' 팝업의 기본값일 뿐이고, 저장 전에 운영자가 고릅니다.
 */
export function suggestCategory(name, description) {
  const text = `${name ?? ''} ${description ?? ''}`;
  for (const [category, re] of CATEGORY_RULES) if (re.test(text)) return category;
  return 'other';
}

/** 종류 값 검사: 목록 안의 값만 (없으면 null — 추가할 때는 추천값을 씀) */
export function checkCategory(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  return SERVICE_CATEGORIES.includes(raw) ? { ok: true, value: raw } : { ok: false };
}

const MAX_URL = 300;
const MAX_NAME = 60;
const MAX_DESC = 100;
const MAX_KEYWORD = 100;

// 공개 인터넷에 없는 이름 (내부망·예약된 이름). 끝이 이것과 같거나 '.이것'으로 끝나면 거부
const BLOCKED_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'test', 'invalid', 'example', 'home.arpa'];

/** IP 주소인가? (IPv4 숫자 네 덩어리, IPv6는 URL에서 [ ]로 감싸져 ':'가 들어감) */
function isIpHost(hostname) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':') || hostname.startsWith('[');
}

/**
 * 주소 하나 검사. 통과하면 화면·DB에 쓸 정리된 주소를 돌려줍니다.
 *   - https만, 기본 포트(443)만, 아이디·비밀번호가 붙은 주소 거부
 *   - 호스트는 점(.)이 있는 도메인 이름 (IP 주소·localhost·.local 등 거부)
 *   - 이 Worker 자신의 주소(selfHost)와 그 하위 주소 거부 (자기 자신을 5분마다 부르는 고리 방지)
 *   - 물음표 뒤(쿼리)·# 뒤는 버림: 쿼리에 토큰 같은 값이 들어 있으면 공개 화면에 그대로 보이게 되므로
 * @returns {{ok:true, url:string, host:string} | {ok:false, error:string}}
 */
export function checkPublicUrl(raw, selfHost) {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: 'url_required' };
  const text = raw.trim();
  if (text.length > MAX_URL) return { ok: false, error: 'url_too_long' };
  let u;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, error: 'url_invalid' };
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'https_only' };
  if (u.username || u.password) return { ok: false, error: 'credentials_not_allowed' };
  if (u.port !== '') return { ok: false, error: 'port_not_allowed' };
  const host = u.hostname.toLowerCase();
  if (isIpHost(host)) return { ok: false, error: 'ip_not_allowed' };
  // 도메인 이름 모양: 글자·숫자·하이픈으로 된 덩어리가 점으로 둘 이상 (xn-- 국제 도메인 포함)
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return { ok: false, error: 'host_invalid' };
  if (BLOCKED_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) return { ok: false, error: 'host_not_public' };
  const self = (selfHost ?? '').toLowerCase();
  if (self && (host === self || host.endsWith(`.${self}`))) return { ok: false, error: 'self_not_allowed' };
  return { ok: true, url: `${u.origin}${u.pathname}`, host };
}

const optText = (v, max) => {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false };
  const t = v.trim();
  if (t.length > max) return { ok: false };
  return { ok: true, value: t === '' ? null : t };
};

/**
 * '+ 서비스 추가' 입력 전체 검사.
 * @param {object} body  { url, name?, description?, healthUrl?, healthKeyword?, consent }
 * @param {object} opts  { selfHost, requireConsent }  — 미리 점검(preview)은 동의 없이도 되고, 추가는 동의가 필수
 * @returns {{ok:true, value:object} | {ok:false, error:string}}
 */
export function validateServiceInput(body, { selfHost, requireConsent = true } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid_body' };
  const site = checkPublicUrl(body.url, selfHost);
  if (!site.ok) return site;

  const name = optText(body.name, MAX_NAME);
  if (!name.ok) return { ok: false, error: 'name_invalid' };
  const description = optText(body.description, MAX_DESC);
  if (!description.ok) return { ok: false, error: 'description_invalid' };
  const keyword = optText(body.healthKeyword, MAX_KEYWORD);
  if (!keyword.ok) return { ok: false, error: 'keyword_invalid' };

  let healthUrl = null;
  if (body.healthUrl !== undefined && body.healthUrl !== null && String(body.healthUrl).trim() !== '') {
    const h = checkPublicUrl(body.healthUrl, selfHost);
    if (!h.ok) return { ok: false, error: `health_${h.error}` };
    // 상태 확인 주소는 같은 사이트 안이어야 함 (다른 호스트를 끼워 넣어 남의 주소를 점검하지 않게)
    if (h.host !== site.host) return { ok: false, error: 'health_host_mismatch' };
    healthUrl = h.url;
  }
  if (keyword.value && !healthUrl) return { ok: false, error: 'keyword_without_health' };

  const category = checkCategory(body.category);
  if (!category.ok) return { ok: false, error: 'category_invalid' };

  if (requireConsent && body.consent !== true) return { ok: false, error: 'consent_required' };

  return {
    ok: true,
    value: {
      homeUrl: site.url,
      host: site.host,
      name: name.value ?? site.host,
      description: description.value,
      healthUrl,
      healthKeyword: keyword.value,
      // 종류(28단계): 고르지 않았으면 이름·설명으로 추천한 값
      category: category.value ?? suggestCategory(name.value ?? site.host, description.value),
    },
  };
}

/**
 * 서비스 키 만들기: 호스트의 첫 덩어리 (my-app.pages.dev → my-app). 이미 있으면 -2, -3 …
 * 키는 0015 CHECK(영문 소문자·숫자·하이픈, 첫 글자는 영문·숫자)와 라우팅 규칙(40자 이하)을 지킵니다.
 * 꺼진 서비스의 키도 다시 쓰지 않습니다(service_key가 UNIQUE라서, 그리고 예전 기록과 섞이지 않게).
 * @param {string} host
 * @param {Iterable<string>} existingKeys  모든 서비스 키 (꺼진 것 포함)
 */
export function serviceKeyFor(host, existingKeys) {
  const taken = new Set(existingKeys);
  // 하이픈 여러 개를 하나로 줄이지 않음: 국제 도메인(xn--…)의 '--'가 깨지기 때문 (0015 CHECK도 연속 하이픈을 허용)
  let base = host.split('.')[0].toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
  if (!base) base = 'service';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const key = `${base}-${i}`;
    if (!taken.has(key)) return key;
  }
}

/**
 * 만들 점검 목록 (기존 고쳐라!·Keychats와 같은 기준)
 *   HTTP: 상태 200, 느림 기준 3000ms / DNS: 이름이 풀리는지, 느림 기준 1000ms /
 *   상태 확인(선택): 상태 200 + 선택 키워드, 느림 기준 3000ms
 * 점검 이름 끝 괄호가 화면의 칩 이름이 됩니다 (dashboard-model.js chipLabel).
 */
export function buildMonitors(v) {
  const list = [
    { name: `${v.name} (HTTP)`, kind: 'http', url: v.homeUrl, expectedStatus: 200, keyword: null, maxResponseMs: 3000 },
    { name: `${v.name} (DNS)`, kind: 'dns', url: `dns://${v.host}`, expectedStatus: 200, keyword: null, maxResponseMs: 1000 },
  ];
  if (v.healthUrl) {
    list.push({ name: `${v.name} (상태 확인)`, kind: 'http', url: v.healthUrl, expectedStatus: 200, keyword: v.healthKeyword, maxResponseMs: 3000 });
  }
  return list;
}
