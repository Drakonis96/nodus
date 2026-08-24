-- Whole-document vectors are a third, independent retrieval lane.
-- Rebuild the three constrained tables because SQLite cannot widen a CHECK in place.
PRAGMA foreign_keys = OFF;

CREATE TABLE vector_sets_next (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ideas', 'documents', 'passages')),
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
INSERT INTO vector_sets_next SELECT * FROM vector_sets;
DROP TABLE vector_sets;
ALTER TABLE vector_sets_next RENAME TO vector_sets;

CREATE TABLE vector_chunks_next (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ideas', 'documents', 'passages')),
  chunk_id TEXT NOT NULL,
  vector_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (space_id, generation, kind, chunk_id)
);
INSERT INTO vector_chunks_next SELECT * FROM vector_chunks;
DROP TABLE vector_chunks;
ALTER TABLE vector_chunks_next RENAME TO vector_chunks;

CREATE TABLE vector_members_next (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ideas', 'documents', 'passages')),
  vector_id TEXT NOT NULL,
  index_binding TEXT NOT NULL,
  PRIMARY KEY (space_id, generation, kind, vector_id)
);
INSERT INTO vector_members_next SELECT * FROM vector_members;
DROP TABLE vector_members;
ALTER TABLE vector_members_next RENAME TO vector_members;
CREATE INDEX vector_members_generation_idx ON vector_members(space_id, generation, index_binding);

PRAGMA foreign_keys = ON;
