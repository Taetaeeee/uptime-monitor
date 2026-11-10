-- 0002: 초기 점검 대상 등록
-- 내가 운영하는 서비스만 점검합니다. (남의 사이트는 점검하지 않음)
--
-- 지금은 비활성(is_active = 0)으로 등록만 해 둡니다.
-- 먼저 가짜 데이터(seed/sample.sql)로 저장 구조를 확인하고, 실제 사이트 점검은 나중에 켭니다.
-- 비활성이면 Cron이 이 대상을 조회하지 않아서 실제 요청이 나가지 않아요.
--
-- 실제 점검을 시작할 때 (원격 DB 기준, PowerShell):
--   npx.cmd wrangler d1 execute status-monitor-db --remote --command "UPDATE monitors SET is_active = 1 WHERE url = 'https://gochyeora.pages.dev'"
--
-- keyword는 일단 NULL(검사 안 함)로 둡니다.
-- 페이지에 항상 나오는 단어(예: 게임 제목)를 정한 뒤 아래처럼 바꾸면 됩니다:
--   UPDATE monitors SET keyword = '페이지에_항상_있는_단어' WHERE url = 'https://gochyeora.pages.dev';
INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active, source)
VALUES ('고쳐라! 웹게임', 'http', 'https://gochyeora.pages.dev', 200, NULL, 3000, 0, 'real');
