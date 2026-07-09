import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  up: string;
}

// Versioned, append-only migrations. Never edit an existing migration's SQL once
// shipped — add a new one. The current schema version is the highest applied.
export const SCHEMA_VERSION = 26;

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
  {
    version: 5,
    up: /* sql */ `
      CREATE TABLE chat_conversations (
        id             TEXT PRIMARY KEY,
        title          TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        archived       INTEGER NOT NULL DEFAULT 0,
        model_json     TEXT,
        selection_json TEXT
      );

      CREATE TABLE chat_messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        seq             INTEGER NOT NULL,
        role            TEXT NOT NULL,
        content         TEXT NOT NULL,
        selection_key   TEXT,
        stats_json      TEXT,
        error           INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL
      );

      CREATE INDEX idx_chat_messages_conv ON chat_messages(conversation_id, seq);
      CREATE INDEX idx_chat_conversations_updated ON chat_conversations(archived, updated_at DESC);
    `,
  },
  {
    version: 6,
    up: /* sql */ `
      ALTER TABLE themes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 7,
    up: /* sql */ `
      UPDATE edges
      SET basis = 'inferred'
      WHERE basis NOT IN ('explicit', 'inferred');

      UPDATE edges
      SET type = 'variant_of'
      WHERE type = 'has_variant';

      UPDATE edges
      SET type = 'extends'
      WHERE type NOT IN (
        'extends',
        'contradicts',
        'applies_to',
        'shares_method',
        'precondition_of',
        'measures_same',
        'supports',
        'refutes',
        'variant_of',
        'refines',
        'contains'
      );
    `,
  },
  {
    version: 8,
    up: /* sql */ `
      CREATE TABLE tutor_saved_routes (
        route_id          TEXT PRIMARY KEY,
        plan_id           TEXT NOT NULL,
        generated_at      TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        last_played_at    TEXT,
        mode              TEXT NOT NULL,
        prompt            TEXT NOT NULL,
        model_json        TEXT,
        overview          TEXT NOT NULL,
        total_themes      INTEGER NOT NULL DEFAULT 0,
        total_ideas       INTEGER NOT NULL DEFAULT 0,
        total_connections INTEGER NOT NULL DEFAULT 0,
        route_json        TEXT NOT NULL,
        rating            INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5))
      );

      CREATE INDEX idx_tutor_saved_routes_generated
        ON tutor_saved_routes(generated_at DESC);
      CREATE INDEX idx_tutor_saved_routes_rating
        ON tutor_saved_routes(rating DESC, updated_at DESC);
    `,
  },
  {
    version: 9,
    up: /* sql */ `
      CREATE TABLE scan_checkpoints (
        nodus_id     TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        kind         TEXT NOT NULL,
        batch_index  INTEGER NOT NULL,
        data_json    TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        PRIMARY KEY (nodus_id, content_hash, kind, batch_index)
      );
    `,
  },
  {
    version: 10,
    up: /* sql */ `
      ALTER TABLE ideas ADD COLUMN embedding_provider TEXT;
      ALTER TABLE ideas ADD COLUMN embedding_model TEXT;
      ALTER TABLE ideas ADD COLUMN embedding_dim INTEGER;
      ALTER TABLE ideas ADD COLUMN embedding_text_hash TEXT;

      CREATE INDEX idx_ideas_embedding_meta
        ON ideas(embedding_provider, embedding_model, embedding_dim, embedding_text_hash);

      CREATE TABLE edge_traces (
        edge_id            TEXT PRIMARY KEY,
        method             TEXT NOT NULL,
        model_json         TEXT,
        embedding_provider TEXT,
        embedding_model    TEXT,
        similarity         REAL,
        rationale          TEXT,
        created_at         TEXT NOT NULL
      );

      UPDATE edges
      SET
        from_id = to_id,
        to_id = from_id
      WHERE type IN ('contradicts', 'shares_method', 'measures_same', 'variant_of')
        AND from_id > to_id;

      DELETE FROM edges
      WHERE rowid IN (
        SELECT rowid
        FROM (
          SELECT
            rowid,
            ROW_NUMBER() OVER (
              PARTITION BY from_id, to_id, type
              ORDER BY confidence DESC, CASE basis WHEN 'explicit' THEN 0 ELSE 1 END, rowid ASC
            ) AS rn
          FROM edges
        )
        WHERE rn > 1
      );

      CREATE UNIQUE INDEX idx_edges_unique_pair_type
        ON edges(from_id, to_id, type);
    `,
  },
  {
    version: 11,
    up: /* sql */ `
      CREATE TABLE zotero_tags (
        tag_id           INTEGER PRIMARY KEY,
        label            TEXT NOT NULL,
        normalized_label TEXT NOT NULL UNIQUE
      );

      CREATE TABLE work_zotero_tags (
        nodus_id TEXT NOT NULL,
        tag_id   INTEGER NOT NULL,
        PRIMARY KEY (nodus_id, tag_id),
        FOREIGN KEY (nodus_id) REFERENCES works(nodus_id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES zotero_tags(tag_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_work_zotero_tags_tag ON work_zotero_tags(tag_id, nodus_id);
    `,
  },
  {
    version: 12,
    up: /* sql */ `
      ALTER TABLE works ADD COLUMN summary_status TEXT DEFAULT 'none';
      ALTER TABLE works ADD COLUMN summary_at     TEXT;
      ALTER TABLE works ADD COLUMN summary_hash   TEXT;

      CREATE TABLE work_summaries (
        nodus_id            TEXT PRIMARY KEY,
        summary             TEXT NOT NULL,
        source_level        TEXT NOT NULL,
        model_json          TEXT,
        content_hash        TEXT NOT NULL,
        embedding           BLOB,
        embedding_provider  TEXT,
        embedding_model     TEXT,
        embedding_dim       INTEGER,
        embedding_text_hash TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        FOREIGN KEY (nodus_id) REFERENCES works(nodus_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_work_summaries_embedding_meta
        ON work_summaries(embedding_provider, embedding_model, embedding_dim, embedding_text_hash);
    `,
  },
  {
    version: 13,
    up: /* sql */ `
      CREATE TABLE collections (
        collection_key TEXT PRIMARY KEY,
        name           TEXT,
        parent_key     TEXT
      );

      CREATE TABLE work_collections (
        nodus_id       TEXT NOT NULL,
        collection_key TEXT NOT NULL,
        PRIMARY KEY (nodus_id, collection_key),
        FOREIGN KEY (nodus_id) REFERENCES works(nodus_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_work_collections_coll ON work_collections(collection_key, nodus_id);
    `,
  },
  {
    version: 14,
    up: /* sql */ `
      CREATE TABLE research_questions (
        id           TEXT PRIMARY KEY,
        question     TEXT NOT NULL,
        notes        TEXT,
        model_json   TEXT,
        status       TEXT NOT NULL DEFAULT 'draft',
        corpus_ideas INTEGER NOT NULL DEFAULT 0,
        corpus_works INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        mapped_at    TEXT
      );

      CREATE TABLE research_subquestions (
        id              TEXT PRIMARY KEY,
        rq_id           TEXT NOT NULL,
        text            TEXT NOT NULL,
        rationale       TEXT,
        order_idx       INTEGER NOT NULL,
        coverage_status TEXT,
        justification   TEXT,
        created_at      TEXT NOT NULL,
        FOREIGN KEY (rq_id) REFERENCES research_questions(id) ON DELETE CASCADE
      );

      CREATE TABLE research_coverage_links (
        id         TEXT PRIMARY KEY,
        subq_id    TEXT NOT NULL,
        kind       TEXT NOT NULL,
        ref_id     TEXT NOT NULL,
        label      TEXT,
        score      REAL,
        read_state TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (subq_id) REFERENCES research_subquestions(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_research_subq_rq ON research_subquestions(rq_id, order_idx);
      CREATE INDEX idx_research_links_subq ON research_coverage_links(subq_id);
    `,
  },
  {
    version: 15,
    up: /* sql */ `
      CREATE TABLE passages (
        passage_id         TEXT PRIMARY KEY,
        nodus_id           TEXT NOT NULL,
        chunk_index        INTEGER NOT NULL,
        text               TEXT NOT NULL,
        page_label         TEXT,
        char_len           INTEGER NOT NULL,
        content_hash       TEXT NOT NULL,
        embedding          BLOB,
        embedding_provider TEXT,
        embedding_model    TEXT,
        embedding_dim      INTEGER,
        embedding_text_hash TEXT,
        created_at         TEXT NOT NULL,
        FOREIGN KEY (nodus_id) REFERENCES works(nodus_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_passages_nodus ON passages(nodus_id);
      CREATE INDEX idx_passages_embedding_meta
        ON passages(embedding_provider, embedding_model, embedding_dim, embedding_text_hash);
    `,
  },
  {
    version: 16,
    up: /* sql */ `
      CREATE TABLE writing_saved_drafts (
        id             TEXT PRIMARY KEY,
        title          TEXT NOT NULL,
        brief_json     TEXT NOT NULL,
        selection_json TEXT NOT NULL,
        model_json     TEXT,
        draft_json     TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );

      CREATE INDEX idx_writing_saved_drafts_updated
        ON writing_saved_drafts(updated_at DESC);
    `,
  },
  {
    version: 17,
    up: /* sql */ `
      CREATE TABLE note_folders (
        id         TEXT PRIMARY KEY,
        parent_id  TEXT,
        name       TEXT NOT NULL,
        order_idx  INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (parent_id) REFERENCES note_folders(id) ON DELETE CASCADE
      );

      CREATE TABLE notes (
        id          TEXT PRIMARY KEY,
        folder_id   TEXT,
        title       TEXT NOT NULL,
        kind        TEXT NOT NULL DEFAULT 'markdown',
        content     TEXT NOT NULL DEFAULT '',
        source_json TEXT,
        order_idx   INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        FOREIGN KEY (folder_id) REFERENCES note_folders(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_note_folders_parent ON note_folders(parent_id, order_idx);
      CREATE INDEX idx_notes_folder ON notes(folder_id, order_idx);
      CREATE INDEX idx_notes_updated ON notes(updated_at DESC);
    `,
  },
  {
    version: 18,
    up: /* sql */ `
      ALTER TABLE note_folders ADD COLUMN summary TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    version: 19,
    up: /* sql */ `
      CREATE TABLE projects (
        id                   TEXT PRIMARY KEY,
        title                TEXT NOT NULL,
        kind                 TEXT NOT NULL DEFAULT 'other',
        status               TEXT NOT NULL DEFAULT 'active',
        brief                TEXT NOT NULL DEFAULT '',
        research_question_id TEXT,
        root_folder_id       TEXT,
        model_json           TEXT,
        target_words         INTEGER,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL,
        FOREIGN KEY (research_question_id) REFERENCES research_questions(id) ON DELETE SET NULL,
        FOREIGN KEY (root_folder_id) REFERENCES note_folders(id) ON DELETE SET NULL
      );

      CREATE TABLE project_sections (
        id           TEXT PRIMARY KEY,
        project_id   TEXT NOT NULL,
        folder_id    TEXT,
        title        TEXT NOT NULL,
        role         TEXT NOT NULL DEFAULT 'custom',
        status       TEXT NOT NULL DEFAULT 'empty',
        target_words INTEGER,
        order_idx    INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (folder_id) REFERENCES note_folders(id) ON DELETE SET NULL
      );

      CREATE TABLE project_links (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        section_id  TEXT,
        kind        TEXT NOT NULL,
        ref_id      TEXT NOT NULL,
        label       TEXT NOT NULL DEFAULT '',
        role        TEXT NOT NULL DEFAULT 'context',
        created_at  TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (section_id) REFERENCES project_sections(id) ON DELETE CASCADE
      );

      CREATE TABLE project_chapters (
        id                 TEXT PRIMARY KEY,
        project_id         TEXT NOT NULL,
        section_id         TEXT,
        note_id            TEXT,
        title              TEXT NOT NULL,
        source_format      TEXT NOT NULL DEFAULT 'unknown',
        original_file_name TEXT,
        original_text_hash TEXT NOT NULL,
        original_text      TEXT NOT NULL,
        current_markdown   TEXT NOT NULL,
        word_count         INTEGER NOT NULL DEFAULT 0,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (section_id) REFERENCES project_sections(id) ON DELETE SET NULL,
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL
      );

      CREATE TABLE project_chapter_chunks (
        id                  TEXT PRIMARY KEY,
        chapter_id          TEXT NOT NULL,
        order_idx           INTEGER NOT NULL,
        heading_path        TEXT NOT NULL DEFAULT '',
        text                TEXT NOT NULL,
        start_offset        INTEGER NOT NULL DEFAULT 0,
        end_offset          INTEGER NOT NULL DEFAULT 0,
        word_count          INTEGER NOT NULL DEFAULT 0,
        embedding           BLOB,
        embedding_provider  TEXT,
        embedding_model     TEXT,
        embedding_dim       INTEGER,
        embedding_text_hash TEXT,
        created_at          TEXT NOT NULL,
        FOREIGN KEY (chapter_id) REFERENCES project_chapters(id) ON DELETE CASCADE
      );

      CREATE TABLE project_insertion_suggestions (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL,
        chapter_id      TEXT NOT NULL,
        target_chunk_id TEXT,
        kind            TEXT NOT NULL,
        ref_id          TEXT NOT NULL,
        ref_label       TEXT NOT NULL DEFAULT '',
        operation       TEXT NOT NULL DEFAULT 'insert_after',
        proposed_text   TEXT NOT NULL,
        citation_json   TEXT NOT NULL DEFAULT '[]',
        rationale       TEXT NOT NULL DEFAULT '',
        confidence      REAL NOT NULL DEFAULT 0.5,
        status          TEXT NOT NULL DEFAULT 'suggested',
        blocked_reason  TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (chapter_id) REFERENCES project_chapters(id) ON DELETE CASCADE,
        FOREIGN KEY (target_chunk_id) REFERENCES project_chapter_chunks(id) ON DELETE SET NULL
      );

      CREATE TABLE project_chapter_versions (
        id         TEXT PRIMARY KEY,
        chapter_id TEXT NOT NULL,
        label      TEXT NOT NULL,
        markdown   TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (chapter_id) REFERENCES project_chapters(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_projects_updated ON projects(updated_at DESC);
      CREATE INDEX idx_project_sections_project ON project_sections(project_id, order_idx);
      CREATE INDEX idx_project_links_project ON project_links(project_id, section_id, kind);
      CREATE INDEX idx_project_chapters_project ON project_chapters(project_id, updated_at DESC);
      CREATE INDEX idx_project_chunks_chapter ON project_chapter_chunks(chapter_id, order_idx);
      CREATE INDEX idx_project_suggestions_chapter ON project_insertion_suggestions(chapter_id, status, created_at DESC);
      CREATE INDEX idx_project_versions_chapter ON project_chapter_versions(chapter_id, created_at DESC);
    `,
  },
  {
    version: 20,
    up: /* sql */ `
      CREATE TABLE saved_searches (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        query      TEXT NOT NULL,
        mode       TEXT NOT NULL DEFAULT 'semantic',
        kinds_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_saved_searches_created ON saved_searches(created_at DESC);
    `,
  },
  {
    version: 21,
    up: /* sql */ `
      -- Ideas distilled from an uploaded chapter. Deliberately separate from the
      -- curated 'ideas' table and the graph: these are ephemeral working units of
      -- the manuscript, re-extracted when the chapter text changes (source_hash).
      CREATE TABLE project_chapter_ideas (
        id                  TEXT PRIMARY KEY,
        chapter_id          TEXT NOT NULL,
        project_id          TEXT NOT NULL,
        type                TEXT NOT NULL DEFAULT 'claim',
        label               TEXT NOT NULL,
        statement           TEXT NOT NULL,
        order_idx           INTEGER NOT NULL DEFAULT 0,
        source_hash         TEXT NOT NULL,
        embedding           BLOB,
        embedding_provider  TEXT,
        embedding_model     TEXT,
        embedding_dim       INTEGER,
        embedding_text_hash TEXT,
        created_at          TEXT NOT NULL,
        FOREIGN KEY (chapter_id) REFERENCES project_chapters(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_chapter_ideas_chapter ON project_chapter_ideas(chapter_id, order_idx);

      -- Typed relations between a chapter idea and a library entity (idea/note/
      -- passage/work). Discovered by cosine shortlist + optional LLM typing.
      CREATE TABLE project_chapter_idea_relations (
        id              TEXT PRIMARY KEY,
        chapter_idea_id TEXT NOT NULL,
        chapter_id      TEXT NOT NULL,
        target_kind     TEXT NOT NULL,
        target_id       TEXT NOT NULL,
        relation        TEXT NOT NULL DEFAULT 'related',
        similarity      REAL NOT NULL DEFAULT 0,
        confidence      REAL NOT NULL DEFAULT 0,
        rationale       TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL,
        FOREIGN KEY (chapter_idea_id) REFERENCES project_chapter_ideas(id) ON DELETE CASCADE,
        FOREIGN KEY (chapter_id) REFERENCES project_chapters(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_chapter_idea_relations_chapter ON project_chapter_idea_relations(chapter_id, chapter_idea_id);

      -- Notes get embeddings too, so chapter ideas can find relations with the
      -- user's own notes (not just corpus ideas/passages/work summaries).
      ALTER TABLE notes ADD COLUMN embedding BLOB;
      ALTER TABLE notes ADD COLUMN embedding_provider TEXT;
      ALTER TABLE notes ADD COLUMN embedding_model TEXT;
      ALTER TABLE notes ADD COLUMN embedding_dim INTEGER;
      ALTER TABLE notes ADD COLUMN embedding_text_hash TEXT;
    `,
  },
  {
    version: 22,
    up: /* sql */ `
      -- Cached AI synthesis for one author's dossier ("Ficha de autor"). The raw
      -- ideas/relations are always assembled live from the graph; only the
      -- narrated thesis/remember/positioning is expensive, so it is cached here.
      -- 'fingerprint' hashes the author's idea + relation set so the UI can flag
      -- the synthesis as stale when the corpus changes.
      CREATE TABLE author_dossier_synthesis (
        author_id    TEXT PRIMARY KEY,
        thesis       TEXT NOT NULL DEFAULT '',
        remember_json TEXT NOT NULL DEFAULT '[]',
        positioning  TEXT NOT NULL DEFAULT '',
        model_json   TEXT,
        fingerprint  TEXT NOT NULL DEFAULT '',
        generated_at TEXT NOT NULL,
        FOREIGN KEY (author_id) REFERENCES authors(author_id) ON DELETE CASCADE
      );

      -- Cached one-sentence stance for a single author×theme cell of the
      -- synthesis matrix. Sparse: only generated cells are stored. 'fingerprint'
      -- hashes the idea set behind the cell so it can be invalidated on change.
      CREATE TABLE synthesis_matrix_cell (
        author_id    TEXT NOT NULL,
        theme_id     TEXT NOT NULL,
        stance       TEXT NOT NULL DEFAULT '',
        model_json   TEXT,
        fingerprint  TEXT NOT NULL DEFAULT '',
        generated_at TEXT NOT NULL,
        PRIMARY KEY (author_id, theme_id),
        FOREIGN KEY (author_id) REFERENCES authors(author_id) ON DELETE CASCADE,
        FOREIGN KEY (theme_id) REFERENCES themes(theme_id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 23,
    up: /* sql */ `
      -- Make Zotero the single source of author identity. We persist the raw
      -- structured creators (with role) per work so author nodes can be built
      -- from canonical (lastName, first-initial) keys instead of free-text names,
      -- which previously fragmented one person into several nodes.
      ALTER TABLE works ADD COLUMN creators_json TEXT;

      -- Normalized identity key ("lastname::i") used to dedupe author nodes.
      ALTER TABLE authors ADD COLUMN canonical_key TEXT;
      CREATE INDEX idx_authors_canonical ON authors(canonical_key);

      -- Zotero creator role for this work↔author link: 'author' | 'editor'.
      ALTER TABLE work_authors ADD COLUMN role TEXT NOT NULL DEFAULT 'author';
    `,
  },
  {
    version: 24,
    up: /* sql */ `
      -- Progress for Modo Estudio. The guide itself is recalculated from the
      -- live graph, but the user's learning state must survive restarts.
      CREATE TABLE study_progress (
        target_kind TEXT NOT NULL,
        target_id   TEXT NOT NULL,
        status      TEXT NOT NULL,
        note        TEXT,
        updated_at  TEXT NOT NULL,
        PRIMARY KEY (target_kind, target_id)
      );
      CREATE INDEX idx_study_progress_status ON study_progress(status, updated_at);
    `,
  },
  {
    version: 25,
    up: /* sql */ `
      -- Cached narrated synthesis for one work's extracted ideas. Mirrors the
      -- author dossier synthesis shape, with a fingerprint over the work's idea
      -- set so the UI can flag stale results after re-analysis.
      CREATE TABLE work_idea_synthesis (
        nodus_id      TEXT PRIMARY KEY,
        thesis        TEXT NOT NULL DEFAULT '',
        remember_json TEXT NOT NULL DEFAULT '[]',
        positioning   TEXT NOT NULL DEFAULT '',
        model_json    TEXT,
        fingerprint   TEXT NOT NULL DEFAULT '',
        generated_at  TEXT NOT NULL,
        FOREIGN KEY (nodus_id) REFERENCES works(nodus_id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 26,
    up: /* sql */ `
      -- Inmersión sessions. plan_json stores the COMPLETE generated experience
      -- (every AI answer, literal quotes, contrasts matrix, exam, topic subgraph)
      -- so a session replays forever without new AI calls; progress_json stores
      -- the user's position, completed steps and answers (with assessments).
      -- stats_json is a small denormalized summary so listing never parses plans.
      CREATE TABLE immersion_sessions (
        id            TEXT PRIMARY KEY,
        topic         TEXT NOT NULL,
        title         TEXT NOT NULL DEFAULT '',
        language      TEXT NOT NULL DEFAULT 'es',
        minutes       INTEGER NOT NULL DEFAULT 150,
        model_json    TEXT,
        plan_json     TEXT NOT NULL,
        progress_json TEXT NOT NULL,
        stats_json    TEXT NOT NULL DEFAULT '{}',
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_immersion_updated ON immersion_sessions(updated_at DESC);
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
