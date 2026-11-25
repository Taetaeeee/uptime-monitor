// 주간 서비스 점검 보고서 계산 — 순수 함수 (20단계)
//
// 서비스 하나의 "지난 한 주(월~일, 한국 시간)"를 요약합니다. 서비스 소유자에게 전달할 용도라서
// 숫자를 많이 늘어놓지 않고 "이상 없음 / 주의 / 장애 있었음" 한 줄 판정을 맨 위에 둡니다.
//
// 입력은 이미 있는 일별 집계(service_daily_stats·daily_stats)와 장애·첫 화면 변경 기록이고,
// 새 테이블은 만들지 않습니다. 월간 보고서(report.js)처럼 볼 때마다 계산해서
// 저장된 숫자와 원본이 어긋날 일이 없게 했어요. DB·네트워크를 쓰지 않으므로 node --test로 확인합니다.

import { KST_OFFSET_MS, addDays, kstDayRange, overallUptime, toKstDay } from './aggregate.js';
import { weekdayIndex } from './analysis.js';
import { clipMinutes } from './report.js';
import { incidentMetrics } from './incident.js';
import { toDailyShape } from './service-status.js';
import { toIsoSeconds } from './time.js';

// ── 판정 기준 (초안 값: 실제 몇 주 데이터를 본 뒤 조정합니다) ──
export const SLOWDOWN_PERCENT = 30;        // 평균 응답이 전주보다 이만큼(%) 이상 늘면 '느려짐' 후보
export const SLOWDOWN_MIN_MS = 100;        // ...그리고 늘어난 양이 이 값(ms) 이상일 때만 (50ms→70ms 같은 잡음 제외)
export const MIN_TREND_SAMPLES = 500;      // 비교하려면 이번 주·전주 모두 성공 점검이 이만큼은 있어야 함 (5분 간격으로 약 이틀 치)
export const SLOW_SLOT_WATCH_RATIO = 0.05; // 느린 회차가 전체의 5% 이상이면 '주의'
export const NOISY_CHANGES_PER_WEEK = 14;  // 첫 화면이 이만큼 이상 바뀌면 '배포가 잦거나 동적 내용일 수 있음'을 안내 (24단계: 동적 내용이라고 단정하지 않음)
export const CHANGE_LIST_LIMIT = 10;       // 보고서에 시각을 적어 줄 변경 수
export const WEEK_CHOICES = 8;             // 화면의 주 선택 목록 길이

export const VERDICT = { QUIET: 'quiet', WATCH: 'watch', INCIDENT: 'incident', NODATA: 'nodata' };
export const VERDICT_TEXT = {
  quiet: '이상 없음',
  watch: '주의',
  incident: '장애 있었음',
  nodata: '기록 없음',
};

const DAY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────
// 주(week) 계산: 월요일 시작, 한국 날짜 기준
// ─────────────────────────────────────────────

/** 'YYYY-MM-DD' 모양이고 실제로 있는 날짜이며 월요일인가? (주 시작 날짜 검사) */
export function isWeekStart(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  // 2026-02-30처럼 존재하지 않는 날짜는 Date가 3월로 넘기므로, 되돌려 읽어 같은지 확인
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) return false;
  return weekdayIndex(day) === 0;
}

/** 한국 날짜가 속한 주의 월요일 */
export function weekStartOf(day) {
  return addDays(day, -weekdayIndex(day));
}

/** 지금(한국 시간)이 속한 주의 월요일 — 진행 중인 주 */
export function thisWeekStart(now) {
  return weekStartOf(toKstDay(toIsoSeconds(now)));
}

/** 방금 끝난 주의 월요일 — 주소에 주를 안 적었을 때 보여 줄 기본 주 */
export function lastCompleteWeekStart(now) {
  return addDays(thisWeekStart(now), -7);
}

/** 화면의 주 선택 목록: 진행 중인 주부터 최근 순으로 count개 */
export function recentWeekStarts(now, count = WEEK_CHOICES) {
  const first = thisWeekStart(now);
  return Array.from({ length: count }, (_, i) => addDays(first, -7 * i));
}

/**
 * 한 주의 범위. UTC 범위는 [startUtc, endUtc) — 끝은 포함하지 않음 (다음 주 월요일 0시 KST)
 * 전주 범위(prev*)는 "전주 대비" 비교용입니다.
 */
export function weekRange(startDay) {
  const endDay = addDays(startDay, 6);
  return {
    startDay,
    endDay,
    prevStartDay: addDays(startDay, -7),
    prevEndDay: addDays(startDay, -1),
    startUtc: kstDayRange(startDay).startUtc,
    endUtc: kstDayRange(endDay).endUtc,
  };
}

/** 이 주에서 오늘(포함)까지 지난 날 수 (0~7). 끝난 주는 7, 아직 시작 전이면 0 */
function elapsedDays(range, today) {
  if (today >= range.endDay) return 7;
  if (today < range.startDay) return 0;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${range.startDay}T00:00:00Z`)) / DAY_MS) + 1;
}

// ─────────────────────────────────────────────
// 요약
// ─────────────────────────────────────────────

const inDays = (s, from, to) => s.day >= from && s.day <= to;

/** 일별 평균을 그날 성공 점검 수로 가중해 합침 (report.js와 같은 방식: 점검이 적은 날이 과하게 반영되지 않게) */
function weightedAvg(stats) {
  const used = stats.filter((s) => s.avgResponseMs !== null && s.avgResponseMs !== undefined && s.successChecks > 0);
  const samples = used.reduce((a, s) => a + s.successChecks, 0);
  if (!samples) return { avgMs: null, samples: 0 };
  return { avgMs: Math.round(used.reduce((a, s) => a + s.avgResponseMs * s.successChecks, 0) / samples), samples };
}

/** 점검 하나의 응답 시간 요약 (이번 주 vs 전주) */
function summarizeCheck(check, range) {
  const cur = check.stats.filter((s) => inDays(s, range.startDay, range.endDay));
  const prev = check.stats.filter((s) => inDays(s, range.prevStartDay, range.prevEndDay));
  const a = weightedAvg(cur);
  const p = weightedAvg(prev);

  // 일별 p95 중 가장 느린 날. 일별 p95를 합쳐 주간 p95를 정확히 만들 수는 없어서(원본이 아닌 요약이므로) 이렇게 표기합니다.
  const p95s = cur.map((s) => s.p95ResponseMs).filter((v) => Number.isFinite(v));

  const trendReliable = a.samples >= MIN_TREND_SAMPLES && p.samples >= MIN_TREND_SAMPLES;
  const bothAvg = a.avgMs !== null && p.avgMs !== null && p.avgMs > 0;
  const changePercent = bothAvg ? Math.round(((a.avgMs - p.avgMs) / p.avgMs) * 100) : null;
  const slower =
    trendReliable && changePercent !== null && changePercent >= SLOWDOWN_PERCENT && a.avgMs - p.avgMs >= SLOWDOWN_MIN_MS;

  return {
    id: check.id,
    name: check.name,
    kind: check.kind,
    avgResponseMs: a.avgMs,
    prevAvgResponseMs: p.avgMs,
    changePercent,
    p95WorstMs: p95s.length ? Math.max(...p95s) : null,
    samples: a.samples,
    trendReliable,
    slower,
  };
}

/**
 * 장애 구간을 합쳐 "서비스가 영향받은 시간(분)"을 센다.
 * 같은 회차에 HTTP와 DNS가 함께 실패하면 점검 장애는 2건이지만 사용자가 겪은 시간은 한 번뿐이라,
 * 겹치는 구간은 하나로 합쳐서 셉니다 (서비스 가동률을 '회차' 기준으로 세는 것과 같은 이유).
 */
function unionMinutes(incidents, range, now) {
  const spans = incidents
    .map((i) => [
      Math.max(Date.parse(i.startedAt), Date.parse(range.startUtc)),
      Math.min(i.resolvedAt ? Date.parse(i.resolvedAt) : now.getTime(), Date.parse(range.endUtc)),
    ])
    .filter(([s, e]) => e > s)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curStart = null;
  let curEnd = null;
  for (const [s, e] of spans) {
    if (curEnd === null || s > curEnd) {
      if (curEnd !== null) total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else {
      curEnd = Math.max(curEnd, e);
    }
  }
  if (curEnd !== null) total += curEnd - curStart;
  return Math.round(total / 60000);
}

/**
 * 서비스 1개의 주간 요약.
 *
 * @param {object} p
 * @param {object} p.range      weekRange() 결과
 * @param {string} p.today      오늘(KST) 'YYYY-MM-DD'
 * @param {Date}   p.now
 * @param {Array<{day:string,totalSlots:number,upSlots:number,slowSlots:number}>} p.slots
 *        이 서비스의 일별 회차 집계 (전주 포함 14일)
 * @param {Array<{id:number,name:string,kind:string,
 *        stats:Array<{day:string,successChecks:number,avgResponseMs:number|null,p95ResponseMs:number|null}>}>} p.checks
 *        서비스에 묶인 점검과 그 점검의 일별 집계 (전주 포함 14일)
 * @param {Array<{id:number,monitorName?:string,startedAt:string,detectedAt:string,resolvedAt:string|null,cause?:string|null}>} p.incidents
 *        이 주에 걸친 장애 (이 서비스의 점검 것만)
 * @param {Array<{firstSeenAt:string,monitorName?:string}>} p.changes  이 주의 첫 화면 변경 (오래된 순)
 */
export function summarizeWeek({ range, today, now, slots, checks, incidents, changes }) {
  const thisSlots = slots.filter((s) => inDays(s, range.startDay, range.endDay));
  const prevSlots = slots.filter((s) => inDays(s, range.prevStartDay, range.prevEndDay));

  const uptime = overallUptime(thisSlots.map(toDailyShape));
  const prevUptime = overallUptime(prevSlots.map(toDailyShape));
  const uptimeDelta = uptime !== null && prevUptime !== null ? Math.round((uptime - prevUptime) * 100) / 100 : null;

  const totalSlots = thisSlots.reduce((a, s) => a + s.totalSlots, 0);
  const upSlots = thisSlots.reduce((a, s) => a + s.upSlots, 0);
  const slowSlots = thisSlots.reduce((a, s) => a + s.slowSlots, 0);

  const expectedDays = elapsedDays(range, today);
  const coverageDays = thisSlots.filter((s) => s.totalSlots > 0).length;

  // 장애: 건수는 점검 단위 기록 수, 시간은 겹침을 합친 분
  const metrics = incidents
    .map((i) => ({
      id: i.id,
      monitorName: i.monitorName ?? null,
      startedAt: i.startedAt,
      resolvedAt: i.resolvedAt ?? null,
      cause: i.cause ?? null,
      minutes: clipMinutes(i, range.startUtc, range.endUtc, now),
      ongoing: incidentMetrics(i, now).ongoing,
    }))
    .sort((x, y) => (x.startedAt < y.startedAt ? -1 : x.startedAt > y.startedAt ? 1 : x.id - y.id));
  const longest = metrics.reduce((best, m) => (!best || m.minutes > best.minutes ? { id: m.id, minutes: m.minutes } : best), null);

  const checkViews = checks.map((c) => summarizeCheck(c, range));
  const changeCount = changes.length;

  // 판정: 장애 > 기록 없음 > 주의 > 이상 없음.
  //   - 장애 기록은 그 자체로 증거라서, 집계 행이 아직 없어도 '장애 있었음'을 먼저 봅니다.
  //   - 기록이 없을 때 '이상 없음'으로 보이면 안 되므로 따로 '기록 없음'
  let verdict;
  if (metrics.length > 0) verdict = VERDICT.INCIDENT;
  else if (totalSlots === 0) verdict = VERDICT.NODATA;
  else if (checkViews.some((c) => c.slower) || slowSlots / totalSlots >= SLOW_SLOT_WATCH_RATIO) verdict = VERDICT.WATCH;
  else verdict = VERDICT.QUIET;

  // 읽는 사람이 숫자를 오해하지 않게 하는 안내
  const notes = [];
  if (today <= range.endDay && expectedDays > 0) notes.push('진행 중인 주라 숫자가 계속 바뀝니다.');
  if (totalSlots > 0 && coverageDays < expectedDays) {
    notes.push(`이번 주 측정 기록이 ${coverageDays}/${expectedDays}일뿐이라 가동률과 전주 비교가 실제와 다를 수 있습니다.`);
  }
  if (totalSlots > 0 && prevUptime === null) notes.push('전주 기록이 없어 전주와 비교하지 않았습니다.');
  if (changeCount >= NOISY_CHANGES_PER_WEEK) {
    // 빌드할 때마다 파일 이름(해시)이 바뀌는 서비스는 배포가 잦기만 해도 자주 바뀐 것으로 보이므로 둘 다 적음 (24단계)
    notes.push('첫 화면이 자주 바뀌었습니다. 배포가 잦았거나(빌드할 때마다 첫 화면의 파일 이름이 바뀜) 시각·광고 같은 동적 내용이 있어서일 수 있습니다.');
  }

  return {
    period: {
      startDay: range.startDay,
      endDay: range.endDay,
      prevStartDay: range.prevStartDay,
      expectedDays,
      coverageDays,
      inProgress: today <= range.endDay,
    },
    verdict,
    verdictText: VERDICT_TEXT[verdict],
    uptime,
    prevUptime,
    uptimeDelta,
    totalSlots,
    failedSlots: totalSlots - upSlots,
    slowSlots,
    incidentCount: metrics.length,
    ongoingIncidents: metrics.filter((m) => m.ongoing).length,
    incidentMinutes: unionMinutes(incidents, range, now),
    longestIncident: longest,
    incidents: metrics,
    checks: checkViews,
    changeCount,
    changes: changes.slice(-CHANGE_LIST_LIMIT).map((c) => ({ firstSeenAt: c.firstSeenAt, monitorName: c.monitorName ?? null })),
    notes,
  };
}

// ─────────────────────────────────────────────
// 복사용 텍스트
// ─────────────────────────────────────────────

const pct = (v) => (v === null || v === undefined ? '-' : `${v}%`);

/** 분 → "1시간 5분" / "15분" (화면의 formatMinutes와 같은 모양) */
export function minutesText(min) {
  if (min === null || min === undefined) return '-';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

/** UTC ISO → 한국 시각 'M/D HH:mm' */
export function kstStamp(iso) {
  const d = new Date(Date.parse(iso) + KST_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`;
}

const signed = (n, unit) => `${n > 0 ? '+' : ''}${n}${unit}`;

/**
 * 메신저·메일에 붙여 넣을 수 있는 한국어 텍스트.
 * 소유자 이름·연락처, 점검 주소(url)는 넣지 않습니다. (공개 화면과 같은 원칙)
 * @param {string} serviceName
 * @param {object} summary  summarizeWeek() 결과
 * @param {string|null} [link]  이 보고서 화면 주소 (없으면 줄을 뺌)
 */
export function renderWeeklyText(serviceName, summary, link = null) {
  const s = summary;
  const lines = [];
  lines.push(`[주간 점검 보고] ${serviceName} · ${s.period.startDay} ~ ${s.period.endDay} (월~일, 한국 시간)`);
  lines.push(`판정: ${s.verdictText}`);

  if (s.verdict === VERDICT.NODATA) {
    lines.push('- 이 기간의 점검 기록이 없습니다.');
  } else {
    const prev =
      s.prevUptime === null
        ? '전주 기록 없음'
        : `전주 ${pct(s.prevUptime)}${s.uptimeDelta === null ? '' : `, ${signed(s.uptimeDelta, '%p')}`}`;
    lines.push(`- 가동률: ${pct(s.uptime)} (${prev})`);

    if (s.incidentCount === 0) {
      lines.push('- 장애: 없음');
    } else {
      const ongoing = s.ongoingIncidents ? `, 진행 중 ${s.ongoingIncidents}건` : '';
      const longest = s.longestIncident ? `, 가장 긴 장애 #${s.longestIncident.id} ${minutesText(s.longestIncident.minutes)}` : '';
      lines.push(`- 장애: ${s.incidentCount}건, 영향 시간 ${minutesText(s.incidentMinutes)}${longest}${ongoing}`);
    }

    for (const c of s.checks) {
      if (c.avgResponseMs === null) continue;
      const cmp =
        c.prevAvgResponseMs === null
          ? '전주 기록 없음'
          : `전주 ${c.prevAvgResponseMs}ms${c.changePercent === null ? '' : `, ${signed(c.changePercent, '%')}`}`;
      const worst = c.p95WorstMs === null ? '' : ` · 가장 느린 날 p95 ${c.p95WorstMs}ms`;
      lines.push(`- 응답 시간(${c.name}): 평균 ${c.avgResponseMs}ms (${cmp})${worst}${c.slower ? ' ← 느려짐' : ''}`);
    }

    if (s.changeCount === 0) {
      lines.push('- 배포 추정(첫 화면 변경): 없음');
    } else {
      const when = s.changes.map((c) => kstStamp(c.firstSeenAt)).join(', ');
      lines.push(`- 배포 추정(첫 화면 변경): ${s.changeCount}회 (${when}${s.changeCount > s.changes.length ? ' …' : ''})`);
    }
    lines.push(`- 측정 기간: ${s.period.coverageDays}/${s.period.expectedDays}일`);
  }

  for (const n of s.notes) lines.push(`※ ${n}`);
  if (link) lines.push(`자세히: ${link}`);
  return lines.join('\n');
}
