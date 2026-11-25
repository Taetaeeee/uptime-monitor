-- 0020: 데이터 보존 정리 기록 (25단계)
--
-- 5분 점검 원본(check_results)은 하루 약 6,000행씩 쌓여서, 오늘 포함 90일이 지난 원본은 하루 한 번(KST 04:00 회차) 지웁니다
-- (규칙은 src/retention.js, 실행은 src/retention-run.js). 이 표는 "언제, 어디까지, 몇 행을 지웠는지"를 남기는 기록입니다.
--   - 지운 것을 되돌릴 수는 없으므로(되돌리려면 D1 Time Travel로 DB 전체를 그 시점으로 덮어써야 함) 기록이라도 정확히 남깁니다.
--   - 하루 1행이라 1년에 365행 — 이 표 자체는 지우지 않습니다.
--   - 운영 근거 화면(/evidence.html)이 마지막 1행만 읽어 '마지막 정리'를 보여 줍니다 (GET /api/retention).

CREATE TABLE retention_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at          TEXT    NOT NULL UNIQUE,   -- 정리한 회차 (UTC ISO). 같은 회차가 두 번 실행돼도 기록은 1행
  first_kept_day  TEXT    NOT NULL,          -- 남긴 첫 날 (KST 'YYYY-MM-DD') — 이보다 앞선 날의 원본이 정리 대상
  cutoff_utc      TEXT    NOT NULL,          -- 실제로 비교한 기준 시각 (first_kept_day의 KST 0시 = UTC 전날 15:00)
  deleted_rows    INTEGER NOT NULL DEFAULT 0,
  kept_old_rows   INTEGER NOT NULL DEFAULT 0, -- 기준보다 오래됐지만 남긴 행 (그날 일별 집계가 없거나, 이번 상한에 걸려 다음 날로 미룸)
  monitors        INTEGER NOT NULL DEFAULT 0, -- 살펴본 점검 수 (꺼진 점검 포함)
  capped          INTEGER NOT NULL DEFAULT 0 CHECK (capped IN (0, 1)), -- 한 번에 지우는 상한에 닿았는지
  error           TEXT                        -- 중간에 실패했으면 짧은 오류 문구 (그 전까지 지운 행 수는 위에 남음)
);
