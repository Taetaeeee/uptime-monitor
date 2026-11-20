// 점검 기록 분석 — 순수 함수 (16단계)
//
//   analyzeDay      하루치 원본 → p95 응답 시간 · 시간대별 [전체, 실패, 느림] · 실패 이유별 횟수
//   buildAnalysis   여러 날의 분석 값 → 서비스 상세 화면용 (실패 이유 분포 · 일별 p95 · 요일×시간 열지도)
//
// DB·네트워크를 쓰지 않으므로 node --test로 바로 확인할 수 있습니다.
// 계산 규칙은 daily_stats(summarizeDay)와 맞춥니다: 계획 작업 중 점검은 빼고, 응답 시간은 성공한 점검만.

import { KST_OFFSET_MS, addDays } from './aggregate.js';

export const HOURS_PER_DAY = 24;
export const ANALYSIS_DAYS = [7, 30]; // 화면에서 고를 수 있는 기간
export const BACKFILL_PER_RUN = 6; // Cron 한 회차에 과거 분석 값을 채울 '점검·날짜' 수 (읽기 약 288행 × 6)

// 요일 이름: 월요일부터 (한국 달력 기준). JS의 getUTCDay()는 일요일=0
export const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

/**
 * 백분위수 (nearest-rank 방식): 정렬했을 때 ceil(p% × n)번째 값.
 *   예) 값 20개의 p95 → 19번째로 작은 값. "이 값보다 느린 요청은 5% 이하"라는 뜻
 * 보간(두 값 사이를 나눠 계산)하지 않는 이유: 실제로 관측된 값만 보여 주면 설명이 쉽고,
 * 같은 데이터면 어디서 계산해도 같은 정수가 나와요.
 * @returns {number|null} 값이 없으면 null
 */
export function percentile(values, p) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * xs.length));
  return xs[rank - 1];
}

/** UTC ISO 시각 → 한국 시각의 '시'(0~23) */
export function kstHour(isoUtc) {
  return new Date(Date.parse(isoUtc) + KST_OFFSET_MS).getUTCHours();
}

/** 한국 날짜 'YYYY-MM-DD' → 요일 번호 (0=월 … 6=일) */
export function weekdayIndex(day) {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * 하루치 점검 결과 → 분석 값
 * @param {Array<{checkedAt:string, isSuccess:boolean, isSlow:boolean, responseMs:number|null,
 *                inMaintenance?:boolean, failureReason?:string|null}>} rows
 * @returns {{p95ResponseMs:number|null, hourly:number[][], failures:Object<string,number>}}
 */
export function analyzeDay(rows) {
  const hourly = Array.from({ length: HOURS_PER_DAY }, () => [0, 0, 0]);
  const failures = {};
  const times = [];
  for (const r of rows) {
    if (r.inMaintenance) continue; // 계획 작업 중 점검은 분석에서도 뺌 (가동률과 같은 규칙)
    const cell = hourly[kstHour(r.checkedAt)];
    cell[0] += 1;
    if (!r.isSuccess) {
      cell[1] += 1;
      // 이유가 비어 있는 실패도 '모름'으로 세어서, 실패 횟수 합계가 열지도와 맞게 합니다
      const reason = r.failureReason || 'unknown';
      failures[reason] = (failures[reason] ?? 0) + 1;
    } else {
      if (r.isSlow) cell[2] += 1;
      if (r.responseMs !== null && r.responseMs !== undefined) times.push(r.responseMs);
    }
  }
  return { p95ResponseMs: percentile(times, 95), hourly, failures };
}

/** DB에 저장된 JSON 문자열을 안전하게 읽기 (깨진 값이면 null — 화면이 통째로 죽지 않게) */
export function parseJsonOr(text, fallback = null) {
  if (text === null || text === undefined) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** hourly 값이 24칸 × [전체, 실패, 느림] 숫자 모양인지 */
function isHourly(h) {
  return Array.isArray(h) && h.length === HOURS_PER_DAY && h.every((c) => Array.isArray(c) && c.length === 3 && c.every(Number.isFinite));
}

/**
 * 서비스 상세 화면용 분석 묶음
 *
 * @param {object} p
 * @param {Array<{id:number, name:string, kind:string}>} p.checks  서비스에 묶인 점검
 * @param {Array<{monitorId:number, day:string, avgResponseMs:number|null, p95ResponseMs:number|null,
 *                hourly:number[][]|null, failures:Object|null}>} p.stats  일별 집계 (분석 열 포함)
 * @param {string} p.today  오늘(KST)
 * @param {number} p.days   기간 (7 또는 30)
 * @param {Object<string,string>} p.reasonText  실패 이유 코드 → 화면 문구
 */
export function buildAnalysis({ checks, stats, today, days, reasonText }) {
  const fromDay = addDays(today, -(days - 1));
  const dayList = Array.from({ length: days }, (_, i) => addDays(fromDay, i));
  const ids = new Set(checks.map((c) => c.id));
  const mine = stats.filter((s) => ids.has(s.monitorId) && s.day >= fromDay && s.day <= today);

  // ① 실패 이유 분포: 이유별 합계 + 어느 점검에서 났는지
  const byReason = new Map();
  for (const s of mine) {
    for (const [reason, n] of Object.entries(s.failures ?? {})) {
      if (!Number.isFinite(n) || n <= 0) continue;
      if (!byReason.has(reason)) byReason.set(reason, new Map());
      const per = byReason.get(reason);
      per.set(s.monitorId, (per.get(s.monitorId) ?? 0) + n);
    }
  }
  const nameOf = new Map(checks.map((c) => [c.id, c.name]));
  const failures = [...byReason]
    .map(([reason, per]) => ({
      reason,
      text: reasonText[reason] ?? (reason === 'unknown' ? '원인 기록 없음' : reason),
      total: [...per.values()].reduce((a, b) => a + b, 0),
      byCheck: [...per].map(([id, count]) => ({ id, name: nameOf.get(id), count })).sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.total - a.total || a.reason.localeCompare(b.reason));
  const failureTotal = failures.reduce((a, f) => a + f.total, 0);

  // ② 일별 p95: 점검마다 기간 전체 날짜를 채움 (기록 없는 날은 null → 그래프에서 선을 끊음)
  const series = checks.map((c) => {
    const byDay = new Map(mine.filter((s) => s.monitorId === c.id).map((s) => [s.day, s]));
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      points: dayList.map((day) => ({
        day,
        p95Ms: byDay.get(day)?.p95ResponseMs ?? null,
        avgMs: byDay.get(day)?.avgResponseMs ?? null,
      })),
    };
  });

  // ③ 요일 × 시간 열지도: 서비스에 묶인 점검의 칸을 모두 더함
  const cells = WEEKDAYS.map(() => Array.from({ length: HOURS_PER_DAY }, () => ({ total: 0, fail: 0, slow: 0 })));
  let analyzedDays = 0;
  let pendingDays = 0; // 아직 분석 값을 채우지 못한 '점검·날짜' 수 (Cron이 채우는 중)
  for (const s of mine) {
    if (!isHourly(s.hourly)) {
      pendingDays += 1;
      continue;
    }
    analyzedDays += 1;
    const row = cells[weekdayIndex(s.day)];
    s.hourly.forEach(([t, f, sl], h) => {
      row[h].total += t;
      row[h].fail += f;
      row[h].slow += sl;
    });
  }

  return {
    days,
    from: fromDay,
    to: today,
    failureTotal,
    failures,
    p95: series,
    heatmap: { weekdays: WEEKDAYS, cells },
    coverage: { analyzedDays, pendingDays },
  };
}
