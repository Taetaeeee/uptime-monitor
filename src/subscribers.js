// 서비스별 장애 메일 수신자 (19단계 — 틀만, 기본은 꺼짐) — 순수 함수
//
//   subscribersStatus(env)      켤 수 있는지 + 왜 꺼져 있는지
//   normalizeEmail(raw)         주소 검사·정리
//   maskEmail(email)            화면용으로 가리기 (q***@naver.com)
//   signToken / verifyToken     확인·그만 받기 링크 토큰 (저장하지 않고 HMAC으로 계산)
//   pickDeliveries(...)         이번 회차에 누구에게 어떤 메일을 보낼지
//   confirmMail / withUnsubscribe   문구
//
// 켜지는 조건 (모두 필요)
//   SUBSCRIBERS_ENABLED = '1'                 운영자가 일부러 켬
//   RESEND_API_KEY · ALERT_EMAIL_TO           15단계 메일 설정 (운영자는 계속 받음)
//   ALERT_EMAIL_FROM = 내 도메인 주소         Resend 기본 주소(resend.dev)로는 다른 사람에게 못 보냄
//   SUBSCRIBE_SECRET                          링크 토큰 계산용 비밀 값
//   SITE_URL                                  메일 안 링크의 주소

import { safeEqual } from './auth.js';

export const MAX_PER_SERVICE = 5; // 서비스당 수신자 (대기 + 활성)
export const MAX_TOTAL = 20; // 전체 수신자 — Resend 무료 하루 100통 안에 들도록
export const CONFIRM_VALID_DAYS = 7; // 확인 링크 유효 기간
export const RECOVERY_WINDOW_MIN = 60; // 복구 메일은 복구 후 이 시간 안에만 (오래 지난 복구 알림은 의미 없음)

/**
 * @returns {{enabled:boolean, reason:string|null}}  reason: 꺼진 이유 (관리자 응답·로그용, 비밀 값 자체는 넣지 않음)
 */
export function subscribersStatus(env) {
  if (env?.SUBSCRIBERS_ENABLED !== '1') return { enabled: false, reason: 'not_enabled' };
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL_TO) return { enabled: false, reason: 'email_not_configured' };
  const from = String(env.ALERT_EMAIL_FROM ?? '');
  if (!from || /@resend\.dev>?\s*$/i.test(from)) return { enabled: false, reason: 'own_domain_required' };
  if (!env.SUBSCRIBE_SECRET || String(env.SUBSCRIBE_SECRET).length < 16) return { enabled: false, reason: 'secret_missing' };
  if (!env.SITE_URL) return { enabled: false, reason: 'site_url_missing' };
  return { enabled: true, reason: null };
}

/**
 * 메일 주소 검사 (실제로 존재하는지는 확인 메일로 확인 — 여기서는 모양만)
 * @returns {{ok:true, email:string} | {ok:false, error:string}}
 */
export function normalizeEmail(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: false, error: 'email_required' };
  if (s.length > 254) return { ok: false, error: 'email_too_long' };
  // 이름 <주소> 같은 형식·공백·여러 개는 받지 않음
  const m = s.match(/^([A-Za-z0-9._%+-]{1,64})@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/);
  if (!m) return { ok: false, error: 'email_invalid' };
  const domain = m[2].toLowerCase();
  if (domain.split('.').some((l) => !l || l.startsWith('-') || l.endsWith('-'))) return { ok: false, error: 'email_invalid' };
  if (/^\d+$/.test(domain.split('.').at(-1))) return { ok: false, error: 'email_invalid' }; // 숫자 IP 주소
  return { ok: true, email: `${m[1].toLowerCase()}@${domain}` };
}

/** 화면용 가리기: 앞 1글자만 보이고 나머지는 *** (도메인은 그대로 — 누가 받는지 대략 알 수 있게) */
export function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * 링크 토큰 = HMAC-SHA256(비밀 값, "용도:id:주소:추가 시각")
 * 주소·추가 시각을 넣는 이유: 같은 id라도 다시 추가하면(시각이 바뀜) 예전 링크가 더는 안 맞게.
 */
export async function signToken(secret, purpose, sub) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(`${purpose}:${sub.id}:${sub.email}:${sub.createdAt}`)));
}

/** 토큰 비교 (걸리는 시간이 내용과 상관없게 — auth.js safeEqual) */
export async function verifyToken(secret, purpose, sub, token) {
  if (!token || typeof token !== 'string') return false;
  return safeEqual(token, await signToken(secret, purpose, sub));
}

/** 확인 링크가 아직 유효한지 (추가 시각부터 7일) */
export function confirmStillValid(createdAt, now) {
  return now.getTime() - Date.parse(createdAt) <= CONFIRM_VALID_DAYS * 24 * 3600_000;
}

const base = (siteUrl) => String(siteUrl).replace(/\/$/, '');

export function confirmLink(siteUrl, sub, token) {
  return `${base(siteUrl)}/subscribe/confirm?id=${sub.id}&t=${encodeURIComponent(token)}`;
}

export function unsubscribeLink(siteUrl, sub, token) {
  return `${base(siteUrl)}/subscribe/unsubscribe?id=${sub.id}&t=${encodeURIComponent(token)}`;
}

/** 동의 확인 메일 (순수 함수) */
export function confirmMail(serviceName, link) {
  return {
    subject: `[Uptime Monitor] ${serviceName} 장애 알림을 받으시겠어요?`,
    text: [
      `'${serviceName}' 서비스의 장애 알림 수신자로 이 주소가 등록 요청되었습니다.`,
      '',
      '받으시려면 아래 링크를 열고 [받기]를 눌러 주세요. 누르기 전에는 아무 메일도 보내지 않습니다.',
      link,
      '',
      `이 링크는 ${CONFIRM_VALID_DAYS}일 동안 유효합니다. 요청하신 적이 없다면 이 메일을 무시하시면 됩니다 — ${CONFIRM_VALID_DAYS}일 안에 확인하지 않으면 이 주소는 자동으로 지워집니다.`,
      '받게 되는 메일: 장애가 15분 넘게 계속될 때 1통, 복구되면 1통. 모든 메일에 그만 받기 링크가 있습니다.',
    ].join('\n'),
  };
}

/** 수신자용 장애·복구 메일: 운영자에게 보낸 문구 + 그만 받기 안내 */
export function withUnsubscribe(mail, serviceName, link) {
  return {
    subject: mail.subject,
    text: `${mail.text}\n\n—\n'${serviceName}' 장애 알림 수신에 동의하셔서 보낸 메일입니다.\n그만 받기: ${link}`,
  };
}

/**
 * 이번 회차에 수신자에게 보낼 메일 고르기 (순수 함수)
 *
 *   장애 메일: 아직 열려 있는 구간(복구 전)에만 — 이미 복구됐는데 "15분째 장애"를 보내면 헷갈림
 *   복구 메일: 복구 후 RECOVERY_WINDOW_MIN분 안에만, 그리고 그 구간의 장애 메일을 받은 사람에게만
 *   이미 보낸 (구간, 사람, 종류)는 다시 보내지 않음 → 실패한 사람에게만 다음 회차에 재시도
 *
 * @param {object} p
 * @param {Array<{id, serviceId, resolvedAt, escalationSubject, escalationBody, recoverySubject, recoveryBody}>} p.escalations
 * @param {Array<{id, serviceId, email, createdAt}>} p.subscribers   활성 수신자만
 * @param {Array<{escalationId, subscriberId, kind}>} p.deliveries
 * @param {Date} p.now
 * @returns {Array<{escalation, subscriber, kind, mail:{subject,text}}>}
 */
export function pickDeliveries({ escalations, subscribers, deliveries, now }) {
  const done = new Set(deliveries.map((d) => `${d.escalationId}:${d.subscriberId}:${d.kind}`));
  const out = [];
  for (const e of escalations) {
    const subs = subscribers.filter((s) => s.serviceId === e.serviceId);
    if (!e.resolvedAt) {
      if (!e.escalationSubject) continue; // 0019 이전 구간(문구가 없음)은 건너뜀
      for (const s of subs) {
        if (!done.has(`${e.id}:${s.id}:escalation`)) out.push({ escalation: e, subscriber: s, kind: 'escalation', mail: { subject: e.escalationSubject, text: e.escalationBody } });
      }
      continue;
    }
    if (!e.recoverySubject) continue;
    if (now.getTime() - Date.parse(e.resolvedAt) > RECOVERY_WINDOW_MIN * 60_000) continue;
    for (const s of subs) {
      if (done.has(`${e.id}:${s.id}:escalation`) && !done.has(`${e.id}:${s.id}:recovery`)) {
        out.push({ escalation: e, subscriber: s, kind: 'recovery', mail: { subject: e.recoverySubject, text: e.recoveryBody } });
      }
    }
  }
  return out;
}
