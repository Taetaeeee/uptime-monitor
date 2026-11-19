// 서비스 묶음의 상태·가동률 계산 — 순수 함수 (0015)
//
// 서비스 하나에는 점검이 여러 개 묶여 있습니다 (예: Keychats = HTTP + DNS + DB 상태).
// 여기서는 "묶인 점검들의 상태 → 서비스 상태"와 "회차별 결과 → 서비스 가동률"만 계산하고,
// DB 조회·저장은 하지 않습니다. 그래서 node --test로 경계 상황을 빠짐없이 시험할 수 있어요.

/** 서비스 상태 값과 화면 문구의 기준 */
export const SERVICE_STATE = {
  UP: 'up',                   // 정상: 판정한 점검이 모두 정상
  DEGRADED: 'degraded',       // 주의: 실패는 없지만 최근 결과가 느린 점검이 있음
  PARTIAL: 'partial',         // 부분 장애: 일부 점검만 장애
  DOWN: 'down',               // 장애: 판정한 점검이 모두 장애
  MAINTENANCE: 'maintenance', // 계획 작업 중: 켜진 점검이 모두 계획 작업 중
  PAUSED: 'paused',           // 점검 대기: 켜진 점검이 하나도 없음
  UNKNOWN: 'unknown',         // 확인 중: 아직 판정 결과가 없음
};

/**
 * 묶인 점검들의 현재 상태로 서비스 상태를 정한다.
 *
 * 순서가 곧 우선순위입니다.
 *   1) 켜진 점검이 없으면 '점검 대기'
 *   2) 켜진 점검이 모두 계획 작업 중이면 '계획 작업 중'
 *   3) (계획 작업 중을 뺀) 판정 대상이 모두 장애면 '장애', 일부만 장애면 '부분 장애'
 *      → 장애를 '느림'보다 먼저 봅니다. 장애가 있는데 '주의'로 보이면 안 되니까요.
 *   4) 판정 대상이 모두 '확인 중'이면 '확인 중'
 *   5) 정상 점검 중 최근 결과가 느린 것이 있으면 '주의', 아니면 '정상'
 *
 * 왜 일부 장애를 '장애'가 아닌 '부분 장애'로 나누나?
 *   DNS는 되는데 DB만 멈췄다면 사이트는 열리지만 기능이 안 됩니다.
 *   "완전히 안 됨"과 "일부 기능 장애"는 대응 순서(에스컬레이션)가 달라서 구분해 보여 줍니다.
 *
 * @param {Array<{state:string, lastIsSlow?:boolean}>} checks
 *   state는 api.js displayState()의 값 (up / down / unknown / paused / maintenance)
 */
export function serviceState(checks) {
  const active = checks.filter((c) => c.state !== 'paused');
  if (active.length === 0) return SERVICE_STATE.PAUSED;

  const judged = active.filter((c) => c.state !== 'maintenance');
  if (judged.length === 0) return SERVICE_STATE.MAINTENANCE;

  const down = judged.filter((c) => c.state === 'down').length;
  if (down === judged.length) return SERVICE_STATE.DOWN;
  if (down > 0) return SERVICE_STATE.PARTIAL;

  if (judged.every((c) => c.state === 'unknown')) return SERVICE_STATE.UNKNOWN;
  if (judged.some((c) => c.state === 'up' && c.lastIsSlow)) return SERVICE_STATE.DEGRADED;
  return SERVICE_STATE.UP;
}

/**
 * 묶인 점검들의 결과를 회차(checkedAt)별로 묶어 센다.
 *   - 계획 작업 중 결과는 뺍니다 (대상별 가동률과 같은 규칙: 미리 알린 작업은 장애가 아님)
 *   - 한 회차의 결과가 모두 성공이면 정상 회차, 하나라도 실패면 장애 회차
 *   - 정상 회차 중 하나라도 느렸으면 느린 회차
 *
 * 왜 '점검 수'가 아니라 '회차 수'로 세나?
 *   HTTP와 DNS가 같은 회차에 함께 실패하면 사용자 입장에서는 장애 5분 한 번입니다.
 *   점검 수로 세면 같은 5분을 두 번 깎아서 서비스 가동률이 실제보다 나빠 보여요.
 *
 * 마이그레이션 0015의 지난 기록 채우기 SQL도 같은 규칙입니다 (테스트에서 두 결과를 비교).
 *
 * @param {Array<{checkedAt:string, isSuccess:boolean, isSlow:boolean, inMaintenance?:boolean}>} rows
 * @returns {{totalSlots:number, upSlots:number, slowSlots:number}}
 */
export function summarizeSlots(rows) {
  const slots = new Map(); // checkedAt → { ok, slow }
  for (const r of rows) {
    if (r.inMaintenance) continue;
    const s = slots.get(r.checkedAt) ?? { ok: true, slow: false };
    s.ok = s.ok && r.isSuccess;
    s.slow = s.slow || r.isSlow;
    slots.set(r.checkedAt, s);
  }
  let upSlots = 0;
  let slowSlots = 0;
  for (const s of slots.values()) {
    if (!s.ok) continue;
    upSlots += 1;
    if (s.slow) slowSlots += 1;
  }
  return { totalSlots: slots.size, upSlots, slowSlots };
}

/**
 * 서비스 일별 집계를 aggregate.js의 막대·가동률 함수가 읽는 모양으로 바꾼다.
 * (회차 수를 점검 수 자리에 넣으면 같은 계산 함수를 그대로 쓸 수 있어요)
 */
export function toDailyShape(stat) {
  return {
    day: stat.day,
    totalChecks: stat.totalSlots,
    successChecks: stat.upSlots,
    slowChecks: stat.slowSlots,
    avgResponseMs: null, // 서비스 단위 평균 응답 시간은 의미가 애매해서 두지 않음 (점검별로 봄)
  };
}
