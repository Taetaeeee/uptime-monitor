// 서비스별 수신자 — 확인·그만 받기 페이지와 초대 (19단계, 기본은 꺼짐)
//
//   GET  /subscribe/confirm?id=&t=        "받으시겠어요?" 페이지 (버튼만 — 아직 아무것도 바꾸지 않음)
//   POST /subscribe/confirm               [받기] → 활성
//   GET  /subscribe/unsubscribe?id=&t=    "그만 받으시겠어요?" 페이지
//   POST /subscribe/unsubscribe           [그만 받기] → 주소 삭제 (메일 프로그램의 '한 번에 구독 취소' POST도 여기로)
//
// 왜 링크를 열기만 해서는 처리하지 않나?
//   메일 서비스의 보안 검사기가 메일 속 링크를 미리 열어 보는 경우가 있어서,
//   GET만으로 확인·해지가 되면 사람이 누르지도 않았는데 처리될 수 있습니다. 그래서 버튼(POST)을 눌러야 바뀝니다.
// 토큰은 저장하지 않고 HMAC으로 다시 계산해 비교합니다 (subscribers.js signToken).
// 페이지는 외부 파일을 불러오지 않고, 주소창의 토큰이 다른 사이트로 새지 않게 Referrer-Policy: no-referrer.

import { getSubscriber, activateSubscriber, deleteSubscriber, addSubscriber, countSubscribers } from './db.js';
import {
  subscribersStatus,
  verifyToken,
  signToken,
  confirmStillValid,
  confirmLink,
  confirmMail,
  normalizeEmail,
  MAX_PER_SERVICE,
  MAX_TOTAL,
} from './subscribers.js';
import { sendEmail } from './channels/email.js';
import { toIsoSeconds } from './time.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(title, bodyHtml, status = 200) {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · Uptime Monitor</title>
<style>body{font-family:system-ui,-apple-system,'Malgun Gothic',sans-serif;background:#f3f6fb;color:#0f172a;margin:0;padding:48px 16px}
main{max-width:460px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px}
h1{font-size:20px;margin:0 0 12px}p{line-height:1.6;color:#334155}button{font:inherit;font-weight:700;padding:10px 18px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer}
button.danger{background:#dc2626}a{color:#2563eb}</style></head><body><main><h1>${esc(title)}</h1>${bodyHtml}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
    },
  });
}

const done = () => page('처리되었습니다', '<p>이미 처리되었거나 더 이상 없는 요청입니다. 이 창은 닫으셔도 됩니다.</p>');
const invalid = () => page('링크를 확인할 수 없습니다', '<p>링크가 올바르지 않거나 만료되었습니다. 메일의 링크를 다시 확인해 주세요.</p>', 400);

/** id·토큰 읽기: GET은 주소에서, POST는 폼 본문(없으면 주소)에서 — 메일 프로그램의 한 번에 구독 취소는 주소에 담겨 옴 */
async function readParams(request, url) {
  let id = url.searchParams.get('id');
  let t = url.searchParams.get('t');
  if (request.method === 'POST') {
    const type = request.headers.get('content-type') ?? '';
    if (type.includes('application/x-www-form-urlencoded')) {
      const form = new URLSearchParams((await request.text()).slice(0, 2048));
      id = form.get('id') ?? id;
      t = form.get('t') ?? t;
    }
  }
  return { id: /^[1-9]\d{0,9}$/.test(id ?? '') ? Number(id) : null, t: typeof t === 'string' ? t.slice(0, 200) : null };
}

const hidden = (id, t) => `<input type="hidden" name="id" value="${id}"><input type="hidden" name="t" value="${esc(t)}">`;

/**
 * /subscribe/... 처리
 * @param {Request} request
 * @param {object} env
 * @param {URL} url
 * @param {Date} [now]
 */
export async function handleSubscribePage(request, env, url, now = new Date()) {
  const action = url.pathname === '/subscribe/confirm' ? 'confirm' : url.pathname === '/subscribe/unsubscribe' ? 'unsubscribe' : null;
  if (!action) return page('찾을 수 없습니다', '<p>없는 주소입니다.</p>', 404);
  if (request.method !== 'GET' && request.method !== 'POST') return page('허용되지 않는 요청', '<p>GET 또는 POST만 받습니다.</p>', 405);

  // 확인(받기)은 기능이 켜져 있을 때만. 그만 받기는 기능을 꺼도 동작해야 함 — 주소를 지울 수 있어야 하니까 (비밀 값만 있으면)
  if (action === 'confirm' && !subscribersStatus(env).enabled) return page('지금은 받을 수 없습니다', '<p>장애 알림 수신 기능이 꺼져 있습니다.</p>', 503);
  if (!env.SUBSCRIBE_SECRET) return page('지금은 처리할 수 없습니다', '<p>장애 알림 수신 기능이 설정되어 있지 않습니다.</p>', 503);

  const { id, t } = await readParams(request, url);
  if (!id || !t) return invalid();
  const sub = await getSubscriber(env.DB, id);
  if (!sub) return done(); // 이미 그만 받았거나 지워진 경우 — 있었는지 여부는 알려 주지 않음
  if (!(await verifyToken(env.SUBSCRIBE_SECRET, action, sub, t))) return invalid();

  if (action === 'confirm') {
    if (sub.status === 'active') return page('이미 받고 계십니다', `<p>'${esc(sub.serviceName)}' 장애 알림을 이미 받고 계십니다.</p>`);
    if (!confirmStillValid(sub.createdAt, now)) return invalid();
    if (request.method === 'GET') {
      return page(`${sub.serviceName} 장애 알림 받기`, `<p>'${esc(sub.serviceName)}' 서비스에 장애가 15분 넘게 계속되면 1통, 복구되면 1통을 이 주소로 보냅니다. 모든 메일에 그만 받기 링크가 있습니다.</p>
<form method="post" action="/subscribe/confirm">${hidden(id, t)}<button type="submit">받기</button></form>`);
    }
    await activateSubscriber(env.DB, id, toIsoSeconds(now));
    console.log(`[수신자] #${id} 받기 확인`);
    return page('등록되었습니다', `<p>이제 '${esc(sub.serviceName)}' 장애 알림을 받습니다. 그만 받으려면 알림 메일 아래의 링크를 눌러 주세요.</p>`);
  }

  // 그만 받기
  if (request.method === 'GET') {
    return page(`${sub.serviceName} 장애 알림 그만 받기`, `<p>'${esc(sub.serviceName)}' 장애 알림을 그만 받으시겠어요? 누르면 이 주소가 지워집니다.</p>
<form method="post" action="/subscribe/unsubscribe">${hidden(id, t)}<button type="submit" class="danger">그만 받기</button></form>`);
  }
  await deleteSubscriber(env.DB, id);
  console.log(`[수신자] #${id} 그만 받기 (주소 삭제)`);
  return page('그만 받기 처리되었습니다', '<p>이 주소는 지워졌고, 더 이상 장애 알림을 보내지 않습니다.</p>');
}

/**
 * 관리자가 수신자를 추가할 때: 주소 검사 → 인원 제한 → 저장(대기) → 확인 메일
 * 이미 활성이면 메일을 다시 보내지 않음. 확인 메일 발송이 실패하면 대기 상태로 남고 다시 추가하면 재발송.
 * @returns {Promise<{status:number, body:object}>}  관리자 API 응답 (주소는 가린 형태만)
 */
export async function inviteSubscriber(env, service, rawEmail, now, deps = {}) {
  const st = subscribersStatus(env);
  if (!st.enabled) return { status: 503, body: { error: 'subscribers_disabled', reason: st.reason } };
  const e = normalizeEmail(rawEmail);
  if (!e.ok) return { status: 400, body: { error: e.error } };

  const counts = await countSubscribers(env.DB, service.id);
  const { sub, existed } = await addSubscriberWithin(env, service, e.email, counts, now);
  if (!sub) return { status: 409, body: { error: 'subscriber_limit', perService: MAX_PER_SERVICE, total: MAX_TOTAL } };
  if (existed === 'active') return { status: 200, body: { ok: true, id: sub.id, status: 'active', confirmSent: false } };

  try {
    const link = confirmLink(env.SITE_URL, sub, await signToken(env.SUBSCRIBE_SECRET, 'confirm', sub));
    await sendEmail(confirmMail(service.name, link), env, deps, { to: sub.email });
    console.log(`[수신자] #${sub.id} 확인 메일 보냄 (${service.key})`);
    return { status: existed ? 200 : 201, body: { ok: true, id: sub.id, status: 'pending', confirmSent: true } };
  } catch (err) {
    console.error(`[수신자] #${sub.id} 확인 메일 실패: ${err?.message ?? err}`);
    return { status: 502, body: { error: 'confirm_send_failed', id: sub.id, status: 'pending' } };
  }
}

// 새 주소일 때만 인원 제한을 셈 (이미 있는 주소의 재발송은 늘어나지 않으니까)
async function addSubscriberWithin(env, service, email, counts, now) {
  const exists = await env.DB.prepare('SELECT id FROM service_subscribers WHERE service_id = ?1 AND email = ?2').bind(service.id, email).first();
  if (!exists && (counts.mine >= MAX_PER_SERVICE || counts.total >= MAX_TOTAL)) return { sub: null, existed: null };
  return addSubscriber(env.DB, service.id, email, toIsoSeconds(now));
}
