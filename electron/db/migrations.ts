import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  up: string;
}

// Versioned, append-only migrations. Never edit an existing migration's SQL once
// shipped — add a new one. The current schema version is the highest applied.
export const SCHEMA_VERSION = 52;

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
  {
    version: 27,
    up: /* sql */ `
      -- User audit verdicts over derived relations. Keyed by the idea pair +
      -- relation type (NOT by edges.id): scan pipelines delete and recreate
      -- edge rows, so a verdict must outlive any individual row. No foreign
      -- keys for the same reason — feedback for a temporarily-removed idea
      -- becomes active again the moment a rescan brings the pair back.
      CREATE TABLE edge_feedback (
        from_id    TEXT NOT NULL,
        to_id      TEXT NOT NULL,
        type       TEXT NOT NULL,
        verdict    TEXT NOT NULL CHECK (verdict IN ('rejected', 'confirmed')),
        note       TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id, type)
      );
      CREATE INDEX idx_edge_feedback_reverse ON edge_feedback(to_id, from_id, type);

      -- Single source of truth for "edges the user hasn't vetoed". Every
      -- UI/AI-facing reader selects from this view; physical maintenance
      -- (dedupe, deletes, imports) keeps operating on the edges table.
      -- A rejection hides the pair in BOTH directions.
      CREATE VIEW visible_edges AS
        SELECT e.* FROM edges e
        WHERE NOT EXISTS (
          SELECT 1 FROM edge_feedback f
          WHERE f.verdict = 'rejected'
            AND f.type = e.type
            AND ((f.from_id = e.from_id AND f.to_id = e.to_id)
              OR (f.from_id = e.to_id AND f.to_id = e.from_id))
        );
    `,
  },
  {
    version: 28,
    up: /* sql */ `
      -- Stable idea identity across rescans. A deep rescan used to DELETE any
      -- idea whose only occurrence was the rescanned work; re-extraction then
      -- minted a NEW global_id, orphaning every reference (notes, routes,
      -- drafts, edge feedback). Now such ideas merely go dormant: orphaned_at
      -- is set, fusion keeps them as match candidates and revives them (same
      -- global_id) when the idea is extracted again; only long-dormant ideas
      -- are pruned.
      ALTER TABLE ideas ADD COLUMN orphaned_at TEXT;
      CREATE INDEX idx_ideas_orphaned ON ideas(orphaned_at) WHERE orphaned_at IS NOT NULL;
    `,
  },
  {
    version: 29,
    up: /* sql */ `
      -- Optional decorative images for Inmersión and Deep Research. The image
      -- and its compact thumbnail live in SQLite so full backups remain
      -- self-contained. No foreign key is used because the two owner tables
      -- intentionally have different schemas; their repositories delete the
      -- associated row explicitly.
      CREATE TABLE decorative_images (
        entity_kind    TEXT NOT NULL CHECK (entity_kind IN ('immersion', 'deep_research')),
        entity_id      TEXT NOT NULL,
        requested      INTEGER NOT NULL DEFAULT 0,
        status         TEXT NOT NULL DEFAULT 'not_requested'
                       CHECK (status IN ('not_requested', 'pending', 'ready', 'failed')),
        provider       TEXT,
        model          TEXT,
        style          TEXT NOT NULL DEFAULT 'antique_book',
        visual_context TEXT,
        prompt         TEXT,
        asset_ref      TEXT,
        mime_type      TEXT,
        image_blob     BLOB,
        thumbnail_blob BLOB,
        error          TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        PRIMARY KEY (entity_kind, entity_id)
      );
      CREATE INDEX idx_decorative_images_status ON decorative_images(status, updated_at DESC);
    `,
  },
  {
    version: 30,
    up: /* sql */ `
      -- Track how the current image was produced ('ai' | 'custom'), and keep a
      -- single-level snapshot of the previous ready image so a regeneration or a
      -- user upload can be undone. The snapshot columns mirror the live ones and
      -- live in SQLite too, so backups stay self-contained.
      ALTER TABLE decorative_images ADD COLUMN source TEXT;
      ALTER TABLE decorative_images ADD COLUMN prev_image_blob BLOB;
      ALTER TABLE decorative_images ADD COLUMN prev_thumbnail_blob BLOB;
      ALTER TABLE decorative_images ADD COLUMN prev_mime_type TEXT;
      ALTER TABLE decorative_images ADD COLUMN prev_style TEXT;
      ALTER TABLE decorative_images ADD COLUMN prev_visual_context TEXT;
      ALTER TABLE decorative_images ADD COLUMN prev_prompt TEXT;
      ALTER TABLE decorative_images ADD COLUMN prev_provider TEXT;
      ALTER TABLE decorative_images ADD COLUMN prev_model TEXT;
      ALTER TABLE decorative_images ADD COLUMN prev_source TEXT;
    `,
  },
  {
    version: 31,
    up: /* sql */ `
      -- Metadata for locally generated narration (text-to-speech) clips. The audio
      -- files themselves live on disk under the vault's audio/ directory, NOT in
      -- SQLite: they are large and fully regenerable, so they are deliberately kept
      -- out of backups and .nodussync (which carry only the database). A restored or
      -- synced database therefore keeps the metadata but the repository flags any row
      -- whose file is absent as "missing" so the UI can offer to regenerate it.
      CREATE TABLE audio_clips (
        id            TEXT PRIMARY KEY,
        entity_kind   TEXT NOT NULL CHECK (entity_kind IN ('immersion', 'deep_research')),
        entity_id     TEXT NOT NULL,
        segment_index INTEGER NOT NULL,
        segment_label TEXT NOT NULL DEFAULT '',
        provider      TEXT NOT NULL DEFAULT 'piper',
        voice         TEXT NOT NULL DEFAULT '',
        language      TEXT NOT NULL DEFAULT '',
        file_name     TEXT NOT NULL,
        bytes         INTEGER NOT NULL DEFAULT 0,
        duration_sec  REAL NOT NULL DEFAULT 0,
        sample_rate   INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_audio_clips_entity ON audio_clips(entity_kind, entity_id, segment_index);
    `,
  },
  {
    version: 32,
    up: /* sql */ `
      -- AI translations of a Deep Research report or an immersion. The translated
      -- document is stored as Markdown; one row per (entity, language) so
      -- regenerating replaces the previous copy. Unlike audio, these are small and
      -- not regenerable for free (they cost an AI call), so they live in SQLite and
      -- travel with backups / .nodussync.
      CREATE TABLE content_translations (
        id             TEXT PRIMARY KEY,
        entity_kind    TEXT NOT NULL CHECK (entity_kind IN ('immersion', 'deep_research')),
        entity_id      TEXT NOT NULL,
        language       TEXT NOT NULL,
        language_label TEXT NOT NULL DEFAULT '',
        title          TEXT NOT NULL DEFAULT '',
        markdown       TEXT NOT NULL DEFAULT '',
        model_json     TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        UNIQUE (entity_kind, entity_id, language)
      );
      CREATE INDEX idx_content_translations_entity
        ON content_translations(entity_kind, entity_id, updated_at DESC);
    `,
  },
  {
    version: 33,
    up: /* sql */ `
      -- Primary-source / genealogy entity ontology. Parallel to the argumentative
      -- ideas/themes graph: a "records" lens extracts persons, places and events
      -- from primary sources instead of ideas. Every fact is backed by evidence
      -- (record_evidence) pointing at a source passage, so the record layer keeps
      -- Nodus's citable DNA. Dates are stored twice: a human display form and a
      -- sortable ISO-ish lower/upper bound so a timeline can order fuzzy dates
      -- ("c. 1850", "antes de 1880"). Coexists with the ideas ontology and can be
      -- cross-referenced by it.

      CREATE TABLE persons (
        person_id       TEXT PRIMARY KEY,
        display_name    TEXT NOT NULL,
        sex             TEXT NOT NULL DEFAULT 'unknown',
        birth_date      TEXT,
        birth_date_sort TEXT,
        death_date      TEXT,
        death_date_sort TEXT,
        notes           TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
      CREATE INDEX idx_persons_name ON persons(display_name);
      CREATE INDEX idx_persons_birth_sort ON persons(birth_date_sort);

      -- Name variants / spellings across records (a person's name changes over time).
      CREATE TABLE person_names (
        id         TEXT PRIMARY KEY,
        person_id  TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        kind       TEXT,
        UNIQUE (person_id, name)
      );
      CREATE INDEX idx_person_names_person ON person_names(person_id);

      -- Places form a hierarchy (parish → municipality → province → country).
      CREATE TABLE places (
        place_id    TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        parent_id   TEXT REFERENCES places(place_id) ON DELETE SET NULL,
        kind        TEXT,
        latitude    REAL,
        longitude   REAL,
        notes       TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_places_parent ON places(parent_id);
      CREATE INDEX idx_places_name ON places(name);

      CREATE TABLE events (
        event_id      TEXT PRIMARY KEY,
        type          TEXT NOT NULL,
        label         TEXT,
        date          TEXT,
        date_sort     TEXT,
        date_end_sort TEXT,
        place_id      TEXT REFERENCES places(place_id) ON DELETE SET NULL,
        notes         TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_events_sort ON events(date_sort);
      CREATE INDEX idx_events_type ON events(type);
      CREATE INDEX idx_events_place ON events(place_id);

      -- Who took part in an event and how (principal, spouse, father, witness…).
      -- Relationships in the primary-source layer are asserted BY events/sources
      -- rather than declared abstractly; the genealogy layer (phase C) adds an
      -- explicit kinship specialisation on top.
      CREATE TABLE event_participants (
        id         TEXT PRIMARY KEY,
        event_id   TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
        person_id  TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        role       TEXT NOT NULL DEFAULT 'principal',
        UNIQUE (event_id, person_id, role)
      );
      CREATE INDEX idx_event_participants_person ON event_participants(person_id);
      CREATE INDEX idx_event_participants_event ON event_participants(event_id);

      -- Polymorphic evidence for any record entity/event/participation. nodus_id is a
      -- free pointer (a works.nodus_id, or an archive item id when source_kind =
      -- 'archive'); intentionally not a FK so the evidence archive (also phase B) can
      -- be introduced without a forward reference.
      CREATE TABLE record_evidence (
        id          TEXT PRIMARY KEY,
        target_kind TEXT NOT NULL,
        target_id   TEXT NOT NULL,
        nodus_id    TEXT,
        source_kind TEXT NOT NULL DEFAULT 'work',
        quote       TEXT,
        location    TEXT,
        confidence  REAL,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_record_evidence_target ON record_evidence(target_kind, target_id);
    `,
  },
  {
    version: 34,
    up: /* sql */ `
      -- Evidence archive: a Nodus-native store for the user's OWN files that Zotero
      -- doesn't hold or can't index (record photos, census CSV/XLSX exports, scans).
      -- The file bytes live as a BLOB in SQLite (like decorative_images) so the whole
      -- archive travels with backups and .nodussync — genealogical evidence is
      -- irreplaceable and must survive. Extracted text (OCR / CSV / XLSX) is stored
      -- alongside so items are searchable and can back record entities as evidence
      -- (record_evidence.source_kind = 'archive', nodus_id = the item_id).

      CREATE TABLE archive_folders (
        folder_id  TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        parent_id  TEXT REFERENCES archive_folders(folder_id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_archive_folders_parent ON archive_folders(parent_id);

      CREATE TABLE archive_items (
        item_id        TEXT PRIMARY KEY,
        folder_id      TEXT REFERENCES archive_folders(folder_id) ON DELETE SET NULL,
        title          TEXT NOT NULL,
        kind           TEXT NOT NULL DEFAULT 'other',
        file_name      TEXT,
        mime_type      TEXT,
        bytes          INTEGER NOT NULL DEFAULT 0,
        blob           BLOB,
        extracted_text TEXT,
        description    TEXT,
        content_hash   TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX idx_archive_items_folder ON archive_items(folder_id);
      CREATE INDEX idx_archive_items_hash ON archive_items(content_hash);

      CREATE TABLE archive_item_tags (
        item_id TEXT NOT NULL REFERENCES archive_items(item_id) ON DELETE CASCADE,
        tag     TEXT NOT NULL,
        PRIMARY KEY (item_id, tag)
      );
      CREATE INDEX idx_archive_item_tags_tag ON archive_item_tags(tag);
    `,
  },
  {
    version: 35,
    up: /* sql */ `
      -- Genealogy kinship layer: explicit relationships between persons, the
      -- specialisation the tree view is built on. In the primary-source layer
      -- relationships are only asserted by events; here the user (or a confirmed AI
      -- suggestion) states them directly. Provenance is tracked — 'user_asserted' or
      -- 'ai_confirmed', never a raw AI write — so every edge in the tree is auditable.
      --   type 'parent': from_person is the PARENT of to_person (the child).
      --   type 'spouse': symmetric; stored once, queried in both directions.
      -- Siblings are derived (persons sharing a parent), never stored.
      CREATE TABLE relationships (
        rel_id      TEXT PRIMARY KEY,
        from_person TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        to_person   TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        type        TEXT NOT NULL,
        provenance  TEXT NOT NULL DEFAULT 'user_asserted',
        notes       TEXT,
        created_at  TEXT NOT NULL,
        UNIQUE (from_person, to_person, type)
      );
      CREATE INDEX idx_relationships_from ON relationships(from_person, type);
      CREATE INDEX idx_relationships_to ON relationships(to_person, type);
    `,
  },
  {
    version: 36,
    up: /* sql */ `
      -- Person portraits: a photo the user attaches (faces on the tree matter to a
      -- genealogist). Stored in its own table so person list queries never load the
      -- blob. The focal point (focus_x/y in 0..1 + scale) is non-destructive framing
      -- metadata — the original bytes are never cropped. Travels in backups/.nodussync.
      CREATE TABLE person_portraits (
        person_id  TEXT PRIMARY KEY REFERENCES persons(person_id) ON DELETE CASCADE,
        blob       BLOB NOT NULL,
        mime       TEXT NOT NULL DEFAULT 'image/jpeg',
        focus_x    REAL NOT NULL DEFAULT 0.5,
        focus_y    REAL NOT NULL DEFAULT 0.5,
        scale      REAL NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 37,
    up: /* sql */ `
      -- Persistent verdicts over candidate identity matches ("are these two person
      -- records the same individual?"). Same pattern as edge_feedback: keyed by the
      -- normalised person pair (person_a < person_b), no foreign keys, so a "these are
      -- NOT the same person" dismissal outlives rescans and is never re-proposed. An
      -- accept is a merge (handled separately), so only dismissals are recorded here.
      CREATE TABLE match_feedback (
        person_a   TEXT NOT NULL,
        person_b   TEXT NOT NULL,
        verdict    TEXT NOT NULL DEFAULT 'dismissed',
        created_at TEXT NOT NULL,
        PRIMARY KEY (person_a, person_b)
      );
    `,
  },
  {
    version: 38,
    up: /* sql */ `
      -- Genealogical/primary-source classification for archive items, separate from
      -- the file-format kind (image/csv/pdf…). doc_type comes from the taxonomy in
      -- shared/archiveDocTypes.ts (partida de nacimiento, diario, fotografía…), and
      -- metadata_json holds the optional type-specific form the user fills in.
      -- Academic/bibliographic sources are NOT archive items — they live in the
      -- library via Zotero.
      ALTER TABLE archive_items ADD COLUMN doc_type TEXT;
      ALTER TABLE archive_items ADD COLUMN metadata_json TEXT;
    `,
  },
  {
    version: 39,
    up: /* sql */ `
      -- Kinship nuance + tree presentation.
      --   relationships.subtype: null = biological/default, 'adoptive' for adoptions
      --   (rendered distinctly on the tree; still a real parent edge for layout).
      --   persons.frame_style: per-person override of the wooden tree frame design;
      --   null = use the vault-wide default (a setting).
      ALTER TABLE relationships ADD COLUMN subtype TEXT;
      ALTER TABLE persons ADD COLUMN frame_style TEXT;
    `,
  },
  {
    version: 40,
    up: /* sql */ `
      -- Link archive documents to the tree members they concern (a birth record to
      -- one person, a marriage certificate to two). This lets a person's ficha gather
      -- every document about them and feeds the AI biography with the right sources.
      CREATE TABLE archive_item_persons (
        item_id   TEXT NOT NULL REFERENCES archive_items(item_id) ON DELETE CASCADE,
        person_id TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (item_id, person_id)
      );
      CREATE INDEX idx_archive_item_persons_person ON archive_item_persons(person_id);
    `,
  },
  {
    version: 41,
    up: /* sql */ `
      -- Optional AI-generated biography of a person, written only on demand from the
      -- evidence (events, kinship, linked documents). Stored so it persists and travels.
      ALTER TABLE persons ADD COLUMN biography TEXT;
      ALTER TABLE persons ADD COLUMN biography_at TEXT;
    `,
  },
  {
    version: 42,
    up: /* sql */ `
      -- Evidence-driven kinship SUGGESTIONS. The cardinal rule of AI-assisted
      -- genealogy is that the machine must never contaminate the tree: it proposes,
      -- the user disposes. So structural record roles (a baptism naming the parents,
      -- a marriage naming the spouses) and explicit textual claims ("mi padre Juan")
      -- never write to the relationships table — they accumulate here as proposals,
      -- each carrying its verbatim quote + source. A mere co-mention of two names produces
      -- NOTHING here; only real evidence does. A suggestion surfaces once its evidence
      -- crosses a threshold; the user confirms it (→ an ai_confirmed relationship) or
      -- dismisses it (persistent, like match_feedback — never re-proposed).
      CREATE TABLE kinship_suggestions (
        suggestion_id TEXT PRIMARY KEY,
        from_person   TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        to_person     TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        type          TEXT NOT NULL,                 -- 'parent' | 'spouse'
        subtype       TEXT,                          -- null | 'adoptive'
        status        TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'confirmed' | 'dismissed'
        score         REAL NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        UNIQUE (from_person, to_person, type)
      );
      CREATE INDEX idx_kinship_suggestions_status ON kinship_suggestions(status);
      CREATE INDEX idx_kinship_suggestions_from ON kinship_suggestions(from_person);
      CREATE INDEX idx_kinship_suggestions_to ON kinship_suggestions(to_person);

      -- One row per piece of evidence backing a suggestion. 'record_role' = implied by
      -- an event's participant roles (structural); 'explicit_claim' = the source text
      -- states the relationship outright. Deduplicated by (suggestion, signal, source,
      -- quote) so re-scanning the same source doesn't inflate a suggestion's score.
      CREATE TABLE kinship_suggestion_evidence (
        id            TEXT PRIMARY KEY,
        suggestion_id TEXT NOT NULL REFERENCES kinship_suggestions(suggestion_id) ON DELETE CASCADE,
        signal        TEXT NOT NULL,                 -- 'record_role' | 'explicit_claim'
        source_kind   TEXT NOT NULL DEFAULT 'work',  -- 'work' | 'archive'
        nodus_id      TEXT,
        quote         TEXT,
        location      TEXT,
        weight        REAL NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_kinship_sugg_ev_suggestion ON kinship_suggestion_evidence(suggestion_id);
      CREATE UNIQUE INDEX idx_kinship_sugg_ev_dedupe
        ON kinship_suggestion_evidence(suggestion_id, signal, COALESCE(nodus_id, ''), COALESCE(quote, ''));

      -- Semantic index for the evidence archive: embed each item's extracted text so
      -- documents can be discovered by meaning ("which documents concern this person?"),
      -- reusing the same float32-BLOB + vec_cosine machinery as ideas. Nullable: an
      -- item is simply un-indexed until an embedding provider is configured and run.
      ALTER TABLE archive_items ADD COLUMN embedding BLOB;
      ALTER TABLE archive_items ADD COLUMN embedding_model TEXT;
      ALTER TABLE archive_items ADD COLUMN embedding_dim INTEGER;
      ALTER TABLE archive_items ADD COLUMN embedding_text_hash TEXT;
    `,
  },
  {
    version: 43,
    up: /* sql */ `
      -- Social-relations network: a SECOND graph, independent from the kinship tree,
      -- for the connections a person had beyond family (patrons, friends, employers,
      -- rivals, correspondents...) — the material a social/prosopographical historian
      -- works with. A social_contact is a lightweight node for someone who is known
      -- ONLY through a relation (not themselves a tree member); 'notes' holds whatever
      -- the user knows about them, free text. Contacts never author relations — only
      -- persons in the kinship tree do (a relation is recorded from a person's ficha).
      CREATE TABLE social_contacts (
        contact_id   TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        notes        TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_social_contacts_name ON social_contacts(display_name);

      -- A directed, typed connection recorded from person_id's ficha ("who they
      -- knew"). role is free text from person_id's perspective (amigo, patrón,
      -- socio...). The target is polymorphic (mirrors record_evidence's
      -- target_kind/target_id pattern): either another tree person or a
      -- social_contact, so the two graphs can interconnect without merging their
      -- ontologies. notes is markdown, about the connection itself (distinct from a
      -- contact's own notes, which describe the person).
      CREATE TABLE social_relations (
        relation_id TEXT PRIMARY KEY,
        person_id   TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        target_kind TEXT NOT NULL,   -- 'contact' | 'person'
        target_id   TEXT NOT NULL,
        role        TEXT NOT NULL,
        notes       TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_social_relations_person ON social_relations(person_id);
      CREATE INDEX idx_social_relations_target ON social_relations(target_kind, target_id);
    `,
  },
  {
    version: 44,
    up: /* sql */ `
      -- Places gain a gazetteer identity so the map's place picker can resolve a
      -- typed name to a real, unique populated place (GeoNames): gazetteer_id is the
      -- stable external id (e.g. 'geonames:2520118'), admin1/country are the
      -- state/province and country names for display ("municipio, estado, país"),
      -- country_code is the ISO code. All nullable — a hand-entered place with just
      -- coordinates still works. A partial unique index keeps one row per gazetteer
      -- entry so the same city links many people to a single place node.
      ALTER TABLE places ADD COLUMN gazetteer_id TEXT;
      ALTER TABLE places ADD COLUMN admin1 TEXT;
      ALTER TABLE places ADD COLUMN country TEXT;
      ALTER TABLE places ADD COLUMN country_code TEXT;
      CREATE UNIQUE INDEX idx_places_gazetteer ON places(gazetteer_id) WHERE gazetteer_id IS NOT NULL;

      -- A person's PLACE RECORD: the log of places associated with a person, which
      -- drives their individual map and (aggregated) the general map. Independent
      -- from events — a place can be logged without a full event — though the two
      -- coexist. label is the kind of association (birth, residence, death, other);
      -- date is a free-text (possibly fuzzy) date with a sortable key so the map's
      -- chronological slider and the migration path can order the stops.
      CREATE TABLE person_places (
        id         TEXT PRIMARY KEY,
        person_id  TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        place_id   TEXT NOT NULL REFERENCES places(place_id) ON DELETE CASCADE,
        label      TEXT,
        date       TEXT,
        date_sort  TEXT,
        notes      TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_person_places_person ON person_places(person_id);
      CREATE INDEX idx_person_places_place ON person_places(place_id);
    `,
  },
  {
    version: 45,
    up: /* sql */ `
      -- Archive documents gain a free-text "source" (provenance): where the
      -- document came from — the archive/repository, a citation, a URL, or how it
      -- was obtained. Central to the genealogical proof standard (cite your source),
      -- but useful for any primary-source vault. Nullable; existing rows stay null.
      ALTER TABLE archive_items ADD COLUMN source TEXT;
    `,
  },
  {
    version: 46,
    up: /* sql */ `
      -- "Databases" mode: a Notion-like structured-data manager scoped to the
      -- 'databases' vault type. A vault holds many databases; each database has a
      -- set of typed columns and a set of rows; a row's value for a column lives in
      -- the generic db_cells table (an entity-attribute-value model, so adding or
      -- retyping columns needs no DDL). Typed (de)serialization of value_text lives
      -- in shared/databases.ts. Attachment blobs and polymorphic relations arrive in
      -- later phases as their own tables. Everything is per-vault (one DB file per
      -- vault) so it travels in backups and .nodussync with no extra plumbing.
      CREATE TABLE db_databases (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,   -- autogenerated human id, e.g. DB-7QK2
        name        TEXT NOT NULL,
        icon        TEXT,
        position    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE db_columns (
        id           TEXT PRIMARY KEY,
        database_id  TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        type         TEXT NOT NULL,         -- title|text|number|date|time|select|multi_select|checkbox|attachment|ai|relation
        position     INTEGER NOT NULL DEFAULT 0,
        config_json  TEXT,                  -- per-type config (number format, AI prompt+auto, relation target, …)
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_db_columns_database ON db_columns(database_id);

      -- Options for select / multi-select columns (controlled vocabulary). A cell
      -- stores option ids in value_text; unknown ids are dropped on read, so this is
      -- the source of truth for which options exist and their display order/colour.
      CREATE TABLE db_select_options (
        id         TEXT PRIMARY KEY,
        column_id  TEXT NOT NULL REFERENCES db_columns(id) ON DELETE CASCADE,
        label      TEXT NOT NULL,
        color      TEXT,
        position   INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_db_select_options_column ON db_select_options(column_id);

      CREATE TABLE db_rows (
        id           TEXT PRIMARY KEY,
        database_id  TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        position     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_db_rows_database ON db_rows(database_id);

      -- One cell = one (row, column) value, serialized to text by shared/databases.ts.
      CREATE TABLE db_cells (
        row_id     TEXT NOT NULL REFERENCES db_rows(id) ON DELETE CASCADE,
        column_id  TEXT NOT NULL REFERENCES db_columns(id) ON DELETE CASCADE,
        value_text TEXT,
        PRIMARY KEY (row_id, column_id)
      );
      CREATE INDEX idx_db_cells_column ON db_cells(column_id);
    `,
  },
  {
    version: 47,
    up: /* sql */ `
      -- Databases mode phase 2: file attachments for 'attachment' columns. Each file
      -- is stored as a BLOB in SQLite (like archive_items) so it travels in backups and
      -- .nodussync; list queries never load the blob (fetch it on demand). extracted_text
      -- and description hold the searchable text / visual description of the file.
      CREATE TABLE db_attachments (
        id             TEXT PRIMARY KEY,
        row_id         TEXT NOT NULL REFERENCES db_rows(id) ON DELETE CASCADE,
        column_id      TEXT NOT NULL REFERENCES db_columns(id) ON DELETE CASCADE,
        file_name      TEXT,
        mime_type      TEXT,
        bytes          INTEGER NOT NULL DEFAULT 0,
        blob           BLOB,
        content_hash   TEXT,
        extracted_text TEXT,
        description    TEXT,
        position       INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT NOT NULL
      );
      CREATE INDEX idx_db_attachments_cell ON db_attachments(row_id, column_id);
    `,
  },
  {
    version: 48,
    up: /* sql */ `
      -- Databases mode phase 3: relation cells. A relation links a row to another
      -- database's row OR to a Nodus entity (Zotero work, idea, author, person) — the
      -- polymorphic target_kind/target_id convention used across the app (record_evidence,
      -- social_relations). The target's display label is resolved at read time.
      CREATE TABLE db_relations (
        id          TEXT PRIMARY KEY,
        row_id      TEXT NOT NULL REFERENCES db_rows(id) ON DELETE CASCADE,
        column_id   TEXT NOT NULL REFERENCES db_columns(id) ON DELETE CASCADE,
        target_kind TEXT NOT NULL,  -- db_row | work | idea | author | person
        target_id   TEXT NOT NULL,
        position    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_db_relations_cell ON db_relations(row_id, column_id);
    `,
  },
  {
    version: 49,
    up: /* sql */ `
      -- Databases mode phase 5: saved views. Each view is a named layout (table/gallery)
      -- plus its own filter and sort, so one database can serve many workflows (Notion-
      -- style views). filter_json/sort_json hold the pure filter/sort state.
      CREATE TABLE db_views (
        id           TEXT PRIMARY KEY,
        database_id  TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        layout       TEXT NOT NULL DEFAULT 'table',
        filter_json  TEXT,
        sort_json    TEXT,
        position     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_db_views_database ON db_views(database_id);
    `,
  },
  {
    version: 50,
    up: /* sql */ `
      -- Databases mode: cross-vault relations. A relation target may live in ANOTHER
      -- vault (an academic idea/gap/work/author, a genealogy person, …). target_vault_id
      -- records which vault it lives in so the label can be resolved by opening that vault
      -- read-only. NULL = the current/active vault (db_row and same-vault entity links).
      ALTER TABLE db_relations ADD COLUMN target_vault_id TEXT;
    `,
  },
  {
    version: 51,
    up: /* sql */ `
      -- Provenance for AI-generated images so the UI can badge them:
      --  · person_portraits.generated — a genealogy reference portrait drawn by AI
      --    (never a real photograph) rather than a user-uploaded likeness.
      --  · db_attachments.ai_generated / ai_prompt — an attachment produced by an
      --    'ai_image' database column, keeping the exact prompt for the info panel.
      ALTER TABLE person_portraits ADD COLUMN generated INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE db_attachments ADD COLUMN ai_generated INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE db_attachments ADD COLUMN ai_prompt TEXT;
    `,
  },
  {
    version: 52,
    up: /* sql */ `
      -- The genealogy Archive drops its single-parent folder tree in favour of a
      -- database-style "Carpeta" multi-select: an item can belong to several folders.
      -- archive_folders becomes the option list; archive_item_folders holds the
      -- (item, folder) memberships. Backfill from the legacy archive_items.folder_id so
      -- no existing folder assignment is lost. The old folder_id column is kept for
      -- backward compatibility but the UI now reads/writes through this join table.
      CREATE TABLE archive_item_folders (
        item_id    TEXT NOT NULL REFERENCES archive_items(item_id) ON DELETE CASCADE,
        folder_id  TEXT NOT NULL REFERENCES archive_folders(folder_id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (item_id, folder_id)
      );
      CREATE INDEX idx_archive_item_folders_folder ON archive_item_folders(folder_id);

      INSERT OR IGNORE INTO archive_item_folders (item_id, folder_id, created_at)
        SELECT item_id, folder_id, COALESCE(created_at, datetime('now'))
        FROM archive_items
        WHERE folder_id IS NOT NULL;
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
