const OUTCOMES = ['candidate', 'deferred', 'no_anomaly_observed'];
export function safeText(value, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max
      || /https?:|workers\.dev|[\w.+-]+@[\w.-]+|[\x00-\x08\x0b-\x1f]/i.test(value)) throw new Error('invalid_report_text');
  return value;
}

// 근거 장부와 구조화된 사실을 대조한다. 일치해도 인과관계가 확인된 것은 아니다.
export function validateModelReport(report, ledger, targetAlias) {
  if (!report || !OUTCOMES.includes(report.outcome) || !Array.isArray(report.citations)
      || !Array.isArray(report.hypotheses) || !Array.isArray(report.unknowns) || !Array.isArray(report.next_actions)
      || report.citations.length > 24 || report.hypotheses.length > 3 || report.unknowns.length > 8 || report.next_actions.length > 8) throw new Error('invalid_report');
  const summary = safeText(report.summary);
  const byId = new Map(ledger.map(e => [e.evidence_id, e]));
  const cited = new Set();
  const citations = report.citations.map(c => {
    const e = byId.get(c.evidence_id);
    if (!e || e.observed_at !== c.observed_at || !Object.hasOwn(e.facts, c.fact_key)
        || String(e.facts[c.fact_key]) !== c.value) throw new Error('invalid_evidence_reference');
    cited.add(e.evidence_id);
    return { evidence_id: e.evidence_id, observed_at: e.observed_at, fact_key: c.fact_key, value: c.value };
  });
  const hypotheses = report.hypotheses.map(h => {
    if (h.target_alias !== targetAlias || !Array.isArray(h.evidence_ids) || !h.evidence_ids.length
        || h.evidence_ids.length > 12 || h.evidence_ids.some(id => !cited.has(id))) throw new Error('unsupported_hypothesis');
    return { target_alias: targetAlias, hypothesis: safeText(h.hypothesis), evidence_ids: [...new Set(h.evidence_ids)], certainty: 'unconfirmed' };
  });
  if (!ledger.length || (report.outcome === 'candidate' && !hypotheses.length)
      || (report.outcome === 'no_anomaly_observed' && (hypotheses.length || !citations.length || ledger.some(e => e.facts.outcome !== 'ok')))) throw new Error('unsupported_outcome');
  return { outcome: report.outcome, summary, hypotheses, citations,
    unknowns: report.unknowns.map(s => safeText(s)), next_actions: report.next_actions.map(s => safeText(s)),
    internal_cause_confirmed: false };
}

export function observationSummary(ledger) {
  return ledger.map(e => ({ evidence_id: e.evidence_id, channel: e.channel, observed_at: e.observed_at,
    provenance: e.provenance, observation_kind: e.observation_kind, facts: { ...e.facts } }));
}
