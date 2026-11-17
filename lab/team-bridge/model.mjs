// 브라우저에는 명시적으로 고른 상태와 작업 요약만 전달합니다.
export const ROLE_NAMES = { leader: '팀장', planner: 'A · 기획·조사', implementer: 'B · 구현', reviewer: 'C · 교차 리뷰', release: 'D · 문서', 'final-review': 'E · 최종 검수' };
export const TASK_ID = /^task-[a-f0-9-]{36}$/;
export function redact(value) {
  return String(value ?? '').slice(0, 10000)
    .replace(/(?:https?:\/\/)?[a-z0-9.-]+\.workers\.dev\b/gi, '[계정 주소 제외]')
    .replace(/\b(?:sk-[\w-]{8,}|Bearer\s+[^\s]+)\b/gi, '[비밀 값 제외]')
    .replace(/\b(?:api[_-]?key|token|password|secret|database_id)\s*[:=]\s*["']?[^\s,"'}]+/gi, '[비밀·계정 값 제외]')
    .replace(/[A-Za-z]:[\\/](?:[^\s\n<>"']+)/g, '[로컬 경로 제외]');
}
export function sessionView(raw, expectedId) {
  if (raw?.Id !== expectedId || raw.Archived || typeof raw.Provider !== 'string' || typeof raw.Model !== 'string') throw new Error('invalid_session');
  const statuses = { idle: 'idle', running: 'running', closed: 'closed', initializing: 'starting', error: 'error', waiting: 'waiting' };
  return { session_id: raw.Id, name: redact(raw.Name), provider: raw.Provider, model: raw.Model,
    status: raw.PendingPermissions?.length ? 'approval_required' : statuses[raw.Status] ?? 'unknown',
    mode: String(raw.Mode ?? 'unknown'), checked_at: new Date().toISOString() };
}
export function reportView(body, roles) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(k => !['role', 'type', 'text', 'to_role'].includes(k))) throw new Error('invalid_report');
  if (!roles.includes(body.role) || !['message', 'handoff', 'result', 'execution', 'change_summary'].includes(body.type) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000 || body.to_role && !roles.includes(body.to_role)) throw new Error('invalid_report');
  return { role: body.role, type: body.type, text: redact(body.text.trim()), ...(body.to_role ? { to_role: body.to_role } : {}),
    attribution: 'agent_reported', at: new Date().toISOString() };
}
export function taskView(task) {
  const { key, event_secret, ...view } = task;
  return structuredClone(view);
}
