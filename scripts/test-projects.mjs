import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-projects-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-projects.mjs'), '--electron-projects-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-projects-test-'));
try {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(root, 'projects.sqlite'));
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE research_questions (id TEXT PRIMARY KEY);
    CREATE TABLE note_folders (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      order_idx INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES note_folders(id) ON DELETE CASCADE
    );
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      folder_id TEXT,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'markdown',
      content TEXT NOT NULL DEFAULT '',
      source_json TEXT,
      order_idx INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (folder_id) REFERENCES note_folders(id) ON DELETE CASCADE
    );
  `);
  db.exec(await migration19Sql());

  for (const table of [
    'projects',
    'project_sections',
    'project_links',
    'project_chapters',
    'project_chapter_chunks',
    'project_insertion_suggestions',
    'project_chapter_versions',
  ]) {
    assert.equal(tableExists(db, table), true, `${table} should exist`);
  }
  assert.equal(indexExists(db, 'idx_project_suggestions_chapter'), true);

  const now = new Date().toISOString();
  db.prepare('INSERT INTO note_folders (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('folder-root', 'Proyecto - Test', now, now);
  db.prepare('INSERT INTO note_folders (id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('folder-manuscript', 'folder-root', '06 - Manuscrito', now, now);
  db.prepare('INSERT INTO notes (id, folder_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('note-chapter', 'folder-manuscript', 'Capitulo 1', '# Capitulo 1', now, now);
  db.prepare(
    `INSERT INTO projects (id, title, kind, status, brief, root_folder_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('project-1', 'Proyecto de prueba', 'thesis', 'active', 'Brief', 'folder-root', now, now);
  db.prepare(
    `INSERT INTO project_sections (id, project_id, folder_id, title, role, status, order_idx, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('section-1', 'project-1', 'folder-manuscript', '06 - Manuscrito', 'manuscript', 'in_progress', 0, now, now);
  db.prepare(
    `INSERT INTO project_links (id, project_id, section_id, kind, ref_id, label, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('link-1', 'project-1', 'section-1', 'idea', 'idea-1', 'Idea verificable', 'evidence', now);
  db.prepare(
    `INSERT INTO project_chapters (
      id, project_id, section_id, note_id, title, source_format, original_text_hash,
      original_text, current_markdown, word_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-1', 'project-1', 'section-1', 'note-chapter', 'Capitulo 1', 'markdown', 'hash', 'Texto', '# Capitulo 1\n\nTexto', 3, now, now);
  db.prepare(
    `INSERT INTO project_chapter_chunks (id, chapter_id, order_idx, heading_path, text, start_offset, end_offset, word_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chunk-1', 'chapter-1', 0, 'Capitulo 1', 'Texto base del capitulo', 14, 37, 4, now);
  db.prepare(
    `INSERT INTO project_insertion_suggestions (
      id, project_id, chapter_id, target_chunk_id, kind, ref_id, ref_label, operation,
      proposed_text, citation_json, rationale, confidence, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'suggestion-1',
    'project-1',
    'chapter-1',
    'chunk-1',
    'idea',
    'idea-1',
    'Idea verificable',
    'insert_after',
    'Texto propuesto [Autor, 2024](nodus://idea/idea-1).',
    JSON.stringify([{ kind: 'idea', id: 'idea-1' }]),
    'Encaja con el parrafo.',
    0.8,
    'suggested',
    now,
    now
  );
  db.prepare('INSERT INTO project_chapter_versions (id, chapter_id, label, markdown, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('version-1', 'chapter-1', 'Antes de aplicar sugerencias', '# Capitulo 1', now);

  assert.equal(count(db, 'projects'), 1);
  assert.equal(count(db, 'project_chapters'), 1);
  assert.equal(count(db, 'project_insertion_suggestions'), 1);
  assert.equal(count(db, 'project_chapter_versions'), 1);

  db.prepare('DELETE FROM projects WHERE id = ?').run('project-1');
  assert.equal(count(db, 'projects'), 0);
  assert.equal(count(db, 'project_sections'), 0);
  assert.equal(count(db, 'project_chapters'), 0);
  assert.equal(count(db, 'project_insertion_suggestions'), 0);
  assert.equal(count(db, 'project_chapter_versions'), 0);
  assert.equal(count(db, 'notes'), 1, 'deleting a project must not delete manuscript notes');

  db.prepare('DELETE FROM note_folders WHERE id = ?').run('folder-root');
  assert.equal(count(db, 'notes'), 0, 'deleting the notes folder keeps existing cascade behavior');
  db.close();
  console.log('projects migration and relation test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

async function migration19Sql() {
  const source = await readFile(path.join(repoRoot, 'electron/db/migrations.ts'), 'utf8');
  const match = source.match(/version:\s*19,\s*up:\s*\/\*\s*sql\s*\*\/\s*`([\s\S]*?)`\s*,\s*}\s*,?\s*];/);
  assert.ok(match?.[1], 'Could not find migration 19 SQL');
  return match[1];
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function indexExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(name));
}

function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}
