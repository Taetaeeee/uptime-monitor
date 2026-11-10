-- 0007: 실제 DNS 점검 대상 등록 (외부 점검 확장)
-- 내가 운영하는 사이트의 이름(gochyeora.pages.dev)이 정상적으로 풀리는지 봅니다.
--
-- HTTP 점검(0002)과 마찬가지로 지금은 비활성(is_active = 0)으로 등록만 해 둡니다.
-- 실제 점검을 켤 때 HTTP와 함께 켭니다:
--   npx.cmd wrangler d1 execute status-monitor-db --remote --command "UPDATE monitors SET is_active = 1 WHERE url IN ('https://gochyeora.pages.dev', 'dns://gochyeora.pages.dev')"
--
-- 기존 컬럼을 DNS 용도로 재사용합니다 (새 컬럼을 만들지 않으려고):
--   url             : 'dns://호스트' (AAAA 등 다른 종류는 'dns://호스트?type=AAAA')
--   keyword         : 기대값 — 응답에 이 글자가 들어 있어야 성공 (NULL이면 검사 안 함)
--                     pages.dev는 IP가 바뀔 수 있어서 지금은 지정하지 않습니다
--   max_response_ms : 이보다 느리면 '느림' (DNS는 HTTP보다 빨라야 하므로 1초)
INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active, source)
VALUES ('고쳐라! 웹게임 (DNS)', 'dns', 'dns://gochyeora.pages.dev', 200, NULL, 1000, 0, 'real');
