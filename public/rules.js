(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const names = { queued: '실행 대기', running: '실행 중', completed: '완료', waiting: '대기', skipped: '미실행',
    incomplete: '미완료', failed: '실행 실패', cancelled: '중단' };
  const terminal = new Set(['completed', 'incomplete', 'failed', 'cancelled']);
  const fallback = [ ['coordinator', '조사 팀장'], ['network', 'DNS·네트워크 검사'], ['server', '서버·로그 검사'],
    ['analysis', '원인 후보 비교'], ['followup', '추가 점검'], ['report', '결과 보고'] ].map(([id, name]) => ({ id, name, kind: '실행 전', instruction: '서버 연결 후 지시가 표시됩니다.', status: 'waiting' }));
  const state = { capabilities: null, run: null, selected: 'coordinator', follow: true, busy: false, polling: false, pending: null, roleNodes: new Map() };
  const el = (tag, text, className) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; };
  const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR', { hour12: false }) : '기록 없음';
  const friendly = code => ({ already_running: '다른 조사가 실행 중입니다. 최근 조사에서 확인하세요.', session_required: '실행기가 재시작됐거나 세션이 만료됐습니다. 페이지를 새로고침하세요.',
    idempotency_conflict: '요청 내용이 변경됐습니다. 질문을 확인한 뒤 다시 요청하세요.', invalid_request: '질문과 대상을 확인하세요.', workflow_storage_or_execution_error: '실행 기록을 저장하거나 실행하지 못했습니다.' }[code] ?? '서버에 연결하지 못했습니다. 실행 여부는 최근 조사에서 확인하세요.');
  async function request(path, options = {}) {
    const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(7000), ...options });
    let data; try { data = await response.json(); } catch { throw new Error('unavailable'); }
    if (!response.ok) throw new Error(data.error ?? 'unavailable');
    return data;
  }
  function roles() { return state.run?.steps ?? state.capabilities?.roles ?? fallback; }
  function active() { return state.run && !terminal.has(state.run.status); }
  function controls() {
    $('start').disabled = !state.capabilities?.ready || state.busy || Boolean(active());
    $('cancel').disabled = !active() || Boolean(state.run?.cancel_requested);
    $('cancel').textContent = state.run?.cancel_requested ? '중단 요청됨' : '후속 작업 중단';
  }
  function graph() {
    const steps = roles();
    if (state.follow && state.run) state.selected = (steps.find(step => step.status === 'running') ?? [...steps].reverse().find(step => ['completed', 'skipped'].includes(step.status)) ?? steps[0]).id;
    for (const step of steps) {
      let button = state.roleNodes.get(step.id);
      if (!button) {
        const li = el('li'); button = el('button', undefined, 'node'); button.type = 'button';
        const title = el('span', undefined, 'node-title'); title.append(el('span', step.name), el('span', '대기', 'state'));
        button.append(title, el('small', step.kind));
        button.addEventListener('click', () => { state.selected = step.id; state.follow = false; graph(); detail(); });
        li.append(button); $('flow').append(li); state.roleNodes.set(step.id, button);
      }
      const status = step.status ?? 'waiting';
      button.dataset.status = status; button.setAttribute('aria-pressed', String(state.selected === step.id));
      button.querySelector('.state').textContent = names[status] ?? status;
      button.querySelector('small').textContent = step.kind;
      button.setAttribute('aria-label', `${step.name}, ${names[status] ?? status}`);
    }
    const value = state.run ? `${names[state.run.status]} · 규칙 실행` : '실행 전';
    if ($('run-status').textContent !== value) $('run-status').textContent = value;
  }
  function block(title, text, className = 'instruction') {
    const div = el('div', undefined, 'detail-block'); div.append(el('h3', title), el('p', text, className)); return div;
  }
  function detail() {
    const step = roles().find(item => item.id === state.selected);
    if (!step) return;
    $('detail-title').textContent = step.name; $('step-status').textContent = names[step.status ?? 'waiting'];
    const box = $('step-detail'); box.replaceChildren();
    box.append(block('역할과 실행 방식', step.kind));
    box.append(block('받은 지시', step.input || step.instruction));
    if (step.started_at) box.append(el('p', `시작 ${time(step.started_at)}${step.ended_at ? ` · 종료 ${time(step.ended_at)}` : ''}`, 'time'));
    const output = el('div', undefined, 'detail-block'); output.append(el('h3', '실행 결과'));
    if (step.output?.length) { const list = el('ul', undefined, 'result-list'); step.output.forEach(line => list.append(el('li', line))); output.append(list); }
    else output.append(el('p', '아직 실행 결과가 없습니다.', 'empty'));
    box.append(output);
    if (step.handoff) {
      const next = roles().find(item => item.id === step.handoff.to);
      const card = el('div', undefined, 'detail-block handoff'); card.append(el('small', `다음 전달 → ${next?.name ?? step.handoff.to}`), el('p', step.handoff.instruction));
      box.append(card);
    }
    if (step.evidence?.length) {
      const d = el('details'); d.append(el('summary', `근거 ${step.evidence.length}건 · 위치·시각·ID 확인`), el('pre', JSON.stringify(step.evidence, null, 2), 'evidence')); box.append(d);
    }
    if (step.id === 'report' && state.run?.report) {
      const report = state.run.report;
      const section = el('section', undefined, 'report'); section.append(el('h3', '보고서 · 실측 기반 규칙 분류'), el('p', report.summary));
      const list = el('ul', undefined, 'result-list');
      report.candidates.forEach(candidate => list.append(el('li', `미확정 후보: ${candidate.title}`)));
      report.unknowns.forEach(line => list.append(el('li', line))); report.next_actions.forEach(line => list.append(el('li', line)));
      section.append(list); box.append(section);
    }
  }
  function conversation() {
    if (!state.run) return;
    const box = $('conversation');
    const question = el('article', undefined, 'message user'); question.append(el('small', '사용자 질문'), el('p', state.run.question));
    const items = [question];
    for (const event of state.run.events) {
      const role = roles().find(step => step.id === event.step_id);
      const article = el('article', undefined, 'message'); article.append(el('small', `${role?.name ?? '실행기'} · ${time(event.at)}`), el('p', event.message));
      if (['completed', 'skipped'].includes(event.type) && role?.handoff) {
        const next = roles().find(step => step.id === role.handoff.to);
        article.append(el('small', `다음 작업 → ${next?.name ?? role.handoff.to}`), el('p', role.handoff.instruction));
      }
      items.push(article);
    }
    box.replaceChildren(...items);
  }
  function render(run) {
    const previousCount = state.run?.events?.length;
    const previousId = state.run?.id;
    state.run = run;
    graph(); detail(); controls();
    if (previousId !== run.id || previousCount !== run.events.length) conversation();
    try { history.replaceState(null, '', `#${run.id}`); } catch { /* 내장 미리보기에서는 URL 변경이 필요하지 않습니다. */ }
  }
  async function loadRuns() {
    const data = await request('/api/workflows/runs');
    const box = $('run-list'); box.replaceChildren();
    if (!data.runs.length) box.append(el('p', '저장된 조사가 없습니다.', 'empty'));
    for (const run of data.runs) {
      const button = el('button', `${run.question.slice(0, 45)} · ${names[run.status]}`, 'run-item'); button.type = 'button';
      if (run.id === state.run?.id) button.setAttribute('aria-current', 'true');
      button.addEventListener('click', async () => { try { state.follow = true; render(await request(`/api/workflows/runs/${run.id}`)); } catch (error) { $('form-error').textContent = friendly(error.message); } });
      box.append(button);
    }
    return data.runs;
  }
  $('ask-form').addEventListener('submit', async event => {
    event.preventDefault(); if (state.busy || active() || !state.capabilities?.ready) return;
    const question = $('question').value.trim();
    if (!question) { $('form-error').textContent = '조사할 증상을 입력하세요.'; return; }
    if (state.pending?.question !== question) state.pending = { question, key: crypto.randomUUID() };
    state.busy = true; controls(); $('form-error').textContent = '';
    try {
      const data = await request('/api/workflows/runs', { method: 'POST', headers: { 'content-type': 'application/json',
        'x-workflow-token': state.capabilities.csrf_token, 'idempotency-key': state.pending.key }, body: JSON.stringify({ question, target_id: 'erp' }) });
      state.pending = null; state.follow = true; render(data.run); await loadRuns();
    } catch (error) { $('form-error').textContent = friendly(error.message); }
    finally { state.busy = false; controls(); }
  });
  $('cancel').addEventListener('click', async () => {
    const run = state.run; if (!run || terminal.has(run.status)) return;
    $('cancel').disabled = true;
    try {
      await request(`/api/workflows/runs/${run.id}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-workflow-token': state.capabilities.csrf_token }, body: '{}' });
      if (state.run?.id === run.id) render(await request(`/api/workflows/runs/${run.id}`));
    } catch (error) { $('form-error').textContent = friendly(error.message); controls(); }
  });
  $('refresh-runs').addEventListener('click', () => loadRuns().catch(error => { $('form-error').textContent = friendly(error.message); }));
  async function poll() {
    if (!state.run || state.polling || terminal.has(state.run.status)) return;
    state.polling = true; const id = state.run.id;
    try {
      const run = await request(`/api/workflows/runs/${id}`);
      if (state.run?.id === id) { render(run); if (terminal.has(run.status)) await loadRuns(); }
    } catch { $('form-error').textContent = '조회가 지연되고 있습니다. 표시된 진행 상태는 마지막으로 확인한 기록입니다.'; }
    finally { state.polling = false; }
  }
  async function init() {
    graph(); detail();
    try {
      state.capabilities = await request('/api/workflows/capabilities');
      $('mode').textContent = '실측 규칙 실행 · LLM 미연결'; $('notice').textContent = state.capabilities.notice;
      if (state.capabilities.environment === 'lab') $('services-link').hidden = true;
      graph(); controls();
      const runs = await loadRuns();
      const hash = location.hash.slice(1);
      const id = /^wf-[a-f0-9-]{36}$/.test(hash) ? hash : runs[0]?.id;
      if (id) render(await request(`/api/workflows/runs/${id}`));
    } catch {
      state.capabilities = null;
      $('mode').textContent = '실행 서버 미연결'; $('notice').textContent = '이 환경에는 작업 흐름 서버가 연결되지 않았습니다. 로컬 실습 환경에서 AI 에이전트 탭을 열어 주세요. 실행 결과를 시연 데이터로 채우지 않습니다.';
      controls();
    }
    setInterval(poll, 1000);
  }
  init();
})();
