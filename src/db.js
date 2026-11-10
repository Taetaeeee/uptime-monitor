// D1 데이터베이스 접근 함수 모음
// SQL을 이 파일에 모아 두면, 스키마가 바뀌었을 때 고칠 곳이 한 군데입니다.

/**
 * 활성화된 HTTP 점검 대상을 모두 가져온다.
 * DB 컬럼 이름(snake_case)을 JS에서 쓰기 편한 이름(camelCase)으로 바꿔서 돌려줍니다.
 */
export async function getActiveMonitors(db) {
  const { results } = await db
    .prepare(
      `SELECT id, name, kind, url, expected_status, keyword, max_response_ms
         FROM monitors
        WHERE is_active = 1 AND kind = 'http'`
    )
    .all();

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    url: row.url,
    expectedStatus: row.expected_status,
    keyword: row.keyword,
    maxResponseMs: row.max_response_ms,
  }));
}

/**
 * 대상별 현재 상태를 모두 가져온다. (대상 수가 적어서 전체 조회로 충분)
 * @returns {Promise<Map<number, object>>}  monitorId → 상태 (state.js의 initialState()와 같은 모양)
 */
export async function getMonitorStates(db) {
  const { results } = await db
    .prepare(
      `SELECT monitor_id, state, consecutive_failures, consecutive_successes, failing_since, changed_at
         FROM monitor_state`
    )
    .all();

  return new Map(
    results.map((row) => [
      row.monitor_id,
      {
        state: row.state,
        consecutiveFailures: row.consecutive_failures,
        consecutiveSuccesses: row.consecutive_successes,
        failingSince: row.failing_since,
        changedAt: row.changed_at,
      },
    ])
  );
}

/**
 * 점검 결과와 대상별 새 상태를 한 번에 저장한다.
 *
 * 왜 상태도 같은 batch에 넣나?
 *   상태는 점검 결과에서 계산된 값이라, 결과만 저장되고 상태는 안 바뀌면(또는 그 반대)
 *   다음 회차의 연속 횟수가 어긋납니다. 둘을 한 묶음으로 저장해서 이런 어긋남을 막아요.
 *
 * db.batch를 쓰는 이유:
 *  - DB 왕복이 한 번으로 줄어듭니다.
 *  - batch는 한 묶음으로 실행돼서, 중간에 실패하면 일부만 저장되는 일이 없습니다.
 *    (D1 batch의 트랜잭션 동작 → 공식 문서에서 확인할 부분)
 *
 * '?1, ?2 ...' 자리표시자를 쓰는 이유: 값을 SQL 문자열에 직접 이어 붙이면
 * SQL 인젝션 위험이 생깁니다. bind로 넘기면 DB가 값으로만 취급해요.
 */
export async function saveCheckResults(db, rows, states = []) {
  if (rows.length === 0 && states.length === 0) return;

  // source는 'real'로 고정합니다. 이 함수는 Cron의 실제 점검 결과만 저장하기 때문이에요.
  // (DB 기본값도 'real'이지만, 기본값에 기대지 않고 코드에 의도를 드러냅니다)
  const stmt = db.prepare(
    `INSERT INTO check_results
       (monitor_id, checked_at, is_success, is_slow, status_code, response_ms, failure_reason, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'real')`
  );

  // "있으면 갱신, 없으면 추가" (upsert). monitor_id가 기본 키라서 ON CONFLICT로 처리할 수 있어요.
  const stateStmt = db.prepare(
    `INSERT INTO monitor_state
       (monitor_id, state, consecutive_failures, consecutive_successes, failing_since, last_checked_at, changed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (monitor_id) DO UPDATE SET
       state                 = excluded.state,
       consecutive_failures  = excluded.consecutive_failures,
       consecutive_successes = excluded.consecutive_successes,
       failing_since         = excluded.failing_since,
       last_checked_at       = excluded.last_checked_at,
       changed_at            = excluded.changed_at`
  );

  await db.batch([
    ...rows.map((r) =>
      stmt.bind(
        r.monitorId,
        r.checkedAt,
        r.isSuccess ? 1 : 0, // boolean → 0/1
        r.isSlow ? 1 : 0,
        r.statusCode,
        r.responseMs,
        r.failureReason
      )
    ),
    ...states.map((s) =>
      stateStmt.bind(
        s.monitorId,
        s.state,
        s.consecutiveFailures,
        s.consecutiveSuccesses,
        s.failingSince,
        s.lastCheckedAt,
        s.changedAt
      )
    ),
  ]);
}

/**
 * 알림 1건을 기록한다. (channels/log.js가 사용)
 */
export async function insertNotification(db, n) {
  await db
    .prepare(
      `INSERT INTO notifications
         (monitor_id, event, channel, message, failure_reason, created_at, source)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    )
    .bind(n.monitorId, n.event, n.channel, n.message, n.failureReason, n.createdAt, n.source)
    .run();
}

// ─────────────────────────────────────────────
// 일별 집계 (B-3)
// ─────────────────────────────────────────────

/**
 * 한 대상의 [startUtc, endUtc) 구간 점검 결과를 가져온다. (일별 집계 계산용)
 * (monitor_id, checked_at) 복합 인덱스 덕분에 해당 대상·구간만 바로 읽습니다.
 */
export async function getResultsInRange(db, monitorId, startUtc, endUtc) {
  const { results } = await db
    .prepare(
      `SELECT is_success, is_slow, response_ms
         FROM check_results
        WHERE monitor_id = ?1 AND checked_at >= ?2 AND checked_at < ?3`
    )
    .bind(monitorId, startUtc, endUtc)
    .all();
  return results.map((r) => ({
    isSuccess: r.is_success === 1,
    isSlow: r.is_slow === 1,
    responseMs: r.response_ms,
  }));
}

/**
 * 일별 집계를 저장한다 (있으면 덮어쓰기). Cron의 실제 점검에서 계산한 값이라 source = 'real'.
 */
export async function upsertDailyStats(db, stats, updatedAt) {
  if (stats.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO daily_stats
       (monitor_id, day, total_checks, success_checks, slow_checks, avg_response_ms, source, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'real', ?7)
     ON CONFLICT (monitor_id, day) DO UPDATE SET
       total_checks    = excluded.total_checks,
       success_checks  = excluded.success_checks,
       slow_checks     = excluded.slow_checks,
       avg_response_ms = excluded.avg_response_ms,
       updated_at      = excluded.updated_at`
  );
  await db.batch(
    stats.map((s) =>
      stmt.bind(s.monitorId, s.day, s.totalChecks, s.successChecks, s.slowChecks, s.avgResponseMs, updatedAt)
    )
  );
}

// ─────────────────────────────────────────────
// 상태 페이지 조회 (B-3)
// 공개 화면에 쓰이므로 점검 주소(url) 같은 불필요한 값은 아예 조회하지 않습니다.
// ─────────────────────────────────────────────

/** 모든 대상 + 현재 상태 + 가장 최근 점검 결과 1건 */
export async function getStatusMonitors(db) {
  const { results } = await db
    .prepare(
      `SELECT m.id, m.name, m.source, m.is_active,
              s.state,
              r.checked_at  AS last_checked_at,
              r.response_ms AS last_response_ms
         FROM monitors m
         LEFT JOIN monitor_state s ON s.monitor_id = m.id
         -- 대상별 "가장 최근 결과 1건": 복합 인덱스로 대상마다 맨 끝 1행만 읽습니다
         LEFT JOIN check_results r ON r.id = (
                SELECT id FROM check_results
                 WHERE monitor_id = m.id
                 ORDER BY checked_at DESC
                 LIMIT 1)
        ORDER BY m.id`
    )
    .all();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    source: r.source,
    isActive: r.is_active === 1,
    state: r.state, // 상태 행이 없으면 null
    lastCheckedAt: r.last_checked_at,
    lastResponseMs: r.last_response_ms,
  }));
}

/** fromDay(KST, 포함) 이후의 모든 대상 일별 집계 */
export async function getDailyStatsSince(db, fromDay) {
  const { results } = await db
    .prepare(
      `SELECT monitor_id, day, total_checks, success_checks, slow_checks, avg_response_ms
         FROM daily_stats
        WHERE day >= ?1`
    )
    .bind(fromDay)
    .all();
  return results.map((r) => ({
    monitorId: r.monitor_id,
    day: r.day,
    totalChecks: r.total_checks,
    successChecks: r.success_checks,
    slowChecks: r.slow_checks,
    avgResponseMs: r.avg_response_ms,
  }));
}

/** 최근 알림 N건 (최신 순) + 대상 이름 */
export async function getRecentNotifications(db, limit) {
  const { results } = await db
    .prepare(
      `SELECT n.id, n.monitor_id, m.name AS monitor_name, n.event, n.message, n.created_at, n.source
         FROM notifications n
         JOIN monitors m ON m.id = n.monitor_id
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT ?1`
    )
    .bind(limit)
    .all();
  return results.map((r) => ({
    id: r.id,
    monitorId: r.monitor_id,
    monitorName: r.monitor_name,
    event: r.event,
    message: r.message,
    createdAt: r.created_at,
    source: r.source,
  }));
}
