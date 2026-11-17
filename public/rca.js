// 토큰은 이 페이지 메모리에만 둔다. 보고서/모델 문구는 textContent로만 표시한다.
(() => {
  const $ = id => document.getElementById(id);
  const make = (tag, text) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
  let capability, active = false, controller, runId, currentToken;
  const mode = () => document.querySelector('input[name="mode"]:checked').value;
  function status(text) { $('rca-status').textContent = text; }
  function busy(value) {
    active = value;
    $('rca-start').disabled = value || !capability?.ready;
    $('rca-cancel').disabled = !value;
    for (const input of document.querySelectorAll('#rca-form select,#rca-form input')) input.disabled = value;
    $('rca-form').setAttribute('aria-busy', String(value));
  }
  function populate() {
    $('rca-target').replaceChildren();
    const live = mode() === 'live';
    $('mode-help').textContent = live ? '등록되고 활성화된 내 서비스만 선택할 수 있습니다. 저장 기록과 새 측정을 구분합니다.' : '가상 장애 상황의 관측을 순서대로 엽니다. 실제 서비스 장애나 RCAEval 실험이 아닙니다.';
    for (const target of live ? capability?.targets ?? [] : capability?.cases ?? []) {
      const opt = make('option', live ? `${target.alias} · ${target.channels.join(' / ')}` : target.label);
      opt.value = target.id; $('rca-target').append(opt);
    }
    if (!$('rca-target').options.length) { const opt = make('option', '허용된 대상이 없습니다'); opt.value = ''; $('rca-target').append(opt); }
  }
  async function loadCapabilities() {
    try {
      const res = await fetch('/api/rca/capabilities', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      capability = await res.json();
      $('rca-setup').replaceChildren(make('strong', capability.ready ? 'AI 조사 준비 완료' : 'AI 설정이 필요합니다'));
      $('rca-setup').append(make('span', capability.ready ? '실행 토큰으로 시작할 수 있습니다. 모델 호출에는 서버 비용 한도가 적용됩니다.' : '서버 API 키·모델·요금·예산·실행 토큰과 분석 저장소를 설정한 뒤 시작할 수 있습니다. 현재 유료 호출은 실행되지 않습니다.'));
      if (capability.verification_only) $('rca-setup').append(make('strong', '로컬 검증 화면 · 모델 전송은 대역입니다. 실제 LLM 실행 결과가 아닙니다.'));
      populate(); busy(false);
    } catch {
      $('rca-setup').replaceChildren(make('strong', '서버 상태를 확인하지 못했습니다.'));
      const retry = make('button', '다시 확인'); retry.type = 'button'; retry.className = 'rca-button'; retry.onclick = loadCapabilities; $('rca-setup').append(retry);
    }
  }
  const outcome = { candidate: '원인 후보 있음 · 미확정', deferred: '근거 부족 · 판단 보류', no_anomaly_observed: '관측 범위에서 이상 없음', not_analyzable: '분석 완료하지 못함' };
  function renderReport(r) {
    $('rca-report').hidden = false;
    $('report-mode').textContent = r.mode === 'live' ? '실제 관측' : r.mode === 'synthetic' ? '합성 시나리오' : '중단 기록';
    $('rca-conclusion').replaceChildren(make('h3', outcome[r.cause_outcome] ?? '미완료'));
    $('rca-conclusion').append(make('p', r.model_report?.summary ?? r.notice ?? `분석 미완료: ${r.error_code ?? '알 수 없음'}`));
    for (const h of r.model_report?.hypotheses ?? []) $('rca-conclusion').append(make('p', `미확정 가설: ${h.hypothesis} (근거 ${h.evidence_ids.join(', ')})`));
    $('time-help').textContent = r.mode === 'synthetic' ? '시각은 시나리오 시작 후 상대 초입니다. 실제 사건 시각이 아닙니다.' : '시각은 UTC epoch 초입니다. 저장된 점검과 새 측정은 아래 출처로 구분합니다. HTTP 응답 시간은 헤더 수신까지이며 본문은 검사하지 않습니다.';
    $('rca-evidence').replaceChildren();
    for (const e of r.observations ?? []) {
      const card = make('article');
      card.append(make('strong', `${e.channel.toUpperCase()} · ${e.observation_kind === 'new_measurement' ? '새 측정' : e.observation_kind === 'stored_history' ? '저장 기록' : '합성 관측'}`),
        make('div', `관측 시각 ${e.observed_at} · ${e.provenance}`), make('div', e.evidence_id), make('pre', JSON.stringify(e.facts, null, 2)));
      $('rca-evidence').append(card);
    }
    for (const [id, values] of [['rca-unknowns', r.model_report?.unknowns], ['rca-next', r.model_report?.next_actions]]) {
      $(id).replaceChildren(...(values?.length ? values : ['완료된 모델 보고 없음']).map(s => make('li', s)));
    }
    $('usage-note').textContent = r.usage ? `모델 요청 ${r.usage.calls}회 · ${r.usage.usage_uncertain ? '사용량 불확정: 예산 예약을 보수적으로 유지합니다.' : '사용량 응답 수신. 정산은 서버 기록 기준입니다.'}` : '';
    $('run-badge').textContent = r.run_status === 'completed' ? '완료' : r.run_status === 'failed' ? '실패' : '미완료';
    status(r.run_status === 'completed' ? '조사가 끝났습니다. 아래 보고서에서 관측과 가설을 확인하세요.' : `분석을 완료하지 못했습니다. ${r.error_code ?? ''}`);
    $('rca-report').focus({ preventScroll: true });
  }
  function event(e) {
    if (e.run_id) { runId = e.run_id; $('rca-permalink').hidden = false; $('rca-permalink').href = `/rca.html?run=${encodeURIComponent(runId)}`; }
    if (e.type === 'report') { renderReport(e.report); return; }
    if (e.type === 'error') throw new Error(e.error);
    $('rca-empty').hidden = true;
    if (e.message) { const li = make('li', `${e.step ? `${e.step}단계 · ` : ''}${e.tool ? `${e.tool} · ` : ''}${e.message}`); $('rca-log').append(li); status(e.message); }
    while ($('rca-log').children.length > 80) $('rca-log').firstChild.remove();
  }
  $('rca-form').addEventListener('submit', async e => {
    e.preventDefault(); if (active || !capability?.ready) return;
    currentToken = $('rca-token').value.trim();
    if (!currentToken) { status('운영자 실행 토큰을 입력하세요.'); $('rca-token').focus(); return; }
    if (!$('rca-target').value) { status('허용된 조사 대상을 먼저 선택하세요.'); return; }
    const selectedMode = mode();
    const body = selectedMode === 'live' ? { mode: selectedMode, monitor_id: Number($('rca-target').value) } : { mode: selectedMode, case_id: $('rca-target').value };
    controller = new AbortController(); runId = null; busy(true);
    $('rca-log').replaceChildren(); $('rca-report').hidden = true; $('rca-permalink').hidden = true; $('run-badge').textContent = '진행 중';
    try {
      const res = await fetch('/api/rca/analyze', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}`, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
      if (!res.ok) { const data = await res.json(); throw new Error(({ unauthorized: '실행 토큰이 맞지 않습니다.', model_not_configured: '서버 AI 설정이 필요합니다.', storage_not_ready: '분석 저장소가 준비되지 않았습니다.', budget_or_concurrency_limit: '예산 또는 동시 실행 한도입니다.', target_not_allowed: '현재 허용되지 않은 대상입니다.' })[data.error] ?? '분석 요청을 처리하지 못했습니다.'); }
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let buffer = '', hasReport = false;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 300000) throw new Error('응답 크기 한도를 넘었습니다.');
        let i;
        while ((i = buffer.indexOf('\n')) !== -1) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); if (line) { const item = JSON.parse(line); if (item.type === 'report') hasReport = true; event(item); } }
      }
      if (!hasReport) throw new Error('완료 보고서를 받지 못했습니다. 저장된 보고서에서 상태를 확인하세요.');
    } catch (err) { $('run-badge').textContent = '미완료'; status(controller.signal.aborted ? '중단을 요청했습니다. 진행 중이던 호출의 과금은 불확정일 수 있습니다. 저장된 보고서에서 상태를 확인하세요.' : err.message); }
    finally { busy(false); $('rca-token').value = ''; currentToken = null; }
  });
  $('rca-cancel').addEventListener('click', () => {
    // 로컬 중단으로 submit finally가 토큰을 지우기 전에 별도 취소 요청 값을 보존한다.
    const cancelRunId = runId, cancelToken = currentToken;
    $('rca-cancel').disabled = true;
    controller?.abort();
    status('이 연결을 중단했습니다. 서버에도 중단을 요청하지만 이미 진행된 모델 처리·과금 중단은 보장하지 않습니다.');
    if (cancelRunId && cancelToken) {
      void fetch(`/api/rca/cancel/${cancelRunId}`, { method: 'POST', signal: AbortSignal.timeout(3000),
        headers: { Authorization: `Bearer ${cancelToken}` } }).catch(() => {
        // 서버 취소 전달이 실패해도 로컬 연결은 이미 중단됐다. 새 실행의 화면을 덮지 않는다.
      });
    }
  });
  for (const radio of document.querySelectorAll('input[name="mode"]')) radio.addEventListener('change', populate);
  $('rca-theme').addEventListener('click', () => { const light = document.documentElement.dataset.theme !== 'light'; document.documentElement.dataset.theme = light ? 'light' : 'dark'; try { localStorage.setItem('um-theme', light ? 'light' : 'dark'); } catch { /* 저장이 막혀도 현재 화면은 전환한다. */ } $('rca-theme').textContent = light ? '어두운 화면' : '밝은 화면'; });
  $('rca-theme').textContent = document.documentElement.dataset.theme === 'light' ? '어두운 화면' : '밝은 화면';
  addEventListener('pagehide', () => { $('rca-token').value = ''; currentToken = null; controller?.abort(); });
  void loadCapabilities();
  const saved = new URLSearchParams(location.search).get('run');
  if (saved && /^rca-[a-f0-9-]{36}$/.test(saved)) fetch(`/api/rca/reports/${saved}`, { cache: 'no-store' }).then(r => r.json()).then(data => { if (data.report) renderReport(data.report); else status(data.status === 'running' ? '완료 보고서가 아직 없습니다. 연결 이탈 뒤 완료를 보장하지 않습니다.' : '보고서를 찾지 못했습니다.'); }).catch(() => status('저장된 보고서를 불러오지 못했습니다.'));
})();
