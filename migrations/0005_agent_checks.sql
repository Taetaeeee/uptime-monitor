-- 0005: 내부 점검 에이전트(B-4)를 위한 컬럼 추가
--
-- 내부 점검(ping·TCP 포트·SSL 만료·디스크·서비스)도 HTTP 점검과 같은 테이블을 씁니다.
--   - monitors.kind 에 'ping' / 'tcp' / 'ssl' / 'disk' / 'service' 가 추가로 들어갑니다.
--     (0001에서 kind를 CHECK로 막지 않았던 이유가 바로 이것: 종류가 늘어날 때 테이블을 새로 만들지 않으려고)
--   - 같은 테이블을 쓰면 장애 판정(B-2)·가동률(B-3)·상태 페이지를 그대로 함께 쓸 수 있어요.
-- Cron의 HTTP 점검은 kind = 'http'만 조회하므로, 내부 점검 대상을 Worker가 직접 점검하는 일은 없습니다.

-- 에이전트가 대상을 가리키는 이름 (예: 'sim-db-tcp')
--   왜 숫자 id가 아니라 이름인가? 에이전트 설정 파일에 DB의 id를 적어 두면
--   DB를 다시 만들거나 순서가 바뀔 때 엉뚱한 대상에 기록됩니다. 사람이 정한 이름은 바뀌지 않아요.
--   HTTP 대상은 에이전트와 관계없으니 NULL로 둡니다.
ALTER TABLE monitors ADD COLUMN check_key TEXT;

-- 판정 기준값: disk = 사용률 상한(%), ssl = 남은 일수 하한(일). 그 밖의 종류는 NULL
--   (ping·tcp의 '느림' 기준은 기존 max_response_ms를 그대로 씁니다)
ALTER TABLE monitors ADD COLUMN threshold INTEGER;

-- check_key는 겹치면 안 됩니다. (SQLite의 UNIQUE 인덱스는 NULL끼리는 겹쳐도 허용 → HTTP 대상은 문제없음)
CREATE UNIQUE INDEX idx_monitors_check_key ON monitors (check_key);

-- 측정값: disk = 사용률(%), ssl = 남은 일수. 그 밖에는 NULL
--   응답 시간은 기존 response_ms를 그대로 씁니다.
ALTER TABLE check_results ADD COLUMN value REAL;
