import { randomUUID } from 'node:crypto';
import { resolveErp, probeHttp, probeTcp, getJson } from './probes.mjs';

export function createWorkflowTools() {
  return {
    async network() {
      const dns = await resolveErp();
      const [http, tcp] = await Promise.all([probeHttp(dns.address), probeTcp()]);
      return { observations: [dns.observation, http, tcp], summary: [
        `수집기 DNS: ${dns.observation.ok ? '해석 성공' : '해석 실패'}`,
        `ERP 업무 HTTP: ${http.skipped ? 'DNS 실패로 미실행' : http.status ?? '응답 확인 불가'}`,
        `수집기→DB TCP: ${tcp.ok ? '연결 성공' : '연결 실패'} (ERP 직접 TCP 측정 아님)`,
      ] };
    },
    async server(previous) {
      const started = new Date().toISOString();
      const [live, evidence] = await Promise.all([getJson('erp', 8080, '/health/live'), getJson('erp', 8080, '/internal/evidence')]);
      const rows = [];
      const add = (channel, facts) => rows.push({ id: randomUUID(), source: 'real', environment: 'lab',
        vantage_id: 'lab-collector', observed_at: started, received_at: new Date().toISOString(), channel, ...facts });
      add('process', { available: live.ok, ok: live.ok ? live.body?.ok === true : null, scope: 'erp_process' });
      if (evidence.ok) {
        const m = evidence.body?.metrics;
        const fields = ['process_cpu_seconds_total', 'process_rss_bytes', 'container_memory_current_bytes', 'container_memory_limit_bytes'];
        add('resources', { scope: 'erp_container', ...Object.fromEntries(fields.map(key => [key,
          typeof m?.[key] === 'number' && Number.isFinite(m[key]) ? m[key] : null])) });
        const requestId = previous.observations.find(row => row.channel === 'http')?.request_id;
        const logs = Array.isArray(evidence.body?.logs) ? evidence.body.logs.filter(row => requestId && row.request_id === requestId).slice(-3) : [];
        for (const log of logs) {
          const allowed = ['ok', '53300', '57P01', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'db_unavailable'];
          add('app_log', { request_id: requestId, event: 'erp_orders_read', status: [200, 503].includes(log.status) ? log.status : null,
            error_code: allowed.includes(log.code) ? log.code : 'unclassified', app_observed_at: log.observed_at });
        }
      } else add('resources', { available: false, scope: 'erp_container' });
      const processOk = live.ok ? live.body?.ok === true : null;
      return { observations: rows, process_ok: processOk, summary: [
        `ERP 프로세스: ${processOk === true ? '생존 확인' : processOk === false ? '실패 관측' : '관측 불가'}`,
        evidence.ok ? '컨테이너 자원과 해당 업무 요청의 정제 로그를 조회했습니다.' : '자원·로그를 수집하지 못했습니다. 0 또는 정상으로 채우지 않습니다.',
        'DB 프로세스 상태·DB 서버 자원은 이 도구가 직접 수집하지 않습니다.',
      ] };
    },
  };
}
