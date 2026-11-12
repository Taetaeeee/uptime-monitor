-- 0008: 출처 'replay'(공개 데이터셋 재생) 허용 + 데이터셋 메타·재생 시계열 테이블
--
-- 왜 테이블을 다시 만드나?
--   출처(source)는 CHECK (source IN ('real', 'sample', 'simulator'))로 막아 두었습니다.
--   오타 하나로 가짜 데이터가 실제 데이터처럼 보이지 않게 하려는 장치였어요.
--   그런데 SQLite는 CHECK 조건을 ALTER로 바꿀 수 없어서, 'replay'를 허용하려면
--   그 CHECK가 있는 테이블(monitors, check_results, notifications, daily_stats, incidents)을 새로 만들어야 합니다.
--   (maintenance_windows는 'replay'가 들어갈 일이 없지만 출처 규칙을 한 벌로 맞추려고 같이 바꿉니다)
--
-- 왜 이렇게 하나? (순서가 중요한 이유)
--   모든 테이블이 monitors(id)를 가리킵니다(외래 키). 부모인 monitors를 지우려면 자식 행이 남아 있으면 안 돼요.
--   그래서 PRAGMA 설정에 기대지 않고 "자식 → 부모" 순서로 지우고 "부모 → 자식" 순서로 다시 채웁니다.
--     1) 7개 테이블의 내용을 임시 복사본(_old_*)에 보관
--     2) 자식 테이블을 지우고, 마지막으로 부모(monitors)를 지움
--     3) 새 monitors를 만들어 복사 → 자식 테이블도 새로 만들어 복사
--     4) 임시 복사본을 지움
--   id를 그대로 복사하므로 점검 결과·장애 번호·링크는 바뀌지 않습니다.
--
-- 주의 (적용 전에 읽어 주세요)
--   - 쓰기 행 수가 한 번 크게 늘어납니다: 모든 행을 임시 복사 + 다시 넣기로 2번씩 씁니다. 한 번만 하는 작업이에요.
--   - 중간에 실패하면 _old_* 임시 테이블이 남을 수 있습니다. 그래서 적용 전에 원격 DB를 내보내 두세요.
--       npx.cmd wrangler d1 export status-monitor-db --remote --output=backup-before-0008.sql
--   - AUTOINCREMENT 번호 기록(sqlite_sequence)은 새 테이블에서 '현재 가장 큰 id'부터 다시 시작합니다.
--     지워진 행의 번호가 다시 쓰일 수 있지만, 지워진 행은 어디에서도 참조되지 않아 문제가 없습니다.
--   - D1에서 이 파일이 한 번에(원자적으로) 실행되는지는 공식 문서에서 확인할 부분입니다.
--     (원자적이지 않아도 위 순서는 외래 키 오류가 나지 않게 짰습니다)
--   - 문장 사이를 ';'로 나누므로 주석 안에는 세미콜론을 쓰지 않았습니다.

-- ─────────────────────────────────────────────
-- 1) 데이터셋 메타 (공개 데이터셋 1종당 1행) — README 표와 출처 배지 상세의 근거
-- ─────────────────────────────────────────────
CREATE TABLE datasets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT    NOT NULL UNIQUE,   -- 짧은 이름. 예: 'smd', 'nab'
  name        TEXT    NOT NULL,          -- 화면에 보여 줄 이름
  url         TEXT    NOT NULL,          -- 공식 저장소·배포 주소
  license     TEXT    NOT NULL,          -- 라이선스 이름과 확인한 근거
  processing  TEXT    NOT NULL,          -- 가공 방법 (예: 5분 평균, 0~1 정규화 값 그대로)
  -- 구분: real_replay = 실제 운영 환경 기록을 재생 / lab = 연구용으로 재현한 실험 환경 로그
  -- 서비스 종류와 달리 CHECK로 막은 이유: 화면에 붙는 배지가 이 값으로 정해지고, 두 가지로 정해져 있기 때문
  kind        TEXT    NOT NULL CHECK (kind IN ('real_replay', 'lab')),
  citation    TEXT                       -- 논문 인용 등 (Loghub처럼 요구하는 경우)
);

-- ─────────────────────────────────────────────
-- 2) 기존 테이블 내용을 임시 복사본에 보관
-- ─────────────────────────────────────────────
CREATE TABLE _old_monitors            AS SELECT * FROM monitors;
CREATE TABLE _old_monitor_state       AS SELECT * FROM monitor_state;
CREATE TABLE _old_maintenance_windows AS SELECT * FROM maintenance_windows;
CREATE TABLE _old_check_results       AS SELECT * FROM check_results;
CREATE TABLE _old_notifications       AS SELECT * FROM notifications;
CREATE TABLE _old_daily_stats         AS SELECT * FROM daily_stats;
CREATE TABLE _old_incidents           AS SELECT * FROM incidents;

-- ─────────────────────────────────────────────
-- 3) 자식 테이블 → 부모(monitors) 순서로 삭제 (인덱스도 함께 사라짐)
-- ─────────────────────────────────────────────
DROP TABLE monitor_state;
DROP TABLE maintenance_windows;
DROP TABLE check_results;
DROP TABLE notifications;
DROP TABLE daily_stats;
DROP TABLE incidents;
DROP TABLE monitors;

-- ─────────────────────────────────────────────
-- 4) 부모부터 새로 만들고 채움: 컬럼 순서와 이름은 기존과 같고 source CHECK만 'replay' 추가
-- ─────────────────────────────────────────────
CREATE TABLE monitors (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  kind            TEXT    NOT NULL DEFAULT 'http',
  url             TEXT    NOT NULL,
  expected_status INTEGER NOT NULL DEFAULT 200,
  keyword         TEXT,
  max_response_ms INTEGER NOT NULL DEFAULT 3000,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  source          TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'sample', 'simulator', 'replay')),
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  check_key       TEXT,
  threshold       INTEGER,
  -- 재생 대상이 어떤 데이터셋에서 왔는지 (재생 대상만 값이 있고 나머지는 NULL)
  dataset_id      INTEGER REFERENCES datasets(id)
);
INSERT INTO monitors (id, name, kind, url, expected_status, keyword, max_response_ms, is_active, source, created_at, check_key, threshold)
  SELECT id, name, kind, url, expected_status, keyword, max_response_ms, is_active, source, created_at, check_key, threshold
  FROM _old_monitors;
CREATE UNIQUE INDEX idx_monitors_check_key ON monitors (check_key);

CREATE TABLE monitor_state (
  monitor_id            INTEGER PRIMARY KEY REFERENCES monitors(id),
  state                 TEXT    NOT NULL DEFAULT 'unknown' CHECK (state IN ('unknown', 'up', 'down')),
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  consecutive_successes INTEGER NOT NULL DEFAULT 0,
  failing_since         TEXT,
  last_checked_at       TEXT,
  changed_at            TEXT
);
INSERT INTO monitor_state (monitor_id, state, consecutive_failures, consecutive_successes, failing_since, last_checked_at, changed_at)
  SELECT monitor_id, state, consecutive_failures, consecutive_successes, failing_since, last_checked_at, changed_at
  FROM _old_monitor_state;

CREATE TABLE maintenance_windows (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id  INTEGER REFERENCES monitors(id),
  title       TEXT    NOT NULL,
  starts_at   TEXT    NOT NULL,
  ends_at     TEXT    NOT NULL,
  source      TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'sample', 'simulator', 'replay')),
  created_at  TEXT    NOT NULL,
  CHECK (ends_at > starts_at)
);
INSERT INTO maintenance_windows (id, monitor_id, title, starts_at, ends_at, source, created_at)
  SELECT id, monitor_id, title, starts_at, ends_at, source, created_at
  FROM _old_maintenance_windows;
CREATE INDEX idx_maintenance_ends ON maintenance_windows (ends_at);

CREATE TABLE check_results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id     INTEGER NOT NULL REFERENCES monitors(id),
  checked_at     TEXT    NOT NULL,
  is_success     INTEGER NOT NULL CHECK (is_success IN (0, 1)),
  is_slow        INTEGER NOT NULL DEFAULT 0 CHECK (is_slow IN (0, 1)),
  status_code    INTEGER,
  response_ms    INTEGER,
  failure_reason TEXT,
  source         TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'sample', 'simulator', 'replay')),
  value          REAL,
  in_maintenance INTEGER NOT NULL DEFAULT 0 CHECK (in_maintenance IN (0, 1)),
  CHECK (is_success = 1 OR is_slow = 0)
);
INSERT INTO check_results (id, monitor_id, checked_at, is_success, is_slow, status_code, response_ms, failure_reason, source, value, in_maintenance)
  SELECT id, monitor_id, checked_at, is_success, is_slow, status_code, response_ms, failure_reason, source, value, in_maintenance
  FROM _old_check_results;
CREATE INDEX idx_check_results_monitor_time ON check_results (monitor_id, checked_at);

CREATE TABLE notifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id     INTEGER NOT NULL REFERENCES monitors(id),
  event          TEXT    NOT NULL CHECK (event IN ('down', 'recovered')),
  channel        TEXT    NOT NULL,
  message        TEXT    NOT NULL,
  failure_reason TEXT,
  created_at     TEXT    NOT NULL,
  source         TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'sample', 'simulator', 'replay'))
);
INSERT INTO notifications (id, monitor_id, event, channel, message, failure_reason, created_at, source)
  SELECT id, monitor_id, event, channel, message, failure_reason, created_at, source
  FROM _old_notifications;
CREATE INDEX idx_notifications_created ON notifications (created_at);

CREATE TABLE daily_stats (
  monitor_id         INTEGER NOT NULL REFERENCES monitors(id),
  day                TEXT    NOT NULL,
  total_checks       INTEGER NOT NULL,
  success_checks     INTEGER NOT NULL,
  slow_checks        INTEGER NOT NULL,
  avg_response_ms    INTEGER,
  source             TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'sample', 'simulator', 'replay')),
  updated_at         TEXT    NOT NULL,
  maintenance_checks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (monitor_id, day),
  CHECK (success_checks <= total_checks AND slow_checks <= success_checks)
);
INSERT INTO daily_stats (monitor_id, day, total_checks, success_checks, slow_checks, avg_response_ms, source, updated_at, maintenance_checks)
  SELECT monitor_id, day, total_checks, success_checks, slow_checks, avg_response_ms, source, updated_at, maintenance_checks
  FROM _old_daily_stats;

CREATE TABLE incidents (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id        INTEGER NOT NULL REFERENCES monitors(id),
  started_at        TEXT    NOT NULL,
  detected_at       TEXT    NOT NULL,
  resolved_at       TEXT,
  cause             TEXT,
  report_summary    TEXT,
  report_impact     TEXT,
  report_root_cause TEXT,
  report_action     TEXT,
  report_prevention TEXT,
  report_updated_at TEXT,
  source            TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'sample', 'simulator', 'replay')),
  CHECK (detected_at >= started_at),
  CHECK (resolved_at IS NULL OR resolved_at >= detected_at)
);
INSERT INTO incidents (id, monitor_id, started_at, detected_at, resolved_at, cause, report_summary, report_impact, report_root_cause, report_action, report_prevention, report_updated_at, source)
  SELECT id, monitor_id, started_at, detected_at, resolved_at, cause, report_summary, report_impact, report_root_cause, report_action, report_prevention, report_updated_at, source
  FROM _old_incidents;
CREATE INDEX idx_incidents_started ON incidents (started_at);
-- 대상 1개당 열린 장애는 1건만 (기존 규칙 그대로)
CREATE UNIQUE INDEX idx_incidents_open ON incidents (monitor_id) WHERE resolved_at IS NULL;

-- ─────────────────────────────────────────────
-- 5) 임시 복사본 삭제
-- ─────────────────────────────────────────────
DROP TABLE _old_monitors;
DROP TABLE _old_monitor_state;
DROP TABLE _old_maintenance_windows;
DROP TABLE _old_check_results;
DROP TABLE _old_notifications;
DROP TABLE _old_daily_stats;
DROP TABLE _old_incidents;

-- ─────────────────────────────────────────────
-- 6) 재생 시계열: 재생 대상 1개당 5분 간격 값의 줄 (순번 0부터)
--    "지금 순번 = 경과 시간 ÷ 5분 mod 전체 길이"로 읽는 표입니다. (읽는 코드는 B-7d)
-- ─────────────────────────────────────────────
CREATE TABLE replay_series (
  monitor_id  INTEGER NOT NULL REFERENCES monitors(id),
  seq         INTEGER NOT NULL,        -- 5분 간격 순번 (0부터)
  value       REAL    NOT NULL,        -- 가공이 끝난 값 (가공 방법은 datasets.processing)
  is_anomaly  INTEGER CHECK (is_anomaly IN (0, 1)),  -- 원본의 이상 구간 라벨. 라벨이 없는 데이터셋은 NULL (B-9에서 사용)
  PRIMARY KEY (monitor_id, seq)
);
