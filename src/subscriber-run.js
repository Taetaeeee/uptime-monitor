// 서비스별 수신자에게 장애·복구 메일 보내기 — Cron 실행 (19단계, 기본은 꺼짐)
//
//   켜져 있나? → 확인 안 한 지 7일 지난 대기 수신자 정리 → 보낼 것 고르기(subscribers.js pickDeliveries)
//   → 한 사람씩 발송(그만 받기 링크 포함) → 보낸 사람만 기록 (실패한 사람은 다음 회차에 다시)
//
// 꺼져 있으면 DB를 읽지도 않고 끝납니다 — 지금(운영자만 받기)과 완전히 같은 동작.
// 문구는 운영자에게 보낸 것을 그대로 쓰므로(구간에 저장), 다시 보낼 때도 같은 내용이 갑니다.

import { getDeliveryState, insertDelivery, deleteExpiredPending } from './db.js';
import { subscribersStatus, pickDeliveries, signToken, unsubscribeLink, withUnsubscribe, CONFIRM_VALID_DAYS, RECOVERY_WINDOW_MIN } from './subscribers.js';
import { sendEmail } from './channels/email.js';
import { toIsoSeconds } from './time.js';

/**
 * @param {object} env
 * @param {Date} now  이번 회차 시각
 * @param {object} [deps] { fetchFn }
 * @returns {Promise<{skipped:true, reason:string} | {sent:number, failed:number, expired:number}>}
 */
export async function runSubscriberDeliveries(env, now, deps = {}) {
  const status = subscribersStatus(env);
  if (!status.enabled) return { skipped: true, reason: status.reason };

  const expired = await deleteExpiredPending(env.DB, toIsoSeconds(new Date(now.getTime() - CONFIRM_VALID_DAYS * 24 * 3600_000)));
  const state = await getDeliveryState(env.DB, toIsoSeconds(new Date(now.getTime() - RECOVERY_WINDOW_MIN * 60_000)));
  const todo = pickDeliveries({ ...state, now });

  let sent = 0;
  let failed = 0;
  for (const d of todo) {
    try {
      const link = unsubscribeLink(env.SITE_URL, d.subscriber, await signToken(env.SUBSCRIBE_SECRET, 'unsubscribe', d.subscriber));
      await sendEmail(withUnsubscribe(d.mail, d.subscriber.serviceName, link), env, deps, { to: d.subscriber.email, unsubscribeUrl: link });
      await insertDelivery(env.DB, d.escalation.id, d.subscriber.id, d.kind, toIsoSeconds(now));
      sent += 1;
    } catch (err) {
      failed += 1;
      // 주소는 로그에 남기지 않음 (수신자 번호만)
      console.error(`[메일] 수신자 #${d.subscriber.id} ${d.kind} 메일 실패 (다음 회차에 다시 시도): ${err?.message ?? err}`);
    }
  }
  if (sent || failed || expired) console.log(`[메일] 수신자 발송 ${sent}통, 실패 ${failed}, 만료 정리 ${expired}`);
  return { sent, failed, expired };
}
