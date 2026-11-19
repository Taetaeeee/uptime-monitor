// B-9 판정 규칙 성능 측정 — 공개 데이터셋 원본을 읽는 순수 함수
//
// 원래 scripts/prepare-datasets/lib.mjs(상태 페이지 재생용 seed를 만들던 스크립트)에 있던 것 중
// 평가(run.mjs·metrics.mjs)가 쓰는 함수만 옮겨 왔습니다. (2026-11-19 재생 기능을 없애면서 데이터 준비 스크립트는 삭제)
// 내용은 바꾸지 않았고, 테스트는 test/evaluate-datasets.test.js에 있습니다.

/** 정렬된 복사본에서 분위수 (q: 0~1, 가장 가까운 순위 방식) */
export function quantile(values, q) {
  if (!values.length) throw new RangeError('값이 없습니다');
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[i];
}

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
