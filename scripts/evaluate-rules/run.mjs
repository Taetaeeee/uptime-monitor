// B-9 판정 규칙 성능 측정 실행 스크립트
//
// 사용 (프로젝트 폴더에서):
//   node scripts/evaluate-rules/run.mjs [--raw <폴더>]
//   먼저 node scripts/evaluate-rules/fetch-heldout.mjs 로 검증용 원본을 받아 둡니다.
//   결과: docs/evaluation/results.md (표), docs/evaluation/results.json (원자료)
//
// 무엇을 하나
//   라벨(정답)이 있는 공개 데이터에 운영의 판정 함수(src/replay.js judgeReplay)와
//   "연속 N회 실패 → 장애" 규칙을 적용해, 알림이 언제 울렸는지를 라벨과 비교합니다.
//   운영 코드·DB는 건드리지 않고 파일만 읽습니다.
//
// 선택 편향을 피하는 방법
//   - 공식 결과는 "임계값·지표 선정에 쓰지 않은" 데이터에서만 냅니다:
//       SMD machine-1-2, 2-2, 3-2 (상태 페이지에 쓴 1-1, 2-1, 3-1과 다른 서버)
//       NAB 파일 3개 (상태 페이지에 쓴 machine_temperature와 다른 파일)
//   - SMD는 지표(38개)를 라벨을 보고 고르지 않고 "전부" 평가해 합칩니다.
//   - 시계열마다 앞 30%로 임계값·기준선을 정하고(라벨 안 씀), 뒤 70%로만 점수를 냅니다.
//   - 참고로 "라벨을 보고 지표를 고른 경우"를 따로 계산해서, 선택이 점수를 얼마나 부풀리는지 보여 줍니다.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSmdRows, parseLabelLines, parseInterpretation, segmentsOf, quantile,
  parseNabCsv, parseNabWindows, labelByWindows,
} from '../prepare-datasets/lib.mjs';
import { downsample, judgeReplay, baselineOf } from '../../src/replay.js';
import { alarmsFromFlags, scoreAlarms, mergeScores, summarize } from './metrics.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argRaw = process.argv.indexOf('--raw');
const RAW = argRaw > 0 ? resolve(process.argv[argRaw + 1]) : resolve(ROOT, '..', 'uptime-monitor-data', 'raw');
const OUT_DIR = join(ROOT, 'docs', 'evaluation');

// ── 실험 설정 (결과 문서에도 그대로 적힙니다) ──
const CALIB = 0.3;                 // 앞 30%로 임계값을 정함
const TOLERANCE_MIN = 15;          // 라벨 경계 허용 15분 (최소 1칸)
const NS = [1, 2, 3];              // 연속 실패 횟수
const QUANTILES = [0.95, 0.97, 0.98, 0.99, 0.995, 0.999];
const DEVIATIONS = [10, 20, 30, 50];
const PRODUCTION = { n: 2, q: 0.99 }; // 운영과 같은 방식: 값의 99% 지점 + 연속 2회

const SMD_HELDOUT = ['1-2', '2-2', '3-2'];
const NAB_HELDOUT = ['ambient_temperature_system_failure', 'cpu_utilization_asg_misconfiguration', 'ec2_request_latency_system_failure'];
const NAB_INSAMPLE = ['machine_temperature_system_failure'];

// ─────────────────────────────────────────────
// 규칙 만들기·적용
// ─────────────────────────────────────────────

/**
 * 앞부분(calib) 값만 보고 규칙을 만든다 — 라벨은 쓰지 않음 (운영이 임계값을 정하는 방식과 같음)
 * 구분 짓지 못하는 시계열(값이 거의 상수)은 null: 임계값이 중앙값과 같으면 평소에도 계속 "실패"라서 비교가 무의미함
 */
function buildRule(spec, calib) {
  if (spec.type === 'high') {
    const failAt = quantile(calib, spec.q);
    if (failAt <= quantile(calib, 0.5)) return null;
    return { rule: { type: 'high', slowAt: failAt, failAt }, baseline: undefined };
  }
  const baseline = baselineOf(calib);
  if (baseline === 0) return null;
  return { rule: { type: 'deviation', slowPct: spec.pct, failPct: spec.pct }, baseline };
}

/**
 * 시계열 하나에 규칙 spec과 연속 횟수 n을 적용해 점수를 낸다 (적용 불가면 null)
 *   점검 간격이 5분이 아닌 파일(NAB ambient는 60분)도 있어서, 허용 범위·지연·일수는 "분" 기준으로 맞춥니다.
 *   점수의 delays와 slots를 분 단위로 바꿔 돌려주므로, 합친 뒤에는 summarize(점수, 1)로 읽습니다.
 */
function evaluate(series, spec, n) {
  const step = series.stepMinutes ?? 5;
  const calibEnd = Math.floor(series.values.length * CALIB);
  const built = buildRule(spec, series.values.slice(0, calibEnd));
  if (!built) return null;
  const flags = series.values.map((v) => !judgeReplay(built.rule, v, built.baseline).isSuccess);
  const alarms = alarmsFromFlags(flags, n);
  const tolerance = Math.max(1, Math.round(TOLERANCE_MIN / step)); // 15분 = 5분 간격이면 3칸, 60분 간격이면 1칸
  const s = scoreAlarms(alarms, { events: series.events, allSegments: series.segs }, { from: calibEnd, to: series.values.length, tolerance });
  return { ...s, delays: s.delays.map((d) => d * step), slots: s.slots * step };
}

const specLabel = (s) => (s.type === 'high' ? `값 상위 ${(s.q * 100).toFixed(1).replace(/\.0$/, '')}% 이상` : `평소 대비 ±${s.pct}%`);

/**
 * 모든 규칙을 "같은 시계열 묶음"으로 비교하려고, 어느 규칙에서든 규칙을 못 만드는 시계열은 처음부터 뺀다.
 * (규칙마다 빠지는 시계열이 다르면 이벤트 수가 달라져 표의 숫자끼리 비교할 수 없게 됩니다)
 */
function usable(seriesList, specs) {
  return seriesList.filter((s) => {
    const calib = s.values.slice(0, Math.floor(s.values.length * CALIB));
    return specs.every((spec) => buildRule(spec, calib));
  });
}

/** 규칙 목록 × 연속 횟수로 표 행을 만든다 */
function sweep(seriesList, specs) {
  const rows = [];
  for (const spec of specs) {
    for (const n of NS) {
      const scores = seriesList.map((s) => evaluate(s, spec, n));
      rows.push({ rule: specLabel(spec), spec, n, ...summarize(mergeScores(scores), 1) });
    }
  }
  return rows;
}

// ─────────────────────────────────────────────
// 데이터 읽기
// ─────────────────────────────────────────────

const read = (...p) => readFileSync(join(RAW, ...p), 'utf8');

/** SMD 한 대 → 지표(38개)마다 5분 최댓값 시계열 + 그 지표가 잡아야 할 이상 구간 */
function loadSmd(machine) {
  const rows = parseSmdRows(read('smd', 'test', `machine-${machine}.txt`));
  const labels = parseLabelLines(read('smd', 'test_label', `machine-${machine}.txt`));
  if (rows.length !== labels.length) throw new Error(`SMD ${machine}: 값과 라벨의 길이가 다릅니다`);
  const interp = parseInterpretation(read('smd', 'interpretation_label', `machine-${machine}.txt`));

  const cols = rows[0].length;
  const series = [];
  let segs = null;
  for (let c = 0; c < cols; c += 1) {
    const reduced = downsample(rows.map((r, i) => ({ value: r[c], anomaly: labels[i] })), 5, 'max');
    if (!segs) segs = segmentsOf(reduced.map((p) => p.anomaly));
    series.push({ dim: c + 1, values: reduced.map((p) => p.value) });
  }
  // 5분 구간마다, 겹치는 해석 라벨(분 단위)의 원인 지표를 모은다
  const dimsOf = segs.map(([a, b]) => {
    const set = new Set();
    for (const it of interp) if (it.start <= b * 5 + 4 && it.end >= a * 5) it.dims.forEach((d) => set.add(d));
    return set;
  });
  return series.map((s) => ({
    name: `SMD machine-${machine} 지표 #${s.dim}`,
    machine,
    dim: s.dim,
    values: s.values,
    segs,
    events: segs.filter((_, i) => dimsOf[i].has(s.dim)),
  }));
}

/** NAB 파일 하나 → 시계열 + 이상 창 */
function loadNab(file, windowsJson) {
  const points = parseNabCsv(read('nab', `${file}.csv`));
  const windows = parseNabWindows(windowsJson, `realKnownCause/${file}.csv`);
  const labelled = labelByWindows(points, windows);
  const segs = segmentsOf(labelled.map((p) => p.anomaly));
  // 간격 확인: 대부분 5분이지만 파일마다 다를 수 있어 중앙값으로 확인합니다
  const t = points.map((p) => Date.parse(`${p.ts.replace(' ', 'T')}Z`));
  const diffs = t.slice(1).map((x, i) => (x - t[i]) / 60000).sort((a, b) => a - b);
  return { name: file, values: points.map((p) => p.value), segs, events: segs, stepMinutes: diffs[diffs.length >> 1], windows: windows.length };
}

// ─────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────

const smdSeries = SMD_HELDOUT.flatMap(loadSmd);
const nabJson = JSON.parse(read('nab', 'combined_windows.json'));
const nabHeld = NAB_HELDOUT.map((f) => loadNab(f, nabJson));
const nabIn = NAB_INSAMPLE.map((f) => loadNab(f, nabJson));
for (const s of [...nabHeld, ...nabIn]) if (s.stepMinutes !== 5) console.warn(`주의: ${s.name}의 점검 간격 중앙값이 ${s.stepMinutes}분입니다 (5분이 아님)`);

const highSpecs = QUANTILES.map((q) => ({ type: 'high', q }));
const devSpecs = DEVIATIONS.map((pct) => ({ type: 'deviation', pct }));

const smdUsable = usable(smdSeries, highSpecs);
const nabHighUsable = usable(nabHeld, highSpecs);
const nabDevUsable = usable(nabHeld, devSpecs);
const smdRows = sweep(smdUsable, highSpecs);
const nabHeldHigh = sweep(nabHighUsable, highSpecs);
const nabHeldDev = sweep(nabDevUsable, devSpecs);
const nabInRows = [...sweep(usable(nabIn, [{ type: 'high', q: 0.99 }]), [{ type: 'high', q: 0.99 }]), ...sweep(usable(nabIn, [{ type: 'deviation', pct: 20 }]), [{ type: 'deviation', pct: 20 }])];

// NAB 파일별 (운영과 같은 방식) — 이벤트 수가 적어 파일별로도 보여 줍니다
const one = (s, spec) => {
  const sc = evaluate(s, spec, PRODUCTION.n);
  return sc ? summarize(mergeScores([sc]), 1) : null;
};
const nabPerFile = nabHeld.map((s) => ({
  name: s.name, stepMinutes: s.stepMinutes, windows: s.events.length,
  high: one(s, { type: 'high', q: PRODUCTION.q }),
  dev: one(s, { type: 'deviation', pct: 20 }),
}));

// 참고: 라벨을 보고 서버마다 "가장 잘 맞는 지표" 하나를 고른 경우 (낙관적인 점수)
const oracle = (() => {
  const spec = { type: 'high', q: PRODUCTION.q };
  const picked = [];
  for (const m of SMD_HELDOUT) {
    let best = null;
    for (const s of smdUsable.filter((x) => x.machine === m)) {
      const sc = evaluate(s, spec, PRODUCTION.n);
      if (!sc) continue;
      const score = sc.detected - sc.falseAlarms;
      if (!best || score > best.score || (score === best.score && sc.detected > best.sc.detected)) best = { score, sc, dim: s.dim };
    }
    picked.push(best);
  }
  return { dims: picked.map((p, i) => `${SMD_HELDOUT[i]}: #${p.dim}`), ...summarize(mergeScores(picked.map((p) => p.sc)), 1) };
})();

const smdProd = smdRows.find((r) => r.n === PRODUCTION.n && r.spec.q === PRODUCTION.q);
const totals = {
  smdSeries: smdSeries.length,
  smdUsable: smdUsable.length,
  smdEvents: smdRows[0].events,
};

const result = {
  generatedFor: 'B-9',
  settings: { calibrationFraction: CALIB, toleranceMinutes: TOLERANCE_MIN, consecutiveFailures: NS, quantiles: QUANTILES, deviations: DEVIATIONS, production: PRODUCTION },
  smd: { machines: SMD_HELDOUT, rows: smdRows, oracle },
  nab: { heldOut: NAB_HELDOUT, high: nabHeldHigh, deviation: nabHeldDev, perFile: nabPerFile, inSample: nabInRows },
};

// ─────────────────────────────────────────────
// 표 만들기
// ─────────────────────────────────────────────

const pct = (v) => (v === null ? '-' : `${(v * 100).toFixed(1)}%`);
const num = (v, d = 2) => (v === null ? '-' : v.toFixed(d));
const min = (v) => (v === null ? '-' : `${v}분`);

function table(rows, { markProduction }) {
  const head = '| 규칙 | 연속 실패 | 이벤트 | 탐지율 | 알림 | 오탐 | 오탐/시계열·일 | 알림 정밀도 | 지연(중앙) | 지연(90%) |\n|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) => {
    const star = markProduction && r.n === PRODUCTION.n && r.spec.q === PRODUCTION.q ? ' ★' : '';
    return `| ${r.rule}${star} | ${r.n}회 | ${r.events} | ${pct(r.recall)} (${r.detected}/${r.events}) | ${r.alarms} | ${r.falseAlarms} | ${num(r.falseAlarmsPerSeriesDay)} | ${pct(r.precision)} | ${min(r.delayMedianMin)} | ${min(r.delayP90Min)} |`;
  });
  return [head, ...body].join('\n');
}

const md = `# 판정 규칙 성능 측정 결과 (B-9)

이 문서는 \`node scripts/evaluate-rules/run.mjs\`가 만든 표입니다. 직접 고치지 말고 스크립트를 다시 실행하세요.
해석과 한계는 README의 "판정 규칙 성능 측정" 섹션에 있습니다.

## 설정

- 시계열마다 **앞 ${CALIB * 100}%**로 임계값·기준선을 정하고(라벨 사용 안 함), **뒤 ${(1 - CALIB) * 100}%**에서만 점수를 냅니다.
- 알림 = "연속 N회 실패"가 채워진 칸. 알림이 이상 구간의 [시작−${TOLERANCE_MIN}분, 끝+${TOLERANCE_MIN}분] 안에 있으면 "맞은 알림", 아니면 **오탐**. (점검 간격이 ${TOLERANCE_MIN}분보다 길면 1칸)
- 탐지 = 그 이상 구간의 같은 범위 안에서 알림이 한 번이라도 울림. 지연 = 첫 알림 − 이상 구간 시작(이르면 0).
- ★ = 운영과 같은 방식(값의 99% 지점 + 연속 2회). 판정은 운영 함수 \`judgeReplay\`를 그대로 썼습니다.
- 오탐/시계열·일 = 시계열 1개가 하루에 내는 오탐 수의 평균.
- 값이 거의 상수라 규칙을 못 만드는 시계열은 **모든 규칙에서 빼서**, 표의 모든 행이 같은 시계열 묶음을 비교합니다.

## 1. SMD 서버 지표 (검증 구역: machine-1-2, 2-2, 3-2, 지표 38개 전부)

시계열 ${totals.smdSeries}개(서버 3대 × 지표 38개) 중 값이 상수에 가까운 ${totals.smdSeries - totals.smdUsable}개를 빼고 **${totals.smdUsable}개**로 비교했습니다. 지표별 원인으로 표시된 이상 구간은 ${totals.smdEvents}건입니다.
지표를 라벨을 보고 고르지 않고 전부 평가해 합쳤습니다.

${table(smdRows, { markProduction: true })}

### 참고: 라벨을 보고 지표를 골랐다면 (낙관적인 점수)

서버마다 평가 구간의 라벨을 보고 (탐지 − 오탐)이 가장 큰 지표 1개를 고른 경우입니다(${oracle.dims.join(', ')}). 실제로는 할 수 없는 선택이라 **상한선**으로만 읽으세요.

| 구분 | 이벤트 | 탐지율 | 오탐 | 오탐/시계열·일 | 지연(중앙) |
|---|---|---|---|---|---|
| 전체 지표 평균 ★ (공식) | ${smdProd.events} | ${pct(smdProd.recall)} | ${smdProd.falseAlarms} | ${num(smdProd.falseAlarmsPerSeriesDay)} | ${min(smdProd.delayMedianMin)} |
| 라벨로 고른 지표 (참고) | ${oracle.events} | ${pct(oracle.recall)} | ${oracle.falseAlarms} | ${num(oracle.falseAlarmsPerSeriesDay)} | ${min(oracle.delayMedianMin)} |

## 2. NAB 설비·서버 지표 (검증 구역: 파일 3개)

이상 "창"이 파일당 1~3개뿐이라 **표본이 매우 작습니다.** 탐지율은 이벤트 수(분모)를 함께 보세요.
파일의 점검 간격: ${nabPerFile.map((f) => `${f.name} ${f.stepMinutes}분`).join(', ')}. 간격이 다르면 "연속 N회"가 실제로 걸리는 시간도 달라집니다(60분 간격이면 2회 = 2시간).

### 값 상위 N% 규칙

${table(nabHeldHigh, { markProduction: true })}

### 평소 값 대비 ±% 규칙

${table(nabHeldDev, { markProduction: false })}

### 파일별 (연속 2회, 값 상위 ${PRODUCTION.q * 100}% / 평소 대비 ±20%)

| 파일 | 이상 창 | 값 상위 99%: 탐지·오탐 | 평소 대비 ±20%: 탐지·오탐 |
|---|---|---|---|
${nabPerFile.map((f) => `| ${f.name} | ${f.windows} | ${f.high.detected}/${f.high.events} · 오탐 ${f.high.falseAlarms} | ${f.dev.detected}/${f.dev.events} · 오탐 ${f.dev.falseAlarms} |`).join('\n')}

## 3. 참고: 상태 페이지에 쓴 NAB 파일 (학습 구역, 낙관적)

\`machine_temperature_system_failure\`는 규칙(±20%)을 정할 때 이미 본 파일입니다. 공식 결과에 넣지 않습니다.

${table(nabInRows, { markProduction: false })}
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'results.md'), md);
writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(md);
console.log(`\n저장: ${join(OUT_DIR, 'results.md')}, results.json`);
