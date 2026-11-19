-- 테스트 전용 고정 자료: 시뮬레이터용 가상 내부 점검 대상 (source = 'simulator')
--
-- 배포 DB에는 넣지 않습니다. (2026-11-19 방침: 배포본에는 실제 운영 서비스만 둠)
-- 원래 seed/simulator-monitors.sql이었고, 지금은 수신 API·무응답 감지 테스트와
-- 에이전트 시나리오 키 검사(agent/tests/test_agent.py)가 쓰는 입력으로만 남겨 두었습니다.
-- 로컬에서 시뮬레이터를 끝까지 시연하려면 로컬 D1에만 이 파일을 넣습니다(--local).
--
-- 다시 실행하면 시뮬레이터 대상과 그 기록(결과·상태·집계·알림)을 모두 지우고 새로 등록합니다.
--   → 시뮬레이터 데모를 처음부터 다시 보여 주고 싶을 때 쓰는 "초기화" 역할도 합니다.
-- real·sample 데이터는 건드리지 않아요.
--
-- 주소는 모두 '.invalid'(존재할 수 없는 예약 도메인)라 실제로 접속될 일이 없습니다.
-- 이 대상들은 kind가 http가 아니라서 Worker의 Cron도 점검하지 않아요.

DELETE FROM notifications WHERE source = 'simulator';
DELETE FROM daily_stats   WHERE source = 'simulator';
DELETE FROM check_results WHERE source = 'simulator';
DELETE FROM monitor_state WHERE monitor_id IN (SELECT id FROM monitors WHERE source = 'simulator');
-- B-5: 장애 이력·계획 작업 (시뮬레이터 대상을 가리키는 것은 함께 지움 — 대상이 사라지므로)
DELETE FROM incidents           WHERE source = 'simulator' OR monitor_id IN (SELECT id FROM monitors WHERE source = 'simulator');
DELETE FROM maintenance_windows WHERE source = 'simulator' OR monitor_id IN (SELECT id FROM monitors WHERE source = 'simulator');
DELETE FROM monitors      WHERE source = 'simulator';

-- max_response_ms: ping·tcp의 '느림' 기준 / threshold: disk = 사용률 상한(%), ssl = 남은 일수 하한(일)
INSERT INTO monitors (name, kind, url, check_key, max_response_ms, threshold, is_active, source) VALUES
  ('코어 스위치 (ping)',      'ping',    'ping://core-switch.demo.invalid',     'sim-core-switch-ping', 100,  NULL, 1, 'simulator'),
  ('사내 DB 서버 (5432 포트)', 'tcp',     'tcp://db.demo.invalid:5432',          'sim-db-tcp',           500,  NULL, 1, 'simulator'),
  ('파일 서버 디스크 (D:)',   'disk',    'disk://fileserver.demo.invalid/D:',   'sim-fileserver-disk',  3000, 90,   1, 'simulator'),
  ('그룹웨어 인증서',         'ssl',     'ssl://gw.demo.invalid:443',           'sim-gw-ssl',           3000, 14,   1, 'simulator'),
  ('ERP 배치 서비스',         'service', 'service://erp-app.demo.invalid/ERP-Batch', 'sim-erp-batch-svc', 3000, NULL, 1, 'simulator');
