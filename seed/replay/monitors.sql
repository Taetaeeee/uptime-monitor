-- replay-smd-1-1
INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active, source, check_key, dataset_id)
VALUES ('그룹웨어·메일', 'replay', 'replay://replay-smd-1-1', 200, NULL, 3000, 1, 'replay', 'replay-smd-1-1', (SELECT id FROM datasets WHERE key = 'smd'))
ON CONFLICT(check_key) DO UPDATE SET name = excluded.name, kind = excluded.kind, url = excluded.url,
  source = excluded.source, dataset_id = excluded.dataset_id;
INSERT INTO replay_config (monitor_id, length, step_minutes, anchor_at, rule, baseline, metric_label, unit)
SELECT id, 2016, 5,
  strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - 68700, 'unixepoch'),
  '{"type":"high","slowAt":10.25,"failAt":18.46}', NULL, '서버 지표 #14 (익명·정규화, % 환산)', '%'
FROM monitors WHERE check_key = 'replay-smd-1-1'
ON CONFLICT(monitor_id) DO UPDATE SET length = excluded.length, step_minutes = excluded.step_minutes,
  rule = excluded.rule, baseline = excluded.baseline, metric_label = excluded.metric_label, unit = excluded.unit;

-- replay-smd-2-1
INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active, source, check_key, dataset_id)
VALUES ('사내 ERP', 'replay', 'replay://replay-smd-2-1', 200, NULL, 3000, 1, 'replay', 'replay-smd-2-1', (SELECT id FROM datasets WHERE key = 'smd'))
ON CONFLICT(check_key) DO UPDATE SET name = excluded.name, kind = excluded.kind, url = excluded.url,
  source = excluded.source, dataset_id = excluded.dataset_id;
INSERT INTO replay_config (monitor_id, length, step_minutes, anchor_at, rule, baseline, metric_label, unit)
SELECT id, 2016, 5,
  strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - 75000, 'unixepoch'),
  '{"type":"high","slowAt":16.17,"failAt":20.81}', NULL, '서버 지표 #4 (익명·정규화, % 환산)', '%'
FROM monitors WHERE check_key = 'replay-smd-2-1'
ON CONFLICT(monitor_id) DO UPDATE SET length = excluded.length, step_minutes = excluded.step_minutes,
  rule = excluded.rule, baseline = excluded.baseline, metric_label = excluded.metric_label, unit = excluded.unit;

-- replay-smd-3-1
INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active, source, check_key, dataset_id)
VALUES ('DB 서버', 'replay', 'replay://replay-smd-3-1', 200, NULL, 3000, 1, 'replay', 'replay-smd-3-1', (SELECT id FROM datasets WHERE key = 'smd'))
ON CONFLICT(check_key) DO UPDATE SET name = excluded.name, kind = excluded.kind, url = excluded.url,
  source = excluded.source, dataset_id = excluded.dataset_id;
INSERT INTO replay_config (monitor_id, length, step_minutes, anchor_at, rule, baseline, metric_label, unit)
SELECT id, 2016, 5,
  strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - 29100, 'unixepoch'),
  '{"type":"high","slowAt":38.95,"failAt":46.32}', NULL, '서버 지표 #1 (익명·정규화, % 환산)', '%'
FROM monitors WHERE check_key = 'replay-smd-3-1'
ON CONFLICT(monitor_id) DO UPDATE SET length = excluded.length, step_minutes = excluded.step_minutes,
  rule = excluded.rule, baseline = excluded.baseline, metric_label = excluded.metric_label, unit = excluded.unit;

-- replay-nab-machine-temp
INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active, source, check_key, dataset_id)
VALUES ('MES (생산관리)', 'replay', 'replay://replay-nab-machine-temp', 200, NULL, 3000, 1, 'replay', 'replay-nab-machine-temp', (SELECT id FROM datasets WHERE key = 'nab'))
ON CONFLICT(check_key) DO UPDATE SET name = excluded.name, kind = excluded.kind, url = excluded.url,
  source = excluded.source, dataset_id = excluded.dataset_id;
INSERT INTO replay_config (monitor_id, length, step_minutes, anchor_at, rule, baseline, metric_label, unit)
SELECT id, 2432, 5,
  strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - 39600, 'unixepoch'),
  '{"type":"deviation","slowPct":10,"failPct":20}', 94.03, '설비 온도 센서 값 (단위는 원본이 밝히지 않음)', ''
FROM monitors WHERE check_key = 'replay-nab-machine-temp'
ON CONFLICT(monitor_id) DO UPDATE SET length = excluded.length, step_minutes = excluded.step_minutes,
  rule = excluded.rule, baseline = excluded.baseline, metric_label = excluded.metric_label, unit = excluded.unit;

-- replay-backblaze-disk
INSERT INTO monitors (name, kind, url, expected_status, keyword, max_response_ms, is_active, source, check_key, dataset_id)
VALUES ('파일서버·NAS 디스크', 'replay', 'replay://replay-backblaze-disk', 200, NULL, 3000, 1, 'replay', 'replay-backblaze-disk', (SELECT id FROM datasets WHERE key = 'backblaze'))
ON CONFLICT(check_key) DO UPDATE SET name = excluded.name, kind = excluded.kind, url = excluded.url,
  source = excluded.source, dataset_id = excluded.dataset_id;
INSERT INTO replay_config (monitor_id, length, step_minutes, anchor_at, rule, baseline, metric_label, unit)
SELECT id, 60, 1440,
  strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', 'now') AS INTEGER) / 300) * 300 - 518400, 'unixepoch'),
  '{"type":"smart","slowAbove":0}', NULL, '드라이브 8대의 불량 섹터(smart_5_raw) 합계', '개'
FROM monitors WHERE check_key = 'replay-backblaze-disk'
ON CONFLICT(monitor_id) DO UPDATE SET length = excluded.length, step_minutes = excluded.step_minutes,
  rule = excluded.rule, baseline = excluded.baseline, metric_label = excluded.metric_label, unit = excluded.unit;
