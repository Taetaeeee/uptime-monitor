-- 시뮬레이터 "파일 서버 디스크 (D:)" 정리 — B-7f 컷오버에서 한 번 실행
--
-- 왜 지우나?
--   (1) 같은 역할을 Backblaze 재생("파일서버·NAS 디스크")이 실제 기록으로 대체합니다.
--   (2) 에이전트가 멈춘 채로 'disk_full' 장애가 열려 있어서(41시간 넘게), 상태 페이지 상단에
--       "N개 서비스 장애"가 계속 남습니다. 이 장애는 닫아 줄 보고가 오지 않으므로 의미 있는 경고가 아닙니다.
--
-- 왜 DB 포트 시뮬레이터는 남기나?
--   agent/scenarios/db-outage.json 시나리오가 그 대상('sim-db-tcp')을 닫았다 여는 이야기라서, 지우면 시나리오가 의미를 잃습니다.
--
-- 무엇을 지우나? check_key가 'sim-fileserver-disk'인 대상 1개와 그 대상의 기록(결과·상태·집계·알림·장애·계획 작업).
--   다른 시뮬레이터·real·replay 데이터는 건드리지 않습니다. (monitors를 참조하는 표를 먼저 지움)
--   에이전트 시나리오는 이 키를 계속 보내지만 서버가 '등록되지 않은 키(unknown)'로 응답에 적고 무시할 뿐 오류가 아닙니다.
--
-- 실행: npx.cmd wrangler d1 execute status-monitor-db --remote --file=seed/retire-simulator-disk.sql

DELETE FROM notifications       WHERE monitor_id IN (SELECT id FROM monitors WHERE check_key = 'sim-fileserver-disk');
DELETE FROM daily_stats         WHERE monitor_id IN (SELECT id FROM monitors WHERE check_key = 'sim-fileserver-disk');
DELETE FROM check_results       WHERE monitor_id IN (SELECT id FROM monitors WHERE check_key = 'sim-fileserver-disk');
DELETE FROM monitor_state       WHERE monitor_id IN (SELECT id FROM monitors WHERE check_key = 'sim-fileserver-disk');
DELETE FROM incidents           WHERE monitor_id IN (SELECT id FROM monitors WHERE check_key = 'sim-fileserver-disk');
DELETE FROM maintenance_windows WHERE monitor_id IN (SELECT id FROM monitors WHERE check_key = 'sim-fileserver-disk');
DELETE FROM monitors            WHERE check_key = 'sim-fileserver-disk';
