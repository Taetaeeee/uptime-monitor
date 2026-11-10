-- 0004: 일별 집계(daily_stats) + '최근 알림' 조회용 인덱스
--
-- 왜 집계 테이블을 따로 두나?
--   상태 페이지는 "최근 30일 막대"를 매번 보여 줘야 합니다.
--   그때마다 원본(5분마다 1행 → 대상당 하루 288행)을 30일치 읽어 계산하면 느리고 D1 읽기 한도도 금방 씁니다.
--   하루 1행으로 미리 요약해 두면 30일이라도 대상당 30행만 읽으면 돼요.

CREATE TABLE daily_stats (
  monitor_id      INTEGER NOT NULL REFERENCES monitors(id),
  -- 한국 시간(KST) 기준 날짜 'YYYY-MM-DD'.
  -- 원본 시각은 UTC로 저장하지만, 보는 사람과 보고서가 한국 기준이라 "하루"는 KST로 자릅니다.
  day             TEXT    NOT NULL,
  total_checks    INTEGER NOT NULL,
  success_checks  INTEGER NOT NULL,   -- '느림'도 성공에 포함
  slow_checks     INTEGER NOT NULL,
  avg_response_ms INTEGER,            -- 성공한 점검의 평균 응답 시간. 성공이 없으면 NULL
  source          TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'sample', 'simulator')),
  updated_at      TEXT    NOT NULL,   -- 마지막으로 다시 계산한 시각 (UTC ISO)

  -- 대상 + 날짜당 1행. Cron이 같은 날을 여러 번 다시 계산해도 덮어쓰기만 됩니다.
  PRIMARY KEY (monitor_id, day),
  -- 숫자끼리 앞뒤가 맞는지 DB에서도 확인 (성공 ≤ 전체, 느림 ≤ 성공)
  CHECK (success_checks <= total_checks AND slow_checks <= success_checks)
);

-- '최근 알림 20건' 조회: ORDER BY created_at DESC LIMIT 20
-- 인덱스가 시간 순서로 정렬된 목차 역할을 해서, 테이블 전체를 정렬하지 않고 끝에서부터 20개만 읽습니다.
CREATE INDEX idx_notifications_created ON notifications (created_at);
