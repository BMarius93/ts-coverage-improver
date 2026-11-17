CREATE TABLE repositories (
  id              TEXT PRIMARY KEY,
  owner           TEXT NOT NULL,
  name            TEXT NOT NULL,
  full_name       TEXT NOT NULL UNIQUE, -- lower-cased owner/name
  default_branch  TEXT,
  scan_status     TEXT NOT NULL CHECK (scan_status IN ('never_scanned', 'scanning', 'succeeded', 'failed')),
  scan_error      TEXT,
  scan_started_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE coverage_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id TEXT NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  commit_sha    TEXT NOT NULL,
  taken_at      TEXT NOT NULL
);
CREATE INDEX coverage_snapshots_by_repository ON coverage_snapshots (repository_id, id);

CREATE TABLE file_coverages (
  snapshot_id INTEGER NOT NULL REFERENCES coverage_snapshots (id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  lines       REAL NOT NULL,
  branches    REAL NOT NULL,
  functions   REAL NOT NULL,
  statements  REAL NOT NULL,
  PRIMARY KEY (snapshot_id, path)
);

CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  repository_id   TEXT NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  target_file     TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  phase           TEXT CHECK (phase IS NULL OR phase IN ('cloning', 'planning', 'writing', 'verifying', 'fixing', 'opening_pr')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  fix_attempts    INTEGER NOT NULL DEFAULT 0,
  worker_id       TEXT,
  lease_until     INTEGER, -- epoch milliseconds; only set while running
  branch_name     TEXT,
  coverage_before REAL,
  coverage_after  REAL,
  test_plan       TEXT,          -- JSON
  pr_url          TEXT,
  error           TEXT,
  timeline        TEXT NOT NULL, -- JSON array of { event, at, note? }
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  started_at      TEXT,
  finished_at     TEXT,
  version         INTEGER NOT NULL
);

-- DB-level invariants backing JobSchedulingPolicy: the database refuses states the domain forbids,
-- even if application code has a bug or two processes race.
CREATE UNIQUE INDEX one_running_job_per_repo ON jobs (repository_id) WHERE status = 'running';
CREATE UNIQUE INDEX one_active_job_per_file ON jobs (repository_id, target_file) WHERE status IN ('queued', 'running');

CREATE INDEX jobs_queue ON jobs (status, created_at);
CREATE INDEX jobs_by_repository ON jobs (repository_id, created_at);
