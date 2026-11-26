-- 0022: 서비스 종류 (28단계) — 대시보드·서비스 상세의 서비스 아이콘을 종류로 고르기
--
-- 예전에는 화면 코드(public/detail.js)에 서비스 키 2개(고쳐라!→게임, Keychats→채팅)만 적혀 있어서
-- '+ 서비스 추가'로 만든 서비스는 모두 지구본 아이콘이었습니다. 이제 서비스마다 종류를 저장하고,
-- 화면은 종류 → 아이콘으로 고릅니다. 목록은 src/service-admin.js SERVICE_CATEGORIES와 같아야 합니다.
-- 새로 추가할 때는 이름·설명으로 추천(suggestCategory)한 값을 운영자가 확인해 저장하고, 나중에는 관리자 PATCH로 바꿉니다.

ALTER TABLE services ADD COLUMN category TEXT NOT NULL DEFAULT 'other'
  CHECK (category IN ('game', 'chat', 'ai', 'note', 'lifestyle', 'health', 'work', 'education', 'shopping', 'community', 'other'));

-- 지금 켜진 10개 서비스의 처음 종류 (2026-11-26 사용자 승인). 서비스 키는 공개 API(/api/services)에 이미 나오는 값
-- 로컬·테스트 DB에 없는 키는 0행이 바뀌고 넘어갑니다.
UPDATE services SET category = 'game'      WHERE service_key IN ('gochyeora', 'kimchi-simulator', 'wakeupslacker');
UPDATE services SET category = 'chat'      WHERE service_key = 'keychats';
UPDATE services SET category = 'lifestyle' WHERE service_key = 'salkka';
UPDATE services SET category = 'note'      WHERE service_key = 'ddonni';
UPDATE services SET category = 'health'    WHERE service_key = 'ieum-donor-care';
UPDATE services SET category = 'work'      WHERE service_key = 'hospital-intranet-prototype';
UPDATE services SET category = 'ai'        WHERE service_key = 'aleph-capstone';
UPDATE services SET category = 'community' WHERE service_key = 'igloo-village';
