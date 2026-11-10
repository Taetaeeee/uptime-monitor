// 알림 발송 담당
//
// 채널(어디로 알릴지)과 이벤트(무슨 일이 있었는지)를 분리합니다.
// 채널은 모두 같은 모양만 지키면 됩니다:
//   { name: '채널이름', async send(event, ctx) { ... } }
// 그래서 나중에 이메일 같은 채널을 추가해도 이 파일과 index.js는 바꿀 필요가 없어요.
// (지금은 'log' 채널 하나만 씁니다 → channels/log.js)

import { TRANSITION } from './state.js';

// 실패 이유 코드 → 사람이 읽는 문장
const REASON_TEXT = {
  timeout: '응답 시간 초과',
  network_error: '네트워크 오류',
  status_mismatch: '상태 코드 불일치',
  keyword_missing: '키워드 없음',
  // 내부 점검 에이전트 (B-4)
  unreachable: 'ping 응답 없음',
  port_closed: '포트 연결 실패',
  ssl_expiring: '인증서 만료 임박',
  disk_full: '디스크 사용률 기준 초과',
  service_stopped: '서비스 중지',
  measure_error: '측정 실패',
};

/**
 * 이벤트를 화면에 보여 줄 한국어 문장으로 만든다. (순수 함수)
 *
 * @param {object} event
 * @param {string} event.type           'down' | 'recovered'
 * @param {string} event.monitorName
 * @param {string|null} event.failureReason
 * @param {string} event.occurredAt     상태가 바뀐 회차 (UTC ISO)
 * @param {string|null} event.failingSince  연속 실패가 시작된 회차 (UTC ISO)
 */
export function buildMessage(event) {
  if (event.type === TRANSITION.DOWN) {
    const reason = REASON_TEXT[event.failureReason] ?? event.failureReason ?? '원인 미상';
    return `[장애] ${event.monitorName}: 연속 실패로 장애 판정 (${reason})`;
  }
  // 복구: 첫 실패부터 복구까지 걸린 시간을 함께 보여 줍니다
  const minutes = event.failingSince
    ? Math.round((Date.parse(event.occurredAt) - Date.parse(event.failingSince)) / 60000)
    : null;
  const duration = minutes === null ? '' : ` (장애 약 ${minutes}분)`;
  return `[복구] ${event.monitorName}: 정상 응답 확인${duration}`;
}

/**
 * 모든 이벤트를 모든 채널로 보낸다.
 *
 * 한 채널이 실패해도 다른 채널·다른 이벤트는 계속 보냅니다.
 * 알림은 "부가 기능"이라서, 알림 실패가 점검 자체를 망가뜨리면 안 되기 때문이에요.
 *
 * @returns {Promise<{ sent: number, failed: number }>}
 */
export async function dispatch(events, channels, ctx) {
  let sent = 0;
  let failed = 0;
  for (const event of events) {
    const withMessage = { ...event, message: buildMessage(event) };
    for (const channel of channels) {
      try {
        await channel.send(withMessage, ctx);
        sent += 1;
      } catch (err) {
        failed += 1;
        console.error(`[알림 실패] 채널=${channel.name} 대상=${event.monitorName}:`, err);
      }
    }
  }
  return { sent, failed };
}
