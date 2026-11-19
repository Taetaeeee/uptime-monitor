-- 0015: 서비스 묶음 (services) — 점검 여러 개를 "서비스 하나"로 묶어 보여 주기 위한 구조
--
-- 지금까지 화면의 한 줄은 "점검 대상(monitor) 하나"였습니다. 그런데 사용자가 궁금한 것은
-- "고쳐라!가 지금 되나?"이지 "고쳐라!의 DNS 점검이 되나?"가 아니에요.
-- 그래서 HTTP·DNS·DB 상태 같은 점검들을 서비스 하나로 묶고, 서비스 상태는 묶인 점검들로 판정합니다.
--   (판정 규칙은 src/service-status.js의 순수 함수에 있습니다)
--
-- 이 마이그레이션만 적용해서는 기존 화면(/api/status)이 바뀌지 않습니다.
-- 새 읽기 API(/api/services)만 생기고, 새 화면은 다음 단계(S2·S3)에서 붙입니다.

CREATE TABLE services (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 주소에 쓰는 짧은 이름 (/api/services/keychats). 영문 소문자·숫자·하이픈만
  service_key TEXT    NOT NULL UNIQUE CHECK (service_key GLOB '[a-z0-9]*' AND service_key NOT GLOB '*[^a-z0-9-]*'),
  name        TEXT    NOT NULL,
  description TEXT,
  -- 서비스 대표 주소. 나중에 "링크로 서비스 추가"(S4)에서 입력받는 값이고,
  -- 공개 API에는 아직 내려주지 않습니다 (점검 주소를 공개 응답에 넣지 않는 기존 원칙과 같게)
  home_url    TEXT,
  -- 0이면 "내린 서비스": 목록에서 빠지지만 기록은 남깁니다 (삭제 대신 끄기)
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  -- 출처: 배포 DB에는 real만 둡니다. simulator는 로컬 시험용 (CLAUDE.md '가짜 데이터')
  source      TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'simulator')),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- 점검 대상이 어느 서비스에 속하는지. NULL이면 어느 서비스에도 묶이지 않은 점검(예: 훈련 대상)
-- SQLite의 ALTER TABLE ADD COLUMN은 REFERENCES를 붙일 수 있습니다 (기본값이 NULL일 때)
ALTER TABLE monitors ADD COLUMN service_id INTEGER REFERENCES services(id);
CREATE INDEX idx_monitors_service ON monitors (service_id);

-- 서비스별 일별 집계 — 회차(5분) 단위
--
-- 왜 대상별 일별 집계(daily_stats)로 계산하지 않고 따로 두나?
--   서비스 가동률은 "점검이 모두 성공한 회차 ÷ 전체 회차"로 셉니다.
--   HTTP 성공 287회 + DNS 성공 280회만 알아서는, 둘이 같은 회차에 실패했는지 다른 회차에 실패했는지 알 수 없어요.
--   그래서 회차 단위로 묶은 결과를 하루에 한 줄로 저장합니다.
-- 왜 화면을 열 때 원본에서 계산하지 않나?
--   서비스 하나(점검 3개)의 30일 원본은 약 2.6만 행입니다. 상태 페이지를 열 때마다 읽으면
--   D1 읽기 한도를 금방 씁니다. 하루 1행으로 요약해 두면 30행만 읽으면 돼요.
CREATE TABLE service_daily_stats (
  service_id  INTEGER NOT NULL REFERENCES services(id),
  day         TEXT    NOT NULL,           -- 한국 날짜 'YYYY-MM-DD' (daily_stats와 같은 기준)
  total_slots INTEGER NOT NULL,           -- 그날 기록이 있는 회차 수 (계획 작업 중 회차는 뺌)
  up_slots    INTEGER NOT NULL,           -- 묶인 점검이 모두 성공한 회차 수 ('느림'도 성공)
  slow_slots  INTEGER NOT NULL,           -- 모두 성공했지만 하나라도 느렸던 회차 수
  source      TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'simulator')),
  updated_at  TEXT    NOT NULL,
  PRIMARY KEY (service_id, day),
  CHECK (up_slots <= total_slots AND slow_slots <= up_slots)
);

-- ── 지금 운영 중인 서비스 2개 등록 + 기존 점검 연결 ──
-- 점검은 id가 아니라 주소(url)로 찾아 연결합니다.
-- 로컬 DB와 원격 DB의 id가 다르기 때문이에요 (원격은 정리 후 1·25·48·49·50, AUTOINCREMENT는 번호를 재사용하지 않음).
INSERT INTO services (service_key, name, description, home_url, sort_order, source)
VALUES ('gochyeora', '고쳐라!', '웹게임 (Cloudflare Pages)', 'https://gochyeora.pages.dev', 1, 'real');

INSERT INTO services (service_key, name, description, home_url, sort_order, source)
VALUES ('keychats', 'Keychats', '학원 팀 채팅 (Vercel)', 'https://keychats.vercel.app/', 2, 'real');

UPDATE monitors SET service_id = (SELECT id FROM services WHERE service_key = 'gochyeora')
 WHERE source = 'real' AND url IN ('https://gochyeora.pages.dev', 'dns://gochyeora.pages.dev');

UPDATE monitors SET service_id = (SELECT id FROM services WHERE service_key = 'keychats')
 WHERE source = 'real' AND url IN ('https://keychats.vercel.app/', 'dns://keychats.vercel.app',
                                   'https://keychats.vercel.app/chats/api/health');

-- ── 지난 기록으로 서비스 일별 집계 채우기 (한 번만) ──
-- 규칙은 Cron이 매 회차 쓰는 순수 함수(summarizeSlots)와 같습니다:
--   켜져 있는 점검의, 계획 작업 중이 아닌 결과만 → 회차(checked_at)별로 묶어 → 모두 성공이면 정상 회차
-- 한국 날짜: checked_at(UTC)에 9시간을 더한 날짜. 'Z'로 끝나는 시각도 SQLite date()가 읽습니다.
INSERT INTO service_daily_stats (service_id, day, total_slots, up_slots, slow_slots, source, updated_at)
SELECT service_id,
       day,
       COUNT(*),
       SUM(all_ok),
       SUM(CASE WHEN all_ok = 1 AND any_slow = 1 THEN 1 ELSE 0 END),
       'real',
       strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  FROM (SELECT m.service_id,
               date(r.checked_at, '+9 hours') AS day,
               MIN(r.is_success) AS all_ok,
               MAX(r.is_slow)    AS any_slow
          FROM check_results r
          JOIN monitors m ON m.id = r.monitor_id
         WHERE m.service_id IS NOT NULL
           AND m.is_active = 1
           AND r.in_maintenance = 0
           AND r.source = 'real'
         GROUP BY m.service_id, r.checked_at)
 GROUP BY service_id, day;
