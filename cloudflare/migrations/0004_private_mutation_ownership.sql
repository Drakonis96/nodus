CREATE TABLE IF NOT EXISTS private_mutation_ownership (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL CHECK (namespace IN ('entity', 'page', 'comment')),
  local_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (space_id, namespace, local_key, user_id)
);

CREATE INDEX IF NOT EXISTS private_mutation_ownership_space_idx
  ON private_mutation_ownership(space_id, namespace, local_key);
