// D1 batch의 트랜잭션으로 중복·다중 Worker 예산 경쟁을 막는다.
export async function rcaStoreReady(db) {
  try { await db.prepare('SELECT id FROM rca_runs LIMIT 1').first(); return true; } catch { return false; }
}
export async function reserveRun(db, { id, key, day, now, config }) {
  await expireRuns(db, now);
  const r = config.reserveMicros;
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO rca_budget(day) VALUES(?)').bind(day),
    db.prepare(`INSERT OR IGNORE INTO rca_runs(id,idempotency_key,budget_day,reservation,started_at,expires_at)
      SELECT ?,?,?,?,?,? FROM rca_budget WHERE day=? AND reserved_micros+spent_micros+?<=?
      AND (SELECT COUNT(*) FROM rca_runs WHERE settled=0 AND reserved=1)<?`)
      .bind(id, key, day, r, now, now + config.limits.elapsedMs + 60000, day, r, config.dailyMicros, config.concurrency),
    db.prepare(`UPDATE rca_budget SET reserved_micros=reserved_micros+?,active=active+1
      WHERE day=? AND EXISTS(SELECT 1 FROM rca_runs WHERE id=? AND reserved=0)` ).bind(r, day, id),
    db.prepare('UPDATE rca_runs SET reserved=1 WHERE id=? AND reserved=0').bind(id),
  ]);
  const row = await db.prepare('SELECT id,status,report_json FROM rca_runs WHERE idempotency_key=?').bind(key).first();
  if (!row) return { accepted: false, error: 'budget_or_concurrency_limit' };
  return { accepted: row.id === id, duplicate: row.id !== id, id: row.id, status: row.status };
}
export async function settleRun(db, id, report, usage) {
  const row = await db.prepare('SELECT reservation,budget_day FROM rca_runs WHERE id=?').bind(id).first();
  if (!row) throw new Error('run_missing');
  const charged = usage.usage_uncertain ? row.reservation : Math.min(row.reservation, usage.spent_micros);
  await db.batch([
    db.prepare(`UPDATE rca_budget SET reserved_micros=reserved_micros-?,spent_micros=spent_micros+?,active=active-1
      WHERE day=? AND EXISTS(SELECT 1 FROM rca_runs WHERE id=? AND settled=0 AND reserved=1)`)
      .bind(row.reservation, charged, row.budget_day, id),
    db.prepare(`UPDATE rca_runs SET settled=1,status=?,charged_micros=?,usage_uncertain=?,report_json=? WHERE id=? AND settled=0`)
      .bind(report.run_status, charged, usage.usage_uncertain ? 1 : 0, JSON.stringify(report), id),
  ]);
}
export async function expireRuns(db, now) {
  const { results } = await db.prepare('SELECT id FROM rca_runs WHERE settled=0 AND expires_at<? LIMIT 20').bind(now).all();
  for (const r of results) await settleRun(db, r.id, { version: 2, run_id: r.id, run_status: 'incomplete', cause_outcome: 'not_analyzable', error_code: 'connection_or_worker_ended', observations: [], notice: '연결 또는 실행이 끝났습니다. 진행 중이던 호출의 사용량은 불확정입니다.' }, { usage_uncertain: true });
}
export async function getRun(db, id) {
  return db.prepare('SELECT id,status,report_json FROM rca_runs WHERE id=?').bind(id).first();
}
export async function requestCancel(db, id) {
  const r = await db.prepare("UPDATE rca_runs SET cancel_requested=1 WHERE id=? AND settled=0").bind(id).run();
  return r.meta.changes > 0;
}
export async function wasCancelled(db, id) {
  const r = await db.prepare('SELECT cancel_requested,settled FROM rca_runs WHERE id=?').bind(id).first();
  return !r || Boolean(r.cancel_requested) || Boolean(r.settled);
}
