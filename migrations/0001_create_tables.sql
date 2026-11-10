-- 0001: 점검 대상(monitors)과 점검 결과(check_results) 테이블
--
-- 왜 마이그레이션 파일로 관리하나?
--   스키마 변경 이력이 파일로 남아서, 로컬 DB와 배포 DB를 같은 순서로 같은 상태로 만들 수 있습니다.
--   wrangler가 적용한 파일을 기록해 두기 때문에 같은 파일이 두 번 실행되지 않아요.

-- ─────────────────────────────────────────────
-- 점검 대상
-- ─────────────────────────────────────────────
CREATE TABLE monitors (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,                 -- 예: '고쳐라! 웹게임'
  -- 지금은 'http'만 씀. CHECK로 값을 막지 않은 이유:
  -- SQLite는 CHECK 조건을 나중에 고치려면 테이블을 새로 만들어야 해서,
  -- dns, agent 같은 종류가 추가될 때 번거로워집니다.
  kind            TEXT    NOT NULL DEFAULT 'http',
  url             TEXT    NOT NULL,
  expected_status INTEGER NOT NULL DEFAULT 200,
  keyword         TEXT,                             -- NULL이면 키워드 검사 안 함
  max_response_ms INTEGER NOT NULL DEFAULT 3000,    -- 넘으면 '느림'
  -- SQLite에는 boolean이 없어서 0/1 정수로 저장
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))  -- UTC
);

-- ─────────────────────────────────────────────
-- 점검 결과 (5분마다 대상별로 1행)
-- ─────────────────────────────────────────────
CREATE TABLE check_results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id     INTEGER NOT NULL REFERENCES monitors(id),
  -- ISO 8601 UTC 문자열 (예: 2026-11-10T01:30:00Z)
  -- 문자열 정렬 순서 = 시간 순서라서 정렬·범위 조회가 그대로 됩니다.
  -- 한국 시간 변환은 화면에서 합니다 (저장은 한 가지 기준으로 통일).
  checked_at     TEXT    NOT NULL,
  is_success     INTEGER NOT NULL CHECK (is_success IN (0, 1)),
  is_slow        INTEGER NOT NULL DEFAULT 0 CHECK (is_slow IN (0, 1)),
  status_code    INTEGER,          -- 시간 초과·네트워크 오류면 응답이 없으므로 NULL
  response_ms    INTEGER,          -- 시간 초과·네트워크 오류면 NULL
  -- 문장 대신 코드값: timeout / network_error / status_mismatch / keyword_missing
  -- (집계하기 쉽고, 화면 문구는 나중에 바꿔도 데이터는 그대로)
  failure_reason TEXT,

  -- '느림'은 성공한 점검에만 붙는다는 규칙을 DB에서도 한 번 더 지킵니다.
  CHECK (is_success = 1 OR is_slow = 0)
);

-- ─────────────────────────────────────────────
-- 인덱스
-- ─────────────────────────────────────────────
-- 가장 많이 할 조회: "이 대상의 최근 결과 N개"
--   WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT N
-- 복합 인덱스는 (monitor_id → checked_at) 순서로 정렬된 목차라서
-- 해당 대상 부분만 골라 시간 순으로 바로 읽습니다. 테이블 전체를 훑지 않아요.
-- (monitor_id 단독 인덱스 역할도 함께 합니다)
CREATE INDEX idx_check_results_monitor_time
  ON check_results (monitor_id, checked_at);

-- monitors는 행이 몇 개뿐이라 인덱스를 만들지 않습니다.
-- checked_at 단독 인덱스(오래된 원본 삭제용)는 그 기능이 생기는 B-3에서 추가합니다.
