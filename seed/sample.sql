-- 시드: 데모용 가짜 데이터 (source = 'sample')
--
-- 왜 마이그레이션이 아니라 별도 파일인가?
--   마이그레이션은 "스키마"를 바꾸는 이력이고, 한 번 적용되면 다시 실행되지 않습니다.
--   데모 데이터는 필요할 때 지우고 다시 넣을 수 있어야 해서 따로 둡니다.
--
-- 실행 (PowerShell, 프로젝트 폴더에서):
--   npx.cmd wrangler d1 execute status-monitor-db --remote --file=seed/sample.sql
--
-- 지켜야 할 규칙 (CLAUDE.md '가짜 데이터')
--   - 모든 행에 source = 'sample'
--   - 가상 서비스는 실제로 점검하지 않음: is_active = 0 + 존재할 수 없는 주소
--     '.invalid'는 인터넷 표준(RFC 2606)으로 예약된 도메인이라 실제로 존재할 수 없어요.
--   - 회사·서비스 이름은 모두 가상
--
-- 여러 번 실행해도 결과가 같도록(멱등), 먼저 기존 sample 데이터를 지우고 다시 넣습니다.
-- real 데이터는 건드리지 않아요.

-- ─────────────────────────────────────────────
-- 1) 기존 sample 데이터 삭제 (결과 → 대상 순서: 결과가 대상을 참조하므로)
-- ─────────────────────────────────────────────
DELETE FROM check_results WHERE source = 'sample';
DELETE FROM monitors      WHERE source = 'sample';

-- ─────────────────────────────────────────────
-- 2) 가상 점검 대상 3개 (모두 비활성)
-- ─────────────────────────────────────────────
INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active, source) VALUES
  ('○○산업 ERP',         'http', 'https://erp.ooindustry.invalid',      200, NULL,   3000, 0, 'sample'),
  ('○○산업 그룹웨어',    'http', 'https://gw.ooindustry.invalid',       200, NULL,   3000, 0, 'sample'),
  ('○○산업 고객센터',    'http', 'https://support.ooindustry.invalid',  200, '고객센터', 3000, 0, 'sample');

-- ─────────────────────────────────────────────
-- 3) 가짜 점검 결과: 대상마다 최근 2시간, 5분 간격 24행
-- ─────────────────────────────────────────────
-- 시각 만드는 법:
--   지금 시각(초)을 300초(5분) 단위로 내림 → 실제 Cron 회차처럼 :00, :05, :10 ... 에 맞춥니다.
--   n = 0이 가장 최근, n = 23이 약 2시간 전.
--   저장 형식은 실제 점검과 같은 UTC ISO 문자열 (예: 2026-11-10T01:30:00Z).
--
-- 일부러 넣은 상황 (판정 규칙과 DB 제약이 실제로 받아들이는지 확인용):
--   ERP       : 시간 초과 1번, 느림 1번
--   그룹웨어  : 상태 코드 불일치(503) 1번, 네트워크 오류 1번, 느림 2번
--   고객센터  : 키워드 없음 1번
--   실패 행은 is_slow = 0 (CHECK 제약), 응답이 없으면 status_code·response_ms = NULL

-- ERP
INSERT INTO check_results
  (monitor_id, checked_at, is_success, is_slow, status_code, response_ms, failure_reason, source)
WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < 23)
SELECT
  (SELECT id FROM monitors WHERE url = 'https://erp.ooindustry.invalid'),
  strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - n * 300, 'unixepoch'),
  CASE WHEN n = 3 THEN 0 ELSE 1 END,
  CASE WHEN n = 10 THEN 1 ELSE 0 END,
  CASE WHEN n = 3 THEN NULL ELSE 200 END,
  CASE WHEN n = 3 THEN NULL WHEN n = 10 THEN 3420 ELSE 380 + (n * 37) % 200 END,
  CASE WHEN n = 3 THEN 'timeout' ELSE NULL END,
  'sample'
FROM seq;

-- 그룹웨어
INSERT INTO check_results
  (monitor_id, checked_at, is_success, is_slow, status_code, response_ms, failure_reason, source)
WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < 23)
SELECT
  (SELECT id FROM monitors WHERE url = 'https://gw.ooindustry.invalid'),
  strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - n * 300, 'unixepoch'),
  CASE WHEN n IN (5, 6) THEN 0 ELSE 1 END,
  CASE WHEN n IN (15, 16) THEN 1 ELSE 0 END,
  CASE WHEN n = 5 THEN 503 WHEN n = 6 THEN NULL ELSE 200 END,
  CASE WHEN n = 5 THEN 140 WHEN n = 6 THEN NULL
       WHEN n = 15 THEN 3250 WHEN n = 16 THEN 3610
       ELSE 520 + (n * 53) % 300 END,
  CASE WHEN n = 5 THEN 'status_mismatch' WHEN n = 6 THEN 'network_error' ELSE NULL END,
  'sample'
FROM seq;

-- 고객센터
INSERT INTO check_results
  (monitor_id, checked_at, is_success, is_slow, status_code, response_ms, failure_reason, source)
WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < 23)
SELECT
  (SELECT id FROM monitors WHERE url = 'https://support.ooindustry.invalid'),
  strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - n * 300, 'unixepoch'),
  CASE WHEN n = 8 THEN 0 ELSE 1 END,
  0,
  200,
  610 + (n * 29) % 250,
  CASE WHEN n = 8 THEN 'keyword_missing' ELSE NULL END,
  'sample'
FROM seq;
