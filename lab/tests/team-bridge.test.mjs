import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTeamService } from '../team-bridge/service.mjs';
import { createHandler } from '../team-bridge/server.mjs';
import { createPaseoCli } from '../team-bridge/paseo-cli.mjs';
import { redact, sessionView } from '../team-bridge/model.mjs';

const leader = '11111111-1111-4111-8111-111111111111';
const reviewer = '22222222-2222-4222-8222-222222222222';
const root = process.cwd();
const config = { teams: [{ id: 'ai-rca', name: 'AI 장애 분석팀', sessions: { leader, reviewer } }, { id: 'ui', name: '개선팀', sessions: { leader, reviewer } }] };
async function setup(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'uptime-team-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sent = [];
  const cli = { inspect: async id => ({ Id: id, Cwd: root, Name: '담당', Provider: 'claude', Model: 'actual-model', Status: 'idle', Mode: 'auto', PendingPermissions: [] }),
    send: async (id, path) => sent.push({ id, prompt: await readFile(path, 'utf8') }), ...overrides };
  const service = await createTeamService({ config, dir, cli, projectRoot: root });
  return { service, cli, dir, sent };
}
const request = { team_id: 'ai-rca', question: 'ERP가 응답하지 않습니다. 조사 계획을 제시해 주세요.' };
const key = 'test-request-123456789';

test('실제 모델과 상태만 조회하며 기존 사용량·cwd·권한 상세를 브라우저에 노출하지 않는다', async t => {
  const { service } = await setup(t);
  const result = await service.refresh();
  assert.equal(result.teams[0].roles[0].model, 'actual-model');
  assert.equal(result.teams[0].roles[1].shared, true);
  assert.ok(!JSON.stringify(result).includes(root));
  assert.ok(!JSON.stringify(result).includes('LastUsage'));
  assert.equal(sessionView({ Id: leader, Provider: 'claude', Model: 'm', Status: 'idle', PendingPermissions: [{}] }, leader).status, 'approval_required');
});
test('실패·다른 프로젝트·보관 세션을 대기 상태로 꾸미지 않는다', async t => {
  for (const inspect of [async () => { throw Error('offline secret'); }, async id => ({ Id: id, Cwd: tmpdir() }), async id => ({ Id: id, Cwd: root, Archived: true })]) {
    const { service } = await setup(t, { inspect }); const result = await service.refresh();
    assert.equal(result.connected, false); assert.equal(result.teams[0].roles[0].status, 'offline');
    await assert.rejects(service.start(request, key), /team_not_idle/);
  }
});
test('멱등 요청은 한 번만 보내고 다른 내용·공통 담당 중복 작업을 막는다', async t => {
  const { service, sent, dir } = await setup(t);
  const [first, duplicate] = await Promise.all([service.start(request, key), service.start(request, key)]);
  assert.equal(sent.length, 1); assert.equal(first.task.id, duplicate.task.id); assert.equal(duplicate.duplicate, true);
  assert.equal(sent[0].id, leader); assert.match(sent[0].prompt, /이번 범위는 읽기 전용/); assert.match(sent[0].prompt, /등록 가용 역할/);
  assert.equal((await readdir(dir)).filter(f => f.endsWith('.prompt.txt')).length, 0);
  assert.ok(!JSON.stringify(first).includes('event_secret')); assert.ok(!JSON.stringify(service.list()).includes(key));
  await assert.rejects(service.start({ ...request, question: '다른 질문' }, key), /idempotency_conflict/);
  await assert.rejects(service.start({ ...request, team_id: 'ui' }, randomUUID()), /task_in_progress/);
});
test('모든 담당 idle만 요청 가능하고 임의 팀·인자·키를 허용하지 않는다', async t => {
  const { service } = await setup(t, { inspect: async id => ({ Id: id, Cwd: root, Provider: 'claude', Model: 'm', Status: 'running' }) });
  await assert.rejects(service.start(request, key), /team_not_idle/);
  await assert.rejects(service.start({ ...request, team_id: 'external' }, key), /invalid_request/);
  await assert.rejects(service.start(request, '$()'), /invalid_idempotency_key/);
});
test('종료된 공통 담당은 가용 위임에서 제외하고 팀장 종료 시에는 접수를 막는다', async t => {
  const { service, sent } = await setup(t, { inspect: async id => ({ Id: id, Cwd: root, Provider: 'claude', Model: 'm', Status: id === reviewer ? 'closed' : 'idle' }) });
  const result = await service.start(request, key); assert.equal(result.task.status, 'delivered');
  assert.ok(!sent[0].prompt.split('등록 가용 역할: ')[1].split('\n')[0].includes(reviewer));
  const other = await setup(t, { inspect: async id => ({ Id: id, Cwd: root, Provider: 'claude', Model: 'm', Status: 'closed' }) });
  await assert.rejects(other.service.start(request, key), /team_not_idle/);
});
test('담당 게시 비밀을 검증하고 팀장 결과만 완료로 표시한다', async t => {
  const { service, dir } = await setup(t); const { task } = await service.start(request, key);
  const secret = JSON.parse(await readFile(join(dir, `${task.id}.json`), 'utf8')).event_secret;
  await assert.rejects(service.report(task.id, 'wrong', { role: 'leader', type: 'result', text: '완료' }), /report_unauthorized/);
  await assert.rejects(service.report(task.id, secret, { role: 'not-registered', type: 'message', text: '안녕' }), /invalid_report/);
  await assert.rejects(service.report(task.id, secret, { role: 'reviewer', type: 'result', text: '완료' }), /leader_result_required/);
  await service.report(task.id, secret, { role: 'reviewer', type: 'message', text: '근거가 더 필요합니다.' });
  const done = await service.report(task.id, secret, { role: 'leader', type: 'result', text: '조사 계획 제시. 복구는 실행하지 않았습니다.' });
  assert.equal(done.status, 'completed'); assert.equal(done.events.at(-1).attribution, 'agent_reported');
  await assert.rejects(service.report(task.id, secret, { role: 'leader', type: 'message', text: '추가' }), /task_closed/);
});
test('재시작은 미완료 추적으로 표시하고 재전송하지 않는다', async t => {
  const { service, dir, cli, sent } = await setup(t); const { task } = await service.start(request, key);
  const restarted = await createTeamService({ config, dir, cli, projectRoot: root });
  assert.equal(restarted.get(task.id).status, 'interrupted'); assert.equal(sent.length, 1);
  await assert.rejects(restarted.start(request, randomUUID()), /task_in_progress/);
  await restarted.close(task.id); await restarted.start(request, randomUUID()); assert.equal(sent.length, 2);
});
test('CLI 전송 오류는 전달 불명으로 남기고 비밀 오류를 내보내지 않는다', async t => {
  const { service } = await setup(t, { send: async () => { throw Error('provider secret'); } });
  const result = await service.start(request, key); assert.equal(result.task.status, 'delivery_unknown');
  assert.ok(!JSON.stringify(result).includes('provider secret'));
  await assert.rejects(service.start(request, randomUUID()), /task_in_progress/);
});
test('민감한 알려진 패턴은 게시 전에 가리고 원문 HTML은 데이터로 유지한다', () => {
  const text = redact('token=private123 database_id=abc https://example.workers.dev C:\\Users\\Private\\file sk-abcdefghijkl <script>alert(1)</script>');
  for (const value of ['private123', 'example.workers.dev', 'Private', 'sk-abcdef']) assert.ok(!text.includes(value));
  assert.ok(text.includes('<script>')); // 서버의 HTML 필터에 의존하지 않고 화면은 textContent만 씁니다.
});
test('CLI는 프롬프트 문자열을 shell에 넣지 않고 파일 인자만 전달한다', async () => {
  const calls = []; const cli = createPaseoCli({ command: 'paseo', execute: async (...args) => { calls.push(args); return { stdout: '{}' }; } });
  await cli.send(leader, "C:\\safe path\\task.txt"); assert.equal(calls.length, 1);
  const rendered = process.platform === 'win32' ? Buffer.from(calls[0][1].at(-1), 'base64').toString('utf16le') : calls[0][1].join(' ');
  assert.ok(rendered.includes('--prompt-file')); assert.ok(rendered.includes('--no-wait')); assert.ok(!rendered.includes('ERP'));
  await assert.rejects(cli.inspect('bad;calc'), /invalid_session/);
});
test('HTTP: Host·Origin·토큰·본문형·미등록 요청을 거부한다', async t => {
  const { service } = await setup(t); await service.refresh();
  const server = http.createServer(createHandler({ service, assets: new Map(), csrf: 'test-csrf' }));
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (headers = {}, body = request) => fetch(`${base}/api/team-tasks`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post()).status, 401);
  assert.equal((await post({ 'x-team-token': 'test-csrf', origin: 'https://other.invalid' })).status, 403);
  const invalidHost = await new Promise((accept, reject) => {
    const req = http.request(base, { method: 'GET', headers: { host: 'evil.invalid' } }, res => { res.resume(); accept(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(invalidHost, 403);
  assert.equal((await post({ 'x-team-token': 'test-csrf' }, [])).status, 400);
  assert.equal((await post({ 'x-team-token': 'test-csrf', 'idempotency-key': key }, { ...request, shell: 'calc' })).status, 400);
  assert.equal((await post({ 'x-team-token': 'test-csrf', 'idempotency-key': key })).status, 202);
  const result = await (await fetch(`${base}/api/team-tasks`)).json(); assert.equal(result.tasks.length, 1); assert.ok(!JSON.stringify(result).includes('event_secret'));
});
