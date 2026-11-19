// '+ 서비스 추가' 입력 검사·서비스 키·점검 목록 만들기 — 순수 함수 (S4)
//
// 링크 하나를 넣으면 서비스 1개와 점검 2~3개(HTTP·DNS·선택한 상태 확인)를 만듭니다.
// 이 기능은 "Worker가 그 주소로 5분마다 요청을 보내게" 만드는 것이라, 아무 주소나 받으면 안 됩니다.
//   - 관리자 토큰이 있어야 하고(admin.js), 운영자 동의 확인이 없으면 거부합니다 (CLAUDE.md: 남의 사이트는 점검하지 않는다)
//   - 공개 인터넷의 https 사이트만 받습니다 (IP 주소·내부용 이름·이 Worker 자신은 거부)
// 판단은 모두 이 파일의 순수 함수에 모아서 node --test로 경계 사례를 확인합니다. DB·네트워크는 admin.js가 맡습니다.

/** 켜진 서비스 상한: D1 무료 한도와 Worker가 5분마다 보내는 요청 수를 생각한 값 (바꾸기 쉽게 상수 하나로) */
export const MAX_SERVICES = 10;

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
