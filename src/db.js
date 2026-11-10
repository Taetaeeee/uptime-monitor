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
 * 점검 결과 여러 개를 한 번에 저장한다.
 *
 * db.batch를 쓰는 이유:
 *  - DB 왕복이 한 번으로 줄어듭니다.
 *  - batch는 한 묶음으로 실행돼서, 중간에 실패하면 일부만 저장되는 일이 없습니다.
 *    (D1 batch의 트랜잭션 동작 → 공식 문서에서 확인할 부분)
 *
 * '?1, ?2 ...' 자리표시자를 쓰는 이유: 값을 SQL 문자열에 직접 이어 붙이면
 * SQL 인젝션 위험이 생깁니다. bind로 넘기면 DB가 값으로만 취급해요.
 */
export async function saveCheckResults(db, rows) {
  if (rows.length === 0) return;

  const stmt = db.prepare(
    `INSERT INTO check_results
       (monitor_id, checked_at, is_success, is_slow, status_code, response_ms, failure_reason)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  );

  await db.batch(
    rows.map((r) =>
      stmt.bind(
        r.monitorId,
        r.checkedAt,
        r.isSuccess ? 1 : 0, // boolean → 0/1
        r.isSlow ? 1 : 0,
        r.statusCode,
        r.responseMs,
        r.failureReason
      )
    )
  );
}
