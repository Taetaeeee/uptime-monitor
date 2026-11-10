// 점검 결과 판정 — 순수 함수
//
// 순수 함수란? 같은 입력이면 항상 같은 출력을 내고, 네트워크·DB·시계 같은 바깥 세계를 건드리지 않는 함수.
// 그래서 진짜 사이트에 요청하지 않고도 "시간 초과면 실패" 같은 규칙을 node --test로 검증할 수 있습니다.

// 실패 이유 코드 (DB에 이 값 그대로 저장)
export const FAILURE_REASON = Object.freeze({
  TIMEOUT: 'timeout',                 // 10초 안에 응답 없음
  NETWORK_ERROR: 'network_error',     // DNS 실패, 연결 거부 등 응답 자체를 못 받음
  STATUS_MISMATCH: 'status_mismatch', // 상태 코드가 기대값과 다름
  KEYWORD_MISSING: 'keyword_missing', // 지정한 키워드가 본문에 없음
});

/**
 * 관측값을 보고 성공/실패/느림을 판정한다.
 *
 * @param {object} monitor  점검 대상 설정
 * @param {number} monitor.expectedStatus  기대 상태 코드
 * @param {string|null} monitor.keyword    본문에 있어야 할 단어 (없으면 검사 안 함)
 * @param {number} monitor.maxResponseMs   허용 응답 시간(ms)
 *
 * @param {object} observation  checker.js가 실제로 관측한 값
 * @param {boolean} observation.timedOut
 * @param {boolean} observation.networkError
 * @param {number|null} observation.statusCode
 * @param {number|null} observation.responseMs
 * @param {string} observation.body
 *
 * @returns {{ isSuccess: boolean, isSlow: boolean, failureReason: string|null }}
 */
export function judgeCheck(monitor, observation) {
  // 실패 이유는 하나만 기록합니다. 우선순위는 "더 근본적인 문제"부터:
  // 응답이 아예 없으면(시간 초과·네트워크 오류) 상태 코드나 키워드를 볼 수도 없으니까요.
  if (observation.timedOut) {
    return fail(FAILURE_REASON.TIMEOUT);
  }
  if (observation.networkError) {
    return fail(FAILURE_REASON.NETWORK_ERROR);
  }
  if (observation.statusCode !== monitor.expectedStatus) {
    return fail(FAILURE_REASON.STATUS_MISMATCH);
  }
  // 키워드가 지정된 경우에만 검사 (null·빈 문자열이면 건너뜀)
  if (monitor.keyword && !(observation.body ?? '').includes(monitor.keyword)) {
    return fail(FAILURE_REASON.KEYWORD_MISSING);
  }

  // 여기까지 왔으면 성공. 느린지는 성공일 때만 따집니다.
  // (실패한 점검에 '느림'까지 붙이면 의미가 겹쳐서 집계가 헷갈려요)
  const isSlow = observation.responseMs > monitor.maxResponseMs;
  return { isSuccess: true, isSlow, failureReason: null };
}

function fail(reason) {
  return { isSuccess: false, isSlow: false, failureReason: reason };
}

// ─────────────────────────────────────────────
// DNS·도메인 만료 판정 (외부 점검 확장)
// ─────────────────────────────────────────────

export const DNS_FAILURE = Object.freeze({
  NXDOMAIN: 'dns_nxdomain',     // 그런 이름이 없음 (RCODE 3)
  ERROR: 'dns_error',           // 그 밖의 DNS 오류 (SERVFAIL 등)
  NO_ANSWER: 'dns_no_answer',   // 이름은 있지만 물어본 종류의 레코드가 없음
  MISMATCH: 'dns_mismatch',     // 기대한 값(예: 특정 IP)이 응답에 없음
  CONFIG: 'measure_error',      // 대상 설정 오류 (에이전트 판정과 같은 코드)
});

/**
 * DNS 조회 결과 판정
 * @param {object} monitor  { keyword: 기대값(없으면 검사 안 함), maxResponseMs }
 * @param {object} obs      dns.js observeDns의 결과
 * @returns {{ isSuccess, isSlow, failureReason }}
 */
export function judgeDns(monitor, obs) {
  // 우선순위는 HTTP와 같은 생각: 더 근본적인 문제부터
  if (obs.configError) return fail(DNS_FAILURE.CONFIG);
  if (obs.timedOut) return fail(FAILURE_REASON.TIMEOUT);
  if (obs.networkError) return fail(FAILURE_REASON.NETWORK_ERROR);
  if (obs.rcode === 3) return fail(DNS_FAILURE.NXDOMAIN);
  if (obs.rcode !== 0) return fail(DNS_FAILURE.ERROR);
  if (obs.answers.length === 0) return fail(DNS_FAILURE.NO_ANSWER);
  // 기대값은 '포함' 검사: IP 하나 또는 CNAME 대상 이름의 일부를 지정 (레코드가 여러 개일 수 있어서)
  if (monitor.keyword && !obs.answers.some((a) => a.includes(monitor.keyword))) return fail(DNS_FAILURE.MISMATCH);
  return { isSuccess: true, isSlow: obs.responseMs > monitor.maxResponseMs, failureReason: null };
}

export const DOMAIN_FAILURE = Object.freeze({
  EXPIRING: 'domain_expiring', // 만료 임박
  EXPIRED: 'domain_expired',   // 이미 만료
});

// 도메인은 갱신(결제·등록 기관 처리)에 시간이 걸려서 SSL(14일)보다 여유 있게 30일 전부터 실패로 봅니다.
export const DOMAIN_DEFAULT_THRESHOLD_DAYS = 30;

/**
 * 도메인 만료 판정 (순수 함수)
 *
 * 내 도메인이 없어서 실제 만료일 조회(RDAP/WHOIS)는 만들지 않았고,
 * 판정 로직만 만들어 가짜 날짜로 검증합니다. (CLAUDE.md 프로젝트 설명)
 *
 * @param {string} expiresAt  만료 시각 (UTC ISO)
 * @param {Date} now
 * @param {number} [thresholdDays]  남은 일수가 이보다 적으면 실패
 * @returns {{ isSuccess, isSlow, failureReason, daysLeft }}
 *   daysLeft: 남은 '완전한' 날 수 (내림). 하루가 안 남았으면 0, 지났으면 음수
 */
export function judgeDomainExpiry(expiresAt, now, thresholdDays = DOMAIN_DEFAULT_THRESHOLD_DAYS) {
  const ms = Date.parse(expiresAt) - now.getTime();
  const daysLeft = Math.floor(ms / 86_400_000);
  if (ms <= 0) return { ...fail(DOMAIN_FAILURE.EXPIRED), daysLeft };
  if (daysLeft < thresholdDays) return { ...fail(DOMAIN_FAILURE.EXPIRING), daysLeft };
  return { isSuccess: true, isSlow: false, failureReason: null, daysLeft };
}
