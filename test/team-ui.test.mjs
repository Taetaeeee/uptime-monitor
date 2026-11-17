import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// DOM 대역은 데이터 흐름만 확인합니다. 실제 브라우저 접근성·렌더 검수는 아닙니다.
class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.events = {}; this.attrs = {}; this.dataset = {}; this.className = ''; this.value = ''; this.disabled = false; this.open = false; this.isConnected = true; this.classList = { toggle() {}, add() {} }; }
  set textContent(text) { this.raw = String(text); this.children = []; }
  get textContent() { return (this.raw ?? '') + this.children.map(c => c.textContent).join(''); }
  set innerHTML(value) { throw Error('unsafe_html'); }
  append(...children) { for (const child of children) child.parent = this; this.children.push(...children); }
  replaceChildren(...children) { this.raw = ''; this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = value; }
  getAttribute(key) { return this.attrs[key]; }
  addEventListener(key, callback) { this.events[key] = callback; }
  contains(item) { return item === this || this.children.some(c => c.contains(item)); }
  showModal() { this.open = true; }
  close() { this.open = false; this.events.close?.(); }
  focus() { this.focused = true; }
  closest(tag) { return this.tag === tag ? this : this.parent?.closest(tag); }
}
async function boot() {
  const ids = 'connection teams team-title graph tasks request refresh detail-dialog request-dialog detail-content detail-title request-error request-form question submit'.split(' ');
  const els = Object.fromEntries(ids.map(id => [id, new Element(id.endsWith('dialog') ? 'dialog' : 'div')]));
  const tabs = ['summary', 'conversation', 'execution', 'changes'].map(tab => { const e = new Element('button'); e.dataset.tab = tab; return e; });
  const calls = [], intervals = [];
  let online = true;
  const context = vm.createContext({ document: { getElementById: id => els[id], createElement: tag => new Element(tag), querySelectorAll: selector => selector === '[data-tab]' ? tabs : [], activeElement: null },
    AbortSignal, Date, crypto: { randomUUID: () => 'request-123456789123456' }, setInterval: fn => intervals.push(fn), console,
    fetch: async (path, options) => {
      calls.push({ path, options }); if (!online) throw Error('offline');
      const data = path === '/api/teams' ? { connected: true, checked_at: new Date().toISOString(), csrf_token: 'local', teams: [{ id: 'ai-rca', name: 'AI 분석팀', roles: ['leader', 'planner', 'reviewer'].map(role => ({ role, label: role, session_id: role, provider: 'actual', model: 'actual-model', status: 'idle' })) }] }
        : { tasks: [{ id: 'task-a', team_id: 'ai-rca', question: '<img src=x onerror=alert(1)>', status: 'completed', created_at: new Date().toISOString(), events: [{ role: 'leader', attribution: 'agent_reported', type: 'result', text: '<script>private()</script>' }] }] };
      return { ok: true, json: async () => data };
    } });
  vm.runInContext(await readFile(new URL('../public/agents.js', import.meta.url), 'utf8'), context);
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  return { els, calls, tabs, intervals, offline() { online = false; } };
}
test('새 화면은 실제 팀 그래프를 만들고 기본 화면에 대화 전문을 배치하지 않는다', async () => {
  const { els, calls } = await boot();
  assert.ok(els.graph.textContent.includes('actual-model')); assert.equal(els.graph.children.length, 2);
  assert.ok(!els.graph.textContent.includes('private()')); assert.ok(!calls.some(c => c.path.includes('/logs')));
  assert.equal(els.request.disabled, false);
});
test('팀 연결을 잃으면 이전 정상 값으로 요청하지 못한다', async () => {
  const ui = await boot(); ui.offline(); await ui.intervals[0]();
  assert.equal(ui.els.request.disabled, true); assert.ok(ui.els.connection.textContent.includes('오프라인'));
});
test('대화는 상세에서만 열고 모델·질문 문자열을 HTML로 실행하지 않는다', async () => {
  const { els, tabs } = await boot();
  const detailButton = els.tasks.children[0].children[1]; detailButton.events.click();
  assert.equal(els['detail-dialog'].open, true); assert.ok(els['detail-content'].textContent.includes('<img'));
  tabs[1].events.click(); assert.ok(els['detail-content'].textContent.includes('<script>private()'));
  els['detail-dialog'].close(); assert.equal(detailButton.focused, true);
});
