-- 0010: 재생 대상의 값 단위 (replay_config.unit)
--
-- 왜 필요한가?
--   화면이 값을 "62.4%"처럼 보여 주려면 단위를 알아야 합니다. 그런데 데이터셋마다 단위가 제각각이에요.
--     SMD  : 0~1 정규화 값을 %로 환산한 상대값 → '%'
--     NAB  : 원본이 단위를 밝히지 않음 → '' (숫자만 표시)
--     디스크: 불량 섹터 개수의 합 → '개'
--   코드에서 규칙 종류로 단위를 짐작하면 데이터셋이 늘 때 조용히 틀립니다. 그래서 데이터에 적어 둡니다.
--
-- ALTER TABLE … ADD COLUMN은 표를 다시 만들지 않고 열만 더하므로 안전합니다.
-- (replay_config는 아직 행이 없어 DEFAULT '' 로 비워 둬도 영향이 없습니다)

ALTER TABLE replay_config ADD COLUMN unit TEXT NOT NULL DEFAULT '';
