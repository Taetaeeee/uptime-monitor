// 오래 가는 장애 메일 알림 — 판단·문구 순수 함수 (15단계)
//
// 5분마다 Cron이 "지금 상태"를 넘기면, 여기서 어느 서비스에 장애 메일·복구 메일을 보낼지 고릅니다.
// 실제 발송·DB 기록은 escalation-run.js가 하고, 이 파일은 계산만 해서 node --test로 경계 사례를 확인합니다.
//
// 규칙
//   - 단위는 서비스: 묶인 점검 중 하나라도 장애가 열려 있으면 그 서비스는 "장애 구간"
//   - 장애 구간이 첫 실패부터 ESCALATE_AFTER_MIN분 이상이고, 그 구간에 메일을 보낸 적이 없으면 → 장애 메일
//   - 메일을 보낸 구간에서 열린 장애가 모두 없어지면 → 복구 메일
//   - 15분 전에 끝난 짧은 장애는 메일 없이 지금처럼 화면 기록만

import { REASON_TEXT } from './notify.js';

/** 첫 실패부터 이만큼 지나도 장애가 계속되면 메일 (분). 바꾸기 쉽게 상수 하나로 */
export const ESCALATE_AFTER_MIN = 15;

const minutesBetween = (fromIso, toIso) => Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 60000);

/**
 * 보낼 메일 고르기 (순수 함수)
 * @param {object} p
 * @param {Array<{id:number, key:string, name:string, monitorIds:number[]}>} p.services   켜진 서비스와 켜진 점검 id
 * @param {Array<{monitorId:number, monitorName:string, startedAt:string, cause:string|null}>} p.openIncidents  열린 장애
 * @param {Array<{id:number, serviceId:number, startedAt:string}>} p.openEscalations  메일을 보냈고 아직 복구 메일 전인 구간
 * @param {string} p.now   이번 회차 (UTC ISO)
 * @param {number} [p.thresholdMin]
 * @returns {{escalate: Array<object>, resolve: Array<object>}}
 */
export function decideEscalations({ services, openIncidents, openEscalations, now, thresholdMin = ESCALATE_AFTER_MIN }) {
  const escalate = [];
  const resolve = [];
  for (const svc of services) {
    const members = new Set(svc.monitorIds);
    const mine = openIncidents.filter((i) => members.has(i.monitorId));
    const open = openEscalations.find((e) => e.serviceId === svc.id);

    if (mine.length === 0) {
      // 장애가 모두 복구됨 → 메일을 보낸 구간이었다면 복구 메일
      if (open) resolve.push({ escalationId: open.id, service: svc, startedAt: open.startedAt, minutes: minutesBetween(open.startedAt, now) });
      continue;
    }
    if (open) continue; // 이 구간은 이미 메일을 보냄 (반복 알림 없음)

    const startedAt = mine.map((i) => i.startedAt).sort()[0]; // 구간 시작 = 가장 이른 첫 실패
    const minutes = minutesBetween(startedAt, now);
    if (minutes < thresholdMin) continue;
    escalate.push({
      service: svc,
      startedAt,
      minutes,
      // 켜진 점검이 모두 장애면 '장애', 일부만이면 '부분 장애' (서비스 상태 판정과 같은 말)
      state: mine.length >= members.size ? 'down' : 'partial',
      incidents: [...mine].sort((a, b) => a.monitorName.localeCompare(b.monitorName)),
    });
  }
  return { escalate, resolve };
}

// 메일에 쓸 한국 시각 'YYYY-MM-DD HH:MM'
function kst(iso) {
  return new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
}

const serviceLink = (siteUrl, key) => (siteUrl ? `${siteUrl.replace(/\/$/, '')}/service.html?key=${encodeURIComponent(key)}` : null);

/** 장애 메일 제목·본문 (순수 함수). 본문에는 점검 주소를 넣지 않음 (공개 화면과 같은 기준) */
export function buildEscalationMail(item, siteUrl) {
  const stateText = item.state === 'down' ? '장애' : '부분 장애';
  const lines = [
    `${item.service.name} 서비스에 ${item.minutes}분째 ${stateText}가 계속되고 있습니다.`,
    '',
    `시작: ${kst(item.startedAt)} (한국 시간, 첫 실패 기준)`,
    '영향받는 점검:',
    ...item.incidents.map((i) => `  - ${i.monitorName}: ${REASON_TEXT[i.cause] ?? i.cause ?? '원인 미상'} (${kst(i.startedAt)}부터)`),
  ];
  const link = serviceLink(siteUrl, item.service.key);
  if (link) lines.push('', `서비스 상세: ${link}`);
  lines.push('', '복구되면 복구 메일을 한 번 더 보냅니다. (Uptime Monitor, 15분 넘는 장애만 메일로 알림)');
  return { subject: `[Uptime Monitor] ${item.service.name} ${stateText} ${item.minutes}분째`, text: lines.join('\n') };
}

/** 복구 메일 제목·본문 (순수 함수) */
export function buildRecoveryMail(item, now, siteUrl) {
  const lines = [
    `${item.service.name} 서비스가 복구되었습니다.`,
    '',
    `장애 구간: ${kst(item.startedAt)} ~ ${kst(now)} (한국 시간, 약 ${item.minutes}분)`,
  ];
  const link = serviceLink(siteUrl, item.service.key);
  if (link) lines.push('', `서비스 상세·최근 이벤트: ${link}`);
  lines.push('', '사후 보고서는 장애 이력 화면에서 작성 여부를 확인하세요. (Uptime Monitor)');
  return { subject: `[Uptime Monitor] ${item.service.name} 복구 (약 ${item.minutes}분)`, text: lines.join('\n') };
}
