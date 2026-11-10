// 시각 계산 순수 함수 모음
// 네트워크·DB와 상관없이 "입력 시각 → 출력 문자열"만 계산해서 node --test로 바로 검증할 수 있습니다.

// 점검 간격(분). wrangler.jsonc의 Cron "*/5 * * * *"과 반드시 같이 바꿔야 합니다.
// (설정 파일 값을 코드에서 읽을 수 없어서 두 곳에 적어 둡니다)
export const CHECK_INTERVAL_MINUTES = 5;

/**
 * 실제 실행 시각을 그대로 UTC ISO 문자열로 (밀리초만 버림).
 * 예: 2026-11-10T02:50:12.345Z → 2026-11-10T02:50:12Z
 * 로그에 "실제로 언제 돌았는지"를 남길 때 씁니다.
 */
export function toIsoSeconds(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * 실행 시각을 점검 '회차' 시각으로 바꾼다 (5분 단위 내림).
 * 예: 2026-11-10T02:50:12Z → 2026-11-10T02:50:00Z
 *
 * 왜 필요한가?
 *   Cron은 정각(:00초)에 딱 맞춰 실행된다는 보장이 없어서, 실제로 02:50:12처럼 초가 붙어 들어왔습니다.
 *   회차 시각으로 맞춰 저장하면 "02:50 회차" 단위로 묶어 조회·집계하기 쉽고,
 *   시드 데이터(seed/sample.sql)와도 형식이 같아집니다.
 *
 * 왜 반올림이 아니라 내림인가?
 *   회차는 "예정된 시각"이라서, 조금 늦게 실행돼도 원래 회차에 묶여야 하기 때문입니다.
 *   (한계: 5분 넘게 늦으면 다음 회차로 묶임. 드물다고 보고 여기서는 다루지 않음)
 */
export function toCheckSlot(date) {
  const intervalMs = CHECK_INTERVAL_MINUTES * 60 * 1000;
  // getTime()은 UTC 기준 밀리초라서, 나눠서 내림하면 시간대와 상관없이 정확히 5분 경계가 됩니다.
  const slotMs = Math.floor(date.getTime() / intervalMs) * intervalMs;
  return toIsoSeconds(new Date(slotMs));
}
