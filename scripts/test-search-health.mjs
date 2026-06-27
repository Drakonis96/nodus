// Validates the SQL behind the corpus-health dashboard, saved searches and
// semantic ranking. Runs under Electron-as-Node so the better-sqlite3 native
// module matches the app ABI (same pattern as test-projects.mjs). The queries
// here mirror the ones in electron/db/corpusHealthRepo.ts,
// electron/db/savedSearchesRepo.ts and the vec_cosine ranking used by
// ideasRepo/passagesRepo, so a regression in that SQL fails the suite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-search-health-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-search-health.mjs'), '--electron-search-health-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

// Same Float32 cosine as electron/db/database.ts (registered as vec_cosine).
function vecCosine(a, b) {
  if (!a || !b) return 0;
  const fa = new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4);
  const fb = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(fa.length, fb.length);
  for (let i = 0; i < n; i++) {
    dot += fa[i] * fb[i];
    na += fa[i] * fa[i];
    nb += fb[i] * fb[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function encode(vec) {
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-search-health-test-'));
try {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(root, 'health.sqlite'));
  db.pragma('foreign_keys = ON');
  db.function('vec_cosine', vecCosine);

  // ── Migration 20: saved_searches table comes straight from migrations.ts ────
  db.exec(await migration20Sql());
  assert.equal(tableExists(db, 'saved_searches'), true, 'saved_searches table should exist');
  assert.equal(indexExists(db, 'idx_saved_searches_created'), true);

  // ── Schema used by corpus health + semantic ranking ─────────────────────────
  db.exec(`
    CREATE TABLE works (
      nodus_id       TEXT PRIMARY KEY,
      zotero_key     TEXT,
      title          TEXT,
      authors_json   TEXT,
      year           INTEGER,
      doi            TEXT,
      read_tag       INTEGER DEFAULT 0,
      manual_deep    INTEGER DEFAULT 0,
      source_type    TEXT,
      light_status   TEXT DEFAULT 'none',
      deep_status    TEXT DEFAULT 'none',
      deep_hash      TEXT,
      summary_status TEXT DEFAULT 'none',
      archived       INTEGER DEFAULT 0
    );
    CREATE TABLE ideas (
      global_id          TEXT PRIMARY KEY,
      type               TEXT,
      label              TEXT,
      statement          TEXT,
      embedding          BLOB,
      embedding_provider TEXT,
      embedding_model    TEXT,
      embedding_dim      INTEGER
    );
    CREATE TABLE idea_occurrences (
      global_id TEXT,
      nodus_id  TEXT,
      PRIMARY KEY (global_id, nodus_id)
    );
    CREATE TABLE passages (
      passage_id         TEXT PRIMARY KEY,
      nodus_id           TEXT,
      text               TEXT,
      page_label         TEXT,
      content_hash       TEXT,
      embedding          BLOB,
      embedding_provider TEXT,
      embedding_model    TEXT,
      embedding_dim      INTEGER
    );
  `);

  const work = db.prepare(
    `INSERT INTO works (nodus_id, title, year, doi, read_tag, manual_deep, source_type, light_status, deep_status, deep_hash, summary_status, archived)
     VALUES (@nodus_id, @title, @year, @doi, @read_tag, @manual_deep, @source_type, @light_status, @deep_status, @deep_hash, @summary_status, @archived)`
  );
  const base = { year: 2020, doi: null, read_tag: 0, manual_deep: 0, deep_hash: null, archived: 0 };
  // w1: fully analysed and indexed — not in any bucket.
  work.run({ ...base, nodus_id: 'w1', title: 'Healthy', source_type: 'pdf', light_status: 'done', deep_status: 'done', summary_status: 'done' });
  // w2: light only (themes done, deep not done, has text).
  work.run({ ...base, nodus_id: 'w2', title: 'Light only', source_type: 'pdf', light_status: 'done', deep_status: 'none', summary_status: 'done' });
  // w3: abstract-only, extraction skipped (no text + recoverable via DOI).
  work.run({ ...base, nodus_id: 'w3', title: 'No text', source_type: 'abstract_only', light_status: 'done', deep_status: 'skipped_no_text', summary_status: 'skipped_no_text', doi: '10.1/x' });
  // w4: flagged read but never deep-analysed (priority + light only).
  work.run({ ...base, nodus_id: 'w4', title: 'Priority', source_type: 'pdf', light_status: 'done', deep_status: 'none', summary_status: 'done', read_tag: 1 });
  // w5: no source but has a DOI (no text + recoverable).
  work.run({ ...base, nodus_id: 'w5', title: 'Fetchable', source_type: 'none', light_status: 'none', deep_status: 'none', summary_status: 'none', doi: '10.2/y' });
  // w6: archived — must be invisible to every bucket.
  work.run({ ...base, nodus_id: 'w6', title: 'Archived', source_type: 'abstract_only', light_status: 'done', deep_status: 'none', summary_status: 'none', archived: 1 });

  const countWhere = (where) => db.prepare(`SELECT COUNT(*) AS n FROM works WHERE ${where}`).get().n;

  const WITHOUT_TEXT = `archived = 0 AND (deep_status = 'skipped_no_text' OR summary_status = 'skipped_no_text' OR source_type IN ('none', 'abstract_only'))`;
  const LIGHT_ONLY = `archived = 0 AND light_status = 'done' AND deep_status NOT IN ('done', 'skipped_no_text')`;
  const DEEP_PRIORITY = `archived = 0 AND (read_tag = 1 OR manual_deep = 1) AND deep_status NOT IN ('done', 'skipped_no_text')`;
  const PDFS_TO_RECOVER = `archived = 0 AND (deep_status = 'skipped_no_text' OR (source_type IN ('none', 'abstract_only') AND doi IS NOT NULL AND doi <> ''))`;

  assert.equal(countWhere(WITHOUT_TEXT), 2, 'withoutText: w3 + w5');
  assert.equal(countWhere(LIGHT_ONLY), 2, 'lightOnly: w2 + w4');
  assert.equal(countWhere(DEEP_PRIORITY), 1, 'deepPriority: w4');
  assert.equal(countWhere(PDFS_TO_RECOVER), 2, 'pdfsToRecover: w3 + w5');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM works WHERE archived = 0').get().n, 5, 'archived work excluded');

  // ── Embedding backlog aggregate (provider/model aware) ──────────────────────
  const idea = db.prepare(
    'INSERT INTO ideas (global_id, type, label, statement, embedding, embedding_provider, embedding_model, embedding_dim) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  idea.run('i1', 'claim', 'Idea uno', 'Enunciado uno', encode([1, 0, 0]), 'openai', 'm', 3);
  idea.run('i2', 'claim', 'Idea dos', 'Enunciado dos', null, null, null, null);
  idea.run('i3', 'claim', 'Idea tres', 'Enunciado tres', encode([0, 1, 0]), 'gemini', 'other', 3); // wrong model
  db.prepare('INSERT INTO idea_occurrences (global_id, nodus_id) VALUES (?, ?)').run('i1', 'w1');
  db.prepare('INSERT INTO idea_occurrences (global_id, nodus_id) VALUES (?, ?)').run('i2', 'w1');
  db.prepare('INSERT INTO idea_occurrences (global_id, nodus_id) VALUES (?, ?)').run('i3', 'w2');

  const ideaRows = db
    .prepare(
      `SELECT io.nodus_id AS nodus_id,
              COUNT(DISTINCT i.global_id) AS total,
              COUNT(DISTINCT CASE WHEN i.embedding IS NOT NULL AND i.embedding_provider = ? AND i.embedding_model = ? THEN i.global_id END) AS embedded
         FROM idea_occurrences io
         JOIN ideas i ON i.global_id = io.global_id
         JOIN works w ON w.nodus_id = io.nodus_id AND w.archived = 0
        GROUP BY io.nodus_id`
    )
    .all('openai', 'm');
  let totalIdeas = 0;
  let embeddedIdeas = 0;
  let incompleteWorks = 0;
  for (const r of ideaRows) {
    totalIdeas += r.total;
    embeddedIdeas += r.embedded;
    if (r.embedded < r.total) incompleteWorks += 1;
  }
  assert.equal(totalIdeas, 3, 'three ideas occur in non-archived works');
  assert.equal(embeddedIdeas, 1, 'only i1 matches the current provider/model');
  assert.equal(incompleteWorks, 2, 'both w1 and w2 have an unembedded idea');

  // ── Semantic ranking via vec_cosine ─────────────────────────────────────────
  idea.run('s1', 'claim', 'Vecino exacto', 'parecido', encode([1, 0, 0]), 'openai', 'm', 3);
  idea.run('s2', 'claim', 'Ortogonal', 'distinto', encode([0, 1, 0]), 'openai', 'm', 3);
  idea.run('s3', 'claim', 'Casi paralelo', 'cercano', encode([0.9, 0.1, 0]), 'openai', 'm', 3);
  const queryVec = encode([1, 0, 0]);
  const ranked = db
    .prepare(
      `SELECT * FROM (
         SELECT global_id, vec_cosine(embedding, ?) AS similarity
           FROM ideas
          WHERE embedding IS NOT NULL AND embedding_provider = ? AND embedding_model = ? AND embedding_dim = ?
            AND global_id IN ('s1','s2','s3')
       ) WHERE similarity >= ? ORDER BY similarity DESC LIMIT 10`
    )
    .all(queryVec, 'openai', 'm', 3, 0.2);
  assert.deepEqual(ranked.map((r) => r.global_id), ['s1', 's3'], 'orthogonal idea filtered out; exact then near');
  assert.ok(ranked[0].similarity > 0.99, 'exact match ~1.0');

  // Passage ranking joins works and respects archived.
  const pass = db.prepare(
    'INSERT INTO passages (passage_id, nodus_id, text, page_label, content_hash, embedding, embedding_provider, embedding_model, embedding_dim) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  pass.run('w1#0', 'w1', 'Pasaje relevante', '12', 'h', encode([1, 0, 0]), 'openai', 'm', 3);
  pass.run('w6#0', 'w6', 'Pasaje de obra archivada', '3', 'h', encode([1, 0, 0]), 'openai', 'm', 3);
  const passHits = db
    .prepare(
      `SELECT p.passage_id, vec_cosine(p.embedding, ?) AS similarity
         FROM passages p JOIN works w ON w.nodus_id = p.nodus_id
        WHERE p.embedding IS NOT NULL AND w.archived = 0
          AND p.embedding_provider = ? AND p.embedding_model = ? AND p.embedding_dim = ?
        ORDER BY similarity DESC`
    )
    .all(queryVec, 'openai', 'm', 3);
  assert.deepEqual(passHits.map((p) => p.passage_id), ['w1#0'], 'archived work passage excluded');

  // ── Saved searches CRUD ─────────────────────────────────────────────────────
  const now = new Date().toISOString();
  db.prepare('INSERT INTO saved_searches (id, name, query, mode, kinds_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('ss1', 'Memoria', 'memoria de trabajo', 'semantic', JSON.stringify(['idea', 'passage']), now);
  const saved = db.prepare('SELECT * FROM saved_searches ORDER BY created_at DESC').all();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].mode, 'semantic');
  assert.deepEqual(JSON.parse(saved[0].kinds_json), ['idea', 'passage']);
  db.prepare('DELETE FROM saved_searches WHERE id = ?').run('ss1');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM saved_searches').get().n, 0);

  db.close();
  console.log('search + corpus-health SQL test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

async function migration20Sql() {
  const source = await readFile(path.join(repoRoot, 'electron/db/migrations.ts'), 'utf8');
  const match = source.match(/version:\s*20,\s*up:\s*\/\*\s*sql\s*\*\/\s*`([\s\S]*?)`\s*,\s*}\s*(?:,|];)/);
  assert.ok(match?.[1], 'Could not find migration 20 SQL');
  return match[1];
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function indexExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(name));
}
