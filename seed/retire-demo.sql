-- 데모(sample) 정리 — B-7f 컷오버에서 한 번 실행
--
-- 왜 지우나?
--   배포본에서는 공개 데이터셋 재생(seed/replay)이 가짜 데모 서비스를 대체합니다.
--   같은 이름("사내 ERP")이 데모와 재생에 함께 있으면 어느 쪽인지 헷갈리고, 가짜와 실제 기록이 섞여 보입니다.
--
-- 무엇을 지우나? 출처가 'sample'인 것만. real·simulator·replay 데이터는 건드리지 않습니다.
--   (monitors를 참조하는 표를 먼저 지우고, 마지막에 monitors를 지웁니다: 외래 키 순서)
--
-- 되돌리려면: seed/sample.sql을 다시 실행하면 데모가 다시 들어갑니다. (로컬 개발·테스트용 파일로 남겨 둠)
--
-- 실행 (PowerShell, 프로젝트 폴더에서):
--   npx.cmd wrangler d1 execute status-monitor-db --remote --file=seed/retire-demo.sql

DELETE FROM notifications WHERE source = 'sample';
DELETE FROM daily_stats   WHERE source = 'sample';
DELETE FROM check_results WHERE source = 'sample';
DELETE FROM monitor_state WHERE monitor_id IN (SELECT id FROM monitors WHERE source = 'sample');
-- 대상이 사라지므로 가상 서비스를 가리키는 장애 이력·계획 작업은 출처와 상관없이 함께 지움
DELETE FROM incidents           WHERE source = 'sample' OR monitor_id IN (SELECT id FROM monitors WHERE source = 'sample');
DELETE FROM maintenance_windows WHERE source = 'sample' OR monitor_id IN (SELECT id FROM monitors WHERE source = 'sample');
DELETE FROM monitors      WHERE source = 'sample';
