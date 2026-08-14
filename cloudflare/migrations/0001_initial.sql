PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS installation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  installation_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  source_code_url TEXT NOT NULL,
  worker_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  password_hash TEXT,
  password_salt TEXT,
  password_scheme TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  vault_json TEXT,
  active_generation INTEGER,
  revision TEXT,
  schema_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('reader', 'writer', 'owner')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, space_id)
);
CREATE INDEX IF NOT EXISTS memberships_space_idx ON memberships(space_id, role);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code_hash TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_kind TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pairing_codes_expiry_idx ON pairing_codes(expires_at);

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  device_kind TEXT NOT NULL,
  expires_at TEXT,
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS device_tokens_user_idx ON device_tokens(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS device_tokens_space_idx ON device_tokens(space_id, revoked_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  refresh_hash TEXT UNIQUE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_tokens_user_idx ON oauth_tokens(user_id, revoked_at);

CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  revision TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('staging', 'active', 'superseded', 'failed')),
  manifest_json TEXT NOT NULL,
  snapshot_key TEXT,
  snapshot_sha256 TEXT,
  snapshot_bytes INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_by_device TEXT REFERENCES device_tokens(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  committed_at TEXT,
  UNIQUE (space_id, generation),
  UNIQUE (space_id, revision)
);
CREATE INDEX IF NOT EXISTS publications_status_idx ON publications(space_id, status, generation DESC);

CREATE TABLE IF NOT EXISTS published_rows (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  row_json TEXT NOT NULL,
  search_text TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (space_id, generation, table_name, row_key)
);
CREATE INDEX IF NOT EXISTS published_rows_table_idx
  ON published_rows(space_id, generation, table_name, row_key);

CREATE VIRTUAL TABLE IF NOT EXISTS published_search USING fts5(
  space_id UNINDEXED,
  generation UNINDEXED,
  table_name UNINDEXED,
  row_key UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS objects (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  object_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_referenced_generation INTEGER,
  PRIMARY KEY (space_id, kind, hash)
);
CREATE INDEX IF NOT EXISTS objects_gc_idx ON objects(space_id, last_referenced_generation);
CREATE INDEX IF NOT EXISTS objects_hash_idx ON objects(space_id, hash);

CREATE TABLE IF NOT EXISTS multipart_uploads (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  publication_id TEXT REFERENCES publications(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  hash TEXT NOT NULL,
  object_key TEXT NOT NULL,
  r2_upload_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  parts_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vector_sets (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ideas', 'passages')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_count INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('vectorize', 'r2-exact')),
  object_key TEXT NOT NULL,
  index_binding TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (space_id, generation, kind)
);

CREATE TABLE IF NOT EXISTS vector_chunks (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ideas', 'passages')),
  chunk_id TEXT NOT NULL,
  vector_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (space_id, generation, kind, chunk_id)
);

CREATE TABLE IF NOT EXISTS vector_members (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ideas', 'passages')),
  vector_id TEXT NOT NULL,
  index_binding TEXT NOT NULL,
  PRIMARY KEY (space_id, generation, kind, vector_id)
);
CREATE INDEX IF NOT EXISTS vector_members_generation_idx ON vector_members(space_id, generation, index_binding);

CREATE TABLE IF NOT EXISTS mutations (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('upsert', 'delete')),
  table_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  body_json TEXT,
  body_object_key TEXT,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  acknowledged_at TEXT
);
CREATE INDEX IF NOT EXISTS mutations_space_sequence_idx ON mutations(space_id, sequence);
CREATE INDEX IF NOT EXISTS mutations_ack_idx ON mutations(space_id, acknowledged_at, sequence);

CREATE TABLE IF NOT EXISTS nodi_notes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  title_explicit INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL,
  deleted_ms INTEGER,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS nodi_notes_updated_idx ON nodi_notes(user_id, updated_ms DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL,
  subject TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, subject, window_start)
);

CREATE TABLE IF NOT EXISTS recovery_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
