-- 0016: 오래 가는 장애 메일 알림 기록 (15단계)
--
-- 서비스의 "장애 구간"(묶인 점검 중 하나라도 장애가 열려 있는 동안)이 첫 실패부터 15분을 넘으면
-- 메일을 1통 보내고, 그 구간이 끝나면(모든 장애 복구) 복구 메일을 1통 보냅니다.
-- 이 표는 "그 구간에 메일을 이미 보냈나"를 기억해서, 5분마다 도는 Cron이 같은 메일을 다시 보내지 않게 합니다.
--
-- 왜 장애 이력(incidents)에 열을 더하지 않고 표를 따로 두나?
--   장애 이력은 점검 하나 단위이고, 메일은 서비스 단위(점검 3개가 함께 죽어도 1통)라서 단위가 다릅니다.

CREATE TABLE service_escalations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id   INTEGER NOT NULL REFERENCES services(id),
  started_at   TEXT    NOT NULL,   -- 장애 구간 시작 = 그 서비스의 열린 장애 중 가장 이른 첫 실패 (UTC ISO)
  escalated_at TEXT    NOT NULL,   -- 장애 메일을 보낸 회차 (UTC ISO). 보내기에 성공한 뒤에만 행을 만듦
  resolved_at  TEXT,               -- 복구 메일을 보낸 회차. NULL이면 아직 장애 구간이 열려 있음
  source       TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'simulator'))
);

-- 서비스마다 열린 구간은 하나뿐: 같은 장애에 메일 행이 두 번 생기지 않게 DB에서도 막음
CREATE UNIQUE INDEX idx_service_escalations_open ON service_escalations (service_id) WHERE resolved_at IS NULL;
