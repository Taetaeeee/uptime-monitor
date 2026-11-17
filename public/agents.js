(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (typeof location !== 'undefined' && ['127.0.0.1', 'localhost'].includes(location.hostname)) {
    document.querySelectorAll('[data-lab-href]').forEach(link => { link.href = link.dataset.labHref; });
  }
  const state = { snapshot: null, tasks: [], team: null, csrf: null, detail: null, tab: 'summary', busy: false, trigger: null, key: null, fingerprint: null };
  const statuses = { idle: '대기', running: '실행 중', starting: '준비 중', approval_required: '권한 승인 대기', closed: '종료', offline: '오프라인', unknown: '확인 불가', error: '오류', waiting: '대기 중' };
  const taskStates = { dispatching: '전달 중', delivered: '결과 대기', completed: '조사·설계 완료', interrupted: '재시작·상태 확인 필요', delivery_unknown: '전달 확인 불가', closed: '추적 종료' };
  const roleNames = { leader: '팀장', planner: 'A', implementer: 'B', reviewer: 'C', release: 'D', 'final-review': 'E' };
  const errors = { team_not_idle: '팀 담당이 실행 중이거나 연결되지 않았습니다. 기존 작업을 마친 뒤 요청하세요.', task_in_progress: '결과 대기 또는 확인이 필요한 작업이 있습니다. 해당 상세를 먼저 확인하세요.', idempotency_conflict: '요청 내용이 바뀌었습니다. 새 요청으로 다시 전송하세요.', task_capacity: '로컬 작업 저장 한도에 도달했습니다.', session_required: '브리지 연결을 새로고침한 뒤 다시 시도하세요.' };
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const time = value => { const d = new Date(value); return Number.isFinite(+d) ? d.toLocaleString('ko-KR') : '확인 안 됨'; };
  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, signal: AbortSignal.timeout(25000), headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'unavailable'); return data;
  }
  const team = () => state.snapshot?.teams?.find(t => t.id === state.team);
  function updateEligibility() {
    const fresh = state.snapshot && Date.now() - Date.parse(state.snapshot.checked_at) < 30000;
    const pending = state.tasks.some(t => ['dispatching', 'delivered', 'delivery_unknown', 'interrupted'].includes(t.status));
    $('request').disabled = state.busy || !fresh || !team()?.roles.every(r => r.status === 'idle' || r.role !== 'leader' && r.status === 'closed') || pending;
  }
  function showDialog(id, trigger) { state.trigger = trigger; $(id).showModal(); }
  function info(label, value) { const line = node('p', undefined, 'info-line'); line.append(node('strong', label), node('span', value)); return line; }
  function renderTeams() {
    $('teams').replaceChildren();
    for (const t of state.snapshot.teams) {
      const button = node('button', t.name); button.setAttribute('aria-pressed', String(t.id === state.team));
      button.addEventListener('click', () => { state.team = t.id; renderTeams(); renderTasks(); [...$('teams').children].find(b => b.getAttribute('aria-pressed') === 'true')?.focus(); }); $('teams').append(button);
    }
    $('team-title').textContent = team()?.name ?? '미연동';
    const graph = $('graph'); graph.replaceChildren();
    if (!team()) { graph.append(node('p', '연결된 팀 정의가 없습니다.', 'empty')); return; }
    const members = node('div', undefined, 'members');
    for (const role of team().roles) {
      const wrap = node('div', undefined, role.role === 'leader' ? 'leader' : 'node-wrap');
      const button = node('button', undefined, 'node'); const head = node('span', undefined, 'node-top');
      head.append(node('span', role.label, 'node-name'), node('span', statuses[role.status] ?? '확인 불가', `status ${role.status}`));
      button.append(head, node('span', role.model ? `${role.provider} · ${role.model}${role.shared ? ' · 공통' : ''}` : '실제 세션 조회 불가', 'node-model'));
      button.addEventListener('click', () => { state.detail = { kind: 'role', role }; state.tab = 'summary'; renderDetail(); showDialog('detail-dialog', button); }); wrap.append(button);
      if (role.role === 'leader') graph.append(wrap); else members.append(wrap);
    }
    graph.append(members); updateEligibility();
  }
  function renderTasks() {
    $('tasks').replaceChildren();
    const rows = state.tasks.filter(t => t.team_id === state.team);
    if (!rows.length) $('tasks').append(node('p', '아직 이 팀에 요청한 작업이 없습니다.', 'empty'));
    for (const t of rows) {
      const row = node('div', undefined, 'task-row'); const text = node('div', undefined, 'task-copy');
      text.append(node('strong', t.question), node('small', `${taskStates[t.status] ?? '확인 불가'} · ${time(t.created_at)} · 공개 요약 ${t.events.filter(e => e.attribution === 'agent_reported').length}개`));
      const button = node('button', '상세 보기'); button.addEventListener('click', () => { state.detail = { kind: 'task', id: t.id }; state.tab = 'summary'; renderDetail(); showDialog('detail-dialog', button); });
      row.append(text, button); $('tasks').append(row);
    }
    updateEligibility();
  }
  function renderDetail() {
    const detail = state.detail; if (!detail) return;
    document.querySelectorAll('[data-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === state.tab)));
    const content = $('detail-content'); content.replaceChildren();
    const task = detail.kind === 'task' ? state.tasks.find(t => t.id === detail.id) : null;
    const role = detail.kind === 'role' ? team()?.roles.find(r => r.role === detail.role.role) ?? detail.role : null;
    $('detail-title').textContent = role ? role.label : '작업 상세';
    if (state.tab === 'summary') {
      if (role) content.append(info('세션', role.session_id), info('실제 모델', role.model ?? '미확인'), info('상태', statuses[role.status] ?? '확인 불가'), info('조회 시각', time(role.checked_at)), info('범위', '읽기 전용 조사·설계 요청 / 프롬프트상 제한'));
      else if (task) {
        content.append(info('요청', task.question), info('상태', taskStates[task.status] ?? '확인 불가'), info('시작', time(task.created_at)), info('실행 주체', '기존 Paseo 팀장 세션'), info('작업 유형', '읽기 전용 조사·설계'));
        if (!['completed', 'closed'].includes(task.status)) {
          const button = node('button', '웹 작업 추적 닫기'); button.addEventListener('click', async () => {
            button.disabled = true;
            try { await api(`/api/team-tasks/${task.id}/close`, { method: 'POST', headers: { 'x-team-token': state.csrf }, body: '{}' }); await refresh(); }
            catch { content.append(node('p', '추적을 닫지 못했습니다. 다시 시도하세요.')); button.disabled = false; }
          }); content.append(node('p', '실제 에이전트를 중단하지 않습니다. 실행 중단이나 권한 승인은 Paseo에서 처리하세요.', 'muted'), button);
        }
      }
    } else {
      const related = task ? [task] : state.tasks.filter(t => t.team_id === state.team);
      const events = related.flatMap(t => t.events).filter(e => (!role || e.role === role.role || e.to_role === role.role) && (state.tab === 'conversation' ? ['message', 'handoff', 'result'].includes(e.type) : state.tab === 'execution' ? ['bridge', 'execution'].includes(e.type) : e.type === 'change_summary'));
      for (const event of events) {
        const el = node('article', undefined, 'event'); el.append(node('strong', `${roleNames[event.role] ?? '브리지'}${event.to_role ? ` → ${roleNames[event.to_role]}` : ''}`), node('small', `${time(event.at)}${event.attribution ? ' · 담당 게시 요약' : ' · 연결 기록'}`), node('p', event.text)); content.append(el);
      }
      if (!events.length) content.append(node('p', state.tab === 'changes' ? '실제 변경 실행은 미연결입니다. 게시된 변경 제안도 아직 없습니다.' : '이 작업에 게시된 기록이 아직 없습니다. 기존 사적 대화는 가져오지 않습니다.', 'empty'));
    }
    content.append(node('p', '대화는 담당이 명시적으로 게시한 작업 요약입니다. 원문 대화·추론 전문이 아니며, 실행·변경 요약은 담당 보고로서 독립 검증 결과와 구분합니다.', 'detail-note'));
  }
  async function refresh() {
    if (state.busy) return; state.busy = true;
    try {
      const [snapshot, history] = await Promise.all([api('/api/teams'), api('/api/team-tasks')]);
      state.snapshot = snapshot; state.tasks = history.tasks; state.csrf = snapshot.csrf_token;
      if (!snapshot.teams.some(t => t.id === state.team)) state.team = snapshot.teams[0]?.id;
      const fresh = Date.now() - Date.parse(snapshot.checked_at) < 30000;
      $('connection').textContent = `${snapshot.connected && fresh ? 'Paseo 연결됨' : '연결 또는 최신 상태 확인 필요'} · 마지막 조회 ${time(snapshot.checked_at)} · 로컬 운영자 전용`;
      $('connection').classList.toggle('offline', !snapshot.connected || !fresh);
      // 사용자가 키보드로 선택 중인 노드를 매번 교체하지 않습니다.
      const active = document.activeElement;
      const dialogOpen = $('detail-dialog').open || $('request-dialog').open;
      if (!dialogOpen && !$('graph').contains(active) && !$('teams').contains(active)) renderTeams();
      if (!dialogOpen && !$('tasks').contains(active)) renderTasks();
      if ($('detail-dialog').open && !$('detail-content').contains(active)) renderDetail();
    } catch {
      $('connection').textContent = '팀 브리지 오프라인 또는 미연결. 표시된 이전 상태를 현재 정상으로 판단하지 마세요.'; $('connection').classList.add('offline'); state.csrf = null;
    } finally { state.busy = false; updateEligibility(); if (!state.csrf) $('request').disabled = true; }
  }
  $('request').addEventListener('click', () => { $('request-error').textContent = ''; showDialog('request-dialog', $('request')); });
  $('request-form').addEventListener('submit', async event => {
    event.preventDefault(); $('submit').disabled = true;
    const body = { team_id: state.team, question: $('question').value.trim() }, fingerprint = JSON.stringify(body);
    if (state.fingerprint !== fingerprint) { state.fingerprint = fingerprint; state.key = crypto.randomUUID(); }
    try {
      await api('/api/team-tasks', { method: 'POST', headers: { 'x-team-token': state.csrf, 'idempotency-key': state.key }, body: JSON.stringify(body) });
      $('request-dialog').close(); $('question').value = ''; state.key = null; state.fingerprint = null; await refresh();
    } catch (error) { $('request-error').textContent = errors[error.message] ?? '접수 여부를 확인하지 못했습니다. 같은 내용으로 다시 누르면 같은 요청 키를 사용합니다.'; }
    finally { $('submit').disabled = false; }
  });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  for (const id of ['detail-dialog', 'request-dialog']) $(id).addEventListener('close', () => { if (state.trigger?.isConnected) state.trigger.focus(); });
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { state.tab = button.dataset.tab; renderDetail(); }));
  $('refresh').addEventListener('click', refresh); refresh(); setInterval(refresh, 5000);
})();
