import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRun, executeRun, TERMINAL } from './workflow.mjs';

export const RUN_ID = /^wf-[a-f0-9-]{36}$/;
export async function createWorkflowStore({ dir, tools, now = Date.now }) {
  await mkdir(dir, { recursive: true });
  const runs = new Map(), writes = new Map(), published = new Map();
  let active = null, lock = Promise.resolve();
  function view(run) { const { key, ...publicRun } = run; return structuredClone(publicRun); }
  function persist(run) {
    const next = (writes.get(run.id) ?? Promise.resolve()).then(async () => {
      const temp = `${dir}/${run.id}.${randomUUID()}.tmp`;
      const serialized = JSON.stringify(run);
      await writeFile(temp, serialized);
      await rename(temp, `${dir}/${run.id}.json`);
      // 조회에는 디스크에 반영된 상태만 내보내 완료 표시와 저장 사이의 경쟁을 막습니다.
      published.set(run.id, JSON.parse(serialized));
    });
    writes.set(run.id, next.catch(() => {}));
    return next;
  }
  const files = (await readdir(dir)).filter(name => RUN_ID.test(name.slice(0, -5)) && name.endsWith('.json')).sort();
  for (const name of files) {
    try {
      const text = await readFile(`${dir}/${name}`, 'utf8');
      if (text.length > 1000000) continue;
      const run = JSON.parse(text);
      if (!RUN_ID.test(run.id) || `${run.id}.json` !== name || !Array.isArray(run.steps) || !Array.isArray(run.events)) continue;
      if (!TERMINAL.has(run.status)) {
        run.status = 'incomplete'; run.ended_at = new Date(now()).toISOString();
        run.events.push({ id: randomUUID(), type: 'stopped', step_id: null, at: run.ended_at, message: '실행기가 재시작되어 이전 작업을 중단됨으로 마감했습니다. 자동 재개하지 않습니다.' });
        for (const step of run.steps) if (['waiting', 'running'].includes(step.status)) step.status = 'skipped';
        await persist(run);
      }
      runs.set(run.id, run);
      if (!published.has(run.id)) published.set(run.id, structuredClone(run));
    } catch { /* 손상된 파일을 실행 계획으로 사용하지 않습니다. */ }
  }
  function list() { return [...runs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async function prune() {
    for (const run of list().slice(20)) {
      if (run.id === active) continue;
      await unlink(`${dir}/${run.id}.json`); runs.delete(run.id); writes.delete(run.id); published.delete(run.id);
    }
  }
  await prune();
  return {
    list: () => list().map(run => published.get(run.id)).filter(Boolean).map(run => ({ id: run.id, question: run.question, status: run.status, created_at: run.created_at, executor: run.executor })),
    get: id => published.has(id) ? view(published.get(id)) : null,
    start(question, key) {
      const operation = lock.then(async () => {
        const previous = [...runs.values()].find(run => run.key === key);
        if (previous) {
          if (previous.question !== question.trim()) throw new Error('idempotency_conflict');
          return { run: view(previous), duplicate: true };
        }
        if (active) throw new Error('already_running');
        const run = createRun(question, key, now());
        await persist(run); runs.set(run.id, run); active = run.id; await prune();
        const result = { run: view(run), duplicate: false };
        void executeRun(run, { ...tools, persist, now }).catch(async () => {
          run.status = 'failed'; run.ended_at = new Date(now()).toISOString();
          try { await persist(run); } catch { /* 조회 상태에 저장 실패를 반영합니다. */ }
        }).finally(() => { if (active === run.id) active = null; });
        return result;
      });
      lock = operation.catch(() => {});
      return operation;
    },
    async cancel(id) {
      const run = runs.get(id);
      if (!run || TERMINAL.has(run.status)) return false;
      run.cancel_requested = true; await persist(run); return true;
    },
  };
}
