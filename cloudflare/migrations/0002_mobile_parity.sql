PRAGMA foreign_keys = ON;

-- Commands are deliberately typed. This table never stores IPC method names, SQL or a
-- destination URL supplied by a client.
CREATE TABLE IF NOT EXISTS space_actions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_device TEXT REFERENCES device_tokens(id) ON DELETE SET NULL,
  input_revision TEXT,
  input_fingerprint TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','claimed','running','applied','refused','failed','cancelled')),
  claimed_by_device TEXT REFERENCES device_tokens(id) ON DELETE SET NULL,
  result_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  claimed_at TEXT,
  finished_at TEXT,
  UNIQUE (space_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS space_actions_queue_idx ON space_actions(space_id, status, sequence);
CREATE INDEX IF NOT EXISTS space_actions_actor_idx ON space_actions(space_id, actor_user_id, sequence DESC);

-- Immutable account-scoped versions. The materialized winner is only a pointer; every losing
-- version remains available so a conflict can never become a silent overwrite.
CREATE TABLE IF NOT EXISTS library_record_versions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  base_version_id TEXT,
  hlc TEXT NOT NULL,
  device_id TEXT,
  payload_json TEXT,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE (user_id, version_id)
);
CREATE INDEX IF NOT EXISTS library_versions_changes_idx ON library_record_versions(user_id, sequence);
CREATE INDEX IF NOT EXISTS library_versions_record_idx ON library_record_versions(user_id, record_id, sequence DESC);

CREATE TABLE IF NOT EXISTS library_records (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  winner_version_id TEXT NOT NULL,
  winner_hlc TEXT NOT NULL,
  payload_json TEXT,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0,1)),
  conflicted INTEGER NOT NULL DEFAULT 0 CHECK (conflicted IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, record_id)
);
CREATE INDEX IF NOT EXISTS library_records_updated_idx ON library_records(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS library_objects (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  object_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, hash)
);

CREATE TABLE IF NOT EXISTS library_commands (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_by_device TEXT REFERENCES device_tokens(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','claimed','running','applied','refused','failed','cancelled')),
  claimed_by_device TEXT REFERENCES device_tokens(id) ON DELETE SET NULL,
  result_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  claimed_at TEXT,
  finished_at TEXT,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS library_commands_queue_idx ON library_commands(user_id, status, sequence);
