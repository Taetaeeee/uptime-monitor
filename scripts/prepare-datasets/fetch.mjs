// 원본 데이터 내려받기 (B-7c) — 승인된 파일만, 저장소 "밖" 폴더에
//
// 사용 (프로젝트 폴더에서):
//   node scripts/prepare-datasets/fetch.mjs [--raw <폴더>]
//   기본 폴더: ..\uptime-monitor-data\raw  (저장소 밖이라 실수로 커밋되지 않습니다)
//
// 안전장치
//   - 아래 목록에 있는 파일만 받습니다 (목록 밖 주소는 받지 않음)
//   - 받기 전에 Content-Length를 확인해 예상 크기를 크게 넘으면 멈춥니다
//   - 이미 있는 파일은 건너뜁니다 (다시 받지 않음)
//   - 받은 뒤 SHA-256을 SHA256SUMS.txt에 적어 둡니다 (나중에 같은 파일인지 확인하는 용도)

import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, appendFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argRaw = process.argv.indexOf('--raw');
export const RAW_DIR = argRaw > 0 ? resolve(process.argv[argRaw + 1]) : resolve(ROOT, '..', 'uptime-monitor-data', 'raw');

const SMD = 'https://raw.githubusercontent.com/NetManAIOps/OmniAnomaly/master/ServerMachineDataset';
const NAB = 'https://raw.githubusercontent.com/numenta/NAB/master';
const BB = 'https://f001.backblazeb2.com/file/Backblaze-Hard-Drive-Data';

const MB = 1024 * 1024;
export const FILES = [
  ...['1-1', '2-1', '3-1'].flatMap((m) => [
    { url: `${SMD}/test/machine-${m}.txt`, path: `smd/test/machine-${m}.txt`, maxBytes: 15 * MB },
    { url: `${SMD}/test_label/machine-${m}.txt`, path: `smd/test_label/machine-${m}.txt`, maxBytes: 1 * MB },
    { url: `${SMD}/interpretation_label/machine-${m}.txt`, path: `smd/interpretation_label/machine-${m}.txt`, maxBytes: 1 * MB },
  ]),
  { url: `${NAB}/data/realKnownCause/machine_temperature_system_failure.csv`, path: 'nab/machine_temperature_system_failure.csv', maxBytes: 2 * MB },
  { url: `${NAB}/labels/combined_windows.json`, path: 'nab/combined_windows.json', maxBytes: 2 * MB },
  { url: `${BB}/data_2013.zip`, path: 'backblaze/data_2013.zip', maxBytes: 100 * MB },
];

async function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function main() {
  console.log(`저장 폴더: ${RAW_DIR}`);
  mkdirSync(RAW_DIR, { recursive: true });
  const sums = join(RAW_DIR, 'SHA256SUMS.txt');

  for (const f of FILES) {
    const dest = join(RAW_DIR, f.path);
    if (existsSync(dest)) {
      console.log(`건너뜀(이미 있음): ${f.path} (${statSync(dest).size} bytes)`);
      continue;
    }
    // 압축 없이("identity") 받도록 요청합니다. 압축을 허용하면 HEAD의 Content-Length는 압축된 크기라서
    // 풀어서 저장한 파일 크기와 달라 "받은 크기가 다릅니다"로 오인하기 때문이에요.
    const plain = { 'accept-encoding': 'identity' };
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
    appendFileSync(sums, `${await sha256(dest)}  ${f.path}\n`);
  }
  console.log('완료. SHA256SUMS.txt에 해시를 적어 두었습니다.');
}

// 다른 스크립트가 RAW_DIR·FILES를 가져다 쓸 수 있게, 직접 실행했을 때만 내려받습니다
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
}
