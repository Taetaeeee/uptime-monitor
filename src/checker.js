// 실제 HTTP 요청을 보내고 "관측값"을 만든다.
//
// 판정(성공/실패)은 하지 않습니다. 그건 judge.js의 일이에요.
// 여기서는 "무슨 일이 있었나"만 기록합니다: 응답이 왔나, 상태 코드는?, 몇 ms 걸렸나, 본문은?
// 네트워크와 닿는 코드를 이 파일에만 모아 두면, 나머지 코드는 네트워크 없이 테스트할 수 있습니다.

export const TIMEOUT_MS = 10_000; // 10초

/**
 * @param {object} monitor  { url }
 * @param {object} [deps]   테스트에서 가짜 fetch·시계를 넣을 수 있게 열어 둔 구멍
 * @returns {Promise<{timedOut:boolean, networkError:boolean, statusCode:number|null,
 *                    responseMs:number|null, body:string, errorMessage:string|null}>}
 */
export async function observe(monitor, deps = {}) {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;

  const startedAt = now();
  try {
    // AbortSignal.timeout: 지정 시간이 지나면 요청을 자동으로 취소합니다.
    // (Workers에서 지원되는 것으로 알고 있음 → 공식 문서에서 확인할 부분)
    const signal = AbortSignal.timeout(timeoutMs);

    const response = await fetchFn(monitor.url, {
      method: 'GET',
      redirect: 'follow', // 리다이렉트를 따라가서 최종 응답으로 판정 (B-1 결정 사항)
      signal,
      headers: { 'User-Agent': 'status-monitor/0.1 (portfolio project)' },
    });

    // 키워드 검사를 위해 본문까지 받습니다. 응답 시간도 본문을 다 받은 시점까지 잽니다.
    // 본문 받는 도중에 10초가 지나도 같은 signal 때문에 취소되어 시간 초과로 처리돼요.
    const body = await response.text();

    return {
      timedOut: false,
      networkError: false,
      statusCode: response.status,
      responseMs: now() - startedAt,
      body,
      errorMessage: null,
    };
  } catch (err) {
    // 시간 초과로 취소되면 이름이 TimeoutError (환경에 따라 AbortError)로 들어옵니다.
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      timedOut,
      networkError: !timedOut, // 그 밖의 예외(DNS 실패, 연결 거부 등)는 네트워크 오류로 봅니다
      statusCode: null,
      responseMs: null,
      body: '',
      errorMessage: String(err?.message ?? err),
    };
  }
}
