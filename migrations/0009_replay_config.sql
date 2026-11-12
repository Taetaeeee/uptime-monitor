-- 0009: 재생 대상별 설정 (replay_config)
--
-- 왜 monitors에 열을 더하지 않고 표를 따로 만드나?
--   monitors는 모든 종류의 점검 대상이 함께 쓰는 넓은 표입니다. 재생 대상에만 필요한 값
--   (시작 기준 시각, 판정 규칙, 평소 값 …)을 거기에 계속 붙이면 대부분의 행에 빈 칸이 생겨요.
--   대상 1개당 1행이라는 점은 monitor_state와 같은 구조입니다. (0003의 설명 참고)
--
-- 왜 CHECK로 값을 막지 않았나?
--   step_minutes처럼 나중에 달라질 수 있는 값을 CHECK (… IN (5, 1440))으로 막으면,
--   값이 하나 늘 때마다 표를 다시 만들어야 합니다. (0008에서 겪은 일) 그래서 "0보다 큼"만 막고,
--   판정 규칙(rule)의 모양은 코드(src/replay-run.js의 parseRule)가 읽을 때 검사합니다.
--
-- 이 파일은 빈 표를 하나 만들 뿐이라 화면과 점검 동작은 바뀌지 않습니다. (재생 대상 등록은 B-7f)

CREATE TABLE replay_config (
  monitor_id   INTEGER PRIMARY KEY REFERENCES monitors(id),
  -- 시계열 전체 길이(값의 개수). replay_series를 매번 COUNT(*)로 세면 5분마다 수천 행을 읽게 되어서 여기에 적어 둡니다.
  length       INTEGER NOT NULL CHECK (length > 0),
  step_minutes INTEGER NOT NULL CHECK (step_minutes > 0),  -- 값 한 칸이 몇 분인지 (5 = 5분, 1440 = 하루)
  anchor_at    TEXT    NOT NULL,                           -- 순번 0이 되는 시각 (UTC ISO). 한 번 정하면 바꾸지 않음
  rule         TEXT    NOT NULL,                           -- 판정 규칙 JSON. 예: {"type":"high","slowAt":10.25,"failAt":18.46}
  baseline     REAL,                                       -- "평소 값". deviation·ratio 규칙에서만 사용, 나머지는 NULL
  metric_label TEXT    NOT NULL                            -- 화면에 보여 줄 지표 설명 (예: 서버 지표 #14 (익명·정규화))
);
