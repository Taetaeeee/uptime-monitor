-- 가짜 데이터 정리 전후 확인 조회 (읽기 전용 — 아무것도 바꾸지 않습니다)
--
-- 왜 필요한가?
--   지우기 "전"에 몇 건이 지워질지, 지운 "뒤"에 실제(real) 기록이 그대로 남았는지
--   숫자로 비교하려고 같은 조회를 두 번 실행합니다.
--
-- 지울 대상의 정의 (purge.sql과 같아야 함):
--   ① 출처(source)가 real이 아닌 모니터 = sample·simulator·replay
--   ② 출처는 real이지만 실제 서비스가 아닌 장애 훈련 대상 (check_key = 'drill-local-tcp')
--
-- 실행 (PowerShell, 프로젝트 폴더에서) — 로컬 리허설용:
--   npx.cmd wrangler d1 execute status-monitor-db --local --file=scripts/purge-fake-data/check.sql
--
-- 주의: 원격(--remote)에 --file로 실행하면 wrangler가 '가져오기' 방식으로 처리해
--   실행 통계만 보여 주고 조회 결과는 보여 주지 않습니다.
--   원격 확인은 README.md의 --command 조회 두 개를 씁니다.

-- 1) 남길 모니터 / 지울 모니터 목록
SELECT
  CASE WHEN source <> 'real' OR check_key = 'drill-local-tcp' THEN '지움' ELSE '남김' END AS action,
  id, name, kind, source, is_active
FROM monitors
ORDER BY action, id;

-- 2) 표별: 전체 / 지울 행 / 남길 행
--    D1은 UNION으로 묶을 수 있는 조회 수에 제한이 있어 표마다 따로 조회합니다.
SELECT 'monitor_state' AS tbl, COUNT(*) AS total, IFNULL(SUM(monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp')), 0) AS to_delete, COUNT(*) - IFNULL(SUM(monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp')), 0) AS to_keep FROM monitor_state;
SELECT 'check_results' AS tbl, COUNT(*) AS total, IFNULL(SUM(source <> 'real' OR monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp')), 0) AS to_delete, COUNT(*) - IFNULL(SUM(source <> 'real' OR monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp')), 0) AS to_keep FROM check_results;
SELECT 'daily_stats' AS tbl, COUNT(*) AS total, IFNULL(SUM(source <> 'real' OR monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp')), 0) AS to_delete, COUNT(*) - IFNULL(SUM(source <> 'real' OR monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp')), 0) AS to_keep FROM daily_stats;
SELECT 'notifications' AS tbl, COUNT(*) AS total, IFNULL(SUM(source <> 'real' OR monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp')), 0) AS to_delete, COUNT(*) - IFNULL(SUM(source <> 'real' OR monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp')), 0) AS to_keep FROM notifications;
SELECT 'incidents' AS tbl, COUNT(*) AS total, IFNULL(SUM(source <> 'real' OR monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp')), 0) AS to_delete, COUNT(*) - IFNULL(SUM(source <> 'real' OR monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp')), 0) AS to_keep FROM incidents;
-- monitor_id가 NULL인 계획 작업(전체 대상)은 출처로만 판단합니다. NULL IN (...)은 NULL이라 IFNULL로 0 처리.
SELECT 'maintenance_windows' AS tbl, COUNT(*) AS total, IFNULL(SUM(source <> 'real' OR IFNULL(monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp'), 0)), 0) AS to_delete, COUNT(*) - IFNULL(SUM(source <> 'real' OR IFNULL(monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp'), 0)), 0) AS to_keep FROM maintenance_windows;
SELECT 'replay_series' AS tbl, COUNT(*) AS total, COUNT(*) AS to_delete, 0 AS to_keep FROM replay_series;
SELECT 'replay_config' AS tbl, COUNT(*) AS total, COUNT(*) AS to_delete, 0 AS to_keep FROM replay_config;
SELECT 'datasets' AS tbl, COUNT(*) AS total, COUNT(*) AS to_delete, 0 AS to_keep FROM datasets;
