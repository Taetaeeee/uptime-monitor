-- 공개 데이터셋 재생 되돌리기 (긴급 중단 + 다시 적재하기 전 정리)
--
-- 무엇을 하나? 재생 대상(source = 'replay')과 그 모든 기록, 재생 설정·시계열, 데이터셋 메타를 지웁니다.
--   real·simulator·sample 데이터는 건드리지 않습니다.
--   다시 올리려면: datasets.sql → monitors.sql → series-*.sql 순서로 실행 (scripts/prepare-datasets/README.md)
--
-- 순서가 중요한 이유: 다른 표들이 monitors(id)를 가리키므로 monitors는 마지막에,
--   monitors.dataset_id가 datasets를 가리키므로 datasets는 monitors보다 뒤에 지웁니다.
--
-- 실행 (PowerShell, 프로젝트 폴더에서):
--   npx.cmd wrangler d1 execute status-monitor-db --remote --file=seed/replay/unload.sql

DELETE FROM notifications       WHERE source = 'replay' OR monitor_id IN (SELECT id FROM monitors WHERE source = 'replay');
DELETE FROM daily_stats         WHERE source = 'replay' OR monitor_id IN (SELECT id FROM monitors WHERE source = 'replay');
DELETE FROM check_results       WHERE source = 'replay' OR monitor_id IN (SELECT id FROM monitors WHERE source = 'replay');
DELETE FROM incidents           WHERE source = 'replay' OR monitor_id IN (SELECT id FROM monitors WHERE source = 'replay');
DELETE FROM maintenance_windows WHERE source = 'replay' OR monitor_id IN (SELECT id FROM monitors WHERE source = 'replay');
DELETE FROM monitor_state       WHERE monitor_id IN (SELECT id FROM monitors WHERE source = 'replay');
DELETE FROM replay_series       WHERE monitor_id IN (SELECT id FROM monitors WHERE source = 'replay');
DELETE FROM replay_config       WHERE monitor_id IN (SELECT id FROM monitors WHERE source = 'replay');
DELETE FROM monitors            WHERE source = 'replay';
DELETE FROM datasets            WHERE key IN ('smd', 'nab', 'backblaze');
