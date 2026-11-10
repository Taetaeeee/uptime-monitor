// 장애 판정(상태 전이) — 순수 함수
//
// judge.js가 "이번 한 번의 점검이 성공인가"를 정한다면,
// 이 파일은 "지금까지의 흐름을 보면 서비스가 장애 상태인가"를 정합니다.
// 한 번 실패했다고 바로 장애로 보지 않기 위해 연속 횟수를 셉니다.

export const STATE = Object.freeze({
  UNKNOWN: 'unknown', // 아직 판단 전 (처음 등록된 대상)
  UP: 'up',           // 정상
  DOWN: 'down',       // 장애
});

// 상태가 바뀌었을 때 알릴 사건 종류 (notifications.event 값과 같음)
export const TRANSITION = Object.freeze({
  DOWN: 'down',           // 장애 발생
  RECOVERED: 'recovered', // 복구
});

// 몇 번 연속 실패하면 장애로 볼까?
//   1이면 일시적인 네트워크 흔들림에도 알림이 울립니다.
//   2면 감지가 최대 한 회차(5분) 늦어지는 대신 오탐이 크게 줄어요.
export const DOWN_AFTER_FAILURES = 2;

// 몇 번 연속 성공하면 복구로 볼까?
//   복구는 빨리 알리는 게 중요하고, 늦게 판정하면 장애 시간이 실제보다 길게 기록됩니다.
export const UP_AFTER_SUCCESSES = 1;

/** 처음 등록된 대상의 상태 (DB에 상태 행이 아직 없을 때 사용) */
export function initialState() {
  return {
    state: STATE.UNKNOWN,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    failingSince: null,
    changedAt: null,
  };
}

/**
 * 이번 점검 결과를 반영한 다음 상태를 계산한다.
 *
 * @param {object}  prev       이전 상태 (initialState()와 같은 모양)
 * @param {boolean} isSuccess  이번 점검 성공 여부 (judge.js 결과)
 * @param {string}  checkedAt  이번 회차 시각 (UTC ISO)
 * @returns {{ next: object, transition: string|null }}
 *   transition: 알려야 할 변화가 있으면 'down' 또는 'recovered', 없으면 null
 */
export function nextState(prev, isSuccess, checkedAt) {
  if (isSuccess) {
    const consecutiveSuccesses = prev.consecutiveSuccesses + 1;
    const base = { consecutiveFailures: 0, consecutiveSuccesses, failingSince: null };

    // 장애 중이었다면 → 복구 (알림)
    if (prev.state === STATE.DOWN && consecutiveSuccesses >= UP_AFTER_SUCCESSES) {
      return {
        next: { ...base, state: STATE.UP, changedAt: checkedAt },
        transition: TRANSITION.RECOVERED,
      };
    }
    // 처음 판단하는 대상이 성공했다면 → 정상 (알림 없음)
    // 배포 직후 모든 대상에 "복구됨" 알림이 쏟아지는 것을 막기 위해서예요.
    if (prev.state === STATE.UNKNOWN) {
      return { next: { ...base, state: STATE.UP, changedAt: checkedAt }, transition: null };
    }
    // 원래 정상이었다면 → 그대로
    return { next: { ...base, state: prev.state, changedAt: prev.changedAt }, transition: null };
  }

  // 실패
  const consecutiveFailures = prev.consecutiveFailures + 1;
  const base = {
    consecutiveFailures,
    consecutiveSuccesses: 0,
    // 연속 실패의 첫 회차를 기억합니다 (이미 실패 중이면 기존 값 유지)
    failingSince: prev.failingSince ?? checkedAt,
  };

  // 아직 장애가 아니고, 연속 실패가 기준에 닿았다면 → 장애 (알림)
  if (prev.state !== STATE.DOWN && consecutiveFailures >= DOWN_AFTER_FAILURES) {
    return {
      next: { ...base, state: STATE.DOWN, changedAt: checkedAt },
      transition: TRANSITION.DOWN,
    };
  }
  // 이미 장애 중이거나, 아직 기준 미만이면 → 그대로
  // (이미 장애인데 실패가 계속될 때 알림을 또 보내지 않는 것이 중요해요. 같은 알림이 5분마다 쌓이면 아무도 안 봅니다)
  return { next: { ...base, state: prev.state, changedAt: prev.changedAt }, transition: null };
}
