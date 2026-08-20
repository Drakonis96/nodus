// Loop 16A acceptance against the production repository and a real SQLite vault.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, repoRoot, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const scriptPath = fileURLToPath(import.meta.url);
if (!requireElectronRuntime(scriptPath, '--electron-page-history-test')) process.exit(0);

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-page-history-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);

try {
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const pages = require(path.join(repoRoot, 'electron/db/pagesRepo.ts'));
  const db = getDb();
  assert.ok(SCHEMA_VERSION >= 146);
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);

  const created = pages.createPage({
    title: 'Contrato original',
    icon: '📜',
    blocks: [{ id: 'history-body', type: 'paragraph', content: { text: 'Primera versión' } }],
  });
  let history = pages.listPageRevisions(created.page.id, null, 2);
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].revision, 1);
  assert.equal(history.items[0].hasSnapshot, true);

  const firstEdit = pages.savePageDocument({
    pageId: created.page.id,
    expectedRevision: created.revision,
    blocks: [{ id: 'history-body', type: 'paragraph', content: { text: 'Contenido que se restaurará' } }],
    actorId: 'writer-a',
    reason: 'content',
  });
  assert.equal(firstEdit.ok, true);
  const renamed = pages.updatePage(created.page.id, { title: 'Contrato renombrado', icon: '🧾' }, firstEdit.document.page.revision, 'writer-b');
  const secondEdit = pages.savePageDocument({
    pageId: created.page.id,
    expectedRevision: firstEdit.document.revision,
    blocks: [
      { id: 'history-body', type: 'paragraph', content: { text: 'Contenido posterior' } },
      { id: 'history-extra', type: 'callout', content: { text: 'No debe desaparecer del historial' } },
    ],
    actorId: 'writer-b',
    reason: 'content',
  });
  assert.equal(secondEdit.ok, true);
  assert.equal(renamed.title, 'Contrato renombrado');

  history = pages.listPageRevisions(created.page.id, null, 2);
  assert.deepEqual(history.items.map((entry) => entry.revision), [4, 3]);
  assert.ok(history.nextCursor);
  const older = pages.listPageRevisions(created.page.id, history.nextCursor, 2);
  assert.deepEqual(older.items.map((entry) => entry.revision), [2, 1]);
  assert.equal(older.nextCursor, null);
  assert.throws(() => pages.listPageRevisions(created.page.id, Buffer.from(JSON.stringify({ v: 1, p: 'other', r: 3 })).toString('base64url'), 20), /cursor/i);

  const preview = pages.getPageRevision(created.page.id, 2);
  assert.equal(preview.page.title, 'Contrato original');
  assert.equal(preview.blocks.length, 1);
  assert.equal(preview.blocks[0].content.text, 'Contenido que se restaurará');
  assert.match(preview.markdown, /Contenido que se restaurará/);

  const restored = pages.restorePageRevision(created.page.id, 2, secondEdit.document.revision, 'owner');
  assert.equal(restored.ok, true);
  assert.equal(restored.document.page.title, 'Contrato original');
  assert.equal(restored.document.page.icon, '📜');
  assert.equal(restored.document.blocks.length, 1);
  assert.equal(restored.document.blocks[0].content.text, 'Contenido que se restaurará');

  history = pages.listPageRevisions(created.page.id, null, 100);
  assert.equal(history.items[0].revision, 5);
  assert.equal(history.items[0].restoredFromRevision, 2);
  assert.equal(history.items[0].hasSnapshot, true, 'a restore is always a new reconstruction point');
  assert.ok(history.items.some((entry) => entry.revision === 4), 'later history remains after restoration');
  assert.equal(pages.getPageRevision(created.page.id, 4).blocks.length, 2, 'the post-target revision remains reconstructible');

  const countBeforeConflict = db.prepare('SELECT COUNT(*) AS n FROM page_revisions WHERE page_id = ?').get(created.page.id).n;
  const conflict = pages.restorePageRevision(created.page.id, 1, secondEdit.document.revision, 'stale-client');
  assert.equal(conflict.ok, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM page_revisions WHERE page_id = ?').get(created.page.id).n, countBeforeConflict,
    'a stale restore never writes history');

  let current = restored.document;
  for (let index = 0; index < 17; index += 1) {
    const edited = pages.savePageDocument({
      pageId: created.page.id,
      expectedRevision: current.revision,
      blocks: [{ id: 'history-body', type: 'paragraph', content: { text: `Delta ${index}` } }],
      actorId: 'load-test',
      reason: 'content',
    });
    assert.equal(edited.ok, true);
    current = edited.document;
  }
  const rows = db.prepare(
    'SELECT revision, delta_json, snapshot_json FROM page_revisions WHERE page_id = ? ORDER BY revision',
  ).all(created.page.id);
  assert.equal(rows.length, 22);
  assert.ok(rows.every((row) => JSON.parse(row.delta_json).blocks), 'every revision stores a valid delta');
  assert.ok(rows.find((row) => row.revision === 20).snapshot_json, 'revision 20 is a periodic snapshot');
  assert.equal(rows.find((row) => row.revision === 19).snapshot_json, null, 'ordinary deltas stay compact');
  assert.equal(pages.getPageRevision(created.page.id, 21).blocks[0].content.text, 'Delta 15');

  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  closeDb();
  console.log('Page history test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}
