// 가격은 운영자가 선택한 모델의 공식 요금으로 설정한다. 임의 모델/가격 기본값은 없다.
export const HARD_LIMITS = Object.freeze({ steps: 6, tools: 8, additional: 2, inputBytes: 24000, outputTokens: 1200, elapsedMs: 90000 });

export function costMicros(inputTokens, outputTokens, prices) {
  if (![inputTokens, outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)
      || ![prices.input, prices.output].every(n => Number.isFinite(n) && n > 0)) throw new Error('invalid_cost');
  const cost = Math.ceil(inputTokens * prices.input + outputTokens * prices.output);
  if (!Number.isSafeInteger(cost)) throw new Error('invalid_cost');
  return cost;
}

export function readRcaConfig(env) {
  const missing = [];
  for (const key of ['OPENAI_API_KEY', 'RCA_OPERATOR_TOKEN', 'RCA_MODEL']) {
    if (typeof env[key] !== 'string' || !env[key].trim()) missing.push(key);
  }
  const positive = key => {
    const n = Number(env[key]);
    if (!Number.isFinite(n) || n <= 0) missing.push(key);
    return n;
  };
  const prices = { input: positive('RCA_INPUT_USD_PER_MILLION'), output: positive('RCA_OUTPUT_USD_PER_MILLION') };
  const dailyMicros = Math.floor(positive('RCA_DAILY_USD_LIMIT') * 1e6);
  const runCapMicros = Math.floor(positive('RCA_RUN_USD_LIMIT') * 1e6);
  const limits = { ...HARD_LIMITS };
  // 입력 토큰은 UTF-8 바이트 수 + API 포장 여유로 보수적으로 예약한다.
  let reserveMicros = 0;
  if (!missing.length) {
    try { reserveMicros = limits.steps * costMicros(limits.inputBytes + 512, limits.outputTokens, prices); }
    catch { missing.push('RCA_INPUT_USD_PER_MILLION', 'RCA_OUTPUT_USD_PER_MILLION'); }
    if (!Number.isSafeInteger(reserveMicros)) missing.push('RCA_INPUT_USD_PER_MILLION', 'RCA_OUTPUT_USD_PER_MILLION');
  }
  if (!Number.isSafeInteger(dailyMicros) || dailyMicros < 1) missing.push('RCA_DAILY_USD_LIMIT');
  if (!Number.isSafeInteger(runCapMicros) || runCapMicros < reserveMicros || runCapMicros < 1) missing.push('RCA_RUN_USD_LIMIT');
  return { ready: missing.length === 0, missing: [...new Set(missing)], model: env.RCA_MODEL, prices,
    dailyMicros, runCapMicros, reserveMicros, limits, concurrency: 1 };
}

export function createCallBudget(config) {
  let calls = 0;
  let spent = 0;
  let unknown = false;
  return {
    beforeCall(bytes) {
      if (calls >= config.limits.steps || bytes > config.limits.inputBytes) throw new Error('model_budget_limit');
      calls++;
      // 첫 네트워크 요청부터 사용량이 확정되지 않을 수 있다. 재시도는 하지 않는다.
      unknown = true;
    },
    recordUsage(usage) {
      const cost = costMicros(usage?.input_tokens, usage?.output_tokens, config.prices);
      if (usage.input_tokens > config.limits.inputBytes + 512 || usage.output_tokens > config.limits.outputTokens) throw new Error('usage_limit');
      spent += cost;
      unknown = false;
    },
    snapshot() { return { calls, spent_micros: spent, usage_uncertain: unknown }; },
  };
}
