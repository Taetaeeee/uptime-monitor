-- 0018: 첫 화면 변경 감지 (17단계)
--
-- 서비스 대표 주소(첫 화면)의 HTTP 점검이 받은 본문으로 '지문'(SHA-256 해시)을 만들어,
-- 지문이 바뀐 시각을 기록합니다. 장애와 같은 화면에 놓고 "장애 직전에 뭔가 바뀌었나?"를 보려는 것입니다.
--
-- 왜 '배포 감지'가 아니라 '변경 감지'인가?
--   우리가 보는 것은 "첫 화면 응답이 달라졌다"는 사실뿐이고, 그게 배포 때문인지는 알 수 없습니다
--   (CDN 설정, 페이지 안의 동적 내용 등). 그래서 확인한 만큼만 이름 붙입니다.
--
-- 본문은 저장하지 않습니다. 해시와 크기만 남깁니다 (저장 공간·개인정보 모두 최소로).
-- 점검은 이미 본문을 받고 있으므로(키워드 검사용) 요청 수는 늘지 않습니다.

-- 점검마다 현재 지문과 '바뀐 것 같은' 후보 지문 (1행)
--   새 지문이 2회 연속 같아야 변경으로 확정합니다 (장애를 2회 연속 실패로 판정하는 것과 같은 이유:
--   잠깐 다른 응답이 섞여도 오탐하지 않게). 규칙은 src/fingerprint.js의 순수 함수에 있습니다.
CREATE TABLE content_fingerprints (
  monitor_id      INTEGER PRIMARY KEY REFERENCES monitors(id),
  hash            TEXT    NOT NULL,          -- 지금 기준 지문 (SHA-256 16진수)
  size_bytes      INTEGER NOT NULL,          -- 그 지문일 때 본문 크기 (UTF-8 바이트)
  since           TEXT    NOT NULL,          -- 이 지문을 처음 본 회차 (UTC ISO). 기준 지문이면 처음 점검한 회차
  candidate_hash  TEXT,                      -- 기준과 다른 새 지문 (확정 전). NULL이면 후보 없음
  candidate_size  INTEGER,
  candidate_since TEXT,                      -- 후보를 처음 본 회차
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  updated_at      TEXT    NOT NULL,
  source          TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'simulator'))
);

-- 확정된 변경 기록 (바뀔 때만 1행)
CREATE TABLE content_changes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id   INTEGER NOT NULL REFERENCES monitors(id),
  first_seen_at TEXT   NOT NULL,   -- 새 지문을 처음 본 회차 = 화면에 보여 주는 "바뀐 시각" (실제 변경은 이보다 최대 5분 전)
  confirmed_at TEXT    NOT NULL,   -- 2회 연속으로 확인해 기록한 회차
  old_hash     TEXT    NOT NULL,
  new_hash     TEXT    NOT NULL,
  old_size     INTEGER NOT NULL,
  new_size     INTEGER NOT NULL,
  source       TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'simulator')),
  CHECK (old_hash <> new_hash)
);

-- 서비스 상세의 '최근 변경'과 장애 상세의 '장애 직전 변경' 조회: 점검 + 시각 범위
CREATE INDEX idx_content_changes_monitor_time ON content_changes (monitor_id, first_seen_at);
