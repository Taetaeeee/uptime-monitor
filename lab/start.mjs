import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--build')) throw new Error('사용법: node start.mjs [--build]');
await mkdir(`${root}/.runtime/secrets`, { recursive: true });
for (const name of ['db-admin.txt', 'db-app.txt']) {
  try { await writeFile(`${root}/.runtime/secrets/${name}`, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
}
// Docker CLI를 직접 호출합니다. PowerShell 정책·시스템 설정은 바꾸지 않습니다.
for (const command of [['info', '--format', '{{.OSType}}'], ['compose', 'up', '-d', ...(args.includes('--build') ? ['--build'] : [])]]) {
  const p = spawnSync('docker', command, { cwd: root, stdio: 'inherit' });
  if (p.status !== 0) process.exit(p.status ?? 1);
}
console.log('실습 관측: http://127.0.0.1:18911/ · ERP: http://127.0.0.1:18910/api/orders');
