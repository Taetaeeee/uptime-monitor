// DNS 점검 — DNS-over-HTTPS(DoH)로 이름이 풀리는지 측정한다.
//
// 왜 DoH인가?
//   Worker에서는 운영체제의 DNS 조회(nslookup 같은 것)를 직접 쓸 수 없습니다.
//   대신 DNS 서버에 HTTPS로 질문하는 DoH를 쓰면 fetch만으로 조회할 수 있어요.
//
// 판정은 하지 않습니다. 그건 judge.js의 judgeDns가 합니다. (HTTP의 checker.js와 같은 역할 분리)

// 질문할 DoH 서버 (Cloudflare 1.1.1.1의 JSON 형식)
// 확인 필요: Worker 안에서 이 주소로 fetch가 제한 없이 되는지 → 공식 문서에서 확인할 부분.
//   안 되면 이 상수만 다른 DoH 주소로 바꾸면 됩니다.
export const DOH_URL = 'https://cloudflare-dns.com/dns-query';
export const DNS_TIMEOUT_MS = 10_000;

// 지원하는 레코드 종류 → DNS 숫자 코드 (응답의 Answer[].type이 숫자로 옵니다)
export const RECORD_TYPES = Object.freeze({ A: 1, AAAA: 28, CNAME: 5, MX: 15, TXT: 16 });

/**
 * 대상 문자열 해석 (순수 함수)
 *   'dns://gochyeora.pages.dev'           → { host: 'gochyeora.pages.dev', type: 'A' }
 *   'dns://gochyeora.pages.dev?type=AAAA' → { host: …, type: 'AAAA' }
 * 형식이 틀리면 null (설정 오류)
 */
export function parseDnsTarget(url) {
  const m = /^dns:\/\/([a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)(?:\?type=([A-Za-z]+))?$/i.exec(url ?? '');
  if (!m) return null;
  const type = (m[2] ?? 'A').toUpperCase();
  if (!RECORD_TYPES[type]) return null;
  return { host: m[1].toLowerCase(), type };
}

/**
 * DoH(JSON) 응답 해석 (순수 함수)
 * 실제 응답 예:
 *   정상     {"Status":0, "Answer":[{"name":"…","type":1,"TTL":300,"data":"172.66.44.133"}, …]}
 *   이름 없음 {"Status":3, "Authority":[…]}   ← Answer 자체가 없음
 * Status는 DNS 응답 코드(RCODE): 0 = 정상, 2 = SERVFAIL, 3 = NXDOMAIN(이름 없음)
 *
 * A 레코드를 물어도 중간에 CNAME이 섞여 올 수 있어서, 물어본 종류의 레코드만 골라 냅니다.
 * @returns {{ rcode: number, answers: string[] }}
 */
export function parseDohResponse(json, type) {
  const code = RECORD_TYPES[type];
  const answers = Array.isArray(json?.Answer)
    ? json.Answer.filter((a) => a && a.type === code && typeof a.data === 'string').map((a) => a.data)
    : [];
  return { rcode: typeof json?.Status === 'number' ? json.Status : -1, answers };
}

/**
 * DNS 조회 1회 (네트워크)
 * @param {object} monitor  { url }  — 'dns://호스트[?type=종류]'
 * @param {object} [deps]   테스트용 { fetchFn, now, timeoutMs }
 * @returns {Promise<{timedOut, networkError, configError, rcode, answers, responseMs, errorMessage}>}
 */
export async function observeDns(monitor, deps = {}) {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? DNS_TIMEOUT_MS;

  const target = parseDnsTarget(monitor.url);
  if (!target) {
    // 대상 주소 형식이 틀림 = 서비스 문제가 아니라 설정 문제 → 판정에서 measure_error로 구분
    return { timedOut: false, networkError: false, configError: true, rcode: null, answers: [], responseMs: null, errorMessage: `잘못된 DNS 대상: ${monitor.url}` };
  }

  const url = `${DOH_URL}?name=${encodeURIComponent(target.host)}&type=${target.type}`;
  const startedAt = now();
  try {
    const res = await fetchFn(url, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);
    const { rcode, answers } = parseDohResponse(await res.json(), target.type);
    return { timedOut: false, networkError: false, configError: false, rcode, answers, responseMs: now() - startedAt, errorMessage: null };
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      timedOut,
      networkError: !timedOut, // DoH 서버에 닿지 못했거나 응답이 이상함
      configError: false,
      rcode: null,
      answers: [],
      responseMs: null,
      errorMessage: String(err?.message ?? err),
    };
  }
}
