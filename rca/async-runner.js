import { validateModelReport, observationSummary } from './lib/report-v2.js';

export async function runAsyncInvestigation({ runId, mode, adapter, policy, limits, signal, isCancelled = async () => false, onEvent = () => {} }) {
  const ledger = [];
  const ids = new Map();
  let toolCount = 0;
  let additional = 0;
  let modelStarted = false;
  let modelResponded = false;
  let results = [];
  const base = { version: 2, run_id: runId, mode, provenance: mode === 'live' ? 'live_probe' : 'synthetic',
    target_alias: adapter.context.target_alias, llm_attempted: false, llm_executed: false, run_status: 'incomplete', cause_outcome: 'not_analyzable' };
  function emit(event) { onEvent(event); }
  try {
    for (let step = 1; step <= limits.steps; step++) {
      if (signal?.aborted || await isCancelled()) throw new Error('cancelled');
      emit({ type: 'step', step, phase: 'model', message: '모델이 다음 조사 단계를 선택합니다.' });
      modelStarted = true;
      const calls = await policy.next({ results, signal });
      modelResponded = true;
      results = [];
      if (signal?.aborted || await isCancelled()) throw new Error('cancelled');
      if (!Array.isArray(calls) || !calls.length || calls.length > 4) throw new Error('invalid_model_calls');
      for (const call of calls) {
        if (signal?.aborted || await isCancelled()) throw new Error('cancelled');
        if (call.name === 'finish_report') {
          if (calls.length !== 1) throw new Error('invalid_model_calls');
          const modelReport = validateModelReport(call.args, ledger, adapter.context.target_alias);
          return { ...base, run_status: 'completed', llm_attempted: true, llm_executed: true, cause_outcome: modelReport.outcome,
            model_report: modelReport, observations: observationSummary(ledger), tool_calls: toolCount, steps: step };
        }
        if (++toolCount > limits.tools) throw new Error('tool_limit');
        if (call.name === 'request_additional_observation' && ++additional > limits.additional) throw new Error('additional_limit');
        emit({ type: 'tool', step, tool: ['get_history', 'http_probe', 'dns_lookup', 'request_additional_observation'].includes(call.name) ? call.name : 'unknown', message: '허용된 도구를 실행합니다.' });
        const result = await adapter.call(call.name, call.args, signal);
        const evidence = [];
        for (const obs of result.evidence ?? []) {
          const key = JSON.stringify(obs);
          if (!ids.has(key)) {
            const item = { ...obs, evidence_id: `${runId}-e${ledger.length + 1}` };
            ids.set(key, item);
            ledger.push(item);
          }
          evidence.push(ids.get(key));
        }
        results.push({ ok: result.ok, error_code: result.error_code, evidence });
        emit({ type: 'observation', count: evidence.length, message: `${evidence.length}건의 관측을 받았습니다.` });
      }
    }
    throw new Error('step_limit');
  } catch (e) {
    const codes = ['cancelled', 'cancelled_or_timed_out', 'tool_limit', 'additional_limit', 'step_limit', 'model_budget_limit', 'provider_error', 'model_incomplete', 'usage_limit', 'invalid_cost', 'response_too_large', 'invalid_json_response', 'empty_response', 'invalid_report', 'invalid_report_text', 'invalid_evidence_reference', 'unsupported_hypothesis', 'unsupported_outcome', 'invalid_model_calls', 'invalid_model_arguments', 'invalid_model_output'];
    const code = codes.includes(e.message) ? e.message : 'investigation_error';
    return { ...base, run_status: /limit|cancel|incomplete/.test(code) ? 'incomplete' : 'failed',
      llm_attempted: modelStarted, llm_executed: modelResponded, error_code: code, observations: observationSummary(ledger), tool_calls: toolCount,
      model_report: null, notice: '관측 요약만 보존했습니다. AI 원인 분석 완료가 아닙니다.' };
  }
}
