// D1 데이터베이스 접근 함수 모음
// SQL을 이 파일에 모아 두면, 스키마가 바뀌었을 때 고칠 곳이 한 군데입니다.

/**
 * Worker의 Cron이 직접 점검하는 활성 대상(HTTP, DNS)을 모두 가져온다.
 * 내부 점검(ping·tcp·disk 등)은 에이전트가 보고하므로 여기서 빠집니다.
 * DB 컬럼 이름(snake_case)을 JS에서 쓰기 편한 이름(camelCase)으로 바꿔서 돌려줍니다.
 */
export async function getActiveMonitors(db) {
  const { results } = await db
    .prepare(
      `SELECT id, name, kind, url, expected_status, keyword, max_response_ms
         FROM monitors
        WHERE is_active = 1 AND kind IN ('http', 'dns')`
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
      `SELECT monitor_id, state, consecutive_failures, consecutive_successes, failing_since, changed_at,
              last_checked_at
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
        // 에이전트 보고의 중복·순서 뒤바뀜 판단에 씁니다 (B-4)
        lastCheckedAt: row.last_checked_at,
      },
    ])
  );
}

/**
 * 에이전트가 보낸 check_key들로 대상을 찾는다. (B-4)
 * 키 개수는 보고 검증에서 50개 이하로 제한되므로 IN (?1, ?2, ...)을 그때그때 만들어도 안전합니다.
 * (값은 여전히 bind로 넘기고, SQL 문자열에는 자리표시자만 이어 붙여요)
 */
export async function getMonitorsByKeys(db, keys) {
  if (keys.length === 0) return [];
  const placeholders = keys.map((_, i) => `?${i + 1}`).join(', ');
  const { results } = await db
    .prepare(
      `SELECT id, name, kind, source, check_key, max_response_ms, threshold
         FROM monitors
        WHERE check_key IN (${placeholders})`
    )
    .bind(...keys)
    .all();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    source: r.source,
    checkKey: r.check_key,
    maxResponseMs: r.max_response_ms,
    threshold: r.threshold,
  }));
}

/**
 * 무응답 감시를 켠 에이전트 대상과 "마지막 실제 보고 회차"를 가져온다. (B-11)
 *
 * 마지막 보고를 monitor_state.last_checked_at으로 보지 않는 이유:
 *   무응답 기록(agent_silent)도 그 값을 갱신하기 때문에, 그걸 쓰면 한 번 기록한 뒤부터
 *   "방금 점검됨"으로 보여 무응답이 풀려 버립니다. 그래서 agent_silent가 아닌 가장 최근 결과를 봅니다.
 *   (monitor_id, checked_at) 인덱스를 거꾸로 훑다가 첫 행에서 멈추므로 비용이 작습니다.
 */
export async function getStaleWatchMonitors(db) {
  const { results } = await db
    .prepare(
      `SELECT m.id, m.name, m.source, m.stale_after_min,
              (SELECT MAX(r.checked_at) FROM check_results r
                WHERE r.monitor_id = m.id AND COALESCE(r.failure_reason, '') <> 'agent_silent') AS last_report_at
         FROM monitors m
        WHERE m.is_active = 1 AND m.stale_after_min IS NOT NULL AND m.check_key IS NOT NULL
          AND m.kind IN ('ping', 'tcp', 'ssl', 'disk', 'service')`
    )
    .all();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    source: r.source,
    staleAfterMin: r.stale_after_min,
    lastReportAt: r.last_report_at,
  }));
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
export async function saveCheckResults(db, rows, states = [], source = 'real', incidents = {}) {
  if (rows.length === 0 && states.length === 0) return;
  const opens = incidents.open ?? [];
  const closes = incidents.close ?? [];

  // source: Cron의 HTTP 점검과 실제 에이전트는 'real', 에이전트 시뮬레이터는 'simulator'.
  // 호출하는 쪽이 출처를 명시하게 해서, 출처 없이 저장되는 일이 없도록 합니다. (CLAUDE.md 가짜 데이터 규칙)
  // value: 디스크 사용률·인증서 남은 일수 같은 측정값 (HTTP 점검은 없음 → NULL)
  const stmt = db.prepare(
    `INSERT INTO check_results
       (monitor_id, checked_at, is_success, is_slow, status_code, response_ms, failure_reason, value, source,
        in_maintenance)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  );

  // 장애 이력 (B-5): 상태 전이와 같은 batch에 넣어서 "상태는 down인데 장애 기록이 없는" 어긋남을 막습니다.
  //   열기: 진행 중 장애가 이미 있으면(부분 UNIQUE 인덱스) 무시 → 중복 장애가 쌓이지 않음
  //   닫기: 그 대상의 진행 중 장애를 복구 처리
  const openStmt = db.prepare(
    `INSERT OR IGNORE INTO incidents (monitor_id, started_at, detected_at, cause, source)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  );
  const closeStmt = db.prepare(
    `UPDATE incidents SET resolved_at = ?2 WHERE monitor_id = ?1 AND resolved_at IS NULL`
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
        r.statusCode ?? null,
        r.responseMs ?? null,
        r.failureReason,
        r.value ?? null,
        source,
        r.inMaintenance ? 1 : 0
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
    ...closes.map((c) => closeStmt.bind(c.monitorId, c.resolvedAt)),
    ...opens.map((o) => openStmt.bind(o.monitorId, o.startedAt, o.detectedAt, o.cause, source)),
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
      `SELECT checked_at, is_success, is_slow, response_ms, in_maintenance, failure_reason
         FROM check_results
        WHERE monitor_id = ?1 AND checked_at >= ?2 AND checked_at < ?3`
    )
    .bind(monitorId, startUtc, endUtc)
    .all();
  return results.map((r) => ({
    checkedAt: r.checked_at, // 서비스 집계(0015)에서 회차별로 묶을 때 사용
    isSuccess: r.is_success === 1,
    isSlow: r.is_slow === 1,
    responseMs: r.response_ms,
    inMaintenance: r.in_maintenance === 1,
    failureReason: r.failure_reason, // 실패 이유 분포(16단계, analysis.js)용
  }));
}

/**
 * 일별 집계를 저장한다 (있으면 덮어쓰기). source는 원본 점검 결과와 같은 출처를 넘겨받습니다.
 * 분석 값(p95·시간대별·실패 이유, 0017)은 JSON 문자열로 함께 저장합니다.
 */
export async function upsertDailyStats(db, stats, updatedAt, source = 'real') {
  if (stats.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO daily_stats
       (monitor_id, day, total_checks, success_checks, slow_checks, avg_response_ms, source, updated_at,
        maintenance_checks, p95_response_ms, hourly, failures)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?8, ?7, ?9, ?10, ?11, ?12)
     ON CONFLICT (monitor_id, day) DO UPDATE SET
       total_checks       = excluded.total_checks,
       success_checks     = excluded.success_checks,
       slow_checks        = excluded.slow_checks,
       avg_response_ms    = excluded.avg_response_ms,
       updated_at         = excluded.updated_at,
       maintenance_checks = excluded.maintenance_checks,
       p95_response_ms    = excluded.p95_response_ms,
       hourly             = excluded.hourly,
       failures           = excluded.failures`
  );
  await db.batch(
    stats.map((s) =>
      stmt.bind(
        s.monitorId, s.day, s.totalChecks, s.successChecks, s.slowChecks, s.avgResponseMs, updatedAt, source,
        s.maintenanceChecks ?? 0,
        s.p95ResponseMs ?? null,
        s.hourly ? JSON.stringify(s.hourly) : null,
        s.failures ? JSON.stringify(s.failures) : null
      )
    )
  );
}

/**
 * 분석 값(0017)이 아직 비어 있는 일별 집계 — 최근 날부터 limit개.
 * Cron이 회차마다 조금씩 원본에서 다시 계산해 채웁니다 (과거 기록 채우기).
 */
export async function getDailyStatsMissingAnalysis(db, limit) {
  const { results } = await db
    .prepare(
      `SELECT monitor_id, day
         FROM daily_stats
        WHERE hourly IS NULL
        ORDER BY day DESC, monitor_id
        LIMIT ?1`
    )
    .bind(limit)
    .all();
  return results.map((r) => ({ monitorId: r.monitor_id, day: r.day }));
}

/** 일별 집계의 분석 열만 채운다 (가동률 숫자는 건드리지 않음) */
export async function updateDailyAnalysis(db, items) {
  if (items.length === 0) return;
  const stmt = db.prepare(
    `UPDATE daily_stats
        SET p95_response_ms = ?3, hourly = ?4, failures = ?5
      WHERE monitor_id = ?1 AND day = ?2`
  );
  await db.batch(
    items.map((s) => stmt.bind(s.monitorId, s.day, s.p95ResponseMs ?? null, JSON.stringify(s.hourly), JSON.stringify(s.failures)))
  );
}

/**
 * 점검들의 fromDay(KST, 포함) 이후 일별 집계 + 분석 열 (서비스 상세 분석, 16단계)
 * 점검당 하루 1행이라 30일이면 점검당 30행만 읽습니다.
 */
export async function getAnalysisStats(db, monitorIds, fromDay) {
  if (monitorIds.length === 0) return [];
  // 점검 id는 서버가 DB에서 읽은 정수라 바인딩 자리표(?)만 개수대로 만듭니다 (값을 SQL 문자열에 넣지 않음)
  const marks = monitorIds.map((_, i) => `?${i + 2}`).join(', ');
  const { results } = await db
    .prepare(
      `SELECT monitor_id, day, avg_response_ms, p95_response_ms, hourly, failures
         FROM daily_stats
        WHERE day >= ?1 AND monitor_id IN (${marks})`
    )
    .bind(fromDay, ...monitorIds)
    .all();
  return results.map((r) => ({
    monitorId: r.monitor_id,
    day: r.day,
    avgResponseMs: r.avg_response_ms,
    p95ResponseMs: r.p95_response_ms,
    hourly: r.hourly,
    failures: r.failures,
  }));
}

// ─────────────────────────────────────────────
// 상태 페이지 조회 (B-3)
// 공개 화면에 쓰이므로 점검 주소(url) 같은 불필요한 값은 아예 조회하지 않습니다.
// ─────────────────────────────────────────────

/** 모든 대상 + 현재 상태 + 가장 최근 점검 결과 1건 */
export async function getStatusMonitors(db) {
  const { results } = await db
    .prepare(
      `SELECT m.id, m.name, m.kind, m.source, m.is_active, m.service_id,
              s.state,
              r.checked_at  AS last_checked_at,
              r.response_ms AS last_response_ms,
              r.value       AS last_value,
              r.is_slow     AS last_is_slow
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
    kind: r.kind,
    source: r.source,
    isActive: r.is_active === 1,
    state: r.state, // 상태 행이 없으면 null
    lastCheckedAt: r.last_checked_at,
    lastResponseMs: r.last_response_ms,
    lastValue: r.last_value, // 디스크 %·인증서 남은 일수 (B-4)
    lastIsSlow: r.last_is_slow === 1, // 서비스 '주의' 판정용 (0015)
    serviceId: r.service_id, // 묶인 서비스 (없으면 null)
  }));
}

// ─────────────────────────────────────────────
// 서비스 묶음 (0015)
// ─────────────────────────────────────────────

/**
 * 켜진 서비스와 그 서비스에 묶인 켜진 점검 id 목록. (서비스 일별 집계 계산용)
 * 대상 수가 적어서 전체를 한 번에 읽고 JS에서 고릅니다.
 * @returns {Promise<Array<{serviceId:number, monitorIds:number[]}>>}
 */
export async function getActiveServiceMembers(db) {
  const { results } = await db
    .prepare(
      `SELECT m.service_id, m.id
         FROM monitors m
         JOIN services s ON s.id = m.service_id
        WHERE s.is_active = 1 AND m.is_active = 1
        ORDER BY m.service_id, m.id`
    )
    .all();
  const byService = new Map();
  for (const r of results) {
    if (!byService.has(r.service_id)) byService.set(r.service_id, []);
    byService.get(r.service_id).push(r.id);
  }
  return [...byService].map(([serviceId, monitorIds]) => ({ serviceId, monitorIds }));
}

/** 서비스 일별 집계 저장 (있으면 덮어쓰기) */
export async function upsertServiceDailyStats(db, stats, updatedAt, source = 'real') {
  if (stats.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO service_daily_stats (service_id, day, total_slots, up_slots, slow_slots, source, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (service_id, day) DO UPDATE SET
       total_slots = excluded.total_slots,
       up_slots    = excluded.up_slots,
       slow_slots  = excluded.slow_slots,
       updated_at  = excluded.updated_at`
  );
  await db.batch(
    stats.map((s) => stmt.bind(s.serviceId, s.day, s.totalSlots, s.upSlots, s.slowSlots, source, updatedAt))
  );
}

/**
 * 켜진 서비스 목록 (정렬 순서대로).
 * 대표 주소(home_url)는 누구나 여는 공개 사이트의 첫 화면 주소라 함께 돌려줍니다 (S3 상세 화면의 '사이트 열기' 링크).
 * 점검 주소(DB 상태 확인 주소·DNS 점검 주소)는 여기서 조회하지 않습니다.
 */
export async function getServices(db) {
  const { results } = await db
    .prepare(
      `SELECT id, service_key, name, description, source, home_url
         FROM services
        WHERE is_active = 1
        ORDER BY sort_order, id`
    )
    .all();
  return results.map((r) => ({
    id: r.id,
    key: r.service_key,
    name: r.name,
    description: r.description,
    source: r.source,
    homeUrl: r.home_url,
  }));
}

/** fromDay(KST, 포함) 이후의 모든 서비스 일별 집계 */
export async function getServiceDailyStatsSince(db, fromDay) {
  const { results } = await db
    .prepare(
      `SELECT service_id, day, total_slots, up_slots, slow_slots
         FROM service_daily_stats
        WHERE day >= ?1`
    )
    .bind(fromDay)
    .all();
  return results.map((r) => ({
    serviceId: r.service_id,
    day: r.day,
    totalSlots: r.total_slots,
    upSlots: r.up_slots,
    slowSlots: r.slow_slots,
  }));
}

/** 한 서비스에 묶인 점검들의 최근 장애 N건 (시작 최신 순) */
export async function getServiceIncidents(db, serviceId, limit) {
  const { results } = await db
    .prepare(
      `SELECT i.id, i.monitor_id, m.name AS monitor_name, m.kind AS monitor_kind,
              i.started_at, i.detected_at, i.resolved_at, i.cause, i.source,
              i.report_summary
         FROM incidents i
         JOIN monitors m ON m.id = i.monitor_id
        WHERE m.service_id = ?1
        ORDER BY i.started_at DESC, i.id DESC
        LIMIT ?2`
    )
    .bind(serviceId, limit)
    .all();
  return results.map((r) => ({ ...mapIncident(r), summary: r.report_summary }));
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

// ─────────────────────────────────────────────
// 계획 작업 (B-5)
// ─────────────────────────────────────────────

function mapWindow(r) {
  return {
    id: r.id,
    monitorId: r.monitor_id, // NULL = 모든 대상
    monitorName: r.monitor_name ?? null,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    source: r.source,
  };
}

/** 이 시각에 진행 중인 작업 [starts_at, ends_at) */
export async function getActiveMaintenanceAt(db, atIso) {
  const { results } = await db
    .prepare(
      `SELECT id, monitor_id, title, starts_at, ends_at, source
         FROM maintenance_windows
        WHERE starts_at <= ?1 AND ends_at > ?1`
    )
    .bind(atIso)
    .all();
  return results.map(mapWindow);
}

/** 진행 중이거나 앞으로 예정된 작업 (시작 순) + 대상 이름 */
export async function getCurrentAndUpcomingMaintenance(db, nowIso, limit = 20) {
  const { results } = await db
    .prepare(
      `SELECT w.id, w.monitor_id, m.name AS monitor_name, w.title, w.starts_at, w.ends_at, w.source
         FROM maintenance_windows w
         LEFT JOIN monitors m ON m.id = w.monitor_id
        WHERE w.ends_at > ?1
        ORDER BY w.starts_at
        LIMIT ?2`
    )
    .bind(nowIso, limit)
    .all();
  return results.map(mapWindow);
}

/**
 * 계획 작업을 저장한다.
 * @param {string} source  작업 대상의 출처 (admin.js가 대상에서 가져옴) — 가짜 대상의 작업이 실제 작업처럼 보이지 않게
 */
export async function insertMaintenance(db, w, createdAt, source) {
  const r = await db
    .prepare(
      `INSERT INTO maintenance_windows (monitor_id, title, starts_at, ends_at, source, created_at)
       VALUES (?1, ?2, ?3, ?4, ?6, ?5)`
    )
    .bind(w.monitorId, w.title, w.startsAt, w.endsAt, createdAt, source)
    .run();
  return r.meta?.last_row_id ?? null;
}

/** @returns 지운 행 수 (0이면 없는 작업) */
export async function deleteMaintenance(db, id) {
  const r = await db.prepare(`DELETE FROM maintenance_windows WHERE id = ?1`).bind(id).run();
  return r.meta?.changes ?? 0;
}

/** 대상의 출처 ('real' | 'sample' | 'simulator'). 없는 대상이면 null */
export async function getMonitorSource(db, id) {
  const row = await db.prepare(`SELECT source FROM monitors WHERE id = ?1`).bind(id).first();
  return row ? row.source : null;
}

// ─────────────────────────────────────────────
// 장애 이력 (B-5)
// ─────────────────────────────────────────────

/** 진행 중인 장애: monitorId → { id, startedAt } (복구 메시지의 장애 시간 계산용) */
export async function getOpenIncidents(db) {
  const { results } = await db
    .prepare(`SELECT id, monitor_id, started_at FROM incidents WHERE resolved_at IS NULL`)
    .all();
  return new Map(results.map((r) => [r.monitor_id, { id: r.id, startedAt: r.started_at }]));
}

function mapIncident(r) {
  return {
    id: r.id,
    monitorId: r.monitor_id,
    monitorName: r.monitor_name,
    monitorKind: r.monitor_kind,
    startedAt: r.started_at,
    detectedAt: r.detected_at,
    resolvedAt: r.resolved_at,
    cause: r.cause,
    source: r.source,
  };
}

/** 최근 장애 N건 (시작 최신 순) + 보고서 작성 여부 */
export async function getRecentIncidents(db, limit) {
  const { results } = await db
    .prepare(
      `SELECT i.id, i.monitor_id, m.name AS monitor_name, m.kind AS monitor_kind,
              i.started_at, i.detected_at, i.resolved_at, i.cause, i.source,
              i.report_summary
         FROM incidents i
         JOIN monitors m ON m.id = i.monitor_id
        ORDER BY i.started_at DESC, i.id DESC
        LIMIT ?1`
    )
    .bind(limit)
    .all();
  return results.map((r) => ({ ...mapIncident(r), summary: r.report_summary }));
}

/** 장애 1건 + 보고서 전체 */
export async function getIncident(db, id) {
  const r = await db
    .prepare(
      `SELECT i.*, m.name AS monitor_name, m.kind AS monitor_kind
         FROM incidents i
         JOIN monitors m ON m.id = i.monitor_id
        WHERE i.id = ?1`
    )
    .bind(id)
    .first();
  if (!r) return null;
  return {
    ...mapIncident(r),
    report: {
      summary: r.report_summary,
      impact: r.report_impact,
      rootCause: r.report_root_cause,
      action: r.report_action,
      prevention: r.report_prevention,
      updatedAt: r.report_updated_at,
    },
  };
}

/** 장애 기간 [from, to]의 해당 대상 알림 (상세 페이지 타임라인용) */
export async function getNotificationsBetween(db, monitorId, fromIso, toIso) {
  const { results } = await db
    .prepare(
      `SELECT event, message, created_at, source
         FROM notifications
        WHERE monitor_id = ?1 AND created_at >= ?2 AND created_at <= ?3
        ORDER BY created_at, id`
    )
    .bind(monitorId, fromIso, toIso)
    .all();
  return results.map((r) => ({ event: r.event, message: r.message, createdAt: r.created_at, source: r.source }));
}

/**
 * 보고서 항목을 고친다. columns는 incident.js의 validateIncidentReport가 만든 {DB컬럼: 값}만 받습니다.
 * 컬럼 이름을 SQL에 이어 붙이지만, 값은 정해진 5개 이름 목록에서만 오므로 인젝션 위험이 없어요(값은 bind).
 * @returns 바뀐 행 수 (0이면 없는 장애)
 */
export async function updateIncidentReport(db, id, columns, updatedAt) {
  const names = Object.keys(columns);
  const sets = names.map((c, i) => `${c} = ?${i + 3}`).join(', ');
  const r = await db
    .prepare(`UPDATE incidents SET report_updated_at = ?2, ${sets} WHERE id = ?1`)
    .bind(id, updatedAt, ...names.map((c) => columns[c]))
    .run();
  return r.meta?.changes ?? 0;
}

// ─────────────────────────────────────────────
// 월간 보고서 (B-6)
// ─────────────────────────────────────────────

/** [fromDay, toDay] (KST 날짜, 양쪽 포함) 모든 대상의 일별 집계 */
export async function getDailyStatsBetween(db, fromDay, toDay) {
  const { results } = await db
    .prepare(
      `SELECT monitor_id, day, total_checks, success_checks, slow_checks, avg_response_ms, maintenance_checks
         FROM daily_stats
        WHERE day >= ?1 AND day <= ?2`
    )
    .bind(fromDay, toDay)
    .all();
  return results.map((r) => ({
    monitorId: r.monitor_id,
    day: r.day,
    totalChecks: r.total_checks,
    successChecks: r.success_checks,
    slowChecks: r.slow_checks,
    avgResponseMs: r.avg_response_ms,
    maintenanceChecks: r.maintenance_checks,
  }));
}

/** [startUtc, endUtc) 구간에 조금이라도 걸친 장애 (진행 중 포함) */
export async function getIncidentsOverlapping(db, startUtc, endUtc) {
  const { results } = await db
    .prepare(
      `SELECT id, monitor_id, started_at, detected_at, resolved_at, cause, source
         FROM incidents
        WHERE started_at < ?2 AND (resolved_at IS NULL OR resolved_at > ?1)
        ORDER BY started_at`
    )
    .bind(startUtc, endUtc)
    .all();
  return results.map((r) => ({
    id: r.id,
    monitorId: r.monitor_id,
    startedAt: r.started_at,
    detectedAt: r.detected_at,
    resolvedAt: r.resolved_at,
    cause: r.cause,
    source: r.source,
  }));
}

/** 기록이 있는 달 목록 'YYYY-MM' (최신 순) — 보고서의 달 선택용 */
export async function getReportMonths(db) {
  const { results } = await db
    .prepare(`SELECT DISTINCT substr(day, 1, 7) AS month FROM daily_stats ORDER BY month DESC`)
    .all();
  return results.map((r) => r.month);
}

// ─────────────────────────────────────────────
// 서비스 상세 팝업 그래프 (최근 N시간 기록)
// ─────────────────────────────────────────────

/** 공개해도 되는 대상 정보 1건 (점검 주소는 조회하지 않음). 없으면 null */
export async function getMonitorPublic(db, id) {
  const r = await db
    .prepare(`SELECT id, name, kind, source, max_response_ms, threshold FROM monitors WHERE id = ?1`)
    .bind(id)
    .first();
  if (!r) return null;
  return { id: r.id, name: r.name, kind: r.kind, source: r.source, maxResponseMs: r.max_response_ms, threshold: r.threshold };
}

/** 한 대상의 sinceIso 이후 점검 결과 (오래된 → 최근). (monitor_id, checked_at) 인덱스로 해당 구간만 읽음 */
export async function getResultsSince(db, monitorId, sinceIso) {
  const { results } = await db
    .prepare(
      `SELECT checked_at, is_success, is_slow, response_ms, value, failure_reason, in_maintenance, source
         FROM check_results
        WHERE monitor_id = ?1 AND checked_at >= ?2
        ORDER BY checked_at`
    )
    .bind(monitorId, sinceIso)
    .all();
  return results.map((r) => ({
    checkedAt: r.checked_at,
    isSuccess: r.is_success === 1,
    isSlow: r.is_slow === 1,
    responseMs: r.response_ms,
    value: r.value,
    failureReason: r.failure_reason,
    inMaintenance: r.in_maintenance === 1,
    source: r.source,
  }));
}

// ─────────────────────────────────────────────
// '+ 서비스 추가' / 끄기 (S4, 관리자 API)
// ─────────────────────────────────────────────

/** 서비스 전체(꺼진 것 포함)의 키·대표 주소·켜짐 여부 — 키 겹침·중복 주소·개수 상한 확인용 (서비스 수가 적어 전체 조회) */
export async function getServiceRows(db) {
  const { results } = await db.prepare('SELECT service_key, home_url, is_active, sort_order FROM services').all();
  return results.map((r) => ({ key: r.service_key, homeUrl: r.home_url, isActive: r.is_active === 1, sortOrder: r.sort_order }));
}

/**
 * 서비스 1개와 점검들을 한 묶음(batch)으로 만든다: 중간에 실패하면 모두 취소되어 "점검 없는 서비스"가 남지 않음.
 * 점검의 service_id는 같은 batch 안에서 키로 찾아 넣습니다 (먼저 넣은 서비스의 id를 따로 읽지 않아도 되게).
 * 출처는 모두 real (실제 운영 서비스만 추가하는 기능)
 */
export async function insertServiceWithMonitors(db, svc, monitors, createdAt) {
  const statements = [
    db.prepare(
      `INSERT INTO services (service_key, name, description, home_url, is_active, sort_order, source, created_at)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, 'real', ?6)`
    ).bind(svc.key, svc.name, svc.description, svc.homeUrl, svc.sortOrder, createdAt),
    ...monitors.map((m) =>
      db.prepare(
        `INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active, source, created_at, service_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 'real', ?7, (SELECT id FROM services WHERE service_key = ?8))`
      ).bind(m.name, m.kind, m.url, m.expectedStatus, m.keyword, m.maxResponseMs, createdAt, svc.key)
    ),
  ];
  await db.batch(statements);
}

/**
 * 서비스와 그 점검을 켜거나 끈다 (삭제 대신 끄기: 기록은 남김).
 * @returns {Promise<number>} 바뀐 서비스 수 (0이면 없는 키)
 */
export async function setServiceActive(db, key, active) {
  const flag = active ? 1 : 0;
  const [svc] = await db.batch([
    db.prepare('UPDATE services SET is_active = ?1 WHERE service_key = ?2').bind(flag, key),
    db.prepare('UPDATE monitors SET is_active = ?1 WHERE service_id = (SELECT id FROM services WHERE service_key = ?2)').bind(flag, key),
  ]);
  return svc.meta.changes;
}

// ─────────────────────────────────────────────
// 오래 가는 장애 메일 알림 (15단계, 0016)
// ─────────────────────────────────────────────

/**
 * 메일 판단에 필요한 지금 상태를 한 번에 읽는다 (서비스·점검·장애 수가 적어 전체 조회).
 *   services        켜진 서비스와 그 서비스의 켜진 점검 id
 *   openIncidents   열린 장애 (점검 이름·첫 실패·원인)
 *   openEscalations 메일을 보냈고 아직 복구 메일 전인 구간
 */
export async function getEscalationState(db) {
  const [svc, inc, esc] = await Promise.all([
    db.prepare(
      `SELECT s.id, s.service_key, s.name, m.id AS monitor_id
         FROM services s
         JOIN monitors m ON m.service_id = s.id AND m.is_active = 1
        WHERE s.is_active = 1
        ORDER BY s.sort_order, s.id, m.id`
    ).all(),
    db.prepare(
      `SELECT i.monitor_id, m.name AS monitor_name, i.started_at, i.cause
         FROM incidents i
         JOIN monitors m ON m.id = i.monitor_id
        WHERE i.resolved_at IS NULL`
    ).all(),
    db.prepare('SELECT id, service_id, started_at FROM service_escalations WHERE resolved_at IS NULL').all(),
  ]);
  const services = new Map();
  for (const r of svc.results) {
    if (!services.has(r.id)) services.set(r.id, { id: r.id, key: r.service_key, name: r.name, monitorIds: [] });
    services.get(r.id).monitorIds.push(r.monitor_id);
  }
  return {
    services: [...services.values()],
    openIncidents: inc.results.map((r) => ({ monitorId: r.monitor_id, monitorName: r.monitor_name, startedAt: r.started_at, cause: r.cause })),
    openEscalations: esc.results.map((r) => ({ id: r.id, serviceId: r.service_id, startedAt: r.started_at })),
  };
}

/** 장애 메일을 보낸 뒤 구간 기록 (보내기에 성공한 뒤에만 부름) */
export async function insertEscalation(db, serviceId, startedAt, escalatedAt) {
  await db
    .prepare(`INSERT INTO service_escalations (service_id, started_at, escalated_at, source) VALUES (?1, ?2, ?3, 'real')`)
    .bind(serviceId, startedAt, escalatedAt)
    .run();
}

/** 복구 메일을 보낸 뒤 구간 닫기 */
export async function resolveEscalation(db, id, resolvedAt) {
  await db.prepare('UPDATE service_escalations SET resolved_at = ?1 WHERE id = ?2 AND resolved_at IS NULL').bind(resolvedAt, id).run();
}
