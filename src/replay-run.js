// 공개 데이터셋 재생 실행 (B-7d) — Cron이 5분마다 호출
//
//   재생 대상 조회 → 지금 순번 계산 → 값 읽기 → 판정 → 기존 기록 경로(record.js)로 저장
//
// 실제 점검(HTTP·DNS)과 같은 record.js를 쓰므로 장애 판정(연속 2회 실패)·알림·장애 이력·일별 집계를
// 똑같이 받습니다. 다른 점은 출처가 'replay'라는 것, 그리고 값을 네트워크가 아니라 D1의 replay_series에서 읽는 것뿐입니다.
//
// 이 파일의 planReplay·parseRule은 순수 함수(시계·DB를 건드리지 않음)라 node --test로 검증합니다.

import { toCheckSlot } from './time.js';
import { getReplayMonitors, getReplayValue } from './db.js';
import { recordResults } from './record.js';
import { replayIndex, buildReplayRow } from './replay.js';

const RULE_TYPES = ['high', 'deviation', 'ratio', 'smart'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * 저장된 판정 규칙(JSON 글자)을 읽어 검사한다. 모양이 잘못되면 던진다.
 *   DB에 잘못된 규칙이 들어가도 그 대상 하나만 건너뛰고 나머지 재생은 계속되게 하려고,
 *   쓰기 전에 여기서 걸러 냅니다. (CHECK 제약 대신 코드로 검사하는 이유는 0009 주석 참고)
 */
export function parseRule(text) {
  let rule;
  try {
    rule = JSON.parse(text);
  } catch {
    throw new SyntaxError('판정 규칙이 JSON이 아닙니다');
  }
  if (!rule || !RULE_TYPES.includes(rule.type)) throw new RangeError(`알 수 없는 규칙 종류: ${rule?.type}`);
  const need = { high: ['slowAt', 'failAt'], deviation: ['slowPct', 'failPct'], ratio: ['slowX', 'failX'], smart: [] }[rule.type];
  for (const k of need) {
    if (!isNum(rule[k])) throw new RangeError(`${rule.type} 규칙에 숫자 ${k}가 필요합니다`);
  }
  return rule;
}

/**
 * 이번 회차에 대상별로 몇 번째 값을 보여 줄지 (순수 함수)
 * @param {Array<{monitorId:number, length:number, stepMinutes:number, anchorAt:string}>} configs
 * @param {Date} runTime  Cron 실행 시각 (5분 회차로 내려서 계산)
 * @returns {Array<{monitorId:number, seq:number}>}
 */
export function planReplay(configs, runTime) {
  const slotMs = Date.parse(toCheckSlot(runTime));
  return configs.map((c) => ({
    monitorId: c.monitorId,
    seq: replayIndex(slotMs, Date.parse(c.anchorAt), c.length, c.stepMinutes),
  }));
}

/**
 * 재생 1회분: 활성 재생 대상을 모두 읽고 판정해 기록한다.
 * @param {object} db
 * @param {Date}   runTime
 * @param {object} [deps]
 * @param {Array}  [deps.channels]  알림 채널 (테스트용)
 * @returns 기록한 행들
 */
export async function runReplay(db, runTime, deps = {}) {
  const configs = await getReplayMonitors(db);
  const checkedAt = toCheckSlot(runTime);
  const label = `재생 ${checkedAt}`;
  if (configs.length === 0) return []; // 재생 대상이 없으면 아무 것도 하지 않음 (로그도 남기지 않아 5분마다 소음이 되지 않게)

  const plan = planReplay(configs, runTime);
  const rows = [];
  const monitors = [];

  // 대상마다 따로 처리: 한 대상의 규칙·값에 문제가 있어도 나머지는 계속합니다
  for (const c of configs) {
    try {
      const rule = parseRule(c.rule);
      const { seq } = plan.find((p) => p.monitorId === c.monitorId);
      const point = await getReplayValue(db, c.monitorId, seq);
      if (!point) throw new RangeError(`순번 ${seq}의 값이 없습니다 (시계열이 적재됐는지 확인)`);

      rows.push(
        buildReplayRow({
          monitorId: c.monitorId,
          checkedAt,
          value: point.value,
          rule,
          baseline: c.baseline ?? undefined,
          // 디스크는 데이터가 직접 기록한 "고장 표시"만 판정에 씁니다. 다른 규칙은 라벨을 쓰지 않습니다.
          failed: rule.type === 'smart' && point.isAnomaly === 1,
        })
      );
      monitors.push({ id: c.monitorId, name: c.name });
    } catch (err) {
      console.error(`[재생 건너뜀] ${c.name}:`, err.message);
    }
  }
  if (rows.length === 0) return [];

  await recordResults(db, { monitors, rows, checkedAt, source: 'replay', label, channels: deps.channels });
  return rows;
}
