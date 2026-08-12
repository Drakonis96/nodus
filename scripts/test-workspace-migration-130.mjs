// Verifies migration 130 — the one that unifies Notas, Escritura y Proyectos into the
// Workspace. It builds a database at schema v129, fills it with REPRESENTATIVE LEGACY
// DATA (a healthy project, a broken one whose root folder was deleted, a chapter whose
// note was deleted, a saved Escritura document, a Deep Research report, a hand-written
// note and a manual idea) and then migrates.
//
// What it is really asserting is the promise made to someone updating from an older
// version: NOTHING they wrote disappears, nothing becomes unreachable, and running the
// migration twice does not duplicate or corrupt a single row.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-migration-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-workspace-migration-130.mjs'), '--electron-migration-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-workspace-migration-'));
installTsHook();

try {
  const Database = require('better-sqlite3');
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const { migrateWorkspaceContent } = require(path.join(repoRoot, 'electron/db/workspaceMigration.ts'));
  assert.ok(SCHEMA_VERSION >= 130, 'this test requires schema v130 or later');

  const db = new Database(path.join(root, 'v129.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  for (const m of migrations.filter((x) => x.version <= 129).sort((a, b) => a.version - b.version)) {
    db.exec(m.up);
    m.after?.(db);
    db.pragma(`user_version = ${m.version}`);
  }
  assert.equal(db.pragma('user_version', { simple: true }), 129, 'DB is at v129');
  assert.equal(hasColumn(db, 'notes', 'style_json'), false, 'editor columns absent before migration');
  assert.equal(hasTable(db, 'workspace_library_links'), false, 'library links absent before migration');

  const now = '2026-01-05T10:00:00.000Z';
  const insertFolder = db.prepare(
    `INSERT INTO note_folders (id, parent_id, name, summary, order_idx, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?, ?)`
  );
  const insertNote = db.prepare(
    `INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertProject = db.prepare(
    `INSERT INTO projects (id, title, kind, status, brief, root_folder_id, created_at, updated_at)
     VALUES (?, ?, 'other', 'active', ?, ?, ?, ?)`
  );
  const insertSection = db.prepare(
    `INSERT INTO project_sections (id, project_id, folder_id, title, role, status, order_idx, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'custom', 'empty', ?, ?, ?)`
  );
  const insertChapter = db.prepare(
    `INSERT INTO project_chapters (id, project_id, section_id, note_id, title, source_format,
       original_text_hash, original_text, current_markdown, word_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'docx', 'hash', ?, ?, ?, ?, ?)`
  );
  const insertDraft = db.prepare(
    `INSERT INTO writing_saved_drafts (id, title, brief_json, selection_json, draft_json, created_at, updated_at)
     VALUES (?, ?, ?, '{}', ?, ?, ?)`
  );

  // ── Legacy shape 1: a healthy project, exactly as the app creates one ──
  insertFolder.run('f_root_a', null, 'Proyecto - Tesis', 0, now, now);
  insertFolder.run('f_sec_a', 'f_root_a', 'Manuscrito', 0, now, now);
  insertProject.run('p_a', 'Tesis', 'Sobre el archivo', 'f_root_a', now, now);
  insertSection.run('s_a', 'p_a', 'f_sec_a', 'Manuscrito', 0, now, now);
  insertNote.run('n_ch_a', 'f_sec_a', 'Capítulo 1', 'markdown', '# Capítulo 1\n\nTexto original.', null, 0, now, now);
  insertChapter.run('c_a', 'p_a', 's_a', 'n_ch_a', 'Capítulo 1', 'texto', '# Capítulo 1\n\nTexto original.', 3, now, now);

  // ── Legacy shape 2: a project whose folders were deleted by hand, a section with no
  // folder at all, and a chapter whose note no longer exists. This is the case that
  // would otherwise leave written work unreachable.
  insertProject.run('p_b', 'Artículo', '', null, now, now);
  insertSection.run('s_b', 'p_b', null, 'Discusión', 0, now, now);
  insertChapter.run('c_b', 'p_b', 's_b', null, 'Borrador de discusión', 'Texto crudo', '# Discusión\n\nCuerpo que debe sobrevivir.', 5, now, now);

  // ── Legacy shape 3: a saved Escritura document and a Deep Research report ──
  insertDraft.run(
    'd_write', 'Revisión de literatura',
    JSON.stringify({ kind: 'literature_review', objective: 'Mapear el campo' }),
    JSON.stringify({ title: 'Revisión de literatura', abstract: 'Resumen breve.', draftMarkdown: '## Estado de la cuestión\n\nCuerpo.', bibliography: ['Autora (2020)'] }),
    now, now
  );
  insertDraft.run(
    'd_deep', 'Informe profundo',
    JSON.stringify({ kind: 'deep_research', objective: 'Investigar' }),
    JSON.stringify({ title: 'Informe profundo', abstract: '', draftMarkdown: 'Informe.', bibliography: [] }),
    now, now
  );

  // ── Legacy shape 4: content that has nothing to do with projects and must be left
  // byte for byte as it was — a loose note and a manual idea in its own folder.
  insertFolder.run('f_user', null, 'Lecturas', 1, now, now);
  insertNote.run('n_user', 'f_user', 'Nota suelta', 'markdown', 'Cuerpo intacto.', null, 0, now, now);
  insertNote.run(
    'n_idea', null, 'Idea propia', 'idea', '# Idea propia\n\nEnunciado.',
    JSON.stringify({ origin: 'idea', ref: 'idea-1', note: 'manual-idea' }), 0, now, now
  );

  const before = snapshot(db);

  runMigrations(db);
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION, `DB migrated through v${SCHEMA_VERSION}`);

  // ── Schema ──
  for (const column of ['style_json', 'spellcheck_language', 'custom_dictionary_json']) {
    assert.equal(hasColumn(db, 'notes', column), true, `notes.${column} added`);
  }
  assert.equal(hasColumn(db, 'note_folders', 'source_ref'), true, 'note_folders.source_ref added');
  assert.equal(hasColumn(db, 'writing_saved_drafts', 'note_id'), true, 'writing_saved_drafts.note_id added');
  for (const table of ['note_versions', 'note_annotations', 'workspace_library_links']) {
    assert.equal(hasTable(db, table), true, `${table} created`);
  }

  // ── Nothing pre-existing was destroyed ──
  assert.deepEqual(
    db.prepare('SELECT id, title, kind, content FROM notes WHERE id IN (?, ?) ORDER BY id').all('n_idea', 'n_user'),
    [
      { id: 'n_idea', title: 'Idea propia', kind: 'idea', content: '# Idea propia\n\nEnunciado.' },
      { id: 'n_user', title: 'Nota suelta', kind: 'markdown', content: 'Cuerpo intacto.' },
    ],
    'existing notes and manual ideas are preserved verbatim'
  );
  assert.equal(
    db.prepare('SELECT name FROM note_folders WHERE id = ?').get('f_user').name,
    'Lecturas',
    'a user folder unrelated to projects is untouched'
  );
  assert.equal(before.projects, db.prepare('SELECT COUNT(*) AS c FROM projects').get().c, 'no project row was removed');
  assert.equal(before.chapters, db.prepare('SELECT COUNT(*) AS c FROM project_chapters').get().c, 'no chapter row was removed');
  assert.equal(before.drafts, db.prepare('SELECT COUNT(*) AS c FROM writing_saved_drafts').get().c, 'no saved draft was removed');

  // ── Each project became a collection ──
  const collectionA = db.prepare('SELECT * FROM note_folders WHERE source_ref = ?').get('project:p_a');
  assert.equal(collectionA.id, 'f_root_a', 'a healthy project adopts the folder it already had, without a duplicate');
  const collectionB = db.prepare('SELECT * FROM note_folders WHERE source_ref = ?').get('project:p_b');
  assert.ok(collectionB, 'a project whose folder was deleted gets a fresh collection');
  assert.equal(collectionB.name, 'Proyecto - Artículo', 'the new collection is named after its project');
  assert.equal(
    db.prepare('SELECT root_folder_id FROM projects WHERE id = ?').get('p_b').root_folder_id,
    collectionB.id,
    'the project points back at its collection'
  );

  // ── Every document inside a project is a note inside that collection ──
  const chapterA = db.prepare('SELECT note_id FROM project_chapters WHERE id = ?').get('c_a');
  assert.equal(chapterA.note_id, 'n_ch_a', 'a chapter that already had a note keeps it');

  const chapterB = db.prepare('SELECT note_id FROM project_chapters WHERE id = ?').get('c_b');
  assert.ok(chapterB.note_id, 'a chapter that had lost its note gets one');
  const noteB = db.prepare('SELECT * FROM notes WHERE id = ?').get(chapterB.note_id);
  assert.equal(noteB.content, '# Discusión\n\nCuerpo que debe sobrevivir.', 'the chapter text reaches the note intact');
  const sectionFolderB = db.prepare('SELECT folder_id FROM project_sections WHERE id = ?').get('s_b').folder_id;
  assert.ok(sectionFolderB, 'a section with no folder gets a subcollection');
  assert.equal(noteB.folder_id, sectionFolderB, 'the note lands in its section subcollection');
  assert.equal(
    db.prepare('SELECT parent_id FROM note_folders WHERE id = ?').get(sectionFolderB).parent_id,
    collectionB.id,
    'the section subcollection hangs from the project collection'
  );

  // ── Saved Escritura documents became notes; Deep Research reports did not ──
  const draftNoteId = db.prepare('SELECT note_id FROM writing_saved_drafts WHERE id = ?').get('d_write').note_id;
  assert.ok(draftNoteId, 'a saved Escritura document becomes a note');
  const draftNote = db.prepare('SELECT * FROM notes WHERE id = ?').get(draftNoteId);
  assert.equal(draftNote.kind, 'writing', 'the note keeps the writing kind');
  assert.match(draftNote.content, /# Revisión de literatura/, 'the note carries its title');
  assert.match(draftNote.content, /Resumen breve\./, 'the note carries its abstract');
  assert.match(draftNote.content, /## Estado de la cuestión/, 'the note carries its body');
  assert.match(draftNote.content, /- Autora \(2020\)/, 'the note carries its bibliography');
  assert.equal(
    db.prepare('SELECT note_id FROM writing_saved_drafts WHERE id = ?').get('d_deep').note_id,
    null,
    'a Deep Research report keeps its own gallery and is NOT copied into the Workspace'
  );
  const writingCollection = db.prepare('SELECT * FROM note_folders WHERE source_ref = ?').get('writing');
  assert.equal(draftNote.folder_id, writingCollection.id, 'saved documents land in the Escritura collection');

  // ── Idempotency: migrating again changes nothing ──
  const after = fullSnapshot(db);
  const second = migrateWorkspaceContent(db);
  assert.deepEqual(
    second,
    { collectionsCreated: 0, collectionsAdopted: 0, sectionCollectionsCreated: 0, chapterNotesCreated: 0, writingNotesCreated: 0 },
    'a second pass reports no work to do'
  );
  assert.deepEqual(fullSnapshot(db), after, 'a second pass leaves every row exactly as it was');

  // A third pass through the whole migration runner (the path a repaired database takes)
  // is equally inert.
  runMigrations(db);
  assert.deepEqual(fullSnapshot(db), after, 'running the migrations again leaves every row exactly as it was');

  db.close();
  console.log('Workspace migration 130 test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function snapshot(db) {
  return {
    projects: db.prepare('SELECT COUNT(*) AS c FROM projects').get().c,
    chapters: db.prepare('SELECT COUNT(*) AS c FROM project_chapters').get().c,
    drafts: db.prepare('SELECT COUNT(*) AS c FROM writing_saved_drafts').get().c,
  };
}

function fullSnapshot(db) {
  return {
    folders: db.prepare('SELECT id, parent_id, name, source_ref FROM note_folders ORDER BY id').all(),
    notes: db.prepare('SELECT id, folder_id, title, kind, content FROM notes ORDER BY id').all(),
    chapters: db.prepare('SELECT id, note_id, section_id FROM project_chapters ORDER BY id').all(),
    sections: db.prepare('SELECT id, folder_id FROM project_sections ORDER BY id').all(),
    projects: db.prepare('SELECT id, root_folder_id FROM projects ORDER BY id').all(),
    drafts: db.prepare('SELECT id, note_id FROM writing_saved_drafts ORDER BY id').all(),
  };
}

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name));
}

function hasColumn(db, table, column) {
  return db.pragma(`table_info(${JSON.stringify(table)})`).some((info) => info.name === column);
}

function installTsHook() {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
