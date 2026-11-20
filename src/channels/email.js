// '메일(email)' 알림 채널 — 메일 발송 API(Resend)로 메일 1통을 보낸다. (15단계)
//
// 비밀 값은 wrangler secret(배포본)·.dev.vars(로컬)로만 받습니다 (CLAUDE.md 규칙 3):
//   RESEND_API_KEY   발송 API 키
//   ALERT_EMAIL_TO   받는 주소 (개인 정보라 코드·저장소·Notion에 적지 않음)
//   ALERT_EMAIL_FROM 보내는 주소 (선택). 없으면 Resend 기본 발신 주소
// 둘 중 하나라도 없으면 메일 기능만 꺼지고(isEmailConfigured = false) 점검·기록은 그대로 동작합니다.
//
// 도메인 없이 기본 발신 주소(onboarding@resend.dev)를 쓰면 Resend 가입 메일 주소로만 보낼 수 있습니다
// (Resend 문서 "403 Error Using resend.dev Domain", 2026-11-20 확인) → ALERT_EMAIL_TO는 가입 메일 주소, 받는 사람은 운영자 한 명.
// 요청 모양은 Resend 문서의 POST /emails 형식입니다 (응답 본문 형식 등 세부는 공식 문서에서 확인할 부분).

export const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Uptime Monitor <onboarding@resend.dev>';
const TIMEOUT_MS = 10_000;

export function isEmailConfigured(env) {
  return Boolean(env?.RESEND_API_KEY && env?.ALERT_EMAIL_TO);
}

/**
 * 메일 1통 보내기. 실패하면 예외를 던집니다 (부르는 쪽이 "보냈다" 기록을 남기지 않고 다음 회차에 다시 시도하게).
 * @param {{subject:string, text:string}} mail
 * @param {object} env   { RESEND_API_KEY, ALERT_EMAIL_TO, ALERT_EMAIL_FROM? }
 * @param {object} [deps] { fetchFn } 테스트용
 * @param {object} [opts] 19단계 수신자용
 * @param {string} [opts.to]       받는 주소 (없으면 운영자 ALERT_EMAIL_TO). 한 통에 한 사람 — 다른 수신자 주소가 서로 보이지 않게
 * @param {string} [opts.unsubscribeUrl]  그만 받기 링크 → 메일 프로그램의 '구독 취소' 버튼용 헤더(List-Unsubscribe)
 */
export async function sendEmail(mail, env, deps = {}, opts = {}) {
  if (!isEmailConfigured(env)) throw new Error('email_not_configured');
  const fetchFn = deps.fetchFn ?? fetch;
  const payload = { from: env.ALERT_EMAIL_FROM || DEFAULT_FROM, to: [opts.to ?? env.ALERT_EMAIL_TO], subject: mail.subject, text: mail.text };
  if (opts.unsubscribeUrl) {
    // 메일 프로그램이 이 주소로 POST 한 번 보내면 바로 그만 받기 (RFC 8058 '한 번에 구독 취소')
    payload.headers = { 'List-Unsubscribe': `<${opts.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  }
  const res = await fetchFn(RESEND_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 응답 본문은 로그에 남기지 않습니다 (주소 등 개인 정보가 들어 있을 수 있어서) — 상태 코드만
  if (!res.ok) throw new Error(`email_send_failed_${res.status}`);
}
