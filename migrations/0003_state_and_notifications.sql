-- 0003: 대상별 현재 상태(monitor_state)와 알림 기록(notifications)
--
-- 왜 monitors에 컬럼을 추가하지 않고 테이블을 따로 만드나?
--   monitors는 사람이 정하는 "설정"(주소, 기대 코드, 키워드)이고,
--   monitor_state는 Cron이 5분마다 바꾸는 "현재 상태"입니다.
--   섞어 두면 설정을 고치다가 상태를 덮어쓰거나, 상태를 갱신하다 설정을 건드릴 위험이 생겨요.

-- ─────────────────────────────────────────────
-- 대상별 현재 상태 (대상 1개당 1행)
-- ─────────────────────────────────────────────
CREATE TABLE monitor_state (
  -- 대상 1개당 1행이라 monitor_id 자체를 기본 키로 씁니다.
  -- (그래서 저장할 때 "있으면 갱신, 없으면 추가"를 ON CONFLICT로 한 번에 할 수 있어요)
  monitor_id            INTEGER PRIMARY KEY REFERENCES monitors(id),
  -- unknown: 아직 판단 전 / up: 정상 / down: 장애
  state                 TEXT    NOT NULL DEFAULT 'unknown' CHECK (state IN ('unknown', 'up', 'down')),
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  consecutive_successes INTEGER NOT NULL DEFAULT 0,
  -- 이번 연속 실패가 시작된 회차 시각. 성공하면 NULL로 돌아갑니다.
  -- 장애는 "2회 연속 실패"에서 판정되지만 실제 문제는 첫 실패부터였으므로,
  -- 장애 지속 시간은 이 값부터 계산해야 정확해요.
  failing_since         TEXT,
  last_checked_at       TEXT,   -- 마지막 점검 회차 (UTC ISO)
  changed_at            TEXT    -- 마지막으로 state가 바뀐 회차 (UTC ISO)
);

-- ─────────────────────────────────────────────
-- 알림 기록 (상태가 바뀔 때만 1행)
-- ─────────────────────────────────────────────
CREATE TABLE notifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id     INTEGER NOT NULL REFERENCES monitors(id),
  -- down: 장애 발생 / recovered: 복구
  event          TEXT    NOT NULL CHECK (event IN ('down', 'recovered')),
  -- 어떤 채널로 보낸 알림인지. 지금은 'log'(이 테이블에 기록) 하나뿐입니다.
  -- CHECK로 막지 않은 이유: 채널은 나중에 늘어날 수 있는 값이라서 (monitors.kind와 같은 이유)
  channel        TEXT    NOT NULL,
  message        TEXT    NOT NULL,   -- 화면에 그대로 보여 줄 한국어 문장
  failure_reason TEXT,               -- 장애 알림이면 원인 코드, 복구 알림이면 NULL
  created_at     TEXT    NOT NULL,   -- 상태가 바뀐 회차 시각 (UTC ISO)
  source         TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'sample', 'simulator'))
);

-- '최근 알림' 조회용 인덱스는 그 화면을 만드는 B-3에서 추가합니다.
