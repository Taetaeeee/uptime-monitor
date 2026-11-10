-- 0006: 장애 이력(incidents) + 계획 작업 시간(maintenance_windows)
--
-- 왜 장애를 알림(notifications)에서 매번 계산하지 않고 테이블로 저장하나?
--   - 장애 1건마다 보고서(요약·영향·원인·조치·재발 방지)를 붙일 자리가 필요합니다.
--   - "지금 진행 중인 장애"를 바로 조회할 수 있어요.
--   알림과 장애는 같은 상태 전이(B-2)에서 함께 만들어지므로 시각이 어긋나지 않습니다.

-- ─────────────────────────────────────────────
-- 장애 이력 (장애 1건 = 1행)
-- ─────────────────────────────────────────────
CREATE TABLE incidents (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id        INTEGER NOT NULL REFERENCES monitors(id),
  -- 세 시각 (모두 회차 시각, UTC ISO)
  --   started_at  : 첫 실패 — 사용자가 실제로 영향을 받기 시작한 때
  --   detected_at : 장애 판정(2회 연속 실패) — 알림이 나간 때
  --   resolved_at : 복구 — 진행 중이면 NULL
  --   detected_at - started_at = 감지까지 걸린 시간(MTTD), resolved_at - started_at = 장애 지속 시간
  started_at        TEXT    NOT NULL,
  detected_at       TEXT    NOT NULL,
  resolved_at       TEXT,
  cause             TEXT,   -- 장애 판정 때의 실패 이유 코드 (timeout, port_closed …)

  -- 사후 보고서 (관리자 API로 작성, 비어 있으면 '작성 전')
  report_summary    TEXT,   -- 요약
  report_impact     TEXT,   -- 영향
  report_root_cause TEXT,   -- 원인
  report_action     TEXT,   -- 조치
  report_prevention TEXT,   -- 재발 방지
  report_updated_at TEXT,

  source            TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'sample', 'simulator')),

  CHECK (detected_at >= started_at),
  CHECK (resolved_at IS NULL OR resolved_at >= detected_at)
);

-- 장애 이력 목록: 최근 시작 순
CREATE INDEX idx_incidents_started ON incidents (started_at);

-- "진행 중인 장애는 대상당 최대 1건"을 DB가 보장 (부분 인덱스: resolved_at이 NULL인 행에만 적용)
-- 상태가 어긋나 같은 대상에 장애를 또 열려고 해도 중복으로 쌓이지 않습니다.
CREATE UNIQUE INDEX idx_incidents_open ON incidents (monitor_id) WHERE resolved_at IS NULL;

-- ─────────────────────────────────────────────
-- 계획 작업 시간
-- ─────────────────────────────────────────────
CREATE TABLE maintenance_windows (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id  INTEGER REFERENCES monitors(id),  -- NULL이면 모든 대상
  title       TEXT    NOT NULL,                 -- 화면에 보여 줄 작업 이름
  starts_at   TEXT    NOT NULL,                 -- UTC ISO
  ends_at     TEXT    NOT NULL,                 -- UTC ISO (이 시각은 포함하지 않음)
  source      TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'sample', 'simulator')),
  created_at  TEXT    NOT NULL,
  CHECK (ends_at > starts_at)
);

-- "지금 진행 중이거나 앞으로 예정된 작업" 조회: WHERE ends_at > 지금
CREATE INDEX idx_maintenance_ends ON maintenance_windows (ends_at);

-- 계획 작업 중에 한 점검인지 (1이면 가동률 계산에서 제외, 장애 판정도 하지 않음)
--   점검 자체는 기록해 두어야 "작업 중에 실제로 무슨 일이 있었나"를 나중에 볼 수 있어요.
ALTER TABLE check_results ADD COLUMN in_maintenance INTEGER NOT NULL DEFAULT 0 CHECK (in_maintenance IN (0, 1));

-- 일별 집계: 계획 작업 중 점검 수 (total_checks·success_checks에는 들어가지 않음)
ALTER TABLE daily_stats ADD COLUMN maintenance_checks INTEGER NOT NULL DEFAULT 0;
