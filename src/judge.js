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
