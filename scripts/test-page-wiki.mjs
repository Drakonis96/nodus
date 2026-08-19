// Loop 6 acceptance against production repositories and a real SQLite database.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, repoRoot, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const scriptPath = fileURLToPath(import.meta.url);
if (!requireElectronRuntime(scriptPath, '--electron-page-wiki-test')) process.exit(0);

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-page-wiki-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);

try {
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const pages = require(path.join(repoRoot, 'electron/db/pagesRepo.ts'));
  const databases = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const db = getDb();
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 139);

  const rootPage = pages.createPage({ title: 'Wiki Automóvil', icon: '🚗', blocks: [
    { id: 'wiki-source-block', type: 'paragraph', content: { text: 'Manual del automóvil eléctrico' } },
    { id: 'wiki-heading', type: 'heading_2', content: { text: 'Arquitectura' } },
  ] });
  const child = pages.createPage({ title: 'Diseño', parentPageId: rootPage.page.id });
  const grandchild = pages.createPage({ title: 'Componentes', parentPageId: child.page.id });
  pages.setPageFavorite(rootPage.page.id, true);
  assert.equal(pages.listPages('active').find((page) => page.id === rootPage.page.id).favorite, true);
  assert.deepEqual(pages.listPageBreadcrumbs(grandchild.page.id).map((page) => page.id),
    [rootPage.page.id, child.page.id, grandchild.page.id]);

  assert.throws(() => pages.movePage(rootPage.page.id, grandchild.page.id, pages.getPage(rootPage.page.id).revision), /ciclo/i);
  const moved = pages.movePage(grandchild.page.id, rootPage.page.id, pages.getPage(grandchild.page.id).revision);
  assert.equal(moved.parentPageId, rootPage.page.id);

  let childDocument = pages.getPageDocument(child.page.id);
  let saved = pages.savePageDocument({ pageId: child.page.id, expectedRevision: childDocument.revision, blocks: [
    { id: 'wiki-mention', type: 'mention', content: { label: 'Raíz', pageId: rootPage.page.id } },
    { id: 'wiki-subpage-link', type: 'subpage', content: { title: 'Componentes', pageId: grandchild.page.id } },
    { id: 'wiki-broken', type: 'subpage', content: { title: 'No existe', pageId: 'page_missing_qa' } },
  ] });
  assert.equal(saved.ok, true);
  const synced = pages.createPage({ title: 'Resumen sincronizado', blocks: [
    { id: 'wiki-synced', type: 'synced_block', content: { sourceBlockId: 'wiki-source-block' } },
  ] });
  const incoming = pages.listPageBacklinks(rootPage.page.id);
  assert.ok(incoming.some((link) => link.kind === 'mention' && link.sourcePageId === child.page.id));
  assert.ok(incoming.some((link) => link.kind === 'synced_block' && link.sourcePageId === synced.page.id));
  assert.equal(pages.getSyncedBlockSource('wiki-source-block').page.id, rootPage.page.id);
  assert.ok(pages.listBrokenPageLinks().some((link) => link.sourceBlockId === 'wiki-broken'));

  const lexical = pages.searchPages('Arquitectura', 'lexical', 20);
  assert.ok(lexical.some((hit) => hit.pageId === rootPage.page.id && hit.entityType === 'page_block'));
  const semantic = pages.searchPages('coche', 'semantic', 20);
  assert.ok(semantic.some((hit) => hit.pageId === rootPage.page.id), 'local synonym expansion finds automóvil from coche');
  assert.ok(pages.searchPages('Resumen sincronizado', 'lexical', 20).some((hit) => hit.entityType === 'page_title'));

  const database = databases.createDatabase('Contenido global');
  const title = databases.createColumn(database.id, 'Nombre', 'title');
  const attachment = databases.createColumn(database.id, 'Archivo', 'attachment');
  const row = databases.createRow(database.id);
  databases.setCell(row.id, title.id, 'Registro Galaxia');
  databases.addAttachment({ rowId: row.id, columnId: attachment.id, fileName: 'fuente.txt', mimeType: 'text/plain', bytes: 7,
    blob: Buffer.from('fuente'), extractedText: 'manuscrito interestelar verificable' });
  assert.ok(pages.searchPages('Galaxia', 'lexical', 20).some((hit) => hit.rowId === row.id && hit.pageId === `row:${row.id}`));
  assert.ok(pages.searchPages('interestelar', 'lexical', 20).some((hit) => hit.entityType === 'attachment'));

  const asset = pages.storePageAsset({ name: 'cover.png', mimeType: 'image/png', bytes: Buffer.from('cover-real') });
  const covered = pages.updatePage(rootPage.page.id, { coverBlobHash: asset.blobHash, fullWidth: true, locked: true }, pages.getPage(rootPage.page.id).revision);
  assert.equal(covered.coverBlobHash, asset.blobHash); assert.equal(covered.fullWidth, true); assert.equal(covered.locked, true);
  assert.throws(() => pages.savePageDocument({ pageId: rootPage.page.id, expectedRevision: pages.getPageDocument(rootPage.page.id).revision, blocks: [] }), /bloqueada/i);
  pages.updatePage(rootPage.page.id, { locked: false }, pages.getPage(rootPage.page.id).revision);

  const trashed = pages.setPageState(rootPage.page.id, 'trashed', pages.getPage(rootPage.page.id).revision);
  assert.ok(trashed.length >= 3); assert.ok(trashed.every((page) => page.state === 'trashed'));
  assert.equal(pages.searchPages('Arquitectura', 'lexical', 20).some((hit) => hit.pageId === rootPage.page.id), false);
  const restored = pages.setPageState(rootPage.page.id, 'active', pages.getPage(rootPage.page.id).revision);
  assert.ok(restored.every((page) => page.state === 'active'));
  assert.equal(pages.listPageBreadcrumbs(grandchild.page.id)[0].id, rootPage.page.id);

  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  closeDb();
  console.log('Page wiki test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}
