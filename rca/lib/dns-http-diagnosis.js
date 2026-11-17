// DNS·HTTP 관측 규칙 진단 — "현상 / 원인 후보 / 보류 / 필요한 추가 자료"를 구분한다.
//
// 이 파일의 핵심 원칙
// 1) 관측된 사실(현상)과 원인 가설을 분리한다. 현상은 증거 id로 뒷받침되고, 가설은 후보·열림(open) 상태일 뿐이다.
// 2) 원인을 "확정"하지 않는다. 결과 등급에 확정이 없고(confirmed_cause는 항상 null),
//    증거가 많아도 최대 candidate(후보)다. 증거 개수나 점수로 등급이 올라가는 경로가 구조적으로 없다.
// 3) 관측하지 않은 것(CPU·DB 상태 등)은 원인 후보로 올리지 않고 unknown_facts(미확인)에만 적는다.
// 4) DoH(이름 해석)와 HTTP는 같은 호스트라도 다른 경로의 관측이다. HTTP가 쓴 해석 결과를 DoH가 보증하지 않는다.
// 5) 범위 밖(다른 사례·실행·모드) 증거는 쓰지 않고 rejected_evidence에 사유와 함께 남긴다.
//
// 순수 함수다. 파일·네트워크를 쓰지 않는다.

import { isPlainObject } from './util.js';
import { CHANNELS, OUTCOMES_OF_CHANNEL, NO_ANOMALY_LIMIT_KO, validateEvidenceShape } from './case-schema.js';

const DNS_FAILURES = ['dns_nxdomain', 'dns_error', 'dns_no_answer', 'dns_mismatch'];

const PHENOMENON_OF = Object.freeze({
  doh: {
    ok: 'dns_resolution_ok', dns_nxdomain: 'dns_nxdomain', dns_error: 'dns_error',
    dns_no_answer: 'dns_no_answer', dns_mismatch: 'dns_answer_mismatch', doh_transport_error: 'doh_transport_error',
  },
  http: {
    ok: 'http_ok', slow: 'http_slow_response', timeout: 'http_timeout',
    network_error: 'http_connection_failed', status_mismatch: 'http_unexpected_status',
    keyword_missing: 'http_unexpected_content',
  },
});

// 채널이 섞였을 때(같은 채널에서 결과가 엇갈림) 열어 두는 가설. 원인을 CPU·DB로 단정하는 가설은 두지 않는다.
const MIXED_HYPOTHESES = Object.freeze({
  http: ['intermittent_network_path', 'intermittent_origin_response', 'probe_timeout_sensitivity'],
  doh: ['intermittent_resolver_path', 'intermittent_target_dns', 'probe_timeout_sensitivity'],
});

/** 증거 목록을 범위 안/밖으로 가른다. */
function splitEvidence(evidence, scope) {
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  for (const ev of Array.isArray(evidence) ? evidence : []) {
    if (!isPlainObject(ev)) { rejected.push({ evidence_id: null, reason: 'invalid_evidence' }); continue; }
    const id = typeof ev.evidence_id === 'string' ? ev.evidence_id : null;
    if (ev.case_id !== scope?.case_id || ev.run_id !== scope?.run_id || ev.mode !== scope?.mode) {
      rejected.push({ evidence_id: id, reason: 'scope_mismatch' });
    } else if (!validateEvidenceShape(ev).ok) {
      rejected.push({ evidence_id: id, reason: 'invalid_evidence' });
    } else if (seen.has(id)) {
      rejected.push({ evidence_id: id, reason: 'duplicate_evidence' });
    } else {
      seen.add(id);
      accepted.push(ev);
    }
  }
  return { accepted, rejected };
}

/** 채널별로 결과 값 → 증거 id 목록. 결과 값 순서는 정의 순서로 고정해 출력이 늘 같게 한다. */
function groupByOutcome(accepted, channel) {
  const map = new Map();
  for (const outcome of OUTCOMES_OF_CHANNEL[channel]) {
    const list = accepted.filter((e) => e.channel === channel && e.facts.outcome === outcome);
    if (list.length > 0) map.set(outcome, list);
  }
  return map;
}

const idsOf = (list) => list.map((e) => e.evidence_id);

function buildPhenomena(channel, grouped) {
  const out = [];
  for (const [outcome, list] of grouped) {
    let code = PHENOMENON_OF[channel][outcome];
    if (channel === 'http' && outcome === 'status_mismatch'
        && list.some((e) => Number.isInteger(e.facts.status_code) && e.facts.status_code >= 500)) {
      code = 'http_server_error'; // 5xx 서버측 오류 관측
    }
    out.push({ code, channel, evidence_ids: idsOf(list), supported: true });
  }
  return out;
}

/**
 * DNS·HTTP 증거로 진단한다.
 * @param {object[]} evidence 도구가 발급한 증거 목록
 * @param {{case_id:string, run_id:string, mode:string}} scope 이 진단이 속한 사례·실행·모드
 */
export function diagnoseDnsHttp(evidence, scope) {
  const { accepted, rejected } = splitEvidence(evidence, scope);
  const grouped = {
    doh: groupByOutcome(accepted, 'doh'),
    http: groupByOutcome(accepted, 'http'),
  };

  const phenomena = [...buildPhenomena('doh', grouped.doh), ...buildPhenomena('http', grouped.http)];
  const diagnosis = {
    cause_outcome: 'deferred',
    confirmed_cause: null,                 // 이 단계에서는 항상 null (확정 경로 없음)
    phenomena,
    hypotheses: [],
    unknown_facts: [],
    next_checks: [],
    rejected_evidence: rejected,
    notes_ko: [],
  };
  const hyp = (code, status, ids, limits) => {
    diagnosis.hypotheses.push({ hyp_id: `h${diagnosis.hypotheses.length + 1}`, code, status, evidence_ids: ids, limits });
  };
  const unknown = (...codes) => { for (const code of codes) diagnosis.unknown_facts.push({ code }); };
  const externalCheck = (channel, reason) => {
    diagnosis.next_checks.push({ kind: 'external_data', channel, reason_code: reason, would_change_outcome: false });
  };

  // 1) 관측이 없는 채널이 있으면 분석할 수 없다. (분석 불가는 "정상"도 "장애"도 아니다.)
  const missing = CHANNELS.filter((ch) => grouped[ch].size === 0);
  if (missing.length > 0) {
    diagnosis.cause_outcome = 'not_analyzable';
    for (const ch of missing) {
      unknown(`${ch}_channel_unobserved`);
      diagnosis.next_checks.push({ kind: 'additional_observation', channel: ch, reason_code: 'channel_unobserved', would_change_outcome: true });
    }
    diagnosis.notes_ko.push('관측이 부족해 분석할 수 없다. 이것은 정상 판정도 장애 판정도 아니다.');
    return diagnosis;
  }

  // 2) 같은 채널 안에서 결과가 엇갈리면(간헐 현상) 원인 후보를 좁히지 못하고 보류한다.
  const mixedChannels = CHANNELS.filter((ch) => grouped[ch].size > 1);
  if (mixedChannels.length > 0) {
    const seen = new Set();
    for (const ch of mixedChannels) {
      const ids = idsOf(accepted.filter((e) => e.channel === ch));
      for (const code of MIXED_HYPOTHESES[ch]) {
        if (seen.has(code)) continue;
        seen.add(code);
        hyp(code, 'open', ids, ['observations_inconclusive']);
      }
      diagnosis.next_checks.push({ kind: 'additional_observation', channel: ch, reason_code: 'mixed_outcomes', would_change_outcome: true });
    }
    unknown('origin_server_state_unobserved');
    return diagnosis;
  }

  // 3) 두 채널 모두 결과가 한 가지로 일정한 경우
  const doh = [...grouped.doh.keys()][0];
  const http = [...grouped.http.keys()][0];
  const dohIds = idsOf(grouped.doh.get(doh));
  const httpIds = idsOf(grouped.http.get(http));

  if (doh === 'ok' && http === 'ok') {
    diagnosis.cause_outcome = 'no_anomaly_observed';
    diagnosis.notes_ko.push(NO_ANOMALY_LIMIT_KO);
    return diagnosis;
  }

  if (doh === 'doh_transport_error') {
    // 점검 쪽이 리졸버에 닿지 못한 것이다. 대상 DNS가 죽은 것과 구분할 수 없으므로 둘 다 열어 둔다.
    const limits = ['doh_and_http_are_different_paths'];
    hyp('probe_to_resolver_path_failure', 'open', dohIds, limits);
    hyp('target_dns_failure', 'open', dohIds, limits);
    unknown('target_dns_state_unobserved', 'resolver_path_state_unobserved');
    externalCheck('doh', 'independent_resolver_check');
    return diagnosis;
  }

  if (DNS_FAILURES.includes(doh)) {
    const code = (doh === 'dns_nxdomain' || doh === 'dns_error') ? 'name_resolution_problem' : 'dns_record_problem';
    if (http === 'network_error' || http === 'timeout') {
      // 이름 해석 실패와 연결 실패가 함께 보인다. 그래도 최대 후보다 (HTTP 경로의 해석은 관측하지 않았다).
      diagnosis.cause_outcome = 'candidate';
      hyp(code, 'candidate', [...dohIds, ...httpIds], ['http_path_resolution_not_observed']);
    } else {
      // DoH는 실패인데 HTTP는 응답했다: 두 경로가 다른 것을 본 것이므로 후보로 올리지 않는다.
      hyp(code, 'open', dohIds, ['http_path_resolution_not_observed', 'doh_and_http_are_different_paths']);
    }
    unknown('origin_server_state_unobserved');
    externalCheck('http', 'http_path_resolution_check');
    return diagnosis;
  }

  // 4) 이름 해석은 정상인데 HTTP가 비정상: 현상만 적고 원인(CPU·DB 등)은 미확인으로 둔다.
  if (http === 'slow') {
    unknown('cpu_load_unobserved', 'db_state_unobserved', 'network_path_latency_unobserved');
  } else if (http === 'status_mismatch') {
    unknown('cpu_load_unobserved', 'db_state_unobserved', 'application_log_unobserved');
  } else if (http === 'keyword_missing') {
    unknown('content_source_unobserved', 'application_log_unobserved');
  } else {
    unknown('origin_server_state_unobserved', 'network_path_state_unobserved');
  }
  externalCheck('http', 'origin_metrics_needed');
  return diagnosis;
}
