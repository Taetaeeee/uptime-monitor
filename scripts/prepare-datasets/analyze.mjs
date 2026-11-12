// 원본 데이터 살펴보기 (B-7c) — 어떤 지표·구간을 쓸지 "근거"를 출력한다
//
// 사용: node scripts/prepare-datasets/analyze.mjs [--raw <폴더>]
// 이 스크립트는 파일을 만들거나 DB를 건드리지 않고 화면에 표만 출력합니다.
//
// 왜 필요한가?
//   SMD의 지표는 38개인데 이름이 공개되지 않았습니다. 그래서 "CPU 같아 보이는 열"을 고르는 대신,
//   이상 구간마다 원인으로 자주 꼽힌 지표를 고르고, 그 지표가 이상/정상을 실제로 가르는지 숫자로 확인합니다.

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RAW_DIR } from './fetch.mjs';
import {
  parseSmdRows, parseLabelLines, parseInterpretation, segmentsOf, bestWindow, topDimensions,
  separation, parseNabCsv, parseNabWindows, labelByWindows, windowAround, quantile,
} from './lib.mjs';
import { downsample, baselineOf } from '../../src/replay.js';

export const SMD_MACHINES = ['1-1', '2-1', '3-1'];
export const SMD_WINDOW_MINUTES = 7 * 24 * 60; // 1주 (1분 간격이므로 10,080줄)

export function loadSmd(machine, raw = RAW_DIR) {
  const read = (dir) => readFileSync(join(raw, 'smd', dir, `machine-${machine}.txt`), 'utf8');
  const rows = parseSmdRows(read('test'));
  const labels = parseLabelLines(read('test_label'));
  const interp = parseInterpretation(read('interpretation_label'));
  if (rows.length !== labels.length) throw new Error(`machine-${machine}: 값 ${rows.length}줄, 라벨 ${labels.length}줄이 다릅니다`);
  return { rows, labels, interp };
}

/** 1주 창과 그 안의 지표 후보를 고른다 (build.mjs도 같은 함수를 씁니다) */
export function pickSmdWindow({ rows, labels, interp }) {
  const segs = segmentsOf(labels);
  const win = bestWindow(segs, rows.length, SMD_WINDOW_MINUTES);
  const range = [win.start, win.start + SMD_WINDOW_MINUTES];
  const top = topDimensions(interp, range, 5);
  return { segs, win, range, top };
}

const f = (v, d = 3) => (typeof v === 'number' ? v.toFixed(d) : String(v));

function analyzeSmd() {
  console.log('\n══════════ SMD ══════════');
  for (const m of SMD_MACHINES) {
    const data = loadSmd(m);
    const { segs, win, range, top } = pickSmdWindow(data);
    console.log(`\n[machine-${m}] 전체 ${data.rows.length}분, 이상 구간 ${segs.length}개`);
    console.log(`  1주 창: ${range[0]} ~ ${range[1]} (이상 구간 ${win.count}개 통째로 포함)`);
    console.log('  원인으로 꼽힌 횟수 상위 지표(번호는 1부터):', top.map((t) => `#${t.dim}(${t.count}회)`).join(' '));

    const sliceRows = data.rows.slice(range[0], range[1]);
    const sliceLabels = data.labels.slice(range[0], range[1]);
    console.log('  지표 | 값 범위(1분)   | 5분 평균: 정상p50 정상p99 이상p50 p99 초과 비율 | 5분 최댓값: 정상p99 p99 초과 비율');
    for (const { dim } of top) {
      const col = sliceRows.map((r) => r[dim - 1]);
      const pts = col.map((value, i) => ({ value, anomaly: sliceLabels[i] }));
      const mean = downsample(pts, 5, 'mean');
      const max = downsample(pts, 5, 'max');
      const sm = separation(mean.map((p) => p.value), mean.map((p) => p.anomaly));
      const sx = separation(max.map((p) => p.value), max.map((p) => p.anomaly));
      console.log(
        `  #${String(dim).padEnd(3)} | ${f(Math.min(...col))}~${f(Math.max(...col))} | ` +
        `${f(sm.normalP50)} ${f(sm.normalP99)} ${f(sm.anomalyP50)} ${f(sm.hitRate * 100, 1)}% | ${f(sx.normalP99)} ${f(sx.hitRate * 100, 1)}%`
      );
    }
  }
}

function analyzeNab() {
  console.log('\n══════════ NAB 설비 온도 ══════════');
  const key = 'realKnownCause/machine_temperature_system_failure.csv';
  const points = parseNabCsv(readFileSync(join(RAW_DIR, 'nab', 'machine_temperature_system_failure.csv'), 'utf8'));
  const windows = parseNabWindows(JSON.parse(readFileSync(join(RAW_DIR, 'nab', 'combined_windows.json'), 'utf8')), key);
  console.log(`전체 ${points.length}점, ${points[0].ts} ~ ${points[points.length - 1].ts}`);
  console.log('라벨 창:', windows.map(([a, b]) => `${a}~${b}`).join(' | '));

  const labelled = labelByWindows(points, windows);
  const [a, b] = windowAround(labelled, windows.slice(0, 2), 144);
  const slice = labelled.slice(a, b + 1);
  console.log(`선택 구간(창 2개 + 앞뒤 12시간): ${slice[0].ts} ~ ${slice[slice.length - 1].ts}, ${slice.length}점`);

  const base = baselineOf(labelled.map((p) => p.value));
  console.log(`전체 중앙값(평소 값): ${f(base, 2)}`);
  const normal = slice.filter((p) => p.anomaly === 0).map((p) => p.value);
  const anom = slice.filter((p) => p.anomaly === 1).map((p) => p.value);
  console.log(`선택 구간 정상: p01 ${f(quantile(normal, 0.01), 1)} p50 ${f(quantile(normal, 0.5), 1)} p99 ${f(quantile(normal, 0.99), 1)}`);
  console.log(`선택 구간 이상: 최소 ${f(Math.min(...anom), 1)} p50 ${f(quantile(anom, 0.5), 1)} 최대 ${f(Math.max(...anom), 1)}`);
  const dev = (v) => (Math.abs(v - base) / Math.abs(base)) * 100;
  const share = (th) => (anom.filter((v) => dev(v) >= th).length / anom.length) * 100;
  const falseShare = (th) => (normal.filter((v) => dev(v) >= th).length / normal.length) * 100;
  for (const th of [10, 20, 30]) {
    console.log(`  평소 대비 ±${th}% 이상: 이상 구간 ${f(share(th), 1)}% / 정상 구간 ${f(falseShare(th), 1)}%`);
  }
}

function analyzeBackblaze() {
  console.log('\n══════════ Backblaze 2013 ══════════');
  const zip = join(RAW_DIR, 'backblaze', 'data_2013.zip');
  console.log(existsSync(zip) ? `zip 있음: ${zip}` : 'zip 없음 (fetch.mjs를 먼저 실행하세요)');
  console.log('열 구조 확인과 드라이브 고르기는 build.mjs가 압축을 푼 뒤에 합니다.');
}

// build.mjs가 loadSmd·pickSmdWindow를 가져다 쓸 수 있게, 직접 실행했을 때만 분석을 출력합니다
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(RAW_DIR)) {
    console.error(`원본 폴더가 없습니다: ${RAW_DIR}\n먼저 node scripts/prepare-datasets/fetch.mjs 를 실행하세요.`);
    process.exit(1);
  }
  console.log(`원본 폴더: ${RAW_DIR}`);
  analyzeSmd();
  analyzeNab();
  analyzeBackblaze();
}
