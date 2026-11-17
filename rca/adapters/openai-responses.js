// 외부 모델 통신은 이 어댑터 한 곳에만 둔다. API 오류 본문/인증 헤더는 반환하지 않는다.
export async function readBoundedJson(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty_response');
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('response_too_large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { joined.set(c, offset); offset += c.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(joined)); } catch { throw new Error('invalid_json_response'); }
}

export function createOpenAiTransport({ apiKey, model, budget, limits, fetchFn }) {
  if (!apiKey || !model || typeof fetchFn !== 'function') throw new Error('model_not_configured');
  return async ({ input, tools, signal }) => {
    const body = JSON.stringify({ model, input, tools, tool_choice: 'required', parallel_tool_calls: false,
      store: false, include: ['reasoning.encrypted_content'], max_output_tokens: limits.outputTokens });
    budget.beforeCall(new TextEncoder().encode(body).byteLength);
    let response;
    try {
      response = await fetchFn('https://api.openai.com/v1/responses', {
        method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body, signal,
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error('provider_error'); }
      const data = await readBoundedJson(response, 256000);
      budget.recordUsage(data.usage);
      if (data.status !== 'completed') throw new Error('model_incomplete');
      return { output: data.output };
    } catch (e) {
      // 공급자 원문 오류나 URL이 오류 메시지로 유출되지 않도록 고정 코드만 사용한다.
      const allowed = ['model_budget_limit', 'provider_error', 'model_incomplete', 'usage_limit', 'invalid_cost', 'response_too_large', 'invalid_json_response', 'empty_response'];
      throw new Error(signal?.aborted ? 'cancelled_or_timed_out' : allowed.includes(e.message) ? e.message : 'provider_error');
    }
  };
}
