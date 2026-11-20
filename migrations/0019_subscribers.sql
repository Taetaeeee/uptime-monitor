-- 0019: 서비스별 장애 메일 수신자 (19단계 — 틀만, 기본은 꺼짐)
--
-- 운영자 말고도 "이 서비스의 장애 메일을 받겠다"고 동의한 사람에게 장애·복구 메일을 보내기 위한 표입니다.
-- 이 마이그레이션을 적용해도 기능은 꺼져 있습니다 (SUBSCRIBERS_ENABLED와 내 도메인 발신 주소가 있어야 켜짐).
-- 켜기 전에는 이 표에 아무것도 들어가지 않습니다 — 추가 API가 503을 돌려줘요.
--
-- 개인정보 원칙
--   - 메일 주소는 여기에만 저장하고, 공개 API·로그·화면에는 가린 형태(q***@example.com)로만 보여 줍니다.
--   - 그만 받기 = 행 삭제 (주소를 남겨 두지 않음). 관리자 삭제도 같음.
--   - 확인·그만 받기 링크의 토큰은 저장하지 않습니다. 비밀 값(SUBSCRIBE_SECRET)으로 그때그때 계산(HMAC)해서 비교해요.
--     → DB가 새어도 링크를 만들 수 없고, 저장할 토큰도 없음.

CREATE TABLE service_subscribers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id   INTEGER NOT NULL REFERENCES services(id),
  email        TEXT    NOT NULL,         -- 소문자로 정리한 주소
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
                                         -- pending: 확인 메일을 보냈고 아직 [받기]를 안 누름 → 장애 메일을 보내지 않음
  created_at   TEXT    NOT NULL,         -- 추가(또는 확인 메일을 다시 보낸) 시각. 확인 링크는 이 시각부터 7일 유효
  confirmed_at TEXT,
  source       TEXT    NOT NULL DEFAULT 'real' CHECK (source IN ('real', 'simulator')),
  UNIQUE (service_id, email)             -- 같은 서비스에 같은 주소는 한 번만
);

-- 받는 사람별 발송 기록: 실패한 사람에게만 다음 회차에 다시 보내고, 받은 사람에게는 중복으로 보내지 않기 위해
CREATE TABLE alert_deliveries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  escalation_id INTEGER NOT NULL REFERENCES service_escalations(id),
  subscriber_id INTEGER NOT NULL REFERENCES service_subscribers(id),
  kind          TEXT    NOT NULL CHECK (kind IN ('escalation', 'recovery')),
  sent_at       TEXT    NOT NULL,
  UNIQUE (escalation_id, subscriber_id, kind)
);

-- 운영자에게 보낸 메일 문구를 구간에 함께 남깁니다.
-- 수신자에게는 같은 문구를 (그만 받기 안내를 붙여) 보내고, 실패하면 다음 회차에 같은 문구로 다시 보내려고요.
ALTER TABLE service_escalations ADD COLUMN escalation_subject TEXT;
ALTER TABLE service_escalations ADD COLUMN escalation_body TEXT;
ALTER TABLE service_escalations ADD COLUMN recovery_subject TEXT;
ALTER TABLE service_escalations ADD COLUMN recovery_body TEXT;
