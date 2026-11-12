// 원본 → 재생용 SQL 만들기 (B-7c)
//
// 사용 (프로젝트 폴더에서, fetch.mjs로 원본을 받은 뒤):
//   node scripts/prepare-datasets/build.mjs [--raw <폴더>]
//
// 만드는 것 (seed/replay/ — 가공한 작은 조각이라 저장소에 올립니다. 원본은 올리지 않습니다)
//   datasets.sql              데이터셋 메타(이름·링크·라이선스·가공 방법)
//   monitors.sql              재생 대상 등록 + 설정(replay_config). B-7f 컷오버 때 실행
//   series-<대상 키>.sql       대상별 5분(또는 하루) 간격 시계열
//   manifest.json             대상 정의 (서비스 이름, 간격, 길이, 판정 규칙 제안) — B-7d가 읽어 대상을 등록
//
// 이 스크립트는 DB에 접속하지 않습니다. 같은 입력이면 항상 같은 파일이 나옵니다 (시각 등 변하는 값을 쓰지 않음).

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RAW_DIR } from './fetch.mjs';
import { loadSmd, pickSmdWindow, SMD_MACHINES } from './analyze.mjs';
import {
  pickBestDimension, quantile, parseNabCsv, parseNabWindows, labelByWindows, windowAround,
  addDays, chooseDiskGroup, dailyDiskSeries, parseCsvLine, buildDatasetsSql, buildSeriesSql, buildMonitorsSql, round,
} from './lib.mjs';
import { downsample, baselineOf, toPercent } from '../../src/replay.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'seed', 'replay');
const CHECKED = '2026-11-12'; // 라이선스를 원본에서 확인한 날

// ─────────────────────────────────────────────
// 데이터셋 메타 (datasets 표와 README의 근거)
// ─────────────────────────────────────────────
export const DATASETS = [
  {
    key: 'smd',
    name: 'SMD (Server Machine Dataset)',
    url: 'https://github.com/NetManAIOps/OmniAnomaly',
    license: `MIT (저장소 ServerMachineDataset/LICENSE 확인, ${CHECKED})`,
    processing:
      '장비 3대(machine-1-1, 2-1, 3-1)의 test 구간에서 이상 구간이 많이 든 1주(10,080분)를 골라 1분 값을 5분 최댓값으로 줄임. ' +
      '지표는 이상 구간을 잘 잡는 것을 골랐고(지표 이름은 공개되지 않음), 값은 0~1 정규화 상대값을 %로 환산한 것이라 실제 사용률이 아님. ' +
      '지표를 이상 라벨을 보고 골랐으므로, 이 지표만으로 탐지 성능을 평가하면 결과가 실제보다 좋게 나옴.',
    kind: 'real_replay',
    citation: null,
  },
  {
    key: 'nab',
    name: 'NAB (Numenta Anomaly Benchmark)',
    url: 'https://github.com/numenta/NAB',
    license: `MIT 형식 (저장소 LICENSE.txt 확인, ${CHECKED})`,
    processing:
      'realKnownCause/machine_temperature_system_failure.csv에서 라벨 창 2개(2013-12-10 ~ 12-17)와 앞뒤 12시간을 포함한 구간을 5분 간격 원본 그대로 사용. ' +
      '원본은 값의 단위를 밝히지 않음.',
    kind: 'real_replay',
    citation: 'Ahmad, Lavin, Purdy, Agha. Unsupervised real-time anomaly detection for streaming data. Neurocomputing, 2017 (arXiv:1510.03336)',
  },
  {
    key: 'backblaze',
    name: 'Backblaze Drive Stats',
    url: 'https://www.backblaze.com/cloud-storage/resources/hard-drive-test-data',
    license: `Backblaze 자체 이용 조건 (공식 페이지 확인, ${CHECKED}): 출처를 Backblaze로 표기, 사용 책임은 사용자, 파생물 판매는 가능하나 데이터 자체는 판매 불가. MIT가 아님`,
    processing:
      '2013년 데이터에서 같은 모델 드라이브 8대(고장 2대, 정상 6대)를 골라 60일치를 하루 1칸으로 사용. ' +
      '값은 8대의 불량 섹터(smart_5_raw) 합계, 이상 표시는 그날 고장 기록이 있는 경우.',
    kind: 'real_replay',
    citation: 'Source: Backblaze Drive Stats (backblaze.com)',
  },
];

const SMD_SERVICE = { '1-1': '그룹웨어·메일', '2-1': '사내 ERP', '3-1': 'DB 서버' };
const pct = (series) => series.map((p) => ({ value: toPercent(p.value), anomaly: p.anomaly }));

// ─────────────────────────────────────────────
// SMD
// ─────────────────────────────────────────────
function buildSmd() {
  return SMD_MACHINES.map((m) => {
    const data = loadSmd(m);
    const { range } = pickSmdWindow(data);
    const rows = data.rows.slice(range[0], range[1]);
    const labels = data.labels.slice(range[0], range[1]);
    const best = pickBestDimension(rows, labels, (pts) => downsample(pts, 5, 'max'));
    const series = pct(best.series);
    const values = series.map((p) => p.value);
    const rule = { type: 'high', slowAt: round(quantile(values, 0.95), 2), failAt: round(quantile(values, 0.99), 2) };
    console.log(`SMD machine-${m}: 지표 #${best.dim}, ${series.length}점, 이상 구간 ${best.detected}/${best.segments} 잡힘(헛경보 ${best.falseRuns}), 규칙 ${JSON.stringify(rule)}`);
    return {
      entry: {
        checkKey: `replay-smd-${m}`,
        name: SMD_SERVICE[m],
        datasetKey: 'smd',
        stepMinutes: 5,
        length: series.length,
        metric: `서버 지표 #${best.dim} (익명·정규화, % 환산)`,
        unit: '%',
        description: `SMD machine-${m}의 ${range[0]}~${range[1]}분 구간, 지표 ${best.dim}, 5분 최댓값`,
        rule,
        baseline: null,
        hasLabels: true,
      },
      series,
    };
  });
}

// ─────────────────────────────────────────────
// NAB
// ─────────────────────────────────────────────
function buildNab() {
  const key = 'realKnownCause/machine_temperature_system_failure.csv';
  const points = parseNabCsv(readFileSync(join(RAW_DIR, 'nab', 'machine_temperature_system_failure.csv'), 'utf8'));
  const windows = parseNabWindows(JSON.parse(readFileSync(join(RAW_DIR, 'nab', 'combined_windows.json'), 'utf8')), key);
  const labelled = labelByWindows(points, windows);
  const [a, b] = windowAround(labelled, windows.slice(0, 2), 144);
  const series = labelled.slice(a, b + 1).map((p) => ({ value: p.value, anomaly: p.anomaly }));
  const baseline = round(baselineOf(series.map((p) => p.value)), 2);
  console.log(`NAB 설비 온도: ${labelled[a].ts} ~ ${labelled[b].ts}, ${series.length}점, 평소 값(중앙값) ${baseline}`);
  return [{
    entry: {
      checkKey: 'replay-nab-machine-temp',
      name: 'MES (생산관리)',
      datasetKey: 'nab',
      stepMinutes: 5,
      length: series.length,
      metric: '설비 온도 센서 값 (단위는 원본이 밝히지 않음)',
      unit: '', // 단위를 알 수 없으므로 숫자만 표시
      description: `NAB machine_temperature_system_failure, ${labelled[a].ts} ~ ${labelled[b].ts}`,
      rule: { type: 'deviation', slowPct: 10, failPct: 20 },
      baseline,
      hasLabels: true,
    },
    series,
  }];
}

// ─────────────────────────────────────────────
// Backblaze
// ─────────────────────────────────────────────
function extractZip(zip, dest) {
  if (existsSync(dest) && readdirSync(dest).length) return;
  mkdirSync(dest, { recursive: true });
  // Windows 10 이상에 들어 있는 tar(bsdtar)가 zip도 풀 수 있습니다. 없으면 직접 압축을 풀고 이 폴더에 두세요.
  const r = spawnSync('tar', ['-xf', zip, '-C', dest], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('압축을 풀지 못했습니다 (tar 실행 실패)');
}

/** 앞쪽 n개 칸만 빠르게 잘라 읽기 (수백만 줄을 읽어야 해서 전체 파싱을 피함) */
function firstFields(line, n) {
  const out = [];
  let from = 0;
  for (let i = 0; i < n; i += 1) {
    const to = line.indexOf(',', from);
    if (to < 0) { out.push(line.slice(from)); break; }
    out.push(line.slice(from, to));
    from = to + 1;
  }
  return out;
}

function listCsv(dir) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((p) => p.toLowerCase().endsWith('.csv') && !p.includes('__MACOSX') && /\d{4}-\d{2}-\d{2}\.csv$/i.test(p))
    .sort((x, y) => basename(x).localeCompare(basename(y)));
}

function buildBackblaze() {
  const dir = join(RAW_DIR, 'backblaze', 'data_2013');
  extractZip(join(RAW_DIR, 'backblaze', 'data_2013.zip'), dir);
  const files = listCsv(dir);
  if (!files.length) throw new Error('압축을 푼 폴더에서 날짜별 CSV를 찾지 못했습니다');
  console.log(`Backblaze: 날짜별 CSV ${files.length}개 (${basename(files[0])} ~ ${basename(files[files.length - 1])})`);

  // 열 구조 확인: 필요한 열이 없으면 멈춥니다 (추측해서 진행하지 않음)
  const header = parseCsvLine(readFileSync(join(dir, files[0]), 'utf8').split(/\r?\n/, 1)[0]);
  const need = ['date', 'serial_number', 'model', 'failure', 'smart_5_raw'];
  const at = Object.fromEntries(need.map((c) => [c, header.indexOf(c)]));
  const missing = need.filter((c) => at[c] < 0);
  if (missing.length) throw new Error(`필요한 열이 없습니다: ${missing.join(', ')} (열 ${header.length}개)`);
  if (!(at.date === 0 && at.serial_number === 1 && at.model === 2 && at.failure === 4)) {
    throw new Error('앞쪽 열 순서가 예상(date, serial_number, model, capacity_bytes, failure)과 다릅니다');
  }

  // 1단계: 고장 기록과 드라이브별 관측 기간
  const seen = new Map();
  const failures = [];
  for (const f of files) {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n');
    for (let i = 1; i < lines.length; i += 1) {
      if (!lines[i]) continue;
      const [date, serial, model, , failure] = firstFields(lines[i], 5);
      const s = seen.get(serial);
      if (!s) seen.set(serial, { model, first: date, last: date });
      else s.last = date;
      if (failure === '1') failures.push({ serial, model, date });
    }
  }
  console.log(`Backblaze: 드라이브 ${seen.size}대, 고장 ${failures.length}건`);

  const group = chooseDiskGroup(failures, seen, { days: 60, nFailed: 2, nHealthy: 6 });
  if (!group) throw new Error('조건에 맞는 드라이브 묶음을 찾지 못했습니다');
  const picked = new Set([...group.failed, ...group.healthy]);
  const dates = Array.from({ length: group.days }, (_, i) => addDays(group.start, i));
  console.log(`Backblaze: 모델 ${group.model}, ${dates[0]} ~ ${dates[dates.length - 1]}, 고장 ${group.failed.join(',')} / 정상 ${group.healthy.length}대`);

  // 2단계: 고른 드라이브의 날짜별 값
  const byDate = new Map();
  for (const f of files) {
    const date = basename(f).slice(0, 10);
    if (date < dates[0] || date > dates[dates.length - 1]) continue;
    const lines = readFileSync(join(dir, f), 'utf8').split('\n');
    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
      if (!lines[i]) continue;
      const [, serial] = firstFields(lines[i], 2);
      if (!picked.has(serial)) continue;
      const c = parseCsvLine(lines[i]);
      rows.push({ serial, smart5: c[at.smart_5_raw] === '' ? NaN : Number(c[at.smart_5_raw]), failure: Number(c[at.failure]) });
    }
    byDate.set(date, rows);
  }
  const series = dailyDiskSeries(byDate, dates);
  const failDays = series.filter((p) => p.anomaly === 1).length;
  console.log(`Backblaze: ${series.length}일, 고장 표시 ${failDays}일, 불량 섹터 합계 최대 ${Math.max(...series.map((p) => p.value))}`);

  return [{
    entry: {
      checkKey: 'replay-backblaze-disk',
      name: '파일서버·NAS 디스크',
      datasetKey: 'backblaze',
      stepMinutes: 1440,
      length: series.length,
      metric: `드라이브 ${picked.size}대의 불량 섹터(smart_5_raw) 합계`,
      unit: '개',
      description: `Backblaze 2013, 모델 ${group.model}, ${dates[0]} ~ ${dates[dates.length - 1]}, 고장 ${group.failed.length}대 + 정상 ${group.healthy.length}대 (시리얼 번호는 기록하지 않음)`,
      rule: { type: 'smart', slowAbove: 0 },
      baseline: null,
      hasLabels: true,
    },
    series,
  }];
}

// ─────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────
function main() {
  if (!existsSync(RAW_DIR)) throw new Error(`원본 폴더가 없습니다: ${RAW_DIR} (fetch.mjs를 먼저 실행하세요)`);
  console.log(`원본 폴더: ${RAW_DIR}`);
  const built = [...buildSmd(), ...buildNab(), ...buildBackblaze()];

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'datasets.sql'), buildDatasetsSql(DATASETS));
  for (const { entry, series } of built) {
    writeFileSync(join(OUT, `series-${entry.checkKey}.sql`), buildSeriesSql(entry.checkKey, series));
    entry.file = `series-${entry.checkKey}.sql`;
    // 첫 이상이 나오는 순번: 대상 등록 SQL이 "적재 직후 얼마 안 돼 이상이 나오도록" 시작 기준 시각을 맞추는 데 씁니다
    const first = series.findIndex((p) => p.anomaly === 1);
    entry.firstAnomalySeq = first < 0 ? null : first;
  }
  writeFileSync(join(OUT, 'monitors.sql'), buildMonitorsSql(built.map((b) => b.entry)));
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ datasets: DATASETS.map((d) => d.key), monitors: built.map((b) => b.entry) }, null, 2) + '\n');
  console.log(`\n만든 곳: ${OUT}  (파일 ${built.length + 3}개)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error('실패:', e.message); process.exit(1); }
}
