INSERT INTO datasets (key, name, url, license, processing, kind, citation)
VALUES ('smd', 'SMD (Server Machine Dataset)', 'https://github.com/NetManAIOps/OmniAnomaly', 'MIT (저장소 ServerMachineDataset/LICENSE 확인, 2026-11-12)', '장비 3대(machine-1-1, 2-1, 3-1)의 test 구간에서 이상 구간이 많이 든 1주(10,080분)를 골라 1분 값을 5분 최댓값으로 줄임. 지표는 이상 구간을 잘 잡는 것을 골랐고(지표 이름은 공개되지 않음), 값은 0~1 정규화 상대값을 %로 환산한 것이라 실제 사용률이 아님. 지표를 이상 라벨을 보고 골랐으므로, 이 지표만으로 탐지 성능을 평가하면 결과가 실제보다 좋게 나옴.', 'real_replay', NULL)
ON CONFLICT(key) DO UPDATE SET name = excluded.name, url = excluded.url, license = excluded.license,
  processing = excluded.processing, kind = excluded.kind, citation = excluded.citation;

INSERT INTO datasets (key, name, url, license, processing, kind, citation)
VALUES ('nab', 'NAB (Numenta Anomaly Benchmark)', 'https://github.com/numenta/NAB', 'MIT 형식 (저장소 LICENSE.txt 확인, 2026-11-12)', 'realKnownCause/machine_temperature_system_failure.csv에서 라벨 창 2개(2013-12-10 ~ 12-17)와 앞뒤 12시간을 포함한 구간을 5분 간격 원본 그대로 사용. 원본은 값의 단위를 밝히지 않음.', 'real_replay', 'Ahmad, Lavin, Purdy, Agha. Unsupervised real-time anomaly detection for streaming data. Neurocomputing, 2017 (arXiv:1510.03336)')
ON CONFLICT(key) DO UPDATE SET name = excluded.name, url = excluded.url, license = excluded.license,
  processing = excluded.processing, kind = excluded.kind, citation = excluded.citation;

INSERT INTO datasets (key, name, url, license, processing, kind, citation)
VALUES ('backblaze', 'Backblaze Drive Stats', 'https://www.backblaze.com/cloud-storage/resources/hard-drive-test-data', 'Backblaze 자체 이용 조건 (공식 페이지 확인, 2026-11-12): 출처를 Backblaze로 표기, 사용 책임은 사용자, 파생물 판매는 가능하나 데이터 자체는 판매 불가. MIT가 아님', '2013년 데이터에서 같은 모델 드라이브 8대(고장 2대, 정상 6대)를 골라 60일치를 하루 1칸으로 사용. 값은 8대의 불량 섹터(smart_5_raw) 합계, 이상 표시는 그날 고장 기록이 있는 경우.', 'real_replay', 'Source: Backblaze Drive Stats (backblaze.com)')
ON CONFLICT(key) DO UPDATE SET name = excluded.name, url = excluded.url, license = excluded.license,
  processing = excluded.processing, kind = excluded.kind, citation = excluded.citation;
