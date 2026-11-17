import { randomUUID } from 'node:crypto';

export const ROLES = Object.freeze([
  { id: 'coordinator', name: '조사 팀장', kind: '규칙 계획', instruction: '질문을 ERP 실습 대상의 증상으로 기록하고, 허용된 점검 순서를 정하세요.' },
  { id: 'network', name: 'DNS·네트워크 검사', kind: '실측 도구', instruction: '내부 DNS 해석, ERP 업무 HTTP, 수집기에서 DB로 가는 TCP 연결을 검사하세요. 관측 위치를 구분하세요.' },
  { id: 'server', name: '서버·로그 검사', kind: '실측 도구', instruction: 'ERP 프로세스 생존·컨테이너 자원·정제 로그를 확인하고 업무 요청 ID와 대조하세요.' },
  { id: 'analysis', name: '원인 후보 비교', kind: '규칙 판단', instruction: '실패 관측과 원인 가설을 구분하고 지지 근거·부족한 근거·다음 확인을 정리하세요.' },
  { id: 'followup', name: '추가 점검', kind: '실측 도구', instruction: '실패 또는 관측 누락이 있으면 같은 등록 대상만 한 번 재검사하고 변화 여부를 기록하세요.' },
  { id: 'report', name: '결과 보고', kind: '규칙 보고', instruction: '확인된 사실·원인 후보·미확정 사항·사람이 확인할 조치를 근거와 함께 보고하세요.' },
]);
export const TERMINAL = new Set(['completed', 'incomplete', 'failed', 'cancelled']);

export function createRun(question, key, now = Date.now()) {
  if (typeof question !== 'string' || !question.trim() || question.length > 600) throw new Error('invalid_question');
  return { id: `wf-${randomUUID()}`, key, question: question.trim(), target_id: 'erp',
    executor: 'rules', llm_executed: false, source: 'real', environment: 'lab',
    status: 'queued', created_at: new Date(now).toISOString(), ended_at: null,
    cancel_requested: false, revision: 0, events: [], report: null,
    steps: ROLES.map(role => ({ ...role, status: 'waiting', started_at: null, ended_at: null,
      input: '', output: [], evidence: [], handoff: null })) };
}
export function compareEvidence(network, server) {
  const list = network?.observations ?? [];
  const find = channel => list.find(row => row.channel === channel);
  const dns = find('dns'), http = find('http'), tcp = find('tcp');
  const support = list.filter(row => row.ok === false).map(row => row.id);
  let summary, candidate;
  if (dns?.ok === false) {
    summary = '수집기에서 내부 이름 해석이 실패했습니다.'; candidate = '내부 DNS 해석 경로 우선 확인';
  } else if (http?.ok === false && tcp?.ok === false) {
    summary = '업무 조회와 수집기→DB 연결이 함께 실패했습니다.'; candidate = 'DB 호출·접속 경로 우선 확인';
  } else if (http?.ok === false) {
    summary = '업무 조회가 실패했습니다. DB TCP 성공만으로 SQL 정상 여부는 알 수 없습니다.'; candidate = 'ERP 업무 처리·DB 호출 오류 확인';
  } else if (tcp?.ok === false) {
    summary = '업무 조회는 성공했지만 수집기→DB 연결 검사에서 실패했습니다.'; candidate = '관측 지점·시점에 따른 연결 차이 확인';
  } else if (http?.ok === true && dns?.ok === true && tcp?.ok === true) {
    summary = '이번 점검에서 DNS·업무 조회·DB TCP 검사가 성공했습니다. 이전 장애가 없었다는 뜻은 아닙니다.';
  } else { summary = '필수 관측이 없어 현재 원인을 판단할 수 없습니다.'; }
  const complete = list.length === 3 && list.every(row => typeof row.ok === 'boolean');
  const needsMore = !complete || list.some(row => row.ok === false) || server?.process_ok !== true;
  return { summary, cause_outcome: candidate ? 'candidate' : complete && !needsMore ? 'no_anomaly_observed' : 'deferred',
    candidates: candidate ? [{ title: candidate, status: 'unconfirmed', evidence_ids: support }] : [],
    needs_more: needsMore, internal_cause_confirmed: false,
    unknowns: ['DB 프로세스·방화벽·연결 수의 내부 상태를 직접 확인하지 않았습니다.',
      '실제 LLM은 호출하지 않았고 등록된 규칙으로 결과를 분류했습니다.'],
    next_actions: needsMore ? ['DB 서비스 상태·관련 로그를 관리자가 확인하세요.', '조치 후 동일 ERP 업무 조회로 복구를 확인하세요.'] : ['증상이 지속되면 발생 시각과 사용자 경로의 추가 근거를 확인하세요.'] };
}

export async function executeRun(run, { network, server, persist, now = Date.now, timeoutMs = 30000 }) {
  const started = now();
  let net, host, analysis, repeated;
  const stamp = () => new Date(now()).toISOString();
  const event = (type, step, message) => run.events.push({ id: randomUUID(), type, step_id: step?.id ?? null, at: stamp(), message });
  async function save() { run.revision++; await persist(run); }
  function boundary() {
    if (run.cancel_requested) throw new Error('cancelled');
    if (now() - started > timeoutMs) throw new Error('time_limit');
  }
  async function step(id, task, input) {
    boundary();
    const node = run.steps.find(item => item.id === id);
    node.input = input; node.status = 'running'; node.started_at = stamp();
    event('started', node, `${node.name} 시작`); await save(); boundary();
    const result = await task();
    node.output = result.output; node.evidence = result.evidence ?? [];
    node.status = result.skipped ? 'skipped' : 'completed'; node.ended_at = stamp();
    const next = run.steps[run.steps.indexOf(node) + 1];
    if (next && !run.cancel_requested) node.handoff = { to: next.id, instruction: result.next ?? next.instruction,
      evidence_ids: node.evidence.map(row => row.id) };
    event(node.status, node, node.output[0] ?? '단계 완료'); await save(); boundary();
  }
  try {
    run.status = 'running'; await save();
    await step('coordinator', async () => ({ output: ['대상: ERP 내부 실습 환경. 질문은 증상 설명으로만 기록했습니다.',
      'DNS·업무 HTTP·수집기 TCP → 프로세스·로그 → 후보 비교 → 필요 시 1회 재검사 순서입니다.'],
      next: 'ERP 이름 해석과 업무 응답, 수집기→DB TCP를 실제 검사하고 위치·시각·근거 ID를 전달하세요.' }), run.question);
    await step('network', async () => {
      net = await network();
      return { output: net.summary, evidence: net.observations,
        next: '앞선 업무 요청 ID에 해당하는 앱 로그와 프로세스 생존을 확인하세요. 수집기 TCP를 ERP 직접 측정으로 바꾸어 해석하지 마세요.' };
    }, run.steps[0].handoff.instruction);
    await step('server', async () => {
      host = await server(net);
      return { output: host.summary, evidence: host.observations,
        next: '이전 단계의 관측·앱 로그를 비교해 원인 후보와 부족한 근거를 정리하세요. 내부 원인을 확정하지 마세요.' };
    }, run.steps[1].handoff.instruction);
    await step('analysis', async () => {
      analysis = compareEvidence(net, host);
      return { output: [analysis.summary, ...analysis.candidates.map(item => `미확정 후보: ${item.title}`)],
        evidence: [...net.observations, ...host.observations],
        next: analysis.needs_more ? '실패 또는 관측 누락이 있습니다. 같은 고정 대상의 네트워크와 서버 근거를 1회 재검사하세요.' : '현재 실패가 재현되지 않았습니다. 추가 전송을 생략하고 그 범위로 보고하세요.' };
    }, run.steps[2].handoff.instruction);
    await step('followup', async () => {
      if (!analysis.needs_more) return { output: ['현재 실패가 재현되지 않아 추가 검사를 실행하지 않았습니다.'], skipped: true };
      const newerNet = await network(); boundary();
      const newerHost = await server(newerNet);
      repeated = { network: newerNet, server: newerHost };
      const compared = compareEvidence(newerNet, newerHost);
      return { output: ['허용된 추가 검사 1회를 실제 실행했습니다.', compared.summary,
        '재검사 전·후의 시각과 근거를 따로 보존합니다.'], evidence: [...newerNet.observations, ...newerHost.observations],
        next: '초기 관측과 추가 관측의 변화·미확정 항목을 구분해 최종 보고서를 작성하세요.' };
    }, run.steps[3].handoff.instruction);
    await step('report', async () => {
      run.report = { ...compareEvidence(repeated?.network ?? net, repeated?.server ?? host),
        initial_summary: analysis.summary, additional_executed: Boolean(repeated), source: 'real', environment: 'lab',
        executor: 'rules', llm_executed: false, generated_at: stamp() };
      return { output: [run.report.summary, ...run.report.unknowns, ...run.report.next_actions],
        evidence: run.steps.slice(1, 5).flatMap(item => item.evidence).filter((row, i, rows) => rows.findIndex(other => other.id === row.id) === i) };
    }, run.steps[4].handoff.instruction);
    run.status = 'completed';
  } catch (error) {
    run.status = error.message === 'cancelled' ? 'cancelled' : error.message === 'time_limit' ? 'incomplete' : 'failed';
    for (const node of run.steps) {
      if (node.status === 'running') { node.status = run.status === 'cancelled' ? 'cancelled' : 'failed'; node.ended_at = stamp(); }
      if (node.status === 'waiting') node.status = 'skipped';
    }
    event('stopped', null, run.status === 'cancelled' ? '사용자가 후속 실행을 중단했습니다.' : '실행 또는 저장을 완료하지 못했습니다. 확보된 근거 범위만 확인하세요.');
  }
  run.ended_at = stamp(); await save();
  return run;
}
