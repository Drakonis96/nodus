import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  up: string;
}

// Versioned, append-only migrations. Never edit an existing migration's SQL once
// shipped — add a new one. The current schema version is the highest applied.
export const SCHEMA_VERSION = 4;

export const migrations: Migration[] = [
  {
    version: 1,
    up: /* sql */ `
      CREATE TABLE works (
        nodus_id        TEXT PRIMARY KEY,
        zotero_key      TEXT UNIQUE,
        zotero_version  INTEGER,
        title           TEXT,
        authors_json    TEXT,
        year            INTEGER,
        item_type       TEXT,
        doi             TEXT,
        read_tag        INTEGER DEFAULT 0,
        manual_deep     INTEGER DEFAULT 0,
        deep_trigger    TEXT,
        source_type     TEXT,
        light_status    TEXT DEFAULT 'pending',
        light_at        TEXT,
        light_hash      TEXT,
        deep_status     TEXT DEFAULT 'none',
        deep_at         TEXT,
        deep_hash       TEXT,
        archived        INTEGER DEFAULT 0,
        notes           TEXT
      );

      CREATE TABLE work_aliases (
        nodus_id   TEXT,
        zotero_key TEXT,
        PRIMARY KEY (nodus_id, zotero_key)
      );

      CREATE TABLE themes (
        theme_id   TEXT PRIMARY KEY,
        label      TEXT UNIQUE,
        created_at TEXT
      );

      CREATE TABLE work_themes (
        nodus_id TEXT,
        theme_id TEXT,
        PRIMARY KEY (nodus_id, theme_id)
      );

      CREATE TABLE ideas (
        global_id  TEXT PRIMARY KEY,
        type       TEXT,
        label      TEXT,
        statement  TEXT,
        embedding  BLOB,
        created_at TEXT
      );

      CREATE TABLE idea_occurrences (
        global_id   TEXT,
        nodus_id    TEXT,
        role        TEXT,
        development TEXT,
        confidence  REAL,
        PRIMARY KEY (global_id, nodus_id)
      );

      CREATE TABLE evidence (
        id        TEXT PRIMARY KEY,
        global_id TEXT,
        nodus_id  TEXT,
        quote     TEXT,
        location  TEXT,
        kind      TEXT
      );

      CREATE TABLE edges (
        id          TEXT PRIMARY KEY,
        from_id     TEXT,
        to_id       TEXT,
        type        TEXT,
        basis       TEXT,
        confidence  REAL,
        source_work TEXT
      );

      CREATE TABLE authors (
        author_id   TEXT PRIMARY KEY,
        name        TEXT,
        affiliation TEXT
      );

      CREATE TABLE author_relations (
        from_author TEXT,
        to_author   TEXT,
        type        TEXT,
        weight      REAL,
        PRIMARY KEY (from_author, to_author, type)
      );

      CREATE TABLE work_authors (
        nodus_id  TEXT,
        author_id TEXT,
        PRIMARY KEY (nodus_id, author_id)
      );

      CREATE TABLE gaps (
        id          TEXT PRIMARY KEY,
        nodus_id    TEXT,
        related_idea TEXT,
        kind        TEXT,
        statement   TEXT,
        confidence  REAL,
        evidence_id TEXT
      );

      CREATE TABLE external_refs (
        id          TEXT PRIMARY KEY,
        nodus_id    TEXT,
        from_idea   TEXT,
        cited_work  TEXT,
        type        TEXT,
        basis       TEXT,
        confidence  REAL,
        evidence_id TEXT
      );

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE sync_log (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        at      TEXT,
        mode    TEXT,
        summary TEXT
      );

      CREATE INDEX idx_idea_occ_nodus ON idea_occurrences(nodus_id);
      CREATE INDEX idx_idea_occ_global ON idea_occurrences(global_id);
      CREATE INDEX idx_evidence_global ON evidence(global_id);
      CREATE INDEX idx_edges_from ON edges(from_id);
      CREATE INDEX idx_edges_to ON edges(to_id);
      CREATE INDEX idx_gaps_nodus ON gaps(nodus_id);
      CREATE INDEX idx_work_themes_theme ON work_themes(theme_id);
    `,
  },
  {
    version: 2,
    up: /* sql */ `
      UPDATE works SET light_status = 'none' WHERE light_status = 'pending';
      UPDATE works SET deep_status = 'none' WHERE deep_status = 'pending';
    `,
  },
  {
    version: 3,
    up: /* sql */ `
      CREATE TABLE extraction_cache (
        file_path      TEXT PRIMARY KEY,
        file_size      INTEGER NOT NULL,
        file_mtime_ms  REAL NOT NULL,
        ocr_enabled    INTEGER NOT NULL,
        ocr_languages  TEXT NOT NULL,
        ocr_max_pages  INTEGER NOT NULL,
        cache_version  INTEGER NOT NULL,
        source_type    TEXT NOT NULL,
        text           TEXT NOT NULL,
        notes          TEXT,
        analysis_json  TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );

      CREATE INDEX idx_extraction_cache_key
        ON extraction_cache(file_path, file_size, file_mtime_ms, ocr_enabled, ocr_languages, ocr_max_pages, cache_version);
    `,
  },
  {
    version: 4,
    up: /* sql */ `
      CREATE TABLE idea_theme_links (
        nodus_id   TEXT NOT NULL,
        global_id  TEXT NOT NULL,
        theme_id   TEXT NOT NULL,
        confidence REAL NOT NULL,
        basis      TEXT NOT NULL,
        PRIMARY KEY (nodus_id, global_id, theme_id)
      );

      CREATE INDEX idx_idea_theme_links_global ON idea_theme_links(global_id);
      CREATE INDEX idx_idea_theme_links_theme ON idea_theme_links(theme_id);
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const current = db.pragma('user_version', { simple: true }) as number;
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    const tx = db.transaction(() => {
      db.exec(m.up);
      db.pragma(`user_version = ${m.version}`);
    });
    tx();
  }
}
