import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';

const root = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--with-db-outage')) throw new Error('사용법: node lab/verify.mjs [--with-db-outage]');
const records = [];
function compose(...args) {
  const p = spawnSync('docker', ['compose', ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
  if (p.status !== 0) throw new Error(`실습 Docker 명령 실패: ${args.join(' ')}`);
}
async function waitFor(label, predicate, timeout = 65000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:18911/api/snapshot', { signal: AbortSignal.timeout(4000) });
      const s = await response.json();
      if (response.ok && s.fresh && predicate(s)) {
        records.push({ label, checked_at: new Date().toISOString(), snapshot: s });
        console.log(`${label}: 통과`);
        return s;
      }
    } catch { /* 준비·수집 사이에는 제한 시간 안에서 다시 확인합니다. */ }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`${label}: 제한 시간 안에 새 관측을 얻지 못했습니다.`);
}
const baseline = await waitFor('DNS·업무 HTTP·DB TCP 정상', s => s.probes.length === 3 && s.probes.every(p => p.ok));
assert.equal(baseline.source, 'real');
assert.equal(baseline.environment, 'lab');
assert.equal(baseline.metrics.metrics.scope, 'erp_container');
assert.ok(baseline.metrics.metrics.process_rss_bytes > 0);
assert.ok(baseline.metrics.logs.some(log => log.code === 'ok' && log.request_id === baseline.probes[1].request_id));
const next = await waitFor('두 표본으로 CPU·네트워크 변화율 계산', s => s.collection_id !== baseline.collection_id && s.metrics?.rates !== null);
assert.ok(next.metrics.rates.window_seconds > 0);
if (args.includes('--with-db-outage')) {
  try {
    compose('stop', 'db');
    const failed = await waitFor('DB 중단 시 DNS 정상·업무 HTTP 실패·DB TCP 실패',
      s => s.collection_id !== next.collection_id && s.probes[0].ok && !s.probes[1].ok && !s.probes[2].ok && s.process_live.ok);
    assert.equal(failed.probes[1].status, 503);
    assert.ok(failed.metrics.logs.some(log => log.status === 503 && log.request_id === failed.probes[1].request_id));
  } finally { compose('start', 'db'); }
  await waitFor('DB 재시작 후 같은 업무 조회 복구', s => s.received_at > records.at(-1).snapshot.received_at && s.probes.every(p => p.ok));
}
await mkdir(`${root}/.runtime`, { recursive: true });
await writeFile(`${root}/.runtime/verification.json`, JSON.stringify({ measured_at: new Date().toISOString(),
  scope: 'local_docker_lab', llm_executed: false, production_modified: false, records }, null, 2));
console.log('검증 기록: lab/.runtime/verification.json');
