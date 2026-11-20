// 오래 가는 장애 메일 알림 — Cron 실행 (15단계)
//
//   지금 상태 읽기(db.js) → 보낼 메일 고르기(escalation.js) → 발송(channels/email.js) → 기록(service_escalations)
//
// 순서가 중요합니다: "보낸 뒤에" 기록합니다.
//   발송이 실패하면 기록하지 않으므로 다음 5분 회차에 다시 시도합니다 (메일을 놓치는 것보다 늦게라도 보내는 것이 낫다).
//   반대로 기록을 먼저 하면, 발송이 실패했을 때 영영 안 보내게 됩니다.
// 메일 설정(비밀 값)이 없으면 아무것도 읽거나 보내지 않고 끝냅니다 — 점검·기록에는 영향 없음.
//
// 19단계: 운영자에게 보낸 문구를 구간에 함께 남기고, 서비스별 수신자 기능이 켜져 있으면(기본은 꺼짐)
// 같은 문구를 동의한 수신자에게도 한 사람씩 보냅니다 (subscriber-run.js).

import { getEscalationState, insertEscalation, resolveEscalation } from './db.js';
import { decideEscalations, buildEscalationMail, buildRecoveryMail } from './escalation.js';
import { isEmailConfigured, sendEmail } from './channels/email.js';
import { toCheckSlot } from './time.js';
import { runSubscriberDeliveries } from './subscriber-run.js';

/**
 * @param {object} env      { DB, RESEND_API_KEY, ALERT_EMAIL_TO, ALERT_EMAIL_FROM?, SITE_URL? }
 * @param {Date}   runTime  이번 실행 시각 (회차로 내림해서 씀)
 * @param {object} [deps]   { fetchFn } 테스트용
 * @returns {Promise<{skipped?:boolean, sent:number, failed:number}>}
 */
export async function runEscalation(env, runTime, deps = {}) {
  if (!isEmailConfigured(env)) return { skipped: true, sent: 0, failed: 0 };
  const now = toCheckSlot(runTime);
  const state = await getEscalationState(env.DB);
  const { escalate, resolve } = decideEscalations({ ...state, now });

  let sent = 0;
  let failed = 0;
  for (const item of escalate) {
    try {
      const mail = buildEscalationMail(item, env.SITE_URL);
      await sendEmail(mail, env, deps);
      await insertEscalation(env.DB, item.service.id, item.startedAt, now, mail);
      sent += 1;
      console.log(`[메일] ${now} ${item.service.key} 장애 ${item.minutes}분 → 장애 메일 보냄`);
    } catch (err) {
      failed += 1;
      console.error(`[메일] ${now} ${item.service.key} 장애 메일 실패 (다음 회차에 다시 시도): ${err?.message ?? err}`);
    }
  }
  for (const item of resolve) {
    try {
      const mail = buildRecoveryMail(item, now, env.SITE_URL);
      await sendEmail(mail, env, deps);
      await resolveEscalation(env.DB, item.escalationId, now, mail);
      sent += 1;
      console.log(`[메일] ${now} ${item.service.key} 복구 → 복구 메일 보냄`);
    } catch (err) {
      failed += 1;
      console.error(`[메일] ${now} ${item.service.key} 복구 메일 실패 (다음 회차에 다시 시도): ${err?.message ?? err}`);
    }
  }

  // 수신자 발송 (19단계): 꺼져 있으면 아무것도 읽지 않고 끝남. 실패해도 운영자 메일·기록에는 영향 없음
  let subscribers = null;
  try {
    subscribers = await runSubscriberDeliveries(env, new Date(Date.parse(now)), deps);
  } catch (err) {
    console.error(`[메일] ${now} 수신자 발송 단계 실패: ${err?.message ?? err}`);
  }
  return { sent, failed, subscribers };
}
