-- AI 분석은 운영 점검/판정 테이블과 완전히 별도로 저장한다.
CREATE TABLE rca_budget (
  day TEXT PRIMARY KEY,
  reserved_micros INTEGER NOT NULL DEFAULT 0 CHECK(reserved_micros>=0),
  spent_micros INTEGER NOT NULL DEFAULT 0 CHECK(spent_micros>=0),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active>=0)
);
CREATE TABLE rca_runs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  budget_day TEXT NOT NULL REFERENCES rca_budget(day),
  reservation INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  settled INTEGER NOT NULL DEFAULT 0,
  charged_micros INTEGER,
  usage_uncertain INTEGER NOT NULL DEFAULT 1,
  report_json TEXT
);
CREATE INDEX idx_rca_runs_pending ON rca_runs(settled,expires_at);
