-- 시드: 데모용 가짜 데이터 (source = 'sample')
--
-- 왜 마이그레이션이 아니라 별도 파일인가?
--   마이그레이션은 "스키마"를 바꾸는 이력이고, 한 번 적용되면 다시 실행되지 않습니다.
--   데모 데이터는 필요할 때 지우고 다시 넣을 수 있어야 해서 따로 둡니다.
--
-- 실행 (PowerShell, 프로젝트 폴더에서, 마이그레이션 0004까지 적용된 뒤):
--   npx.cmd wrangler d1 execute status-monitor-db --remote --file=seed/sample.sql
--
-- 지켜야 할 규칙 (CLAUDE.md '가짜 데이터')
--   - 모든 행에 source = 'sample' (monitor_state는 출처 컬럼이 없어서 sample 대상의 행만 넣음)
--   - 가상 서비스는 실제로 점검하지 않음: is_active = 0 + 존재할 수 없는 주소
--     '.invalid'는 인터넷 표준(RFC 2606)으로 예약된 도메인이라 실제로 존재할 수 없어요.
--   - 회사·서비스 이름은 모두 가상
--
-- 무엇을 넣나
--   1) 가상 서비스 3개
--   2) 최근 2시간 원본 점검 결과 (대상당 24행)
--   3) 현재 상태(monitor_state): ERP·그룹웨어 정상, 고객센터 장애 중 (화면에서 장애 모습을 보여 주기 위해)
--   4) 최근 30일 일별 집계: 어제까지 29일은 집계만 직접 넣고, 오늘은 2)의 원본에서 계산
--      → 원본을 30일치(약 2.6만 행) 넣으면 D1 쓰기 한도를 크게 쓰기 때문에 집계(90행)로 대신합니다.
--   5) 장애·복구 알림 (2)·4)의 장애와 시각·메시지가 맞도록)
--   6) 장애 이력과 보고서(일부), 7) 계획 작업 지난 1건·예정 1건 (B-5)
--
-- 시각 계산
--   회차 시각 slot(n): 지금을 5분 단위로 내림한 뒤 n회차 전. n = 0이 가장 최근.
--   한국 시간 D일 HH:MM → UTC: strftime(..., date('now','+9 hours','-D days') || ' HH:MM:00', '-9 hours')
--   (SQLite의 'now'는 문장마다 따로 계산돼서, 5분 경계에 걸쳐 실행되면 회차가 한 칸 어긋날 수 있어요. 데모라 허용)
--
-- 여러 번 실행해도 결과가 같도록(멱등), 먼저 기존 sample 데이터를 지우고 다시 넣습니다.
-- real 데이터는 건드리지 않아요.

-- ─────────────────────────────────────────────
-- 0) 기존 sample 데이터 삭제 (다른 테이블이 참조하는 monitors를 마지막에)
-- ─────────────────────────────────────────────
DELETE FROM notifications WHERE source = 'sample';
DELETE FROM daily_stats   WHERE source = 'sample';
DELETE FROM check_results WHERE source = 'sample';
DELETE FROM monitor_state WHERE monitor_id IN (SELECT id FROM monitors WHERE source = 'sample');
-- B-5: 장애 이력·계획 작업 (가상 서비스를 가리키는 것은 출처와 상관없이 함께 지움 — 대상이 사라지므로)
DELETE FROM incidents           WHERE source = 'sample' OR monitor_id IN (SELECT id FROM monitors WHERE source = 'sample');
DELETE FROM maintenance_windows WHERE source = 'sample' OR monitor_id IN (SELECT id FROM monitors WHERE source = 'sample');
DELETE FROM monitors      WHERE source = 'sample';

-- ─────────────────────────────────────────────
-- 1) 가상 점검 대상 3개 (모두 비활성)
-- ─────────────────────────────────────────────
INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active, source) VALUES
  ('사내 ERP',         'http', 'https://erp.demo.invalid',      200, NULL,   3000, 0, 'sample'),
  ('그룹웨어',    'http', 'https://gw.demo.invalid',       200, NULL,   3000, 0, 'sample'),
  ('고객센터',    'http', 'https://support.demo.invalid',  200, '고객센터', 3000, 0, 'sample');

-- 도메인 만료 데모 대상 (외부 점검 확장)
--   내 도메인이 없어서 실제 만료일 조회는 하지 않습니다. 판정 로직(judge.js judgeDomainExpiry)이
--   화면·보고서에서 어떻게 보이는지 보여 주기 위한 데모입니다. value = 만료까지 남은 일수, threshold = 30일
INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, threshold, is_active, source) VALUES
  ('대표 도메인 만료', 'domain', 'domain://demo.invalid', 200, NULL, 3000, 30, 0, 'sample');

-- ─────────────────────────────────────────────
-- 2) 원본 점검 결과: 대상마다 최근 2시간, 5분 간격 24행
-- ─────────────────────────────────────────────
-- 일부러 넣은 상황:
--   ERP       : 시간 초과 1번(n=3, 단발이라 장애 아님), 느림 1번
--   그룹웨어  : 네트워크 오류(n=6) → 503(n=5) 2회 연속 실패 = 장애, n=4에서 복구. 느림 2번
--   고객센터  : 키워드 없음 단발 1번(n=8), 그리고 최근 2회(n=1, n=0) 연속 실패 = 지금 장애 중
--   실패 행은 is_slow = 0 (CHECK 제약), 응답이 없으면 status_code·response_ms = NULL

-- ERP
INSERT INTO check_results
  (monitor_id, checked_at, is_success, is_slow, status_code, response_ms, failure_reason, source)
WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < 23)
SELECT
  (SELECT id FROM monitors WHERE url = 'https://erp.demo.invalid'),
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
  (SELECT id FROM monitors WHERE url = 'https://gw.demo.invalid'),
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
  (SELECT id FROM monitors WHERE url = 'https://support.demo.invalid'),
  strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - n * 300, 'unixepoch'),
  CASE WHEN n IN (0, 1, 8) THEN 0 ELSE 1 END,
  0,
  200,
  610 + (n * 29) % 250,
  CASE WHEN n IN (0, 1, 8) THEN 'keyword_missing' ELSE NULL END,
  'sample'
FROM seq;

-- ─────────────────────────────────────────────
-- 3) 현재 상태 (2)의 원본 흐름과 맞춤)
-- ─────────────────────────────────────────────
INSERT INTO monitor_state
  (monitor_id, state, consecutive_failures, consecutive_successes, failing_since, last_checked_at, changed_at)
VALUES
  -- ERP: n=3 단발 실패 뒤 3회 연속 성공. 마지막 상태 변경은 6일 전 장애 복구(아래 알림과 같음)
  ((SELECT id FROM monitors WHERE url = 'https://erp.demo.invalid'),
   'up', 0, 3, NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300, 'unixepoch'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-6 days') || ' 21:30:00', '-9 hours')),
  -- 그룹웨어: n=4에서 복구된 뒤 4회 연속 성공
  ((SELECT id FROM monitors WHERE url = 'https://gw.demo.invalid'),
   'up', 0, 4, NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300, 'unixepoch'),
   strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - 4 * 300, 'unixepoch')),
  -- 고객센터: n=1부터 연속 실패, n=0에서 장애 판정
  ((SELECT id FROM monitors WHERE url = 'https://support.demo.invalid'),
   'down', 2, 0,
   strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - 1 * 300, 'unixepoch'),
   strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300, 'unixepoch'),
   strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300, 'unixepoch'));

-- ─────────────────────────────────────────────
-- 4) 일별 집계 (KST 날짜)
-- ─────────────────────────────────────────────
-- 4-1) 어제(1일 전) ~ 29일 전: 하루 288회 점검(5분 × 24시간)을 가정한 집계를 직접 넣습니다.
--      장애가 있던 날 (아래 알림과 같은 날·같은 횟수):
--        ERP       6일 전 실패 4회(20분), 17일 전 실패 13회(65분)
--        그룹웨어  3일 전 실패 2회(10분), 12일 전 실패 30회(150분), 25일 전 단발 실패 1회(알림 없음)
--        고객센터  9일 전 실패 6회(30분)

-- ERP
--   20일 전 02:00~04:00은 계획 작업(아래 6번) → 그 2시간(24회)은 가동률 계산에서 빼고 maintenance_checks로만 셉니다
INSERT INTO daily_stats
  (monitor_id, day, total_checks, success_checks, slow_checks, avg_response_ms, source, updated_at, maintenance_checks)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 29)
SELECT
  (SELECT id FROM monitors WHERE url = 'https://erp.demo.invalid'),
  date('now', '+9 hours', '-' || n || ' days'),
  288 - CASE n WHEN 20 THEN 24 ELSE 0 END,
  288 - CASE n WHEN 20 THEN 24 ELSE 0 END - CASE n WHEN 6 THEN 4 WHEN 17 THEN 13 ELSE 0 END,
  CASE WHEN n % 5 = 0 THEN 2 ELSE 0 END,
  420 + (n * 37) % 120,
  'sample',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  CASE n WHEN 20 THEN 24 ELSE 0 END
FROM seq;

-- 그룹웨어
INSERT INTO daily_stats
  (monitor_id, day, total_checks, success_checks, slow_checks, avg_response_ms, source, updated_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 29)
SELECT
  (SELECT id FROM monitors WHERE url = 'https://gw.demo.invalid'),
  date('now', '+9 hours', '-' || n || ' days'),
  288,
  288 - CASE n WHEN 3 THEN 2 WHEN 12 THEN 30 WHEN 25 THEN 1 ELSE 0 END,
  CASE WHEN n % 4 = 0 THEN 3 ELSE 1 END,
  610 + (n * 53) % 160,
  'sample',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM seq;

-- 고객센터
INSERT INTO daily_stats
  (monitor_id, day, total_checks, success_checks, slow_checks, avg_response_ms, source, updated_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 29)
SELECT
  (SELECT id FROM monitors WHERE url = 'https://support.demo.invalid'),
  date('now', '+9 hours', '-' || n || ' days'),
  288,
  288 - CASE n WHEN 9 THEN 6 ELSE 0 END,
  0,
  690 + (n * 29) % 140,
  'sample',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM seq;

-- 4-1b) 도메인 만료 데모: 원본(최근 2시간, 모두 성공, 만료까지 41일), 현재 상태, 지난 29일 집계
--       하루에 한 번만 봐도 되는 항목이지만, 다른 대상과 같은 모양을 보여 주려고 5분 간격으로 넣습니다.
INSERT INTO check_results
  (monitor_id, checked_at, is_success, is_slow, status_code, response_ms, failure_reason, value, source)
WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < 23)
SELECT
  (SELECT id FROM monitors WHERE url = 'domain://demo.invalid'),
  strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - n * 300, 'unixepoch'),
  1, 0, NULL, NULL, NULL, 41, 'sample'
FROM seq;

INSERT INTO monitor_state
  (monitor_id, state, consecutive_failures, consecutive_successes, failing_since, last_checked_at, changed_at)
VALUES
  ((SELECT id FROM monitors WHERE url = 'domain://demo.invalid'),
   'up', 0, 24, NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300, 'unixepoch'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-29 days') || ' 00:00:00', '-9 hours'));

INSERT INTO daily_stats
  (monitor_id, day, total_checks, success_checks, slow_checks, avg_response_ms, source, updated_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 29)
SELECT
  (SELECT id FROM monitors WHERE url = 'domain://demo.invalid'),
  date('now', '+9 hours', '-' || n || ' days'),
  288, 288, 0, NULL, 'sample',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM seq;

-- 4-2) 오늘: 2)의 원본에서 계산 (Cron이 실제 데이터를 집계하는 방식과 같은 규칙)
--      date(checked_at, '+9 hours') = 한국 날짜. 2시간 범위가 자정을 넘으면 어제 부분은 빠지지만 데모라 허용.
INSERT INTO daily_stats
  (monitor_id, day, total_checks, success_checks, slow_checks, avg_response_ms, source, updated_at)
SELECT
  monitor_id,
  date(checked_at, '+9 hours'),
  COUNT(*),
  SUM(is_success),
  SUM(is_slow),
  CAST(ROUND(AVG(CASE WHEN is_success = 1 THEN response_ms END)) AS INTEGER),
  'sample',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM check_results
WHERE source = 'sample' AND date(checked_at, '+9 hours') = date('now', '+9 hours')
GROUP BY monitor_id, date(checked_at, '+9 hours');

-- ─────────────────────────────────────────────
-- 5) 알림 (B-2 장애 판정 규칙과 같은 형식: 2회 연속 실패에서 장애, 첫 실패부터 복구까지가 장애 시간)
-- ─────────────────────────────────────────────
INSERT INTO notifications (monitor_id, event, channel, message, failure_reason, created_at, source) VALUES
  -- ERP 17일 전: 14:00부터 13회 실패 → 14:05 장애 판정 → 15:05 복구 (65분)
  ((SELECT id FROM monitors WHERE url = 'https://erp.demo.invalid'), 'down', 'log',
   '[장애] 사내 ERP: 연속 실패로 장애 판정 (응답 시간 초과)', 'timeout',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-17 days') || ' 14:05:00', '-9 hours'), 'sample'),
  ((SELECT id FROM monitors WHERE url = 'https://erp.demo.invalid'), 'recovered', 'log',
   '[복구] 사내 ERP: 정상 응답 확인 (장애 약 65분)', NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-17 days') || ' 15:05:00', '-9 hours'), 'sample'),

  -- 그룹웨어 12일 전: 02:00부터 30회 실패 → 02:05 장애 판정 → 04:30 복구 (150분)
  ((SELECT id FROM monitors WHERE url = 'https://gw.demo.invalid'), 'down', 'log',
   '[장애] 그룹웨어: 연속 실패로 장애 판정 (상태 코드 불일치)', 'status_mismatch',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-12 days') || ' 02:05:00', '-9 hours'), 'sample'),
  ((SELECT id FROM monitors WHERE url = 'https://gw.demo.invalid'), 'recovered', 'log',
   '[복구] 그룹웨어: 정상 응답 확인 (장애 약 150분)', NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-12 days') || ' 04:30:00', '-9 hours'), 'sample'),

  -- 고객센터 9일 전: 09:00부터 6회 실패 → 09:05 장애 판정 → 09:30 복구 (30분)
  ((SELECT id FROM monitors WHERE url = 'https://support.demo.invalid'), 'down', 'log',
   '[장애] 고객센터: 연속 실패로 장애 판정 (키워드 없음)', 'keyword_missing',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-9 days') || ' 09:05:00', '-9 hours'), 'sample'),
  ((SELECT id FROM monitors WHERE url = 'https://support.demo.invalid'), 'recovered', 'log',
   '[복구] 고객센터: 정상 응답 확인 (장애 약 30분)', NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-9 days') || ' 09:30:00', '-9 hours'), 'sample'),

  -- ERP 6일 전: 21:10부터 4회 실패 → 21:15 장애 판정 → 21:30 복구 (20분)
  ((SELECT id FROM monitors WHERE url = 'https://erp.demo.invalid'), 'down', 'log',
   '[장애] 사내 ERP: 연속 실패로 장애 판정 (응답 시간 초과)', 'timeout',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-6 days') || ' 21:15:00', '-9 hours'), 'sample'),
  ((SELECT id FROM monitors WHERE url = 'https://erp.demo.invalid'), 'recovered', 'log',
   '[복구] 사내 ERP: 정상 응답 확인 (장애 약 20분)', NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-6 days') || ' 21:30:00', '-9 hours'), 'sample'),

  -- 그룹웨어 3일 전: 11:40부터 2회 실패 → 11:45 장애 판정 → 11:50 복구 (10분)
  ((SELECT id FROM monitors WHERE url = 'https://gw.demo.invalid'), 'down', 'log',
   '[장애] 그룹웨어: 연속 실패로 장애 판정 (네트워크 오류)', 'network_error',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-3 days') || ' 11:45:00', '-9 hours'), 'sample'),
  ((SELECT id FROM monitors WHERE url = 'https://gw.demo.invalid'), 'recovered', 'log',
   '[복구] 그룹웨어: 정상 응답 확인 (장애 약 10분)', NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-3 days') || ' 11:50:00', '-9 hours'), 'sample'),

  -- 그룹웨어 오늘: 원본 n=6(네트워크 오류)·n=5(503) → n=5에서 장애 판정 → n=4에서 복구 (10분)
  ((SELECT id FROM monitors WHERE url = 'https://gw.demo.invalid'), 'down', 'log',
   '[장애] 그룹웨어: 연속 실패로 장애 판정 (상태 코드 불일치)', 'status_mismatch',
   strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - 5 * 300, 'unixepoch'), 'sample'),
  ((SELECT id FROM monitors WHERE url = 'https://gw.demo.invalid'), 'recovered', 'log',
   '[복구] 그룹웨어: 정상 응답 확인 (장애 약 10분)', NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - 4 * 300, 'unixepoch'), 'sample'),

  -- 고객센터 지금: 원본 n=1·n=0 연속 실패 → n=0에서 장애 판정 (아직 복구 안 됨)
  ((SELECT id FROM monitors WHERE url = 'https://support.demo.invalid'), 'down', 'log',
   '[장애] 고객센터: 연속 실패로 장애 판정 (키워드 없음)', 'keyword_missing',
   strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300, 'unixepoch'), 'sample');

-- ─────────────────────────────────────────────
-- 6) 장애 이력 (B-5) — 5)의 알림과 같은 장애를 1건씩 묶은 것
-- ─────────────────────────────────────────────
-- started_at = 첫 실패, detected_at = 장애 판정(알림 시각), resolved_at = 복구 (진행 중이면 NULL)
-- 보고서는 일부 장애에만 작성해 두어 '작성 전' 상태도 화면에서 보이게 합니다. 내용은 모두 가상입니다.
INSERT INTO incidents
  (monitor_id, started_at, detected_at, resolved_at, cause,
   report_summary, report_impact, report_root_cause, report_action, report_prevention, report_updated_at, source)
VALUES
  -- ERP 17일 전 14:00~15:05 (65분), 보고서 있음
  ((SELECT id FROM monitors WHERE url = 'https://erp.demo.invalid'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-17 days') || ' 14:00:00', '-9 hours'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-17 days') || ' 14:05:00', '-9 hours'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-17 days') || ' 15:05:00', '-9 hours'),
   'timeout',
   'ERP 응답 지연으로 약 65분간 접속이 원활하지 않았습니다. (데모)',
   '오후 업무 시간에 ERP 조회·전표 입력이 10초 이상 걸리거나 시간 초과로 실패했습니다.',
   '월말 정산 배치가 업무 시간에 수동 실행되어 DB 잠금이 길어졌습니다.',
   '배치를 중지하고 잠금을 해제한 뒤 정상 응답을 확인했습니다. 배치는 야간에 다시 실행했습니다.',
   '정산 배치는 업무 시간 실행을 막고 야간 스케줄로만 돌리도록 운영 절차를 바꿉니다.',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-16 days') || ' 10:00:00', '-9 hours'),
   'sample'),
  -- 그룹웨어 12일 전 02:00~04:30 (150분), 보고서 있음
  ((SELECT id FROM monitors WHERE url = 'https://gw.demo.invalid'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-12 days') || ' 02:00:00', '-9 hours'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-12 days') || ' 02:05:00', '-9 hours'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-12 days') || ' 04:30:00', '-9 hours'),
   'status_mismatch',
   '새벽 시간 그룹웨어가 503 오류를 반환했습니다. (데모)',
   '야간 근무자의 메일·결재 확인이 약 2시간 30분 동안 불가했습니다.',
   '디스크 용량 부족으로 애플리케이션 로그를 쓰지 못해 서비스가 멈췄습니다.',
   '오래된 로그를 정리해 공간을 확보하고 서비스를 재시작했습니다.',
   '로그 보관 주기를 30일로 정하고, 디스크 사용률을 내부 점검 대상으로 추가합니다.',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-11 days') || ' 09:30:00', '-9 hours'),
   'sample'),
  -- 고객센터 9일 전 09:00~09:30 (30분), 보고서 없음
  ((SELECT id FROM monitors WHERE url = 'https://support.demo.invalid'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-9 days') || ' 09:00:00', '-9 hours'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-9 days') || ' 09:05:00', '-9 hours'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-9 days') || ' 09:30:00', '-9 hours'),
   'keyword_missing', NULL, NULL, NULL, NULL, NULL, NULL, 'sample'),
  -- ERP 6일 전 21:10~21:30 (20분), 보고서 있음
  ((SELECT id FROM monitors WHERE url = 'https://erp.demo.invalid'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-6 days') || ' 21:10:00', '-9 hours'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-6 days') || ' 21:15:00', '-9 hours'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-6 days') || ' 21:30:00', '-9 hours'),
   'timeout',
   '야간 백업과 겹쳐 ERP 응답이 20분간 지연되었습니다. (데모)',
   '야간 근무자의 재고 조회가 지연되었습니다.',
   '백업 시작 시각이 변경되면서 야간 집계 작업과 겹쳤습니다.',
   '집계 작업을 백업 이후로 미뤄 응답을 정상화했습니다.',
   '야간 작업 일정을 한 표로 관리하고, 겹치는 작업은 계획 작업 시간으로 미리 공지합니다.',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-5 days') || ' 11:00:00', '-9 hours'),
   'sample'),
  -- 그룹웨어 3일 전 11:40~11:50 (10분), 보고서 없음
  ((SELECT id FROM monitors WHERE url = 'https://gw.demo.invalid'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-3 days') || ' 11:40:00', '-9 hours'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-3 days') || ' 11:45:00', '-9 hours'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-3 days') || ' 11:50:00', '-9 hours'),
   'network_error', NULL, NULL, NULL, NULL, NULL, NULL, 'sample'),
  -- 그룹웨어 오늘: 원본 n=6(첫 실패) → n=5(판정) → n=4(복구), 보고서 없음
  ((SELECT id FROM monitors WHERE url = 'https://gw.demo.invalid'),
   strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - 6 * 300, 'unixepoch'),
   strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - 5 * 300, 'unixepoch'),
   strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - 4 * 300, 'unixepoch'),
   'status_mismatch', NULL, NULL, NULL, NULL, NULL, NULL, 'sample'),
  -- 고객센터 지금: 원본 n=1(첫 실패) → n=0(판정), 진행 중 (resolved_at NULL)
  ((SELECT id FROM monitors WHERE url = 'https://support.demo.invalid'),
   strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - 1 * 300, 'unixepoch'),
   strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300, 'unixepoch'),
   NULL,
   'keyword_missing', NULL, NULL, NULL, NULL, NULL, NULL, 'sample');

-- ─────────────────────────────────────────────
-- 7) 계획 작업 (B-5) — 가상 서비스에만 (실제 대상의 점검에는 영향 없음)
-- ─────────────────────────────────────────────
INSERT INTO maintenance_windows (monitor_id, title, starts_at, ends_at, source, created_at) VALUES
  -- 지난 작업: ERP 20일 전 02:00~04:00 (4)의 일별 집계에서 그날 24회를 가동률에서 제외한 것과 같은 시간)
  ((SELECT id FROM monitors WHERE url = 'https://erp.demo.invalid'),
   'ERP DB 정기 점검 (데모)',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-20 days') || ' 02:00:00', '-9 hours'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-20 days') || ' 04:00:00', '-9 hours'),
   'sample',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '-27 days') || ' 10:00:00', '-9 hours')),
  -- 예정 작업: 그룹웨어 2일 뒤 22:00~23:30
  ((SELECT id FROM monitors WHERE url = 'https://gw.demo.invalid'),
   '그룹웨어 보안 패치 (데모)',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '+2 days') || ' 22:00:00', '-9 hours'),
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now', '+9 hours', '+2 days') || ' 23:30:00', '-9 hours'),
   'sample',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
