import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// UI 상태 검증용 DOM 대역입니다. 브라우저 렌더링·키보드 검수로 주장하지 않습니다.
class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.dataset = {}; this.value = ''; this.disabled = false; this.raw = ''; }
  set textContent(value) { this.raw = String(value); this.children = []; }
  get textContent() { return this.raw + this.children.map(row => row.textContent).join(''); }
  set innerHTML(_) { throw new Error('unsafe HTML sink'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.raw = ''; this.children = children; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(name, callback) { this.events[name] = callback; }
  querySelector(selector) {
    const matches = row => selector.startsWith('.') ? row.className?.split(' ').includes(selector.slice(1)) : row.tag === selector;
    for (const child of this.children) { if (matches(child)) return child; const nested = child.querySelector(selector); if (nested) return nested; }
    return null;
  }
}
const roles = [{ id: 'coordinator', name: '조사 팀장', kind: '규칙 계획', instruction: '대상 확인' }, { id: 'network', name: '네트워크', kind: '실측 도구', instruction: '검사' }];
const makeRun = () => ({ id: 'wf-11111111-1111-1111-1111-111111111111', question: '<img src=x onerror=alert(1)>', status: 'running',
  events: [{ type: 'started', step_id: 'network', at: '2026-11-17T00:00:00Z', message: '검사 시작' }],
  steps: roles.map((role, i) => ({ ...role, status: i ? 'running' : 'completed', input: '<script>bad()</script>', output: ['관측'], evidence: [], handoff: null })) });
async function boot({ unavailable = false } = {}) {
  const ids = 'mode notice start cancel question ask-form form-error conversation run-list refresh-runs flow run-status detail-title step-status step-detail services-link'.split(' ');
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const calls = [], intervals = []; let run = makeRun();
  const context = vm.createContext({ document: { getElementById: id => elements[id], createElement: tag => new Element(tag) },
    history: { replaceState() {} }, location: { hash: '' }, crypto: { randomUUID: () => 'request-11111111111111111111' },
    AbortSignal, setInterval: callback => intervals.push(callback), console,
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      let data, ok = true;
      if (url.endsWith('/capabilities')) { ok = !unavailable; data = unavailable ? { error: 'not_found' } : { ready: true, csrf_token: 'session-test', environment: 'lab', roles, notice: 'LLM 미연결' }; }
      else if (url === '/api/workflows/runs' && options.method === 'POST') { data = { run: structuredClone(run) }; }
      else if (url === '/api/workflows/runs') data = { runs: [{ id: run.id, question: run.question, status: run.status }] };
      else data = structuredClone(run);
      return { ok, json: async () => data };
    } });
  vm.runInContext(await readFile(new URL('../public/rules.js', import.meta.url), 'utf8'), context);
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  return { elements, calls, intervals, setRun: value => { run = value; } };
}
test('실행 서버 미연결 시 시작을 막고 가짜 결과를 만들지 않는다', async () => {
  const { elements, calls } = await boot({ unavailable: true });
  assert.equal(elements.start.disabled, true);
  assert.equal(elements.mode.textContent, '실행 서버 미연결');
  assert.ok(!calls.some(row => row.options.method === 'POST'));
});
test('질문과 지시를 HTML로 실행하지 않고 문자로 표시한다', async () => {
  const { elements } = await boot();
  assert.ok(elements.conversation.textContent.includes('<img src=x onerror=alert(1)>'));
  assert.ok(elements['step-detail'].textContent.includes('<script>bad()</script>'));
});
test('진행 갱신 때 사용자가 선택한 노드와 버튼을 유지한다', async () => {
  const ui = await boot();
  const coordinator = ui.elements.flow.children[0].children[0];
  coordinator.events.click();
  const run = makeRun(); run.steps[1].status = 'completed'; run.status = 'completed';
  ui.setRun(run); await ui.intervals[0]();
  assert.equal(ui.elements.flow.children[0].children[0], coordinator);
  assert.equal(coordinator.attrs['aria-pressed'], 'true');
  assert.equal(ui.elements['detail-title'].textContent, '조사 팀장');
});
