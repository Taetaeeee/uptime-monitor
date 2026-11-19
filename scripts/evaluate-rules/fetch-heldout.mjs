// B-9 검증용 원본 데이터 내려받기 — "임계값 선정에 쓰지 않은" 서버·파일만
//
// 사용: node scripts/evaluate-rules/fetch-heldout.mjs [--raw <폴더>]
//   기본 폴더: ..\uptime-monitor-data\raw (저장소 밖)
//
// 안전장치: 목록 안의 파일만 받고 / Content-Length가 상한을 넘으면 멈추고 / 이미 있으면 건너뛰고 / SHA-256을 기록합니다.
//
// 2026-11-19: 재생용 데이터 준비 스크립트(scripts/prepare-datasets/fetch.mjs)를 지우면서,
//   그 스크립트만 받던 파일 중 평가(run.mjs)에 필요한 2개(NAB 라벨 창, 기준값을 정할 때 본 NAB 파일)를
//   이 목록 끝에 옮겨 왔습니다. 이제 이 스크립트 하나로 평가에 필요한 원본을 모두 받습니다.

import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, appendFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argRaw = process.argv.indexOf('--raw');
const RAW_DIR = argRaw > 0 ? resolve(process.argv[argRaw + 1]) : resolve(ROOT, '..', 'uptime-monitor-data', 'raw');

const SMD = 'https://raw.githubusercontent.com/NetManAIOps/OmniAnomaly/master/ServerMachineDataset';
const NAB_ROOT = 'https://raw.githubusercontent.com/numenta/NAB/master';
const NAB = `${NAB_ROOT}/data/realKnownCause`;
const MB = 1024 * 1024;

export const HELDOUT_FILES = [
  ...['1-2', '2-2', '3-2'].flatMap((m) => [
    { url: `${SMD}/test/machine-${m}.txt`, path: `smd/test/machine-${m}.txt`, maxBytes: 15 * MB },
    { url: `${SMD}/test_label/machine-${m}.txt`, path: `smd/test_label/machine-${m}.txt`, maxBytes: 1 * MB },
    { url: `${SMD}/interpretation_label/machine-${m}.txt`, path: `smd/interpretation_label/machine-${m}.txt`, maxBytes: 1 * MB },
  ]),
  ...['ambient_temperature_system_failure', 'cpu_utilization_asg_misconfiguration', 'ec2_request_latency_system_failure'].map((n) => ({
    url: `${NAB}/${n}.csv`,
    path: `nab/${n}.csv`,
    maxBytes: 2 * MB,
  })),
  // 원래 prepare-datasets/fetch.mjs가 받던 것 (평가의 NAB 라벨과 "이미 본 파일" 참고 표에 필요)
  { url: `${NAB}/machine_temperature_system_failure.csv`, path: 'nab/machine_temperature_system_failure.csv', maxBytes: 2 * MB },
  { url: `${NAB_ROOT}/labels/combined_windows.json`, path: 'nab/combined_windows.json', maxBytes: 2 * MB },
];

async function main() {
  console.log(`저장 폴더: ${RAW_DIR}`);
  mkdirSync(RAW_DIR, { recursive: true });
  const sums = join(RAW_DIR, 'SHA256SUMS.txt');
  const plain = { 'accept-encoding': 'identity' }; // 압축 없이 받아야 HEAD 크기와 저장 크기가 같음 (fetch.mjs와 동일한 이유)

  for (const f of HELDOUT_FILES) {
    const dest = join(RAW_DIR, f.path);
    if (existsSync(dest)) {
      console.log(`건너뜀(이미 있음): ${f.path}`);
      continue;
    }
    const head = await fetch(f.url, { method: 'HEAD', redirect: 'follow', headers: plain });
    if (!head.ok) throw new Error(`HEAD 실패 ${head.status}: ${f.url}`);
    const size = Number(head.headers.get('content-length'));
    if (!Number.isFinite(size)) throw new Error(`크기를 알 수 없어 받지 않습니다: ${f.url}`);
    if (size > f.maxBytes) throw new Error(`예상보다 큽니다(${size} > ${f.maxBytes}): ${f.url}`);

    console.log(`받는 중: ${f.path} (${(size / MB).toFixed(2)} MB)`);
    mkdirSync(dirname(dest), { recursive: true });
    const res = await fetch(f.url, { redirect: 'follow', headers: plain });
    if (!res.ok || !res.body) throw new Error(`GET 실패 ${res.status}: ${f.url}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    const got = statSync(dest).size;
    if (got !== size) throw new Error(`받은 크기가 다릅니다(${got} != ${size}): ${f.path}`);
    appendFileSync(sums, `${createHash('sha256').update(readFileSync(dest)).digest('hex')}  ${f.path}\n`);
  }
  console.log('완료. SHA256SUMS.txt에 해시를 적어 두었습니다.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
