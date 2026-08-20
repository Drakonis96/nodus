// Persistent Deep Research highlights and comments, against the real schema and
// repositories. Runs under Electron-as-Node so better-sqlite3 matches the app ABI.
//
// This pins the feature at the persistence boundary: annotations are independent rows,
// editing them never rewrites the report, comment/highlight rules differ as intended,
// deleting a report cleans up its children, and the table travels in both sync systems.
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

if (!process.argv.includes('--electron-deep-research-annotations-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-deep-research-annotations.mjs'), '--electron-deep-research-annotations-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-dr-annotations-'));
installTsHook();

try {
  const Database = require('better-sqlite3');
  const { runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const db = new Database(path.join(root, 'vault.sqlite'));
  runMigrations(db);
  assert.ok(SCHEMA_VERSION >= 127);

  stubModule('electron/db/database.ts', { getDb: () => db });
  const drafts = require(path.join(repoRoot, 'electron/db/writingDraftsRepo.ts'));
  const annotations = require(path.join(repoRoot, 'electron/db/writingAnnotationsRepo.ts'));
  const immersion = require(path.join(repoRoot, 'electron/db/immersionRepo.ts'));
  const { immersionAnnotationDocumentId } = require(path.join(repoRoot, 'shared/readerAnnotations.ts'));

  const brief = { kind: 'deep_research', objective: 'La memoria de la posguerra' };
  const draft = { title: brief.objective, brief, selection: {}, draftMarkdown: 'Memoria compartida y archivo.' };
  const saved = drafts.saveWritingWorkshopDraft({ draft, title: draft.title, model: null });
  const reportRow = () => JSON.stringify(db.prepare('SELECT * FROM writing_saved_drafts WHERE id = ?').get(saved.id));
  const before = reportRow();

  const highlight = annotations.createWritingDraftAnnotation({
    draftId: saved.id,
    scope: 'source',
    kind: 'highlight',
    color: 'yellow',
    startOffset: 0,
    endOffset: 7,
    selectedText: 'Memoria',
    prefix: '',
    suffix: ' compartida',
  });
  assert.equal(highlight.kind, 'highlight');
  assert.equal(highlight.color, 'yellow');
  assert.equal(highlight.comment, null);

  const comment = annotations.createWritingDraftAnnotation({
    draftId: saved.id,
    scope: 'source',
    kind: 'comment',
    startOffset: 8,
    endOffset: 18,
    selectedText: 'compartida',
    prefix: 'Memoria ',
    suffix: ' y archivo',
    comment: 'Contrastar con la fuente oral.',
  });
  assert.equal(comment.kind, 'comment');
  assert.equal(comment.color, null);
  const bookmark = annotations.createWritingDraftAnnotation({
    draftId: saved.id,
    scope: 'source',
    kind: 'bookmark',
    startOffset: 19,
    endOffset: 20,
    selectedText: 'y',
    prefix: 'Memoria compartida ',
    suffix: ' archivo',
  });
  assert.equal(bookmark.id, `reader-bookmark:${saved.id}:source`);
  assert.equal(bookmark.color, null);
  const movedBookmark = annotations.createWritingDraftAnnotation({
    draftId: saved.id,
    scope: 'source',
    kind: 'bookmark',
    startOffset: 21,
    endOffset: 28,
    selectedText: 'archivo',
    prefix: 'Memoria compartida y ',
    suffix: '.',
  });
  assert.equal(movedBookmark.id, bookmark.id, 'moving a bookmark updates the cross-device row');
  assert.equal(movedBookmark.selectedText, 'archivo');
  assert.equal(annotations.listWritingDraftAnnotations(saved.id).length, 3);
  assert.equal(reportRow(), before, 'annotations never rewrite the multi-page report row');

  const updated = annotations.updateWritingDraftComment(comment.id, 'Añadir una referencia cruzada.');
  assert.equal(updated?.comment, 'Añadir una referencia cruzada.');
  assert.equal(annotations.updateWritingDraftComment(highlight.id, 'No se puede'), null, 'a highlight is not editable as a comment');
  assert.throws(
    () => annotations.createWritingDraftAnnotation({
      draftId: saved.id, scope: 'source', kind: 'highlight', color: 'neon',
      startOffset: 0, endOffset: 1, selectedText: 'M',
    }),
    /color/i,
  );

  assert.equal(annotations.deleteWritingDraftAnnotation(highlight.id), saved.id);
  assert.equal(annotations.listWritingDraftAnnotations(saved.id).length, 2);

  const immersionId = 'immersion-annotation-test';
  const immersionDocumentId = immersionAnnotationDocumentId(immersionId);
  const now = new Date().toISOString();
  const immersionPlan = {
    topic: 'Memoria', title: 'Ruta de memoria', language: 'es', minutes: 90,
    stations: [], stats: { stations: 0, ideas: 0, works: 0, authors: 0, citations: 0, quizQuestions: 0 },
  };
  db.prepare(`INSERT INTO immersion_sessions (
    id, topic, title, language, minutes, model_json, plan_json, progress_json, stats_json, created_at, updated_at
  ) VALUES (?, ?, ?, 'es', 90, NULL, ?, ?, ?, ?, ?)`).run(
    immersionId,
    immersionPlan.topic,
    immersionPlan.title,
    JSON.stringify(immersionPlan),
    JSON.stringify(immersion.emptyImmersionProgress()),
    JSON.stringify(immersionPlan.stats),
    now,
    now,
  );
  const immersionHighlight = annotations.createWritingDraftAnnotation({
    draftId: immersionDocumentId,
    scope: 'step:1:source',
    kind: 'highlight',
    color: 'mint',
    startOffset: 0,
    endOffset: 7,
    selectedText: 'Memoria',
  });
  const immersionComment = annotations.createWritingDraftAnnotation({
    draftId: immersionDocumentId,
    scope: 'step:1:source',
    kind: 'comment',
    startOffset: 8,
    endOffset: 14,
    selectedText: 'social',
    comment: 'Relacionar con el paso anterior.',
  });
  assert.equal(immersionHighlight.draftId, immersionDocumentId);
  assert.equal(immersionComment.comment, 'Relacionar con el paso anterior.');
  assert.equal(annotations.listWritingDraftAnnotations(immersionDocumentId).length, 2);
  immersion.deleteImmersionSession(immersionId);
  assert.equal(annotations.listWritingDraftAnnotations(immersionDocumentId).length, 0, 'deleting an immersion removes its annotations');

  const { syncedTableNames, syncedTablesByGroup } = require(path.join(repoRoot, 'electron/db/syncTables.ts'));
  assert.ok(syncedTableNames(db).includes('writing_draft_annotations'));
  assert.ok(
    syncedTablesByGroup(db).find((group) => group.key === 'writing')?.tables.includes('writing_draft_annotations'),
    'annotations travel beside their saved reports in .nodussync packages',
  );
  const { MUTABLE_TABLES } = require(path.join(repoRoot, 'electron/serverSync/outboxTriggers.ts'));
  assert.ok(MUTABLE_TABLES.includes('writing_draft_annotations'), 'connected replicas send annotation edits through the ledger');

  drafts.deleteWritingWorkshopDraft(saved.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM writing_draft_annotations').get().n, 0, 'deleting a report removes its comments');

  db.close();
  console.log('deep research annotations test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

function stubModule(relative, exports) {
  const filename = path.join(repoRoot, relative);
  const Module = require('node:module');
  const stub = new Module(filename, null);
  stub.filename = filename;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[filename] = stub;
}

function installTsHook() {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
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
