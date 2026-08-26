/**
 * SQLite schema for the Forge Linux Agent task store.
 *
 * Uses WAL mode for concurrent read access during task execution.
 * All tables use TEXT UUIDs as primary keys for portability.
 */

/** SQL statements to create the initial schema. */
export const SCHEMA_VERSION = 1;

export const CREATE_TABLES_SQL = `
-- Enable WAL mode for concurrent readers
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- Tasks: persistent logical task definitions
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  goal              TEXT NOT NULL,
  profile           TEXT,
  schedule_type     TEXT,          -- 'interval' | 'cron' | 'once' | NULL (manual only)
  schedule_value    TEXT,          -- seconds for interval, cron expression, or ISO date
  enabled           INTEGER NOT NULL DEFAULT 1,
  overlap_policy    TEXT NOT NULL DEFAULT 'skip',   -- 'skip' | 'queue'
  timeout_seconds   INTEGER DEFAULT 120,
  retry_max         INTEGER DEFAULT 0,
  retry_delay_seconds INTEGER DEFAULT 30,
  retry_strategy    TEXT DEFAULT 'fixed',           -- 'fixed' | 'exponential'
  policy_mode       TEXT DEFAULT 'autonomous',      -- 'safe' | 'supervised' | 'autonomous'
  tools_allow       TEXT,          -- JSON array of allowed tool names
  tools_deny        TEXT,          -- JSON array of denied tool names
  skills            TEXT,          -- JSON array of skill names
  model_tier        TEXT,          -- 'fast' | 'default' | 'reasoning' | 'coding' | NULL
  notifications     TEXT,          -- JSON notification config
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  next_run_at       TEXT,
  last_run_at       TEXT,
  last_success_at   TEXT
);

-- ============================================================
-- Task runs: each execution of a task
-- ============================================================
CREATE TABLE IF NOT EXISTS task_runs (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  session_id      TEXT,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT,
  status          TEXT NOT NULL DEFAULT 'CREATED',
  exit_reason     TEXT,
  error           TEXT,
  result_summary  TEXT,
  input_tokens    INTEGER DEFAULT 0,
  output_tokens   INTEGER DEFAULT 0,
  tool_calls      INTEGER DEFAULT 0,
  duration_ms     INTEGER,
  cpu_percent     REAL,
  memory_mb       REAL
);

CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);

-- ============================================================
-- Task locks: execution lease system
-- ============================================================
CREATE TABLE IF NOT EXISTS task_locks (
  task_id         TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  run_id          TEXT NOT NULL,
  lease_id        TEXT NOT NULL UNIQUE,
  owner_id        TEXT NOT NULL,
  acquired_at     TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT NOT NULL,
  heartbeat_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Task events: full audit trail
-- ============================================================
CREATE TABLE IF NOT EXISTS task_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_id          TEXT,
  event_type      TEXT NOT NULL,
  timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
  details         TEXT            -- JSON details
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_task_events_run_id ON task_events(run_id);
CREATE INDEX IF NOT EXISTS idx_task_events_type ON task_events(event_type);

-- ============================================================
-- Task checkpoints: incremental processing state
-- ============================================================
CREATE TABLE IF NOT EXISTS task_checkpoints (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  checkpoint_key  TEXT NOT NULL,   -- e.g., file path being monitored
  device          TEXT,
  inode           TEXT,
  byte_offset     INTEGER DEFAULT 0,
  line_offset     INTEGER DEFAULT 0,
  last_hash       TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(task_id, checkpoint_key)
);

-- ============================================================
-- Task artifacts: output files, reports, etc.
-- ============================================================
CREATE TABLE IF NOT EXISTS task_artifacts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_id          TEXT REFERENCES task_runs(id) ON DELETE SET NULL,
  artifact_type   TEXT NOT NULL,   -- 'report' | 'log' | 'snapshot' | 'data'
  name            TEXT NOT NULL,
  path            TEXT,
  content         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_artifacts_task_id ON task_artifacts(task_id);

-- ============================================================
-- Task notifications: sent notification log
-- ============================================================
CREATE TABLE IF NOT EXISTS task_notifications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_id            TEXT REFERENCES task_runs(id) ON DELETE SET NULL,
  idempotency_key   TEXT UNIQUE,
  channel           TEXT NOT NULL,  -- 'email' | 'webhook'
  recipient         TEXT,
  subject           TEXT,
  status            TEXT NOT NULL,  -- 'sent' | 'failed' | 'skipped'
  error             TEXT,
  sent_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_notifications_task_id ON task_notifications(task_id);
CREATE INDEX IF NOT EXISTS idx_task_notifications_idempotency ON task_notifications(idempotency_key);

-- ============================================================
-- Dedup state: for log deduplication
-- ============================================================
CREATE TABLE IF NOT EXISTS dedup_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  hash            TEXT NOT NULL,
  normalized_msg  TEXT,
  first_seen      TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen       TEXT NOT NULL DEFAULT (datetime('now')),
  count           INTEGER NOT NULL DEFAULT 1,
  last_context    TEXT,
  UNIQUE(task_id, hash)
);

CREATE INDEX IF NOT EXISTS idx_dedup_task_hash ON dedup_entries(task_id, hash);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

INSERT INTO schema_version (version) VALUES (${SCHEMA_VERSION});
`;
