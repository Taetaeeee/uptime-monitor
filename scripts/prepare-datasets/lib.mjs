// 데이터 준비 스크립트용 순수 함수 모음 (B-7c)
//
// 파일 읽기·내려받기는 fetch.mjs / analyze.mjs / build.mjs가 하고,
// "글자를 숫자로 바꾸기, 구간 고르기, SQL 만들기" 같은 계산은 여기에 모아 node --test로 검증합니다.
// (src/replay.js의 순수 함수를 그대로 재사용: 같은 계산을 두 번 쓰지 않으려고)

// ─────────────────────────────────────────────
// 공통
// ─────────────────────────────────────────────

/** 정렬된 복사본에서 분위수 (q: 0~1, 가장 가까운 순위 방식) */
export function quantile(values, q) {
  if (!values.length) throw new RangeError('값이 없습니다');
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[i];
}

/** 소수 자리 줄이기 (SQL 크기와 부동소수점 잡음을 줄이려고) */
export const round = (v, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;

// ─────────────────────────────────────────────
// SMD (Server Machine Dataset)
//   test/machine-X-Y.txt          : 한 줄 = 1분, 38개 지표를 쉼표로 구분 (열 이름·시각 정보 없음)
//   test_label/machine-X-Y.txt    : 한 줄 = 1분, 이상이면 1
//   interpretation_label/…        : "시작-끝:지표번호,지표번호,…" (이상 구간별로 원인이 된 지표, 번호는 1부터로 가정)
// ─────────────────────────────────────────────

/** 숫자 표 읽기. 모든 줄의 열 개수가 같고 숫자여야 합니다 (아니면 데이터가 깨진 것이니 바로 멈춤) */
export function parseSmdRows(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  let cols = null;
  return lines.map((line, i) => {
    const row = line.split(',').map(Number);
    if (cols === null) cols = row.length;
    if (row.length !== cols || row.some((v) => !Number.isFinite(v))) {
      throw new TypeError(`SMD ${i + 1}번째 줄이 올바르지 않습니다`);
    }
    return row;
  });
}

/** 0/1 라벨 읽기 */
export function parseLabelLines(text) {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '').map((l, i) => {
    const v = Number(l);
    if (v !== 0 && v !== 1) throw new TypeError(`라벨 ${i + 1}번째 줄이 0/1이 아닙니다: ${l}`);
    return v;
  });
}

/** "15849-16368:1,9,10" → { start, end, dims:[1,9,10] } (start·end는 0부터 센 줄 번호, 끝 포함) */
export function parseInterpretation(text) {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => {
    const m = /^(\d+)-(\d+):([\d,]+)$/.exec(l.trim());
    if (!m) throw new TypeError(`해석 라벨 형식이 아닙니다: ${l}`);
    return { start: Number(m[1]), end: Number(m[2]), dims: m[3].split(',').map(Number) };
  });
}

/** 라벨 0/1 배열에서 이상 구간 [시작, 끝] 목록 (끝 포함) */
export function segmentsOf(labels) {
  const out = [];
  let s = null;
  labels.forEach((v, i) => {
    if (v === 1 && s === null) s = i;
    if (v !== 1 && s !== null) { out.push([s, i - 1]); s = null; }
  });
  if (s !== null) out.push([s, labels.length - 1]);
  return out;
}

/**
 * windowLen 길이의 창 중에서, 이상 구간이 통째로 가장 많이 들어가는 시작 위치 (동점이면 앞쪽)
 * @returns {{start:number, count:number}}
 */
export function bestWindow(segments, total, windowLen, stride = 60) {
  if (total < windowLen) throw new RangeError('데이터가 창보다 짧습니다');
  let best = null;
  for (let st = 0; st + windowLen <= total; st += stride) {
    const count = segments.filter(([a, b]) => a >= st && b < st + windowLen).length;
    if (!best || count > best.count) best = { start: st, count };
  }
  return best;
}

/** 창 안의 이상 구간에서 원인으로 가장 자주 꼽힌 지표 (지표 번호는 1부터) */
export function topDimensions(interp, window, n = 5) {
  const [from, to] = window; // [포함, 미포함)
  const count = new Map();
  for (const seg of interp) {
    if (seg.start < from || seg.end >= to) continue;
    for (const d of seg.dims) count.set(d, (count.get(d) ?? 0) + 1);
  }
  return [...count.entries()]
    .map(([dim, c]) => ({ dim, count: c }))
    .sort((a, b) => b.count - a.count || a.dim - b.dim)
    .slice(0, n);
}

/**
 * 값이 이상/정상을 얼마나 가르는지 (지표를 고르는 근거)
 *   normalP99: 정상 구간 값의 99% 지점. hitRate: 이상 구간 값 중 normalP99를 넘는 비율.
 *   (이상이 정상의 "가끔 있는 큰 값"보다 뚜렷이 크면 hitRate가 높고, 절대 기준으로도 잡기 쉽다)
 */
export function separation(values, labels, q = 0.99) {
  const normal = [];
  const anomaly = [];
  values.forEach((v, i) => (labels[i] === 1 ? anomaly : normal).push(v));
  if (!normal.length || !anomaly.length) return null;
  const normalCut = quantile(normal, q);
  return {
    normalP50: quantile(normal, 0.5),
    normalP99: normalCut,
    anomalyP50: quantile(anomaly, 0.5),
    anomalyMax: Math.max(...anomaly),
    hitRate: anomaly.filter((v) => v > normalCut).length / anomaly.length,
  };
}

/** 값이 기준(th)을 넘는 칸이 2개 이상 이어진 덩어리들 = "2회 연속 실패"로 장애가 열릴 구간 */
export function runsAbove(values, th, minLen = 2) {
  const runs = [];
  let s = null;
  values.forEach((v, i) => {
    if (v > th && s === null) s = i;
    if (!(v > th) && s !== null) { runs.push([s, i - 1]); s = null; }
  });
  if (s !== null) runs.push([s, values.length - 1]);
  return runs.filter(([a, b]) => b - a + 1 >= minLen);
}

/**
 * 지표(열) 중에서 "이상 구간을 가장 잘 잡으면서 헛경보가 적은" 것을 고른다.
 *   기준 th = 그 창 값의 99% 지점(라벨을 쓰지 않고 값의 분포만으로 정함)
 *   점수 = (장애로 잡힌 이상 구간 수) − (이상 구간과 겹치지 않는 헛경보 수), 동점이면 더 많이 잡은 쪽, 그래도 같으면 번호가 작은 쪽
 * 주의(선택 편향): 이 선택은 라벨을 보고 합니다. 그래서 이 지표로 판정 성능(B-9)을 재면 결과가 낙관적입니다.
 *   B-9는 선택에 쓰지 않은 구간·장비로 평가하고, 이 사실을 문서에 적습니다.
 *
 * @param {number[][]} rows       창 안의 1분 값 (행 = 1분, 열 = 지표)
 * @param {number[]}   labels     같은 길이의 0/1
 * @param {(points:Array)=>Array} reduce  5분 등으로 줄이는 함수 (보통 downsample을 감싼 것)
 * @returns {{dim:number, th:number, detected:number, segments:number, falseRuns:number, series:Array}}
 */
export function pickBestDimension(rows, labels, reduce) {
  const cols = rows[0].length;
  let best = null;
  for (let c = 0; c < cols; c += 1) {
    const series = reduce(rows.map((r, i) => ({ value: r[c], anomaly: labels[i] })));
    const values = series.map((p) => p.value);
    const th = quantile(values, 0.99);
    const segs = segmentsOf(series.map((p) => p.anomaly));
    const bad = runsAbove(values, th);
    const detected = segs.filter(([a, b]) => bad.some(([x, y]) => x <= b && y >= a)).length;
    const falseRuns = bad.filter(([x, y]) => !segs.some(([a, b]) => x <= b && y >= a)).length;
    const score = detected - falseRuns;
    if (!best || score > best.score || (score === best.score && detected > best.detected)) {
      best = { dim: c + 1, th, detected, segments: segs.length, falseRuns, score, series };
    }
  }
  return best;
}

// ─────────────────────────────────────────────
// NAB (Numenta Anomaly Benchmark)
//   data/realKnownCause/machine_temperature_system_failure.csv : "timestamp,value" (5분 간격)
//   labels/combined_windows.json : { "파일키": [[시작, 끝], …] } 이상 "창"
// ─────────────────────────────────────────────

const NAB_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;

/** @returns {Array<{ts:string, value:number}>}  ts는 'YYYY-MM-DD HH:MM:SS' */
export function parseNabCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines[0].trim() !== 'timestamp,value') throw new TypeError('NAB 머리줄이 timestamp,value가 아닙니다');
  return lines.slice(1).map((l, i) => {
    const [ts, v] = l.split(',');
    const value = Number(v);
    if (!NAB_TS.test(ts) || !Number.isFinite(value)) throw new TypeError(`NAB ${i + 2}번째 줄이 올바르지 않습니다`);
    return { ts: ts.slice(0, 19), value };
  });
}

/** 라벨 창 읽기: 시각 문자열을 'YYYY-MM-DD HH:MM:SS'까지만 남깁니다 */
export function parseNabWindows(json, fileKey) {
  const w = json[fileKey];
  if (!w) throw new RangeError(`라벨에 ${fileKey}가 없습니다`);
  return w.map(([a, b]) => [a.slice(0, 19), b.slice(0, 19)]);
}

/** 각 점에 anomaly(0/1)를 붙임: 창 안(양 끝 포함)이면 1 */
export function labelByWindows(points, windows) {
  return points.map((p) => ({
    ...p,
    anomaly: windows.some(([a, b]) => p.ts >= a && p.ts <= b) ? 1 : 0,
  }));
}

/** 고른 창들을 모두 포함하고 앞뒤로 pad개씩 여유를 둔 구간 [시작 인덱스, 끝 인덱스(포함)] */
export function windowAround(points, windows, padPoints = 0) {
  const a = windows[0][0];
  const b = windows[windows.length - 1][1];
  const first = points.findIndex((p) => p.ts >= a);
  let last = -1;
  points.forEach((p, i) => { if (p.ts <= b) last = i; });
  if (first < 0 || last < first) throw new RangeError('창에 해당하는 점이 없습니다');
  return [Math.max(0, first - padPoints), Math.min(points.length - 1, last + padPoints)];
}

// ─────────────────────────────────────────────
// Backblaze Drive Stats (하루 1개 CSV, 드라이브 1대 = 1줄)
// ─────────────────────────────────────────────

/** 쉼표 구분 한 줄 읽기 (따옴표로 감싼 칸 지원) */
export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** 'YYYY-MM-DD'에 일수를 더한다 (UTC 기준, 시간대 영향 없음) */
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * 같은 모델의 드라이브 묶음을 고른다: 고장 난 것 nFailed대 + 기간 내내 살아 있는 정상 nHealthy대
 * @param {Array<{serial,model,date}>} failures  고장 기록
 * @param {Map<string,{model:string, first:string, last:string}>} seen  드라이브별 처음·마지막으로 보인 날
 * @returns {{model, start, days, failed:string[], healthy:string[]} | null}
 */
export function chooseDiskGroup(failures, seen, { days = 60, nFailed = 2, nHealthy = 6 } = {}) {
  const failedSerials = new Set(failures.map((f) => f.serial));
  const models = [...new Set(failures.map((f) => f.model))].sort();
  for (const model of models) {
    const fs = failures.filter((f) => f.model === model).sort((a, b) => a.date.localeCompare(b.date) || a.serial.localeCompare(b.serial));
    for (let i = 0; i + nFailed <= fs.length; i += 1) {
      const group = fs.slice(i, i + nFailed);
      const first = group[0].date;
      const lastFail = group[group.length - 1].date;
      // 고장 날짜들이 창(days) 안에 들어와야 하고, 첫 고장 전에 여유(7일)를 둔다
      const start = addDays(first, -7);
      const end = addDays(start, days - 1);
      if (lastFail > end) continue;
      const healthy = [...seen.entries()]
        .filter(([serial, s]) => s.model === model && !failedSerials.has(serial) && s.first <= start && s.last >= end)
        .map(([serial]) => serial)
        .sort()
        .slice(0, nHealthy);
      if (healthy.length === nHealthy) {
        return { model, start, days, failed: group.map((g) => g.serial), healthy };
      }
    }
  }
  return null;
}

/**
 * 날짜별 값 만들기
 *   value  = 그날 보인 드라이브들의 불량 섹터(smart_5_raw) 합계
 *   failed = 그날 고장 기록이 있는 드라이브가 있으면 1
 * @param {Map<string, Array<{serial, smart5, failure}>>} rowsByDate
 */
export function dailyDiskSeries(rowsByDate, dates) {
  return dates.map((date) => {
    const rows = rowsByDate.get(date) ?? [];
    return {
      value: rows.reduce((sum, r) => sum + (Number.isFinite(r.smart5) ? r.smart5 : 0), 0),
      anomaly: rows.some((r) => r.failure === 1) ? 1 : 0,
    };
  });
}

// ─────────────────────────────────────────────
// SQL 만들기
//   입력값이 SQL에 그대로 들어가므로 따옴표를 이스케이프합니다 (이 스크립트의 입력은 공개 데이터셋이지만,
//   "문자열을 SQL에 넣을 때는 항상 이스케이프한다"는 습관을 지키기 위해서입니다)
// ─────────────────────────────────────────────

export function sqlString(s) {
  if (typeof s !== 'string') throw new TypeError('문자열이 아닙니다');
  if (s.includes('\0')) throw new TypeError('NUL 문자는 넣을 수 없습니다');
  return `'${s.replace(/'/g, "''")}'`;
}

export function sqlNumber(n) {
  if (!Number.isFinite(n)) throw new TypeError(`숫자가 아닙니다: ${n}`);
  return String(n);
}

/** 데이터셋 메타 → INSERT … ON CONFLICT(key) DO UPDATE (다시 실행해도 같은 결과) */
export function buildDatasetsSql(datasets) {
  const kinds = new Set(['real_replay', 'lab']);
  return datasets.map((d) => {
    if (!kinds.has(d.kind)) throw new RangeError(`구분이 올바르지 않습니다: ${d.kind}`);
    return [
      'INSERT INTO datasets (key, name, url, license, processing, kind, citation)',
      `VALUES (${sqlString(d.key)}, ${sqlString(d.name)}, ${sqlString(d.url)}, ${sqlString(d.license)}, ${sqlString(d.processing)}, ${sqlString(d.kind)}, ${d.citation ? sqlString(d.citation) : 'NULL'})`,
      'ON CONFLICT(key) DO UPDATE SET name = excluded.name, url = excluded.url, license = excluded.license,',
      '  processing = excluded.processing, kind = excluded.kind, citation = excluded.citation;',
    ].join('\n');
  }).join('\n\n') + '\n';
}

/**
 * 재생 시계열 SQL
 *   대상(monitors)은 check_key로 찾습니다. 기존 줄을 지우고 다시 넣으므로 여러 번 실행해도 같은 결과입니다.
 *   한 문장이 너무 길어지지 않게 chunk행씩 나눕니다 (D1의 문장 길이 제한은 공식 문서에서 확인할 부분).
 * @param {Array<{value:number, anomaly:(0|1|null)}>} points  순번 0부터
 */
export function buildSeriesSql(checkKey, points, { chunk = 400 } = {}) {
  const key = sqlString(checkKey);
  const out = [`DELETE FROM replay_series WHERE monitor_id = (SELECT id FROM monitors WHERE check_key = ${key});`];
  for (let i = 0; i < points.length; i += chunk) {
    const values = points.slice(i, i + chunk).map((p, j) => {
      const label = p.anomaly === null || p.anomaly === undefined ? 'NULL' : sqlNumber(p.anomaly);
      return `(${i + j}, ${sqlNumber(round(p.value))}, ${label})`;
    });
    out.push(
      'INSERT INTO replay_series (monitor_id, seq, value, is_anomaly)',
      `SELECT id, column1, column2, column3 FROM monitors, (VALUES ${values.join(', ')}) WHERE check_key = ${key};`
    );
  }
  return out.join('\n') + '\n';
}
