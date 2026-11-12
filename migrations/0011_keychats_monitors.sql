-- 0011: 사내 메신저(Keychats) 점검 대상 3개 등록 — 모두 비활성(is_active = 0)으로
--
-- Keychats는 내가 만들어 학원에서 실제로 쓰는 팀 채팅입니다. 고쳐라!(0002·0007)와 같은 방식으로
-- "대상은 마이그레이션으로 등록하고, 켜는 것은 따로" 합니다. 비활성으로 두는 이유:
--   1) Keychats의 상태 확인 주소(/chats/api/health)가 배포되기 전에 켜면 DB 상태 점검이 계속 실패(404)합니다.
--   2) 학원 측에 "포트폴리오에 소개한다"고 미리 알린 뒤에 공개 상태 페이지에 올려야 합니다.
--   (비활성이어도 상태 페이지에는 '점검 대기'로 보이므로, 원격 적용 자체도 위 두 가지가 끝난 뒤에 합니다)
--
-- 점검 3종은 서로 다른 장애를 잡습니다:
--   HTTP      : 사이트가 안 뜨는 장애 (루트 주소는 /chats로 리다이렉트되고 점검기는 리다이렉트를 따라감)
--   DNS       : 이름 해석 장애 (고쳐라!의 DNS 점검과 같은 방식)
--   DB 상태   : 페이지는 뜨는데 DB가 멈춘 장애 (Keychats가 DB를 1번 조회해 ok / error만 돌려주는 주소)
--
-- 왜 /chats/api/health 인가?
--   Keychats는 next.config.ts에서 basePath: '/chats'를 쓰므로 모든 경로가 /chats 아래에 있습니다.
--
-- 지켜야 할 것 (CLAUDE.md): 채널·메시지 주소(/chats/channel/…)는 점검하지 않고,
--   상태 확인 응답에 사용자 정보를 넣지 않으며, 공개 응답에는 점검 대상의 주소(URL)를 넣지 않습니다.
--
-- 켜는 명령 (Keychats 배포·학원 고지 후): README의 "Keychats 점검 켜기" 참고

INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active, source)
VALUES ('사내 메신저 (HTTP)', 'http', 'https://keychats.vercel.app/', 200, 'Keychats', 3000, 0, 'real');

INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active, source)
VALUES ('사내 메신저 (DNS)', 'dns', 'dns://keychats.vercel.app', 200, NULL, 1000, 0, 'real');

-- 키워드 "ok"는 따옴표를 포함해서 {"status":"ok"} 안의 값만 맞춥니다 ({"status":"error"}에는 없음)
INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active, source)
VALUES ('사내 메신저 (DB 상태)', 'http', 'https://keychats.vercel.app/chats/api/health', 200, '"ok"', 3000, 0, 'real');
