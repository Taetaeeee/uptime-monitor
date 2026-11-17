import { readBoundedJson } from './openai-responses.js';

const isArgumentObject = args => args !== null && typeof args === 'object' && !Array.isArray(args)
  && [Object.prototype, null].includes(Object.getPrototypeOf(args));

// 주소·기록 조회는 서버가 선택한다. 모델 인자는 URL/호스트/ID를 받을 수 없다.
export function createLiveAdapter({ target, history, fetchFn, now }) {
  let sequence = 0;
  const latestMeasurement = new Map();
  const context = { target_alias: target.alias, mode: 'live', channels: ['http', ...(target.dns ? ['doh'] : [])],
    time_basis: 'UTC epoch seconds', notice: '등록된 내 서비스의 한시점 외부 관측. 내부 메트릭·로그는 제공되지 않음.' };
  async function measure(channel, parentSignal) {
    const signal = AbortSignal.any([parentSignal ?? new AbortController().signal, AbortSignal.timeout(6000)]);
    const start = now();
    let facts;
    try {
      if (channel === 'http') {
        let address = new URL(target.http.url);
        let response;
        for (let hop = 0; hop <= 2; hop++) {
          response = await fetchFn(address.href, { method: 'GET', redirect: 'manual', signal, headers: { Accept: '*/*' } });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || hop === 2) throw new Error('redirect_blocked');
          const next = new URL(location, address);
          // 명시적으로 등록된 HTTPS origin 안에서만 이동한다. 쿠키/인증은 전송하지 않는다.
          if (next.origin !== new URL(target.http.url).origin || next.username || next.password) throw new Error('redirect_blocked');
          address = next;
        }
        // 본문은 읽지 않는다. 응답 시간은 본문 전송 시간이 아닌 헤더 수신까지다.
        const size = Number(response.headers.get('content-length'));
        await response.body?.cancel();
        facts = { outcome: size > 65536 ? 'body_not_read' : response.status === target.http.expected_status ? 'ok' : 'status_mismatch',
          status_code: response.status, response_ms: Math.max(0, now() - start), body_inspected: false };
      } else {
        const endpoint = new URL('https://cloudflare-dns.com/dns-query');
        endpoint.searchParams.set('name', target.host);
        endpoint.searchParams.set('type', target.dns.recordType);
        const response = await fetchFn(endpoint.href, { signal, redirect: 'error', headers: { Accept: 'application/dns-json' } });
        if (!response.ok) { await response.body?.cancel(); throw new Error('doh_transport_error'); }
        const data = await readBoundedJson(response, 32000);
        if (!Number.isInteger(data.Status) || data.Status < 0 || data.Status > 15 || (data.Answer !== undefined && !Array.isArray(data.Answer))) throw new Error('invalid_dns_response');
        const type = target.dns.recordType === 'AAAA' ? 28 : 1;
        const answerCount = (data.Answer ?? []).filter(a => a.type === type).length;
        facts = { outcome: data.Status !== 0 ? 'dns_error' : answerCount > 0 ? 'ok' : 'no_answer', rcode: data.Status, record_type: target.dns.recordType, answer_count: answerCount };
      }
    } catch (e) {
      if (parentSignal?.aborted) throw new Error('cancelled');
      facts = { outcome: e.message === 'redirect_blocked' ? 'redirect_blocked' : signal.aborted ? 'timeout' : channel === 'http' ? 'network_error' : 'doh_transport_error' };
    }
    return [{ observation_key: `measurement-${++sequence}`, channel, observed_at: Math.floor(now() / 1000), provenance: 'live_probe', observation_kind: 'new_measurement', facts }];
  }
  return { context, async call(name, args, signal) {
    const channel = name === 'http_probe' ? 'http' : name === 'dns_lookup' ? 'doh' : args?.channel;
    const withChannel = ['get_history', 'request_additional_observation'].includes(name);
    if (!['get_history', 'request_additional_observation', 'http_probe', 'dns_lookup'].includes(name)
        || !isArgumentObject(args) || Object.keys(args).some(k => !withChannel || k !== 'channel')
        || (withChannel && Object.keys(args).length !== 1) || !context.channels.includes(channel)) return { ok: false, error_code: 'invalid_tool_arguments', evidence: [] };
    if (name === 'get_history') return { ok: true, evidence: await history(channel) };
    // 기본 probe는 채널별 첫 결과(또는 마지막 추가 측정)를 다시 읽는다.
    // 새 측정은 러너가 횟수를 제한하는 추가 관측 경로로만 열어 준다.
    // 진행 중 Promise도 캐시해 같은 채널의 동시 기본 호출이 중복 측정하지 않게 한다.
    if (name === 'request_additional_observation' || !latestMeasurement.has(channel)) {
      latestMeasurement.set(channel, measure(channel, signal));
    }
    const pending = latestMeasurement.get(channel);
    try { return { ok: true, evidence: structuredClone(await pending) }; }
    catch (e) {
      if (latestMeasurement.get(channel) === pending) latestMeasurement.delete(channel);
      throw e;
    }
  } };
}

// 기존 동기 도구와 합성 데이터 스키마를 재사용하되, 모델에는 열린 관측만 반환한다.
export function createSyntheticAdapter({ tools, context }) {
  return { context, async call(name, args) {
    const channel = name === 'http_probe' ? 'http' : name === 'dns_lookup' ? 'doh' : args?.channel;
    const withChannel = ['get_history', 'request_additional_observation'].includes(name);
    if (!isArgumentObject(args) || Object.keys(args).some(k => !withChannel || k !== 'channel')
        || (withChannel && Object.keys(args).length !== 1) || !['http', 'doh'].includes(channel)) return { ok: false, error_code: 'invalid_tool_arguments', evidence: [] };
    let result;
    if (name === 'request_additional_observation') result = tools.call(name, { channel });
    else if (['get_history', 'http_probe', 'dns_lookup'].includes(name)) result = tools.call(channel === 'http' ? 'http_probe' : 'dns_lookup', { target_alias: context.target_alias });
    else return { ok: false, error_code: 'unknown_tool', evidence: [] };
    return { ok: result.ok, error_code: result.error_code, evidence: (result.evidence ?? []).map(e => ({ observation_key: e.evidence_id, channel: e.channel,
      observed_at: e.observed_at, facts: e.facts, provenance: 'synthetic', observation_kind: 'fixture_observation' })) };
  } };
}
