-- 가짜 데이터 영구 삭제 (2026-11 방침 변경: 실제 운영 서비스만 남긴다)
--
-- 무엇을 지우나?
--   ① 출처가 real이 아닌 모니터(sample·simulator·replay)와 그 모든 기록
--   ② 장애 훈련 대상(check_key = 'drill-local-tcp')과 그 기록 (훈련 장애 보고서 포함)
--   ③ 재생 시계열·재생 설정·데이터셋 메타 전부
--   남는 것: 출처 real인 실제 서비스 모니터(고쳐라!·Keychats)와 그 기록
--
-- 되돌릴 수 있나?
--   이 파일 자체로는 되돌릴 수 없습니다. 실행 전에 반드시 원격 DB 전체를 내보내기(export)로 백업합니다.
--   (README.md의 1단계)
--
-- 순서가 중요한 이유 (외래 키):
--   다른 표들이 monitors(id)를 가리키므로 자식 표 → monitors 순으로 지우고,
--   monitors.dataset_id가 datasets를 가리키므로 datasets는 monitors 뒤에 지웁니다.
--   지울 모니터 조건은 monitors를 마지막에 지울 때까지 바뀌지 않으므로 각 줄에 같은 조건을 씁니다.
--   (임시 표를 쓰지 않은 이유: 원격 D1에서 TEMP TABLE 지원 여부를 확인하지 못했기 때문)
--
-- 실행 (PowerShell, 프로젝트 폴더에서) — 백업과 check.sql 확인 뒤에:
--   npx.cmd wrangler d1 execute status-monitor-db --remote --file=scripts/purge-fake-data/purge.sql

DELETE FROM notifications       WHERE source <> 'real' OR monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp');
DELETE FROM daily_stats         WHERE source <> 'real' OR monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp');
DELETE FROM check_results       WHERE source <> 'real' OR monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp');
DELETE FROM incidents           WHERE source <> 'real' OR monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp');
DELETE FROM maintenance_windows WHERE source <> 'real' OR monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp');
DELETE FROM monitor_state       WHERE monitor_id IN (SELECT id FROM monitors WHERE source <> 'real' OR check_key = 'drill-local-tcp');
DELETE FROM replay_series;
DELETE FROM replay_config;
DELETE FROM monitors            WHERE source <> 'real' OR check_key = 'drill-local-tcp';
DELETE FROM datasets;
