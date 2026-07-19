import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  up: string;
}

// Versioned, append-only migrations. Never edit an existing migration's SQL once
// shipped — add a new one. The current schema version is the highest applied.
export const SCHEMA_VERSION = 90;

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
  {
    version: 53,
    up: /* sql */ `
      -- Study vault phase 1: local-first organization. Documents are independent
      -- entities and placements are many-to-many so one source can appear in
      -- several courses/topics without duplicating its content.
      CREATE TABLE study_courses (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        description TEXT,
        color       TEXT,
        icon        TEXT,
        favorite    INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE study_subjects (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        course_id   TEXT NOT NULL REFERENCES study_courses(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT,
        color       TEXT,
        icon        TEXT,
        favorite    INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_study_subjects_course ON study_subjects(course_id, position);

      CREATE TABLE study_topics (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        subject_id  TEXT NOT NULL REFERENCES study_subjects(id) ON DELETE CASCADE,
        parent_id   TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        name        TEXT NOT NULL,
        description TEXT,
        color       TEXT,
        icon        TEXT,
        favorite    INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_study_topics_subject ON study_topics(subject_id, parent_id, position);

      CREATE TABLE study_folders (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        parent_id   TEXT REFERENCES study_folders(id) ON DELETE SET NULL,
        course_id   TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id  TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        name        TEXT NOT NULL,
        description TEXT,
        color       TEXT,
        icon        TEXT,
        favorite    INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_study_folders_parent ON study_folders(parent_id, position);
      CREATE INDEX idx_study_folders_scope ON study_folders(course_id, subject_id, position);

      CREATE TABLE study_docs (
        id                  TEXT PRIMARY KEY,
        short_id            TEXT NOT NULL UNIQUE,
        title               TEXT NOT NULL,
        kind                TEXT NOT NULL DEFAULT 'apunte',
        content_markdown    TEXT NOT NULL DEFAULT '',
        description         TEXT,
        color               TEXT,
        icon                TEXT,
        favorite            INTEGER NOT NULL DEFAULT 0,
        pinned              INTEGER NOT NULL DEFAULT 0,
        locked              INTEGER NOT NULL DEFAULT 0,
        position            INTEGER NOT NULL DEFAULT 0,
        embedding           BLOB,
        embedding_provider  TEXT,
        embedding_model     TEXT,
        embedding_dim       INTEGER,
        embedding_text_hash TEXT,
        archived_at         TEXT,
        deleted_at          TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
      CREATE INDEX idx_study_docs_kind ON study_docs(kind, position);
      CREATE INDEX idx_study_docs_recent ON study_docs(updated_at DESC);

      CREATE TABLE study_placements (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        document_id TEXT NOT NULL REFERENCES study_docs(id) ON DELETE CASCADE,
        course_id   TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id  TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        topic_id    TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        folder_id   TEXT REFERENCES study_folders(id) ON DELETE SET NULL,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        CHECK (course_id IS NOT NULL OR subject_id IS NOT NULL OR topic_id IS NOT NULL OR folder_id IS NOT NULL)
      );
      CREATE INDEX idx_study_placements_doc ON study_placements(document_id, position);
      CREATE INDEX idx_study_placements_course ON study_placements(course_id, position);
      CREATE INDEX idx_study_placements_subject ON study_placements(subject_id, position);
      CREATE INDEX idx_study_placements_topic ON study_placements(topic_id, position);
      CREATE INDEX idx_study_placements_folder ON study_placements(folder_id, position);
      CREATE UNIQUE INDEX idx_study_placements_unique
        ON study_placements(document_id, IFNULL(course_id, ''), IFNULL(subject_id, ''), IFNULL(topic_id, ''), IFNULL(folder_id, ''));

      CREATE TABLE study_tags (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description TEXT,
        color       TEXT,
        icon        TEXT,
        favorite    INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE study_doc_tags (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        document_id TEXT NOT NULL REFERENCES study_docs(id) ON DELETE CASCADE,
        tag_id      TEXT NOT NULL REFERENCES study_tags(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        UNIQUE(document_id, tag_id)
      );
      CREATE INDEX idx_study_doc_tags_tag ON study_doc_tags(tag_id, document_id);

      CREATE TABLE study_templates (
        id           TEXT PRIMARY KEY,
        short_id     TEXT NOT NULL UNIQUE,
        kind         TEXT NOT NULL,
        name         TEXT NOT NULL,
        description  TEXT,
        content_json TEXT NOT NULL DEFAULT '{}',
        color        TEXT,
        icon         TEXT,
        favorite     INTEGER NOT NULL DEFAULT 0,
        position     INTEGER NOT NULL DEFAULT 0,
        archived_at  TEXT,
        deleted_at   TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_study_templates_kind ON study_templates(kind, position);
    `,
  },
  {
    version: 54,
    up: /* sql */ `
      -- Study vault phase 2: lossless Markdown editing, recoverable versions,
      -- anchored comments and internal links/backlinks.
      ALTER TABLE study_docs ADD COLUMN style_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE study_docs ADD COLUMN spellcheck_language TEXT NOT NULL DEFAULT 'es-ES';
      ALTER TABLE study_docs ADD COLUMN custom_dictionary_json TEXT NOT NULL DEFAULT '[]';

      CREATE TABLE study_doc_versions (
        id               TEXT PRIMARY KEY,
        short_id         TEXT NOT NULL UNIQUE,
        document_id      TEXT NOT NULL REFERENCES study_docs(id) ON DELETE CASCADE,
        version_no       INTEGER NOT NULL,
        title            TEXT NOT NULL,
        content_markdown TEXT NOT NULL,
        style_json       TEXT NOT NULL DEFAULT '{}',
        reason           TEXT NOT NULL DEFAULT 'manual',
        content_hash     TEXT NOT NULL,
        position         INTEGER NOT NULL DEFAULT 0,
        archived_at      TEXT,
        deleted_at       TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        UNIQUE(document_id, version_no)
      );
      CREATE INDEX idx_study_doc_versions_doc ON study_doc_versions(document_id, version_no DESC);
      CREATE INDEX idx_study_doc_versions_hash ON study_doc_versions(document_id, content_hash);

      CREATE TABLE study_annotations (
        id            TEXT PRIMARY KEY,
        short_id      TEXT NOT NULL UNIQUE,
        document_id   TEXT NOT NULL REFERENCES study_docs(id) ON DELETE CASCADE,
        from_pos      INTEGER NOT NULL DEFAULT 0,
        to_pos        INTEGER NOT NULL DEFAULT 0,
        selected_text TEXT NOT NULL DEFAULT '',
        comment       TEXT NOT NULL DEFAULT '',
        color         TEXT,
        resolved_at   TEXT,
        locked        INTEGER NOT NULL DEFAULT 0,
        pinned        INTEGER NOT NULL DEFAULT 0,
        position      INTEGER NOT NULL DEFAULT 0,
        archived_at   TEXT,
        deleted_at    TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_study_annotations_doc ON study_annotations(document_id, resolved_at, position);

      CREATE TABLE study_doc_links (
        id                 TEXT PRIMARY KEY,
        short_id           TEXT NOT NULL UNIQUE,
        source_document_id TEXT NOT NULL REFERENCES study_docs(id) ON DELETE CASCADE,
        target_document_id TEXT REFERENCES study_docs(id) ON DELETE CASCADE,
        target_ref         TEXT NOT NULL,
        target_title       TEXT,
        link_text          TEXT,
        position           INTEGER NOT NULL DEFAULT 0,
        archived_at        TEXT,
        deleted_at         TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX idx_study_doc_links_source ON study_doc_links(source_document_id, position);
      CREATE INDEX idx_study_doc_links_target ON study_doc_links(target_document_id, position);
      CREATE UNIQUE INDEX idx_study_doc_links_unique
        ON study_doc_links(source_document_id, target_ref, IFNULL(link_text, ''));
    `,
  },
  {
    version: 55,
    up: /* sql */ `
      -- Study vault phase 5 schema. The repository and UI are activated in phase 5;
      -- the table version is installed now so v57 remains append-only and ordered.
      CREATE TABLE study_materials (
        id                  TEXT PRIMARY KEY,
        short_id            TEXT NOT NULL UNIQUE,
        title               TEXT NOT NULL,
        description         TEXT,
        file_name           TEXT,
        file_path           TEXT,
        mime_type           TEXT,
        extension           TEXT,
        content_blob        BLOB,
        content_hash        TEXT NOT NULL,
        extracted_text      TEXT NOT NULL DEFAULT '',
        extraction_status   TEXT NOT NULL DEFAULT 'pending',
        metadata_json       TEXT NOT NULL DEFAULT '{}',
        bibliography_json   TEXT NOT NULL DEFAULT '{}',
        read_state          TEXT NOT NULL DEFAULT 'pending',
        page_count          INTEGER,
        duration_seconds    REAL,
        size_bytes          INTEGER NOT NULL DEFAULT 0,
        favorite            INTEGER NOT NULL DEFAULT 0,
        pinned              INTEGER NOT NULL DEFAULT 0,
        position            INTEGER NOT NULL DEFAULT 0,
        archived_at         TEXT,
        deleted_at          TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
      CREATE INDEX idx_study_materials_hash ON study_materials(content_hash);
      CREATE INDEX idx_study_materials_state ON study_materials(read_state, updated_at DESC);

      CREATE TABLE study_material_placements (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
        course_id   TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id  TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        topic_id    TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        folder_id   TEXT REFERENCES study_folders(id) ON DELETE SET NULL,
        document_id TEXT REFERENCES study_docs(id) ON DELETE SET NULL,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_study_material_placements_material ON study_material_placements(material_id, position);
      CREATE INDEX idx_study_material_placements_scope ON study_material_placements(course_id, subject_id, topic_id, document_id);

      CREATE TABLE study_material_annotations (
        id            TEXT PRIMARY KEY,
        short_id      TEXT NOT NULL UNIQUE,
        material_id   TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
        page_number   INTEGER,
        rect_json     TEXT,
        from_pos      INTEGER,
        to_pos        INTEGER,
        selected_text TEXT NOT NULL DEFAULT '',
        note          TEXT NOT NULL DEFAULT '',
        color         TEXT,
        position      INTEGER NOT NULL DEFAULT 0,
        archived_at   TEXT,
        deleted_at    TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_study_material_annotations_material ON study_material_annotations(material_id, page_number, position);

      CREATE TABLE study_material_fragment_links (
        id            TEXT PRIMARY KEY,
        short_id      TEXT NOT NULL UNIQUE,
        material_id   TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
        annotation_id TEXT REFERENCES study_material_annotations(id) ON DELETE SET NULL,
        document_id   TEXT NOT NULL REFERENCES study_docs(id) ON DELETE CASCADE,
        doc_from_pos  INTEGER,
        doc_to_pos    INTEGER,
        label         TEXT,
        source_json   TEXT NOT NULL DEFAULT '{}',
        position      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_study_material_links_document ON study_material_fragment_links(document_id, position);
      CREATE INDEX idx_study_material_links_material ON study_material_fragment_links(material_id, position);

      CREATE TABLE study_material_versions (
        id               TEXT PRIMARY KEY,
        short_id         TEXT NOT NULL UNIQUE,
        material_id      TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
        version_no       INTEGER NOT NULL,
        file_name        TEXT,
        mime_type        TEXT,
        content_blob     BLOB,
        content_hash     TEXT NOT NULL,
        extracted_text   TEXT NOT NULL DEFAULT '',
        metadata_json    TEXT NOT NULL DEFAULT '{}',
        size_bytes       INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL,
        UNIQUE(material_id, version_no)
      );
      CREATE INDEX idx_study_material_versions_material ON study_material_versions(material_id, version_no DESC);
    `,
  },
  {
    version: 56,
    up: /* sql */ `
      -- Study vault phase 6 schema, activated by its own repository/UI phase.
      CREATE TABLE study_recordings (
        id                 TEXT PRIMARY KEY,
        short_id           TEXT NOT NULL UNIQUE,
        title              TEXT NOT NULL,
        file_name          TEXT,
        file_path          TEXT,
        mime_type          TEXT,
        audio_blob         BLOB,
        content_hash       TEXT NOT NULL,
        duration_seconds   REAL NOT NULL DEFAULT 0,
        size_bytes         INTEGER NOT NULL DEFAULT 0,
        language           TEXT,
        course_id          TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id         TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        topic_id           TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        document_id        TEXT REFERENCES study_docs(id) ON DELETE SET NULL,
        material_id        TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
        session_label      TEXT,
        processing_status  TEXT NOT NULL DEFAULT 'pending',
        processing_progress REAL NOT NULL DEFAULT 0,
        favorite           INTEGER NOT NULL DEFAULT 0,
        position           INTEGER NOT NULL DEFAULT 0,
        archived_at        TEXT,
        deleted_at         TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX idx_study_recordings_scope ON study_recordings(course_id, subject_id, topic_id, updated_at DESC);
      CREATE INDEX idx_study_recordings_hash ON study_recordings(content_hash);

      CREATE TABLE study_transcripts (
        id                  TEXT PRIMARY KEY,
        short_id            TEXT NOT NULL UNIQUE,
        recording_id        TEXT NOT NULL REFERENCES study_recordings(id) ON DELETE CASCADE,
        kind                TEXT NOT NULL DEFAULT 'literal',
        content_markdown    TEXT NOT NULL DEFAULT '',
        language            TEXT,
        model_provider      TEXT,
        model_name          TEXT,
        status              TEXT NOT NULL DEFAULT 'pending',
        progress            REAL NOT NULL DEFAULT 0,
        error_message       TEXT,
        version_no          INTEGER NOT NULL DEFAULT 1,
        source_transcript_id TEXT REFERENCES study_transcripts(id) ON DELETE SET NULL,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        UNIQUE(recording_id, kind, version_no)
      );
      CREATE INDEX idx_study_transcripts_recording ON study_transcripts(recording_id, kind, version_no DESC);

      CREATE TABLE study_transcript_segments (
        id            TEXT PRIMARY KEY,
        short_id      TEXT NOT NULL UNIQUE,
        transcript_id TEXT NOT NULL REFERENCES study_transcripts(id) ON DELETE CASCADE,
        t_start       REAL NOT NULL,
        t_end         REAL NOT NULL,
        text          TEXT NOT NULL,
        speaker       TEXT,
        confidence    REAL,
        chapter       TEXT,
        position      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_study_transcript_segments_time ON study_transcript_segments(transcript_id, t_start, position);

      CREATE TABLE study_audio_markers (
        id           TEXT PRIMARY KEY,
        short_id     TEXT NOT NULL UNIQUE,
        recording_id TEXT NOT NULL REFERENCES study_recordings(id) ON DELETE CASCADE,
        t_seconds    REAL NOT NULL,
        label        TEXT NOT NULL,
        note         TEXT,
        color        TEXT,
        position     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_study_audio_markers_time ON study_audio_markers(recording_id, t_seconds, position);
    `,
  },
  {
    version: 57,
    up: /* sql */ `
      -- Study vault phase 4: reusable improvement styles, prompt history,
      -- scoped defaults and a provenance-only AI action log.
      CREATE TABLE study_styles (
        id                TEXT PRIMARY KEY,
        short_id          TEXT NOT NULL UNIQUE,
        name              TEXT NOT NULL,
        icon              TEXT NOT NULL DEFAULT '✦',
        color             TEXT NOT NULL DEFAULT '#0f766e',
        description       TEXT NOT NULL DEFAULT '',
        prompt            TEXT NOT NULL,
        system_prompt     TEXT NOT NULL DEFAULT '',
        category          TEXT NOT NULL DEFAULT 'custom',
        language          TEXT NOT NULL DEFAULT 'auto',
        level             TEXT NOT NULL DEFAULT 'moderate',
        length_mode       TEXT NOT NULL DEFAULT 'similar',
        model_provider    TEXT,
        model_name        TEXT,
        temperature       REAL NOT NULL DEFAULT 0.2,
        max_output_tokens INTEGER NOT NULL DEFAULT 2400,
        creativity        REAL NOT NULL DEFAULT 0.1,
        locked            INTEGER NOT NULL DEFAULT 0,
        favorite          INTEGER NOT NULL DEFAULT 0,
        active            INTEGER NOT NULL DEFAULT 1,
        position          INTEGER NOT NULL DEFAULT 0,
        archived_at       TEXT,
        deleted_at        TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE INDEX idx_study_styles_library ON study_styles(archived_at, active DESC, favorite DESC, position, name);

      CREATE TABLE study_style_versions (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        style_id    TEXT NOT NULL REFERENCES study_styles(id) ON DELETE CASCADE,
        version_no  INTEGER NOT NULL,
        config_json TEXT NOT NULL,
        reason      TEXT NOT NULL DEFAULT 'update',
        created_at  TEXT NOT NULL,
        UNIQUE(style_id, version_no)
      );
      CREATE INDEX idx_study_style_versions_style ON study_style_versions(style_id, version_no DESC);

      CREATE TABLE study_style_associations (
        id          TEXT PRIMARY KEY,
        style_id    TEXT NOT NULL,
        kind        TEXT NOT NULL,
        target_id   TEXT NOT NULL DEFAULT '',
        is_default  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        UNIQUE(style_id, kind, target_id)
      );
      CREATE INDEX idx_study_style_associations_target ON study_style_associations(kind, target_id, is_default DESC);

      CREATE TABLE study_improvement_log (
        id               TEXT PRIMARY KEY,
        document_id      TEXT NOT NULL REFERENCES study_docs(id) ON DELETE CASCADE,
        style_id         TEXT NOT NULL,
        scope            TEXT NOT NULL,
        mode             TEXT NOT NULL,
        level            TEXT NOT NULL,
        length_mode      TEXT NOT NULL,
        model_provider   TEXT NOT NULL,
        model_name       TEXT NOT NULL,
        original_hash    TEXT NOT NULL,
        result_hash      TEXT NOT NULL,
        original_chars   INTEGER NOT NULL,
        result_chars     INTEGER NOT NULL,
        warnings_json    TEXT NOT NULL DEFAULT '[]',
        action           TEXT NOT NULL DEFAULT 'generated',
        created_at       TEXT NOT NULL
      );
      CREATE INDEX idx_study_improvement_log_doc ON study_improvement_log(document_id, created_at DESC);
      CREATE INDEX idx_study_improvement_log_hash ON study_improvement_log(original_hash, result_hash);
    `,
  },
  {
    version: 58,
    up: /* sql */ `
      -- Study vault phase 10a: centralized, source-grounded question bank.
      CREATE TABLE study_questions (
        id                 TEXT PRIMARY KEY,
        short_id           TEXT NOT NULL UNIQUE,
        prompt             TEXT NOT NULL,
        question_type      TEXT NOT NULL,
        difficulty         TEXT NOT NULL DEFAULT 'medium',
        cognitive_level    TEXT NOT NULL DEFAULT 'understand',
        status             TEXT NOT NULL DEFAULT 'pending',
        answer_json        TEXT NOT NULL DEFAULT '{}',
        options_json       TEXT NOT NULL DEFAULT '[]',
        explanation        TEXT NOT NULL DEFAULT '',
        rubric_json        TEXT NOT NULL DEFAULT '{}',
        competence         TEXT,
        tags_json          TEXT NOT NULL DEFAULT '[]',
        course_id          TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id         TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        topic_id           TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        document_id        TEXT REFERENCES study_docs(id) ON DELETE SET NULL,
        material_id        TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
        recording_id       TEXT REFERENCES study_recordings(id) ON DELETE SET NULL,
        transcript_id      TEXT REFERENCES study_transcripts(id) ON DELETE SET NULL,
        source_title       TEXT,
        source_excerpt     TEXT NOT NULL DEFAULT '',
        source_location_json TEXT NOT NULL DEFAULT '{}',
        model_provider     TEXT,
        model_name         TEXT,
        generation_prompt  TEXT,
        favorite           INTEGER NOT NULL DEFAULT 0,
        locked             INTEGER NOT NULL DEFAULT 0,
        usage_count        INTEGER NOT NULL DEFAULT 0,
        correct_count      INTEGER NOT NULL DEFAULT 0,
        incorrect_count    INTEGER NOT NULL DEFAULT 0,
        omitted_count      INTEGER NOT NULL DEFAULT 0,
        total_response_ms  INTEGER NOT NULL DEFAULT 0,
        position           INTEGER NOT NULL DEFAULT 0,
        archived_at        TEXT,
        deleted_at         TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX idx_study_questions_bank ON study_questions(archived_at, status, favorite DESC, updated_at DESC);
      CREATE INDEX idx_study_questions_scope ON study_questions(course_id, subject_id, topic_id, question_type, difficulty);
      CREATE INDEX idx_study_questions_source ON study_questions(document_id, material_id, recording_id, transcript_id);

      CREATE TABLE study_question_versions (
        id            TEXT PRIMARY KEY,
        short_id      TEXT NOT NULL UNIQUE,
        question_id   TEXT NOT NULL REFERENCES study_questions(id) ON DELETE CASCADE,
        version_no    INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        reason        TEXT NOT NULL DEFAULT 'update',
        created_at    TEXT NOT NULL,
        UNIQUE(question_id, version_no)
      );
      CREATE INDEX idx_study_question_versions_question ON study_question_versions(question_id, version_no DESC);

      CREATE TABLE study_question_collections (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        color       TEXT NOT NULL DEFAULT '#0f766e',
        favorite    INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE study_question_collection_items (
        collection_id TEXT NOT NULL REFERENCES study_question_collections(id) ON DELETE CASCADE,
        question_id   TEXT NOT NULL REFERENCES study_questions(id) ON DELETE CASCADE,
        position      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        PRIMARY KEY(collection_id, question_id)
      );
      CREATE INDEX idx_study_question_collection_items_question ON study_question_collection_items(question_id);
    `,
  },
  {
    version: 59,
    up: /* sql */ `
      -- Study vault phases 10b/10c: reusable tests/exams and durable attempts.
      CREATE TABLE study_assessments (
        id                 TEXT PRIMARY KEY,
        short_id           TEXT NOT NULL UNIQUE,
        kind               TEXT NOT NULL,
        title              TEXT NOT NULL,
        description        TEXT NOT NULL DEFAULT '',
        course_id          TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id         TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        topic_id           TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        config_json        TEXT NOT NULL DEFAULT '{}',
        rubric_id          TEXT,
        available_at       TEXT,
        duration_minutes   INTEGER,
        max_attempts       INTEGER,
        favorite           INTEGER NOT NULL DEFAULT 0,
        archived_at        TEXT,
        deleted_at         TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX idx_study_assessments_kind ON study_assessments(kind, subject_id, updated_at DESC);

      CREATE TABLE study_assessment_items (
        id            TEXT PRIMARY KEY,
        short_id      TEXT NOT NULL UNIQUE,
        assessment_id TEXT NOT NULL REFERENCES study_assessments(id) ON DELETE CASCADE,
        question_id   TEXT NOT NULL REFERENCES study_questions(id) ON DELETE RESTRICT,
        points        REAL NOT NULL DEFAULT 1,
        required      INTEGER NOT NULL DEFAULT 1,
        position      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        UNIQUE(assessment_id, question_id)
      );
      CREATE INDEX idx_study_assessment_items_order ON study_assessment_items(assessment_id, position);

      CREATE TABLE study_attempts (
        id                TEXT PRIMARY KEY,
        short_id          TEXT NOT NULL UNIQUE,
        assessment_id     TEXT NOT NULL REFERENCES study_assessments(id) ON DELETE CASCADE,
        mode              TEXT NOT NULL DEFAULT 'practice',
        status            TEXT NOT NULL DEFAULT 'in_progress',
        score             REAL,
        max_score         REAL,
        correct_count     INTEGER NOT NULL DEFAULT 0,
        incorrect_count   INTEGER NOT NULL DEFAULT 0,
        omitted_count     INTEGER NOT NULL DEFAULT 0,
        duration_seconds  INTEGER NOT NULL DEFAULT 0,
        started_at        TEXT NOT NULL,
        submitted_at      TEXT,
        config_json       TEXT NOT NULL DEFAULT '{}',
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE INDEX idx_study_attempts_assessment ON study_attempts(assessment_id, started_at DESC);

      CREATE TABLE study_attempt_answers (
        id               TEXT PRIMARY KEY,
        short_id         TEXT NOT NULL UNIQUE,
        attempt_id       TEXT NOT NULL REFERENCES study_attempts(id) ON DELETE CASCADE,
        assessment_item_id TEXT NOT NULL REFERENCES study_assessment_items(id) ON DELETE CASCADE,
        question_id      TEXT NOT NULL REFERENCES study_questions(id) ON DELETE RESTRICT,
        response_json    TEXT NOT NULL DEFAULT '{}',
        is_correct       INTEGER,
        points_awarded   REAL,
        response_ms      INTEGER NOT NULL DEFAULT 0,
        flagged          INTEGER NOT NULL DEFAULT 0,
        confidence       INTEGER,
        feedback_json    TEXT NOT NULL DEFAULT '{}',
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        UNIQUE(attempt_id, assessment_item_id)
      );
      CREATE INDEX idx_study_attempt_answers_attempt ON study_attempt_answers(attempt_id, created_at);
    `,
  },
  {
    version: 60,
    up: /* sql */ `
      -- Study vault phase 10d: weighted rubrics and auditable AI grading.
      CREATE TABLE study_rubrics (
        id            TEXT PRIMARY KEY,
        short_id      TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        description   TEXT NOT NULL DEFAULT '',
        criteria_json TEXT NOT NULL,
        built_in      INTEGER NOT NULL DEFAULT 0,
        favorite      INTEGER NOT NULL DEFAULT 0,
        locked        INTEGER NOT NULL DEFAULT 0,
        archived_at   TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_study_rubrics_library ON study_rubrics(archived_at, favorite DESC, name);

      CREATE TABLE study_grading_runs (
        id               TEXT PRIMARY KEY,
        short_id         TEXT NOT NULL UNIQUE,
        attempt_answer_id TEXT NOT NULL REFERENCES study_attempt_answers(id) ON DELETE CASCADE,
        rubric_id        TEXT REFERENCES study_rubrics(id) ON DELETE SET NULL,
        severity         TEXT NOT NULL DEFAULT 'balanced',
        model_provider   TEXT NOT NULL,
        model_name       TEXT NOT NULL,
        sources_json     TEXT NOT NULL DEFAULT '[]',
        result_json      TEXT NOT NULL,
        estimated_score  REAL,
        manual_score     REAL,
        manual_comment   TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX idx_study_grading_runs_answer ON study_grading_runs(attempt_answer_id, created_at DESC);

      CREATE TABLE study_grading_annotations (
        id             TEXT PRIMARY KEY,
        short_id       TEXT NOT NULL UNIQUE,
        grading_run_id TEXT NOT NULL REFERENCES study_grading_runs(id) ON DELETE CASCADE,
        from_pos       INTEGER NOT NULL DEFAULT 0,
        to_pos         INTEGER NOT NULL DEFAULT 0,
        kind           TEXT NOT NULL,
        severity       TEXT NOT NULL DEFAULT 'info',
        message        TEXT NOT NULL,
        suggestion     TEXT,
        created_at     TEXT NOT NULL
      );
      CREATE INDEX idx_study_grading_annotations_run ON study_grading_annotations(grading_run_id, from_pos);
    `,
  },
  {
    version: 61,
    up: /* sql */ `
      -- Study vault phase 11a-11c: flashcards, spaced repetition and mastery.
      CREATE TABLE study_flashcards (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, card_type TEXT NOT NULL DEFAULT 'front_back',
        front TEXT NOT NULL, back TEXT NOT NULL, hint TEXT NOT NULL DEFAULT '', media_json TEXT NOT NULL DEFAULT '{}',
        tags_json TEXT NOT NULL DEFAULT '[]', course_id TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL, topic_id TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        document_id TEXT REFERENCES study_docs(id) ON DELETE SET NULL, material_id TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
        transcript_id TEXT REFERENCES study_transcripts(id) ON DELETE SET NULL, question_id TEXT REFERENCES study_questions(id) ON DELETE SET NULL,
        source_excerpt TEXT NOT NULL DEFAULT '', difficulty TEXT NOT NULL DEFAULT 'medium', favorite INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0, archived_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_study_flashcards_scope ON study_flashcards(subject_id, topic_id, archived_at, favorite DESC);

      CREATE TABLE study_srs_state (
        card_id TEXT PRIMARY KEY REFERENCES study_flashcards(id) ON DELETE CASCADE, ease_factor REAL NOT NULL DEFAULT 2.5,
        interval_days REAL NOT NULL DEFAULT 0, due_at TEXT NOT NULL, repetitions INTEGER NOT NULL DEFAULT 0,
        lapses INTEGER NOT NULL DEFAULT 0, last_rating INTEGER, last_reviewed_at TEXT, confidence REAL,
        mastered INTEGER NOT NULL DEFAULT 0, excluded INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_study_srs_due ON study_srs_state(excluded, mastered, due_at);

      CREATE TABLE study_reviews (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, card_id TEXT NOT NULL REFERENCES study_flashcards(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL, confidence INTEGER, correct INTEGER NOT NULL, elapsed_ms INTEGER NOT NULL DEFAULT 0,
        previous_interval_days REAL NOT NULL DEFAULT 0, next_interval_days REAL NOT NULL DEFAULT 0,
        scheduled_at TEXT, created_at TEXT NOT NULL
      );
      CREATE INDEX idx_study_reviews_card ON study_reviews(card_id, created_at DESC);

      CREATE TABLE study_mastery (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL,
        mastery REAL NOT NULL DEFAULT 0, confidence REAL NOT NULL DEFAULT 0, evidence_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'learning', last_activity_at TEXT, updated_at TEXT NOT NULL,
        UNIQUE(scope_kind, scope_id)
      );
      CREATE INDEX idx_study_mastery_level ON study_mastery(scope_kind, mastery, updated_at DESC);
    `,
  },
  {
    version: 62,
    up: /* sql */ `
      -- Study vault phase 11d: local academic planning and actual study time.
      CREATE TABLE study_plans (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        course_id TEXT REFERENCES study_courses(id) ON DELETE SET NULL, subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        exam_at TEXT, available_minutes INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL DEFAULT '{}', position INTEGER NOT NULL DEFAULT 0, archived_at TEXT, deleted_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE study_plan_blocks (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, plan_id TEXT REFERENCES study_plans(id) ON DELETE CASCADE,
        title TEXT NOT NULL, block_type TEXT NOT NULL DEFAULT 'study', course_id TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL, topic_id TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        starts_at TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 25, status TEXT NOT NULL DEFAULT 'planned',
        priority INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_study_plan_blocks_time ON study_plan_blocks(starts_at, status, subject_id);
      CREATE TABLE study_calendar_events (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, event_type TEXT NOT NULL DEFAULT 'session',
        starts_at TEXT NOT NULL, ends_at TEXT, all_day INTEGER NOT NULL DEFAULT 0,
        course_id TEXT REFERENCES study_courses(id) ON DELETE SET NULL, subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        topic_id TEXT REFERENCES study_topics(id) ON DELETE SET NULL, notes TEXT NOT NULL DEFAULT '', reminder_minutes INTEGER,
        completed INTEGER NOT NULL DEFAULT 0, archived_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_study_calendar_events_time ON study_calendar_events(starts_at, event_type);
      CREATE TABLE study_goals (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, period TEXT NOT NULL DEFAULT 'weekly',
        target_value REAL NOT NULL DEFAULT 1, current_value REAL NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT 'sesiones',
        starts_at TEXT NOT NULL, ends_at TEXT, subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        completed INTEGER NOT NULL DEFAULT 0, archived_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE study_study_sessions (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, plan_block_id TEXT REFERENCES study_plan_blocks(id) ON DELETE SET NULL,
        subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL, topic_id TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        mode TEXT NOT NULL DEFAULT 'focus', planned_minutes INTEGER NOT NULL DEFAULT 25, actual_seconds INTEGER NOT NULL DEFAULT 0,
        interruptions INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, ended_at TEXT, notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_study_sessions_time ON study_study_sessions(started_at, subject_id);
    `,
  },
  {
    version: 63,
    up: /* sql */ `
      -- Study vault phase 12: auditable per-task AI usage without invented pricing.
      CREATE TABLE study_ai_usage (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, task TEXT NOT NULL,
        provider TEXT NOT NULL, model TEXT NOT NULL, input_chars INTEGER NOT NULL DEFAULT 0,
        output_chars INTEGER NOT NULL DEFAULT 0, estimated_cost_usd REAL, status TEXT NOT NULL,
        fallback_used INTEGER NOT NULL DEFAULT 0, error TEXT, started_at TEXT NOT NULL, finished_at TEXT NOT NULL
      );
      CREATE INDEX idx_study_ai_usage_month ON study_ai_usage(started_at, task, status);
    `,
  },
  {
    version: 64,
    up: /* sql */ `
      -- Study organization browser: topics may live directly in a subject or
      -- inside one of that subject's folders.
      ALTER TABLE study_topics ADD COLUMN folder_id TEXT REFERENCES study_folders(id) ON DELETE SET NULL;
      CREATE INDEX idx_study_topics_folder ON study_topics(folder_id, parent_id, position);
    `,
  },
  {
    version: 65,
    up: /* sql */ `
      -- Rich visual metadata for the study organization browser. Images are
      -- stored as local data URLs so they remain part of the vault and work
      -- without an external file path.
      ALTER TABLE study_courses ADD COLUMN emoji TEXT;
      ALTER TABLE study_courses ADD COLUMN image_data TEXT;
      ALTER TABLE study_courses ADD COLUMN year INTEGER;
      ALTER TABLE study_subjects ADD COLUMN emoji TEXT;
      ALTER TABLE study_subjects ADD COLUMN image_data TEXT;
      ALTER TABLE study_subjects ADD COLUMN year INTEGER;
      ALTER TABLE study_topics ADD COLUMN emoji TEXT;
      ALTER TABLE study_topics ADD COLUMN image_data TEXT;
      ALTER TABLE study_topics ADD COLUMN year INTEGER;
      ALTER TABLE study_folders ADD COLUMN emoji TEXT;
      ALTER TABLE study_folders ADD COLUMN image_data TEXT;
      ALTER TABLE study_folders ADD COLUMN year INTEGER;
      ALTER TABLE study_docs ADD COLUMN emoji TEXT;
      ALTER TABLE study_docs ADD COLUMN image_data TEXT;
      ALTER TABLE study_docs ADD COLUMN year INTEGER;
    `,
  },
  {
    version: 66,
    up: /* sql */ `
      -- Semantic material index. The visual description is persisted separately so
      -- image analysis remains inspectable and can be re-embedded without another
      -- multimodal request when the embedding model changes.
      ALTER TABLE study_materials ADD COLUMN visual_description TEXT NOT NULL DEFAULT '';
      ALTER TABLE study_materials ADD COLUMN visual_analysis_status TEXT NOT NULL DEFAULT 'not_applicable';
      ALTER TABLE study_materials ADD COLUMN visual_analysis_provider TEXT;
      ALTER TABLE study_materials ADD COLUMN visual_analysis_model TEXT;
      ALTER TABLE study_materials ADD COLUMN embedding BLOB;
      ALTER TABLE study_materials ADD COLUMN embedding_provider TEXT;
      ALTER TABLE study_materials ADD COLUMN embedding_model TEXT;
      ALTER TABLE study_materials ADD COLUMN embedding_dim INTEGER;
      ALTER TABLE study_materials ADD COLUMN embedding_text_hash TEXT;
      ALTER TABLE study_materials ADD COLUMN index_status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE study_materials ADD COLUMN index_error TEXT;
      ALTER TABLE study_materials ADD COLUMN indexed_at TEXT;
      CREATE INDEX idx_study_materials_index_status ON study_materials(index_status, deleted_at, archived_at);
    `,
  },
  {
    version: 67,
    up: /* sql */ `
      -- Keep generated questions attached to the complete study hierarchy.
      ALTER TABLE study_questions ADD COLUMN folder_id TEXT REFERENCES study_folders(id) ON DELETE SET NULL;
      CREATE INDEX idx_study_questions_folder ON study_questions(folder_id, created_at DESC);
    `,
  },
  {
    version: 68,
    up: /* sql */ `
      -- Translation jobs become visible and recoverable as soon as they start.
      ALTER TABLE content_translations ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
      ALTER TABLE content_translations ADD COLUMN error TEXT;
      CREATE INDEX idx_content_translations_status ON content_translations(entity_kind, entity_id, status, updated_at DESC);
    `,
  },
  {
    version: 69,
    up: /* sql */ `
      -- Surface the learner's latest written answer and AI evaluation in the bank.
      ALTER TABLE study_questions ADD COLUMN last_response TEXT NOT NULL DEFAULT '';
      ALTER TABLE study_questions ADD COLUMN last_score REAL;
      ALTER TABLE study_questions ADD COLUMN last_max_score REAL;
      ALTER TABLE study_questions ADD COLUMN last_feedback TEXT NOT NULL DEFAULT '';
      ALTER TABLE study_questions ADD COLUMN last_answered_at TEXT;
    `,
  },
  {
    version: 70,
    up: /* sql */ `
      -- Editable weekly timetable for the study organization workspace.
      CREATE TABLE study_schedule_periods (
        id TEXT PRIMARY KEY,
        section TEXT NOT NULL CHECK(section IN ('morning', 'afternoon')),
        label TEXT NOT NULL DEFAULT '',
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE study_schedule_cells (
        day TEXT NOT NULL CHECK(day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday')),
        period_id TEXT NOT NULL REFERENCES study_schedule_periods(id) ON DELETE CASCADE,
        subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        PRIMARY KEY(day, period_id)
      );
      CREATE TABLE study_schedule_day_styles (
        day TEXT PRIMARY KEY CHECK(day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday')),
        color TEXT
      );
      CREATE INDEX idx_study_schedule_cells_subject ON study_schedule_cells(subject_id);
    `,
  },
  {
    version: 71,
    up: /* sql */ `
      -- Remove objective questions left unusable by the former permissive validator.
      -- They are soft-deleted so a backup can still recover the original row.
      UPDATE study_questions
      SET deleted_at = COALESCE(deleted_at, datetime('now')),
          updated_at = datetime('now')
      WHERE deleted_at IS NULL
        AND question_type IN ('single_choice', 'multiple_choice')
        AND (
          json_valid(options_json) = 0
          OR json_array_length(CASE WHEN json_valid(options_json) THEN options_json ELSE '[]' END) < 2
          OR EXISTS (
            SELECT 1 FROM json_each(CASE WHEN json_valid(options_json) THEN options_json ELSE '[]' END) AS option
            WHERE trim(COALESCE(json_extract(
              CASE WHEN json_valid(options_json) THEN options_json ELSE '[]' END,
              '$[' || option.key || '].text'
            ), '')) = ''
          )
          OR NOT EXISTS (
            SELECT 1 FROM json_each(CASE WHEN json_valid(options_json) THEN options_json ELSE '[]' END) AS option
            WHERE json_extract(
              CASE WHEN json_valid(options_json) THEN options_json ELSE '[]' END,
              '$[' || option.key || '].correct'
            ) = 1
          )
          OR (
            question_type = 'single_choice'
            AND (SELECT COUNT(*)
              FROM json_each(CASE WHEN json_valid(options_json) THEN options_json ELSE '[]' END) AS option
              WHERE json_extract(
                CASE WHEN json_valid(options_json) THEN options_json ELSE '[]' END,
                '$[' || option.key || '].correct'
              ) = 1
            ) <> 1
          )
        );
    `,
  },
  {
    version: 72,
    up: /* sql */ `
      -- Subject-scoped knowledge graph for study vaults. Sources remain polymorphic
      -- so imported materials and editable study notes use the same pipeline.
      CREATE TABLE study_ideas (
        id                  TEXT PRIMARY KEY,
        subject_id          TEXT NOT NULL REFERENCES study_subjects(id) ON DELETE CASCADE,
        type                TEXT NOT NULL,
        label               TEXT NOT NULL,
        normalized_label    TEXT NOT NULL,
        statement           TEXT NOT NULL,
        embedding           BLOB,
        embedding_provider  TEXT,
        embedding_model     TEXT,
        embedding_dim       INTEGER,
        embedding_text_hash TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        UNIQUE(subject_id, type, normalized_label)
      );
      CREATE INDEX idx_study_ideas_subject ON study_ideas(subject_id, updated_at DESC);

      CREATE TABLE study_idea_occurrences (
        id           TEXT PRIMARY KEY,
        idea_id      TEXT NOT NULL REFERENCES study_ideas(id) ON DELETE CASCADE,
        source_kind  TEXT NOT NULL CHECK(source_kind IN ('material', 'document')),
        source_id    TEXT NOT NULL,
        source_title TEXT NOT NULL DEFAULT '',
        source_hash  TEXT NOT NULL DEFAULT '',
        role         TEXT NOT NULL DEFAULT 'secondary',
        confidence   REAL NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        UNIQUE(idea_id, source_kind, source_id)
      );
      CREATE INDEX idx_study_idea_occ_source ON study_idea_occurrences(source_kind, source_id);
      CREATE INDEX idx_study_idea_occ_idea ON study_idea_occurrences(idea_id);

      CREATE TABLE study_idea_evidence (
        id            TEXT PRIMARY KEY,
        occurrence_id TEXT NOT NULL REFERENCES study_idea_occurrences(id) ON DELETE CASCADE,
        quote         TEXT NOT NULL,
        location      TEXT NOT NULL DEFAULT '',
        position      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_study_idea_evidence_occ ON study_idea_evidence(occurrence_id, position);

      CREATE TABLE study_idea_edges (
        id                 TEXT PRIMARY KEY,
        subject_id         TEXT NOT NULL REFERENCES study_subjects(id) ON DELETE CASCADE,
        from_id            TEXT NOT NULL REFERENCES study_ideas(id) ON DELETE CASCADE,
        to_id              TEXT NOT NULL REFERENCES study_ideas(id) ON DELETE CASCADE,
        type               TEXT NOT NULL,
        basis              TEXT NOT NULL DEFAULT '',
        confidence         REAL NOT NULL DEFAULT 0,
        source_kind        TEXT,
        source_id          TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        CHECK(from_id <> to_id),
        UNIQUE(subject_id, from_id, to_id, type)
      );
      CREATE INDEX idx_study_idea_edges_subject ON study_idea_edges(subject_id, confidence DESC);
      CREATE INDEX idx_study_idea_edges_from ON study_idea_edges(from_id);
      CREATE INDEX idx_study_idea_edges_to ON study_idea_edges(to_id);

      CREATE TABLE study_knowledge_jobs (
        subject_id    TEXT NOT NULL REFERENCES study_subjects(id) ON DELETE CASCADE,
        source_kind   TEXT NOT NULL CHECK(source_kind IN ('material', 'document')),
        source_id     TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        phase         TEXT NOT NULL DEFAULT 'pending',
        source_hash   TEXT NOT NULL DEFAULT '',
        model_provider TEXT,
        model_name    TEXT,
        error         TEXT,
        updated_at    TEXT NOT NULL,
        PRIMARY KEY(subject_id, source_kind, source_id)
      );
      CREATE INDEX idx_study_knowledge_jobs_status ON study_knowledge_jobs(status, updated_at);
    `,
  },
  {
    version: 73,
    up: /* sql */ `
      ALTER TABLE study_material_annotations ADD COLUMN kind TEXT NOT NULL DEFAULT 'highlight';
      ALTER TABLE study_material_annotations ADD COLUMN rects_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE study_material_annotations ADD COLUMN path_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE study_material_annotations ADD COLUMN thickness REAL NOT NULL DEFAULT 3;
    `,
  },
  {
    version: 74,
    up: /* sql */ `
      CREATE TABLE database_chat_conversations (
        id                TEXT PRIMARY KEY,
        title             TEXT NOT NULL,
        database_ids_json TEXT NOT NULL DEFAULT '[]',
        messages_json     TEXT NOT NULL DEFAULT '[]',
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE INDEX idx_database_chat_conversations_updated
        ON database_chat_conversations(updated_at DESC);
    `,
  },
  {
    version: 75,
    up: /* sql */ `
      -- Timetable cells may contain either a subject or an independent activity.
      ALTER TABLE study_schedule_cells ADD COLUMN activity_title TEXT;
    `,
  },
  {
    version: 76,
    up: /* sql */ `
      -- Full student calendar metadata and durable reminder delivery state.
      ALTER TABLE study_calendar_events ADD COLUMN icon TEXT NOT NULL DEFAULT 'calendar';
      ALTER TABLE study_calendar_events ADD COLUMN emoji TEXT NOT NULL DEFAULT '';
      ALTER TABLE study_calendar_events ADD COLUMN description TEXT NOT NULL DEFAULT '';
      ALTER TABLE study_calendar_events ADD COLUMN url TEXT NOT NULL DEFAULT '';
      ALTER TABLE study_calendar_events ADD COLUMN reminder_at TEXT;
      ALTER TABLE study_calendar_events ADD COLUMN notified_at TEXT;
      CREATE INDEX idx_study_calendar_events_reminder ON study_calendar_events(reminder_at, notified_at, deleted_at);
    `,
  },
  {
    version: 77,
    up: /* sql */ `
      -- Zotero-backed study materials can either copy an attachment into the
      -- vault or remain a lightweight link opened by the Zotero desktop app.
      ALTER TABLE study_materials ADD COLUMN origin TEXT NOT NULL DEFAULT 'file';
      ALTER TABLE study_materials ADD COLUMN zotero_library_type TEXT;
      ALTER TABLE study_materials ADD COLUMN zotero_library_id TEXT;
      ALTER TABLE study_materials ADD COLUMN zotero_item_key TEXT;
      ALTER TABLE study_materials ADD COLUMN zotero_attachment_key TEXT;
      CREATE INDEX idx_study_materials_zotero_source
        ON study_materials(zotero_library_type, zotero_library_id, zotero_item_key, zotero_attachment_key);
    `,
  },
  {
    version: 78,
    up: /* sql */ `
      -- Cover the bounded list queries used by the performance-sensitive
      -- academic views and current-model vector maintenance.
      CREATE INDEX idx_works_active_year_title
        ON works(archived, year DESC, title COLLATE NOCASE);
      CREATE INDEX idx_works_active_analysis_status
        ON works(archived, light_status, deep_status, summary_status);
      CREATE INDEX idx_ideas_current_embedding
        ON ideas(embedding_provider, embedding_model, orphaned_at)
        WHERE embedding IS NOT NULL;
      CREATE INDEX idx_idea_theme_links_work
        ON idea_theme_links(nodus_id, global_id, theme_id);
      CREATE INDEX idx_edges_type_endpoints
        ON edges(type, from_id, to_id);
      CREATE INDEX idx_gaps_kind_statement
        ON gaps(kind, statement);
    `,
  },
  {
    version: 79,
    up: /* sql */ `
      -- Optional country-issued identifier for archival disambiguation and search.
      ALTER TABLE persons ADD COLUMN national_id TEXT;
      CREATE INDEX idx_persons_national_id ON persons(national_id);
    `,
  },
  {
    version: 80,
    up: /* sql */ `
      -- A downscaled preview of an image attachment. The grid and the gallery render one
      -- thumb per visible row, and reading the original blob for that (a 5 GB photo
      -- catalogue is ~800 KB per file) moved hundreds of MB over IPC just to draw a 40px
      -- box. NULL for non-images and for attachments added before this column existed.
      ALTER TABLE db_attachments ADD COLUMN thumb BLOB;
    `,
  },
  {
    version: 81,
    up: /* sql */ `
      -- The academic year ("2024/2025") is the scope study vaults were missing: the
      -- same subject is taught again every September with new materials and a new
      -- timetable, and last year's has to stay readable rather than be overwritten.
      -- The date range is stored, not just the label, because it is what lets the
      -- app work out which year is the current one without a stored "current" flag
      -- that goes stale the September after somebody sets it.
      CREATE TABLE study_academic_years (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
        start_date TEXT NOT NULL, end_date TEXT NOT NULL, color TEXT,
        position INTEGER NOT NULL DEFAULT 0, archived_at TEXT, deleted_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_study_academic_years_label ON study_academic_years(label);

      -- Only courses and subjects carry the year. Topics, folders and documents reach
      -- it through the subject that owns them, so there is one place to change it and
      -- no way for a topic and its subject to claim different years. Both columns are
      -- nullable because the two real shapes disagree about where the year belongs: a
      -- school course *is* one year (set it there, subjects inherit), while a degree
      -- spans several (leave the course open, set it per subject).
      ALTER TABLE study_courses ADD COLUMN academic_year_id TEXT REFERENCES study_academic_years(id) ON DELETE SET NULL;
      ALTER TABLE study_subjects ADD COLUMN academic_year_id TEXT REFERENCES study_academic_years(id) ON DELETE SET NULL;
      CREATE INDEX idx_study_courses_academic_year ON study_courses(academic_year_id, position);
      CREATE INDEX idx_study_subjects_academic_year ON study_subjects(academic_year_id, course_id, position);

      -- The weekly timetable stops being a vault-wide singleton and becomes one grid
      -- per academic year. Cells reach their year through their period, so only
      -- periods carry the column. Existing rows keep NULL and stay reachable as the
      -- "no academic year" timetable rather than being adopted into a year the user
      -- never chose.
      ALTER TABLE study_schedule_periods ADD COLUMN academic_year_id TEXT REFERENCES study_academic_years(id) ON DELETE CASCADE;
      CREATE INDEX idx_study_schedule_periods_year ON study_schedule_periods(academic_year_id, section, position);

      -- Day colours were keyed by day alone, which cannot hold one palette per year.
      -- SQLite cannot widen a primary key in place, so the table is rebuilt. The
      -- unique index goes through COALESCE because NULLs are distinct in a SQLite
      -- index, and a bare (academic_year_id, day) index would let the unscoped
      -- timetable accumulate two colours for the same Monday.
      CREATE TABLE study_schedule_day_styles_v81 (
        day TEXT NOT NULL CHECK(day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday')),
        academic_year_id TEXT REFERENCES study_academic_years(id) ON DELETE CASCADE,
        color TEXT
      );
      INSERT INTO study_schedule_day_styles_v81 (day, academic_year_id, color)
        SELECT day, NULL, color FROM study_schedule_day_styles;
      DROP TABLE study_schedule_day_styles;
      ALTER TABLE study_schedule_day_styles_v81 RENAME TO study_schedule_day_styles;
      CREATE UNIQUE INDEX idx_study_schedule_day_styles_key
        ON study_schedule_day_styles(COALESCE(academic_year_id, ''), day);
    `,
  },
  {
    version: 82,
    up: /* sql */ `
      -- Exam paper builder (teaching vault). This is deliberately NOT study_assessments:
      -- that models an interactive test taken on screen and assembled from the shared
      -- question bank, whose 0.78 similarity dedup would silently drop freshly generated
      -- items. An exam paper is a printed document, so its questions are owned by the
      -- exam (cascade delete), carry layout intent (answer lines, option/pair shape, an
      -- embedded image) and never pollute the bank.
      CREATE TABLE teaching_exams (
        id TEXT PRIMARY KEY,
        short_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        course_id TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        language TEXT NOT NULL DEFAULT 'es',
        target_question_count INTEGER NOT NULL DEFAULT 10,
        -- Header fields and logos are a single JSON blob each: they are read and written
        -- as a whole by the builder and never queried by column.
        header_json TEXT NOT NULL DEFAULT '{}',
        logos_json TEXT NOT NULL DEFAULT '[]',
        position INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_teaching_exams_subject ON teaching_exams(subject_id, updated_at DESC);

      CREATE TABLE teaching_exam_questions (
        id TEXT PRIMARY KEY,
        short_id TEXT NOT NULL UNIQUE,
        exam_id TEXT NOT NULL REFERENCES teaching_exams(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        points REAL NOT NULL DEFAULT 1,
        options_json TEXT NOT NULL DEFAULT '[]',
        pairs_json TEXT NOT NULL DEFAULT '[]',
        items_json TEXT NOT NULL DEFAULT '[]',
        image_data_url TEXT,
        image_caption TEXT NOT NULL DEFAULT '',
        answer_lines INTEGER,
        solution TEXT NOT NULL DEFAULT '',
        ai_prompt TEXT NOT NULL DEFAULT '',
        generated_by TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_teaching_exam_questions_exam ON teaching_exam_questions(exam_id, position);
    `,
  },
  {
    version: 83,
    up: /* sql */ `
      -- Rubrics (teaching vault). Levels and criteria are stored as JSON rather than
      -- child tables: a rubric is always read, edited and exported as one whole grid,
      -- never queried by cell, and keeping it in one row makes the history list a plain
      -- SELECT and versioning trivial.
      CREATE TABLE teaching_rubrics (
        id TEXT PRIMARY KEY,
        short_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        course_id TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        language TEXT NOT NULL DEFAULT 'es',
        scale_max REAL NOT NULL DEFAULT 5,
        weighted INTEGER NOT NULL DEFAULT 0,
        levels_json TEXT NOT NULL DEFAULT '[]',
        criteria_json TEXT NOT NULL DEFAULT '[]',
        position INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_teaching_rubrics_subject ON teaching_rubrics(subject_id, updated_at DESC);
    `,
  },
  {
    version: 84,
    up: /* sql */ `
      -- A reusable logo library: a teacher stamps the same crest on every exam, so the
      -- image is stored once here and copied into each exam that uses it (the exam stays
      -- self-contained, and deleting a library entry never blanks an existing paper).
      CREATE TABLE teaching_logos (
        id TEXT PRIMARY KEY,
        short_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        data_url TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Until the teacher picks a language for THIS exam, the document follows the
      -- interface language; once they choose, that choice is remembered per exam.
      ALTER TABLE teaching_exams ADD COLUMN language_locked INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 85,
    up: /* sql */ `
      -- Section statements: a shared text/case/image (type = 'section') that several
      -- sub-questions hang from. The sub-questions point at it through parent_id, so a
      -- standalone question can still follow a section — which a flat "everything after
      -- this header belongs to it" marker could never express.
      --
      -- ON DELETE CASCADE: removing the statement removes the questions that only made
      -- sense underneath it. The builder warns before doing so.
      ALTER TABLE teaching_exam_questions
        ADD COLUMN parent_id TEXT REFERENCES teaching_exam_questions(id) ON DELETE CASCADE;
      CREATE INDEX idx_teaching_exam_questions_parent ON teaching_exam_questions(parent_id, position);
    `,
  },
  {
    version: 86,
    up: /* sql */ `
      -- Student groups (teaching vault): the class list a teacher keeps per subject.
      --
      -- A group hangs off a SUBJECT, not a course, because the per-student comment is
      -- inherently subject-scoped — what you note about a student in History is not what
      -- you note in Geography. Modelling groups as shared rosters (group ⇄ subject
      -- many-to-many) would force splitting identity from annotation into two tables to
      -- save nothing but retyping, which the "import from another group" action below
      -- solves far more cheaply.
      --
      -- academic_year_id is carried HERE rather than inherited from the subject: a group
      -- belongs to one academic year the same way a course does, and that is exactly what
      -- makes a new year start from an empty list instead of dragging last year's
      -- students along. It is SET NULL rather than CASCADE so deleting a year archives
      -- the scoping, never the roster.
      CREATE TABLE teaching_groups (
        id TEXT PRIMARY KEY,
        short_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        subject_id TEXT NOT NULL REFERENCES study_subjects(id) ON DELETE CASCADE,
        academic_year_id TEXT REFERENCES study_academic_years(id) ON DELETE SET NULL,
        -- The "total number of students" the teacher declares up front; used once to
        -- pre-create that many blank rows. A starting point, never a limit.
        expected_size INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_teaching_groups_subject ON teaching_groups(subject_id, academic_year_id);

      -- pseudonym_code is a STORED column, not derived from the name: it has to survive
      -- a rename, and deriving it from the name (initials, a hash) would defeat the
      -- point of showing it to an AI instead of the name. See shared/studentPseudonyms.ts.
      CREATE TABLE teaching_students (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES teaching_groups(id) ON DELETE CASCADE,
        given_names TEXT NOT NULL DEFAULT '',
        surnames TEXT NOT NULL DEFAULT '',
        comments TEXT NOT NULL DEFAULT '',
        pseudonym_code TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_teaching_students_code ON teaching_students(group_id, pseudonym_code);
      CREATE INDEX idx_teaching_students_group ON teaching_students(group_id, position);
    `,
  },
  {
    version: 87,
    up: /* sql */ `
      -- Gradebook (teaching vault).
      --
      -- The plan IS the programación didáctica / guía docente, and it is versioned on
      -- purpose: no state norm prescribes how a grade is computed, so what actually
      -- binds a teacher — and what a grade challenge is resolved against — is the
      -- document they published. Once published_at is set the plan is frozen and an
      -- edit produces a new version, so a mark can always be recomputed against the
      -- rules that were in force when it was given.
      --
      -- rules_json holds the whole PlanRules object (scale, rounding, thresholds,
      -- not-presented policy, honours quota, advisories). It is stored as one blob
      -- rather than as columns because it is always read and written whole, and
      -- because every institution needs a different subset of it.
      CREATE TABLE teaching_assessment_plans (
        id TEXT PRIMARY KEY,
        short_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        subject_id TEXT NOT NULL REFERENCES study_subjects(id) ON DELETE CASCADE,
        academic_year_id TEXT REFERENCES study_academic_years(id) ON DELETE SET NULL,
        profile TEXT NOT NULL DEFAULT 'libre',
        rules_json TEXT NOT NULL DEFAULT '{}',
        published_at TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        parent_version_id TEXT REFERENCES teaching_assessment_plans(id) ON DELETE SET NULL,
        archived_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_teaching_plans_subject ON teaching_assessment_plans(subject_id, academic_year_id);

      -- The evaluation tree. weight and weight_alt are the two columns of a guía
      -- docente's evaluation table (continuous vs non-continuous assessment) over the
      -- SAME tree — not two trees, which is how the document itself is laid out.
      --
      -- The source_* columns keep provenance: a column generated from an exam question
      -- can be traced back to it, and competency_code/criterion_code carry the LOMLOE
      -- traceability that a regional inspection asks for.
      CREATE TABLE teaching_assessment_items (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES teaching_assessment_plans(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES teaching_assessment_items(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'activity',
        position INTEGER NOT NULL DEFAULT 0,
        weight REAL NOT NULL DEFAULT 1,
        weight_alt REAL NOT NULL DEFAULT 1,
        aggregation TEXT NOT NULL DEFAULT 'weighted',
        entry_mode TEXT NOT NULL DEFAULT 'numeric',
        max_points REAL NOT NULL DEFAULT 10,
        min_to_average REAL,
        is_mandatory INTEGER NOT NULL DEFAULT 0,
        is_recoverable INTEGER NOT NULL DEFAULT 1,
        target REAL,
        best_of INTEGER,
        conditional_min REAL,
        source_exam_id TEXT REFERENCES teaching_exams(id) ON DELETE SET NULL,
        source_exam_question_id TEXT REFERENCES teaching_exam_questions(id) ON DELETE SET NULL,
        source_rubric_id TEXT REFERENCES teaching_rubrics(id) ON DELETE SET NULL,
        competency_code TEXT,
        criterion_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_teaching_items_plan ON teaching_assessment_items(plan_id, parent_id, position);

      -- THE ATOM. status is orthogonal to raw_value, which is the whole reason a blank
      -- cell need not mean zero: "sin evaluar" renormalises the weights, "no entregado"
      -- may score zero, and "exento" never counts either way.
      --
      -- convocatoria is part of the key rather than a separate table so an ordinary and
      -- an extraordinary mark for the same item coexist and can be compared.
      CREATE TABLE teaching_grade_entries (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES teaching_students(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES teaching_assessment_items(id) ON DELETE CASCADE,
        convocatoria TEXT NOT NULL DEFAULT 'ordinaria',
        raw_value REAL,
        status TEXT NOT NULL DEFAULT 'not_assessed',
        is_override INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_teaching_entries_key
        ON teaching_grade_entries(student_id, item_id, convocatoria);
      CREATE INDEX idx_teaching_entries_item ON teaching_grade_entries(item_id, convocatoria);

      -- Per-student rubric marks. Rubrics themselves store their grid as JSON because
      -- they are edited whole, but an EVALUATION is queried per criterion, so it gets
      -- real rows.
      CREATE TABLE teaching_rubric_evaluations (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES teaching_grade_entries(id) ON DELETE CASCADE,
        criterion_id TEXT NOT NULL,
        level_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_teaching_rubric_eval_key
        ON teaching_rubric_evaluations(entry_id, criterion_id);
    `,
  },
  {
    version: 88,
    up: /* sql */ `
      -- Every version a sync merge discarded, so "newest wins" stops destroying.
      --
      -- Merging two machines resolves conflicts by comparing wall-clock timestamps. That
      -- is fine until a clock is wrong, and it silently overwrote whatever lost. The
      -- losing version is now kept here instead: a wrong resolution becomes a decision
      -- the user can review and undo, not lost work.
      --
      -- Purely additive: nothing reads or writes it except the merge and its own view,
      -- so an older build simply ignores it.
      CREATE TABLE sync_superseded (
        id           TEXT PRIMARY KEY,
        table_name   TEXT NOT NULL,
        -- JSON array of the identity values, in the order the merge resolved them.
        row_key      TEXT NOT NULL,
        -- 'incoming-lost'     the arriving version lost and was not applied
        -- 'local-overwritten' the arriving version won and replaced local work
        -- 'restored'          a superseded version was promoted back, replacing this one
        origin       TEXT NOT NULL,
        -- The row as JSON. BLOB columns are replaced by a {__nodusOmittedBlob} marker:
        -- duplicating attachments and recordings would multiply the database size.
        row_json     TEXT NOT NULL,
        row_stamp    TEXT,
        winner_stamp TEXT,
        package_date TEXT,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_sync_superseded_created ON sync_superseded(created_at DESC);
      CREATE INDEX idx_sync_superseded_row ON sync_superseded(table_name, row_key);
    `,
  },
  {
    version: 89,
    up: /* sql */ `
      -- Deletions, so they stop coming back.
      --
      -- A sync package carries rows, not their absence. Deleting a note on one machine
      -- and importing any package built before the other heard about it re-inserted the
      -- note with its original timestamps — and did so again on every future sync, in
      -- both directions. There was no way to delete anything permanently across two
      -- computers.
      --
      -- A tombstone is the record that a row was deleted, and when. It is written by
      -- triggers generated from the synced-table registry (see db/tombstones.ts), so a
      -- table added by a later migration is covered by the same mechanism that already
      -- forces it to be classified.
      CREATE TABLE sync_tombstones (
        table_name TEXT NOT NULL,
        -- json_array() of the identity values, byte-identical to the JSON.stringify the
        -- merge produces, so SQL-written and JS-written keys compare equal.
        row_key    TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        PRIMARY KEY (table_name, row_key)
      );
      CREATE INDEX idx_sync_tombstones_deleted ON sync_tombstones(deleted_at);
    `,
  },
  {
    version: 90,
    up: /* sql */ `
      -- Nodus Protect output library. The final, already-rasterised artifact is
      -- kept as a vault BLOB so it follows full backups and portable sync. A
      -- soft-delete marker prevents an older .nodussync package from
      -- resurrecting a copy the user removed on another machine.
      CREATE TABLE protect_copies (
        id           TEXT PRIMARY KEY,
        file_name    TEXT NOT NULL,
        mime_type    TEXT NOT NULL,
        bytes        INTEGER NOT NULL DEFAULT 0,
        sha256       TEXT NOT NULL,
        blob         BLOB,
        source_kind  TEXT,
        source_label TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        deleted_at   TEXT
      );
      CREATE INDEX idx_protect_copies_updated ON protect_copies(deleted_at, updated_at DESC);
      CREATE INDEX idx_protect_copies_sha256 ON protect_copies(sha256);
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
