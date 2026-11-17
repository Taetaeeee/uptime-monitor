import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_ID } from './model.mjs';

// 에이전트가 선택한 작업 요약만 전송합니다. 원문 세션 로그를 가져오지 않습니다.
const [id, role, type, text, to_role] = process.argv.slice(2);
if (!TASK_ID.test(id ?? '') || !text) throw new Error('사용법: node report.mjs task-id role type "공개 요약" [to-role]');
const dir = fileURLToPath(new URL('../.runtime/team-bridge/', import.meta.url));
const endpoint = JSON.parse(await readFile(resolve(dir, 'endpoint.json'), 'utf8'));
if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(endpoint.url)) throw new Error('invalid_endpoint');
const task = JSON.parse(await readFile(resolve(dir, `${id}.json`), 'utf8'));
const response = await fetch(`${endpoint.url}/api/team-tasks/${id}/events`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
  headers: { 'content-type': 'application/json', 'x-report-token': task.event_secret }, body: JSON.stringify({ role, type, text, ...(to_role ? { to_role } : {}) }) });
if (!response.ok) throw new Error(`공개 요약 접수 실패 (${response.status})`);
console.log('공개 요약을 게시했습니다.');
