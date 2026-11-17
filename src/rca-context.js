// 운영 테이블에는 SELECT만 한다. URL·서비스 이름·원문 오류는 모델 맥락에 포함하지 않는다.
export function allowedHosts(env) {
  return new Set(String(env.RCA_ALLOWED_HOSTS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(x =>
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(x) && !x.endsWith('.local') && !x.endsWith('.internal')));
}
export async function listRcaTargets(db, env) {
  const hosts = allowedHosts(env);
  const { results } = await db.prepare("SELECT id,kind,url,expected_status FROM monitors WHERE source='real' AND is_active=1 AND kind IN ('http','dns') ORDER BY id").all();
  const parsed = results.flatMap(row => {
    try {
      const u = new URL(row.url);
      if (!hosts.has(u.hostname) || u.username || u.password || u.port || (row.kind === 'http' ? u.protocol !== 'https:' : u.protocol !== 'dns:')) return [];
      return [{ ...row, host: u.hostname, recordType: u.searchParams.get('type') ?? 'A' }];
    } catch { return []; }
  });
  return parsed.filter(r => r.kind === 'http').map(http => ({ id: http.id, alias: `target-${http.id}`, host: http.host, http,
    dns: parsed.find(r => r.kind === 'dns' && r.host === http.host && ['A', 'AAAA'].includes(r.recordType)) ?? null }));
}
export function createHistoryReader(db, target, now) {
  return async channel => {
    const monitor = channel === 'http' ? target.http : target.dns;
    if (!monitor) return [];
    const until = Math.floor(now() / 1000);
    const from = new Date((until - 3600) * 1000).toISOString().replace('.000Z', 'Z');
    const { results } = await db.prepare("SELECT id,checked_at,is_success,is_slow,status_code,response_ms,failure_reason,value FROM check_results WHERE monitor_id=? AND source='real' AND checked_at>=? AND checked_at<=? ORDER BY checked_at DESC LIMIT 8")
      .bind(monitor.id, from, new Date(until * 1000).toISOString().replace('.000Z', 'Z')).all();
    return results.flatMap(row => {
      const time = Date.parse(row.checked_at) / 1000;
      if (!Number.isFinite(time) || time > until || time < until - 3600) return [];
      const facts = { outcome: row.is_success ? row.is_slow ? 'slow' : 'ok' : 'check_failed' };
      if (channel === 'http') {
        if (Number.isInteger(row.status_code)) facts.status_code = row.status_code;
        if (Number.isFinite(row.response_ms) && row.response_ms >= 0) facts.response_ms = row.response_ms;
      } else if (Number.isInteger(row.value) && row.value >= 0) { facts.answer_count = row.value; facts.record_type = monitor.recordType; }
      // 자유 형식 오류 문자열은 버리고 고정 코드만 남긴다.
      if (['timeout', 'network_error', 'status_mismatch', 'keyword_missing', 'dns_rcode', 'dns_no_answer'].includes(row.failure_reason)) facts.failure_code = row.failure_reason;
      return [{ observation_key: `history-${row.id}`, channel, observed_at: time, provenance: 'stored_real', observation_kind: 'stored_history', facts }];
    });
  };
}
