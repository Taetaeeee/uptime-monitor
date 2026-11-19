# 가짜 데이터 영구 삭제 (2026-11-19 방침 변경)

## 왜 하나?

처음에는 실제 서비스가 적어서 데모(sample)·시뮬레이터(simulator)·공개 데이터셋 재생(replay)을 출처 표시와 함께 섞어 보여 줬습니다.
방침을 바꿔 **우리가 실제로 운영하는 서비스만** 남깁니다. 주간·장애 보고서도 앞으로 실제 서비스 기록만으로 새로 만듭니다.

## 무엇을 지우고 무엇을 남기나?

| 구분 | 대상 |
|---|---|
| 지움 | 출처가 real이 아닌 모니터(sample·simulator·replay)와 그 측정·일별 집계·알림·장애·계획 작업·상태 기록 |
| 지움 | 장애 훈련 대상 `drill-local-tcp` (출처는 real이지만 실제 서비스가 아님)과 훈련 장애 보고서 |
| 지움 | 재생 시계열(`replay_series`)·재생 설정(`replay_config`)·데이터셋 메타(`datasets`) 전부 |
| 남김 | 고쳐라! HTTP·DNS, Keychats HTTP·DNS·DB 상태 — 모니터 5개와 그 기록 전부 |
| 손대지 않음 | `rca_runs`·`rca_budget` (모니터를 참조하지 않는 AI 조사 기록) |

코드·화면 정리(재생 Cron 제거, seed 파일 삭제, 출처 배지 정리, 문서 수정)는 다음 단계에서 따로 합니다.
데이터를 먼저 지워도 안전한 이유: 재생 코드는 설정이 비어 있으면 아무것도 하지 않고(`src/replay-run.js`),
에이전트가 지워진 대상 키로 보고하면 수신 API가 '등록되지 않은 키'로 거절합니다(`src/ingest.js`).

## 실행 순서 (PowerShell, 프로젝트 폴더에서 직접 실행)

1. **백업** — 되돌릴 수 있는 유일한 방법입니다. 파일이 생겼는지 꼭 확인합니다.

   ```powershell
   npx.cmd wrangler d1 export status-monitor-db --remote --output=backup-before-purge-2026-11-19.sql
   ```

   백업 파일에는 운영 기록이 들어 있으므로 저장소에 커밋하지 않습니다(`.gitignore`의 `backup-*.sql`).

2. **지우기 전 확인** — '지움' 목록에 남겨야 할 서비스가 없는지 봅니다.

   원격 DB에 `--file`로 실행하면 wrangler가 '가져오기(import)' 방식으로 처리해 실행 통계만 보여 주고
   조회 결과 표는 보여 주지 않습니다(2026-11-19 실제로 겪음). 그래서 원격 확인은 `--command`로 합니다.
   `check.sql`은 로컬 리허설용으로 남겨 둡니다.

   (가) 모니터 목록 — KEEP이 실제 서비스 5개뿐이어야 합니다.

   ```powershell
   npx.cmd wrangler d1 execute status-monitor-db --remote --command "SELECT CASE WHEN source<>'real' OR check_key='drill-local-tcp' THEN 'DELETE' ELSE 'KEEP' END AS action, id, name, kind, source, is_active FROM monitors ORDER BY action, id"
   ```

   (나) 표별 전체(`_all`)와 남을 건수(`_keep`) — UNION 대신 하위 조회를 열로 나열해 D1 제한을 피했습니다.

   ```powershell
   npx.cmd wrangler d1 execute status-monitor-db --remote --command "WITH d AS (SELECT id FROM monitors WHERE source<>'real' OR check_key='drill-local-tcp') SELECT (SELECT COUNT(*) FROM check_results) cr_all, (SELECT COUNT(*) FROM check_results WHERE NOT (source<>'real' OR monitor_id IN d)) cr_keep, (SELECT COUNT(*) FROM daily_stats) ds_all, (SELECT COUNT(*) FROM daily_stats WHERE NOT (source<>'real' OR monitor_id IN d)) ds_keep, (SELECT COUNT(*) FROM notifications) nt_all, (SELECT COUNT(*) FROM notifications WHERE NOT (source<>'real' OR monitor_id IN d)) nt_keep, (SELECT COUNT(*) FROM incidents) inc_all, (SELECT COUNT(*) FROM incidents WHERE NOT (source<>'real' OR monitor_id IN d)) inc_keep, (SELECT COUNT(*) FROM maintenance_windows) mw_all, (SELECT COUNT(*) FROM maintenance_windows WHERE source='real' AND (monitor_id IS NULL OR monitor_id NOT IN d)) mw_keep, (SELECT COUNT(*) FROM monitor_state) ms_all, (SELECT COUNT(*) FROM monitor_state WHERE monitor_id NOT IN d) ms_keep, (SELECT COUNT(*) FROM replay_series) rs_all, (SELECT COUNT(*) FROM datasets) dset_all"
   ```

3. **삭제**

   ```powershell
   npx.cmd wrangler d1 execute status-monitor-db --remote --file=scripts/purge-fake-data/purge.sql
   ```

   삭제는 결과 표가 필요 없으므로 `--file`로 실행해도 됩니다. 출력의 `rows written`이
   2번에서 계산한 지울 행 수(표마다 `_all - _keep`의 합 + 재생 설정·모니터·데이터셋)와 같은지 봅니다.

4. **지운 뒤 확인** — 2번의 (가)·(나)를 다시 실행합니다. 기대 결과: 모니터 목록이 KEEP 5줄뿐,
   모든 표에서 `_all`과 `_keep`이 같고 2번의 `_keep`과 같은 숫자(측정은 5분 점검으로 조금 늘 수 있음).

## 원격 실행 결과 (2026-11-19)

| 표 | 지우기 전 (전체 → 남길 건수) | 지운 뒤 |
|---|---|---|
| monitors | 15 → 5 | 5 (고쳐라! HTTP·DNS, 사내 메신저 HTTP·DNS·DB 상태) |
| check_results | 21,446 → 10,967 | 10,967 |
| daily_stats | 87 → 42 | 42 |
| notifications | 38 → 4 | 4 |
| incidents | 19 → 2 | 2 |
| maintenance_windows | 1 → 0 | 0 |
| monitor_state | 15 → 5 | 5 |
| replay_series · replay_config · datasets | 8,540 · 5 · 3 → 0 | 0 |

- 백업 파일: 약 5.9MB, 저장소에 올리지 않음.
- 삭제 출력의 `rows written` 19,144 = 위 표에서 계산한 지울 행 수의 합과 같음.
- DB 크기 2.24MB → 1.57MB.
- 모니터 아이디가 1, 25, 48~50처럼 띄엄띄엄인 것은 정상입니다. `AUTOINCREMENT`는 지운 번호를 다시 쓰지 않습니다.

## 되돌리기

2번 결과와 4번 결과가 예상과 다르면, 1번 백업 파일로 복구합니다. 복구 방법(빈 DB에 다시 넣을지, 같은 DB에 덮어쓸지)은
Cloudflare 공식 문서에서 확인할 부분입니다. 추측으로 실행하지 않습니다.

## 로컬 검증 결과 (2026-11-19)

임시 로컬 D1(`--local --persist-to`, 프로젝트의 `.wrangler`와 분리)에 마이그레이션 0001~0014와 seed(sample·simulator·replay 일부)를 넣고
real 측정·real 장애·전체 대상 계획 작업(real 1, simulator 1)을 추가한 뒤 실행했습니다.

| 표 | 전 (전체/지움/남김) | 후 (전체) |
|---|---|---|
| monitors | 20 / 15 / 5 | 5 |
| check_results | 102 / 97 / 5 | 5 |
| incidents | 9 / 8 / 1 | 1 |
| maintenance_windows | 4 / 3 / 1 | 1 |
| daily_stats · notifications · monitor_state | 120·13·4 / 전부 | 0 |
| replay_series · replay_config · datasets | 2016·5·3 / 전부 | 0 |

한계: 로컬은 Wrangler가 흉내 낸 SQLite입니다. 원격 D1의 실제 건수·동작은 2번·4번 조회로 확인해야 합니다.
D1은 `UNION`으로 묶는 조회 수에 제한이 있어 확인 조회를 표마다 나눴습니다(로컬에서 오류로 확인).
