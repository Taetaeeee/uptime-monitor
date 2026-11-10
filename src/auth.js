// Bearer 토큰 확인 — 에이전트 보고(B-4)와 관리자 API(B-5)가 함께 사용
//
// 토큰 값은 wrangler secret(배포본)·.dev.vars(로컬)로만 주입되고 코드·저장소에는 없습니다. (CLAUDE.md 규칙 3)
// 에이전트 키(AGENT_API_KEY)와 관리자 토큰(ADMIN_TOKEN)은 따로 둡니다.
//   → 에이전트 키가 새어도 보고서·작업 일정은 고칠 수 없게 (최소 권한)

/**
 * 두 문자열이 같은지 "걸리는 시간이 내용과 상관없게" 비교한다.
 *
 * 왜? 보통의 a === b 는 앞에서부터 비교하다 다른 글자를 만나면 바로 끝나서,
 * 응답 시간을 재면 키를 한 글자씩 맞혀 볼 수 있습니다(타이밍 공격).
 * 두 값을 SHA-256으로 같은 길이(32바이트)로 만든 뒤 모든 바이트를 끝까지 비교하면 이 단서가 사라져요.
 * (crypto.subtle은 Workers와 Node 모두에 있어서 테스트에서도 그대로 동작합니다)
 */
export async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * 요청의 Authorization: Bearer <토큰>을 확인한다.
 * @param {Request} request
 * @param {string|undefined} secret  등록된 토큰 (env.AGENT_API_KEY / env.ADMIN_TOKEN)
 * @returns {Promise<'ok'|'disabled'|'unauthorized'>}
 *   disabled: 서버에 토큰이 등록되지 않음 → 아무도 통과 못 하게 막아야 함 ("토큰 없음 = 누구나 허용"이 되면 안 되므로)
 */
export async function checkBearer(request, secret) {
  if (!secret) return 'disabled';
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return 'unauthorized';
  return (await safeEqual(token, secret)) ? 'ok' : 'unauthorized';
}
