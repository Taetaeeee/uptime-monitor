// 합성 사례용 읽기 전용 조회 도구
//
// 이 도구가 지키는 약속
// 1) 현재 사례(case)의 "허용된 관측"만 돌려준다. 임의 URL·파일·다른 사례/실행/모드에는 접근할 수 없다.
//    도구는 이미 파싱된 객체만 받으므로 파일을 열거나 네트워크로 나갈 능력 자체가 없다.
// 2) 관측 마감(cutoff) 뒤의 관측은 아무 경로로도 보이지 않는다. 마감 뒤 관측을 바꿔도 출력이 같다.
//    (마감 뒤 값을 읽어서 응답 뒤에 자르는 방식이 아니라, 처음부터 보이는 관측만 골라 쓴다.)
// 3) 응답에는 정답·기대 판정·시나리오 이름이 없다. 숨겨진 관측이 몇 개인지도 알려 주지 않는다.
// 4) 증거(evidence)는 이 도구만 발급한다. 발급 장부(ledger)가 보고서 검증의 기준이 된다.
//
// 합성 데이터는 "주입한 가짜 측정"이다. 실제 서비스 점검이 아니며 운영 기록과 이어지지 않는다.

import {
  CHANNELS, MODES, RUN_ID_RE, FORBIDDEN_ARG_NAMES, makeEvidenceId,
  validateObservationCase, findForbiddenKeys,
} from '../lib/case-schema.js';
import { deepClone, isPlainObject, isNonNegInt } from '../lib/util.js';

/** 도구 이름 → 허용 인자 이름. 이 밖의 인자는 모두 invalid_argument. */
export const TOOL_ARGS = Object.freeze({
  dns_lookup: ['target_alias', 'record_type', 'window'],
  http_probe: ['target_alias', 'window'],
  request_additional_observation: ['channel'],
});

const CHANNEL_OF_TOOL = Object.freeze({ dns_lookup: 'doh', http_probe: 'http' });

function fail(tool, errorCode) {
  return { ok: false, tool: typeof tool === 'string' ? tool.slice(0, 64) : null, error_code: errorCode };
}

function hasPathLikeText(value) {
  return typeof value === 'string' && (value.includes('://') || value.includes('..') || value.includes('\\') || value.includes('/'));
}

/**
 * 합성 도구 묶음을 만든다.
 * @param {object} p
 * @param {object} p.caseData 관측 fixture 한 건 (정답이 없는 입력)
 * @param {string} p.runId 이 실행의 id (증거 id에 들어간다)
 * @param {number} [p.availabilityDelaySec=0] 측정 후 조회 가능해지기까지의 지연 d (초).
 *   관측이 "생성된 시각"과 "수집돼 쓸 수 있는 시각"은 다르다. 보이는 조건: observed_at + d ≤ 마감.
 */
export function createSyntheticTools({ caseData, runId, availabilityDelaySec = 0 } = {}) {
  if (!isPlainObject(caseData)) throw new Error('invalid_case');
  if (!MODES.includes(caseData.mode)) throw new Error('mode_not_supported'); // 합성이 아닌 모드는 시작도 못 한다
  const forbidden = findForbiddenKeys(caseData);
  if (forbidden.length > 0) throw new Error(`fixture_contains_forbidden_key:${forbidden[0]}`);
  const checked = validateObservationCase(caseData);
  if (!checked.ok) throw new Error(`invalid_case:${checked.problems.join(',')}`);
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) throw new Error('invalid_run_id');
  if (!isNonNegInt(availabilityDelaySec)) throw new Error('invalid_availability_delay');

  // 원본을 복사해 둔다: 만든 뒤 호출자가 fixture를 바꿔도 이 도구 안에는 영향이 없다.
  const data = deepClone(caseData);
  const d = availabilityDelaySec;
  const cutoff = { ...data.initial_cutoff_rel };
  const issued = new Map();   // obs_key → 발급된 증거
  const ledger = [];          // 발급 순서대로의 증거 장부

  const byChannel = (channel) => data.observations
    .filter((o) => o.channel === channel)
    .sort((a, b) => a.observed_at - b.observed_at || (a.obs_key < b.obs_key ? -1 : 1));
  const isVisible = (o) => o.observed_at + d <= cutoff[o.channel];

  function issue(obs) {
    if (!issued.has(obs.obs_key)) {
      const ev = {
        evidence_id: makeEvidenceId(runId, ledger.length + 1),
        case_id: data.case_id, run_id: runId, mode: data.mode,
        channel: obs.channel, observed_at: obs.observed_at, available_at: obs.observed_at + d,
        facts: deepClone(obs.facts),
      };
      issued.set(obs.obs_key, ev);
      ledger.push(ev);
    }
    return deepClone(issued.get(obs.obs_key));
  }

  function checkWindow(window) {
    if (window === undefined) return { ok: true };
    if (!isPlainObject(window) || Object.keys(window).some((k) => !['from_rel', 'to_rel'].includes(k))
        || !isNonNegInt(window.from_rel) || !isNonNegInt(window.to_rel) || window.from_rel > window.to_rel) {
      return { ok: false };
    }
    return { ok: true };
  }

  function listChecks() {
    return {
      target_alias: data.target_alias,
      channels: [...CHANNELS],
      tools: Object.entries(TOOL_ARGS).map(([name, args]) => ({ name, args: [...args] })),
      cutoff_rel: { ...cutoff },
    };
  }

  function query(tool, args) {
    const channel = CHANNEL_OF_TOOL[tool];
    const { window } = args;
    const recordType = tool === 'dns_lookup' ? (args.record_type ?? 'A') : null;
    if (recordType !== null && !['A', 'AAAA'].includes(recordType)) return fail(tool, 'invalid_argument');
    if (!checkWindow(window).ok) return fail(tool, 'invalid_argument');

    const from = window ? window.from_rel : data.observation_start_rel;
    const to = window ? window.to_rel : Number.MAX_SAFE_INTEGER;
    const evidence = byChannel(channel)
      .filter((o) => isVisible(o) && o.observed_at >= from && o.observed_at <= to)
      .filter((o) => recordType === null || o.facts.record_type === recordType)
      .map(issue);
    // 창이 마감을 넘으면 잘렸다는 사실만 알린다 (잘린 쪽에 무엇이 있는지는 알리지 않는다).
    const clipped = window !== undefined && window.to_rel + d > cutoff[channel];
    return { ok: true, tool, evidence, cutoff_clipped: clipped, cutoff_rel: { ...cutoff } };
  }

  function requestAdditional(args) {
    const tool = 'request_additional_observation';
    if (!CHANNELS.includes(args.channel)) return fail(tool, 'invalid_argument');
    const channel = args.channel;
    const hidden = byChannel(channel).filter((o) => !isVisible(o));
    if (hidden.length === 0) return fail(tool, 'no_more_observations');
    // 새 마감 = 다음 관측의 observed_at + d. 그 관측만 열리고, 그 뒤 관측은 계속 숨는다.
    // 다른 채널의 마감은 건드리지 않는다.
    const before = new Set(byChannel(channel).filter(isVisible).map((o) => o.obs_key));
    cutoff[channel] = hidden[0].observed_at + d;
    const opened = byChannel(channel).filter((o) => isVisible(o) && !before.has(o.obs_key)).map(issue);
    return { ok: true, tool, evidence: opened, cutoff_clipped: false, cutoff_rel: { ...cutoff } };
  }

  /** 도구 호출. 실패는 예외가 아니라 error_code가 있는 결과로 돌려준다. */
  function call(name, args) {
    if (typeof name !== 'string' || !Object.hasOwn(TOOL_ARGS, name)) return fail(name, 'unknown_tool');
    if (!isPlainObject(args)) return fail(name, 'invalid_argument');
    const names = Object.keys(args);
    // 1) 다른 사례·실행·모드·임의 자원을 가리키는 인자는 값과 상관없이 거부한다 (자기 id와 같아도 거부).
    if (names.some((k) => FORBIDDEN_ARG_NAMES.includes(k))) return fail(name, 'forbidden_scope');
    // 2) 정해진 인자 이름만 허용한다.
    if (names.some((k) => !TOOL_ARGS[name].includes(k))) return fail(name, 'invalid_argument');
    // 3) 문자열 값이 URL·경로처럼 생겼으면 거부한다.
    if (Object.values(args).some(hasPathLikeText)) return fail(name, 'forbidden_target');
    if (name === 'request_additional_observation') return requestAdditional(args);
    // 4) 대상 별칭은 이 사례의 것이어야 한다.
    if (typeof args.target_alias !== 'string') return fail(name, 'invalid_argument');
    if (args.target_alias !== data.target_alias) return fail(name, 'forbidden_target');
    return query(name, args);
  }

  return Object.freeze({
    listChecks,
    call,
    ledger: () => deepClone(ledger),
  });
}
