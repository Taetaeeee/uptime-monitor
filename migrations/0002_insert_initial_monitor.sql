-- 0002: 초기 점검 대상 등록
-- 내가 운영하는 서비스만 점검합니다. (남의 사이트는 점검하지 않음)
--
-- keyword는 일단 NULL(검사 안 함)로 둡니다.
-- 페이지에 항상 나오는 단어(예: 게임 제목)를 정한 뒤 아래처럼 바꾸면 됩니다:
--   UPDATE monitors SET keyword = '페이지에_항상_있는_단어' WHERE id = 1;
INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active)
VALUES ('고쳐라! 웹게임', 'http', 'https://gochyeora.pages.dev', 200, NULL, 3000, 1);
