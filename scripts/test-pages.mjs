// Loop 5 acceptance against production repositories and a real SQLite database.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, repoRoot, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const scriptPath = fileURLToPath(import.meta.url);
if (!requireElectronRuntime(scriptPath, '--electron-pages-test')) process.exit(0);

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-pages-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);

try {
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const databases = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const pages = require(path.join(repoRoot, 'electron/db/pagesRepo.ts'));
  const notes = require(path.join(repoRoot, 'electron/db/notesRepo.ts'));
  const workspace = require(path.join(repoRoot, 'electron/db/workspaceRepo.ts'));
  const exporter = require(path.join(repoRoot, 'electron/export/databaseExport.ts'));
  const { PAGE_BLOCK_TYPES, pageBlocksToMarkdown, markdownToPageBlocks } = require(path.join(repoRoot, 'shared/pages.ts'));
  const { Y, readPageYDocument, writePageYDocument } = require(path.join(repoRoot, 'shared/pageYjs.ts'));
  const db = getDb();
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 137);

  const database = databases.createDatabase('Páginas reales');
  const title = databases.createColumn(database.id, 'Nombre', 'title');
  const row = databases.createRow(database.id);
  databases.setCell(row.id, title.id, 'Expediente universal');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM page_documents WHERE page_id = ?').get(`row:${row.id}`).count, 1,
    'row creation materializes its universal document in the same transaction');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM page_document_snapshots WHERE page_id = ?').get(`row:${row.id}`).count, 1,
    'row creation materializes its initial snapshot in the same transaction');
  const initial = pages.getPageDocumentForRow(row.id);
  assert.equal(initial.page.rowId, row.id);
  assert.equal(initial.page.title, 'Expediente universal');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pages WHERE row_id = ?').get(row.id).count, 1);

  const drafts = PAGE_BLOCK_TYPES.map((type, index) => ({
    id: `block-${index}`,
    parentBlockId: index === 1 ? 'block-0' : null,
    type,
    content: type === 'task' ? { text: 'Tarea verificable', checked: true }
      : type === 'table' ? { rows: [['A', 'B'], ['1', '2']] }
      : type === 'columns' ? { columns: ['Izquierda', 'Derecha'] }
      : type === 'divider' ? {}
      : type === 'code' ? { text: 'const real = true;', language: 'ts' }
      : type === 'markdown' ? { markdown: ':::construcción-desconocida\nvalor intacto\n:::' }
      : type === 'image' ? { caption: 'Imagen local', url: 'https://example.invalid/image.png' }
      : type === 'bookmark' ? { title: 'Fuente', url: 'https://example.invalid' }
      : type === 'toggle' ? { text: 'Detalles', body: 'Cuerpo ocultable' }
      : type === 'callout' ? { text: 'Atención', tone: 'warning' }
      : type === 'subpage' ? { title: 'Hija', pageId: 'future-page' }
      : type === 'mention' ? { label: 'Persona', pageId: 'future-page' }
      : type === 'synced_block' ? { sourceBlockId: 'block-0' }
      : type === 'database_view' ? { viewId: 'view-1' }
      : { text: `${type} verificable` },
  }));
  let saved = pages.savePageDocument({ pageId: initial.page.id, expectedRevision: initial.revision, blocks: drafts });
  assert.equal(saved.ok, true);
  assert.equal(saved.document.blocks.length, PAGE_BLOCK_TYPES.length);
  assert.equal(saved.document.blocks[1].parentBlockId, 'block-0');
  assert.equal(new Set(saved.document.blocks.map((block) => block.type)).size, PAGE_BLOCK_TYPES.length);
  assert.equal(databases.searchDatabaseRowsPage({ query: 'Tarea verificable', limit: 10 }).hits[0].rowId, row.id);

  const markdown = pageBlocksToMarkdown(saved.document.blocks);
  const reparsed = markdownToPageBlocks(markdown);
  assert.match(markdown, /construcción-desconocida/);
  assert.ok(reparsed.some((block) => block.type === 'markdown' && String(block.content.markdown).includes('construcción-desconocida')));
  assert.ok(reparsed.some((block) => block.type === 'table'));
  assert.ok(reparsed.some((block) => block.type === 'code'));
  assert.ok(reparsed.some((block) => block.type === 'mention'
    && block.content.label === 'Persona' && block.content.pageId === 'future-page'),
  'Markdown round-trip preserves page mentions as typed blocks');
  const localBlobHash = 'a'.repeat(64);
  const assetRoundTrip = markdownToPageBlocks(pageBlocksToMarkdown([
    { type: 'image', content: { caption: 'Local', blobHash: localBlobHash } },
    { type: 'file', content: { name: 'Local.txt', blobHash: localBlobHash } },
    { type: 'audio', content: { blobHash: localBlobHash } },
    { type: 'video', content: { blobHash: localBlobHash } },
  ]));
  assert.deepEqual(assetRoundTrip.map((entry) => [entry.type, entry.content.blobHash]), [
    ['image', localBlobHash], ['file', localBlobHash], ['audio', localBlobHash], ['video', localBlobHash],
  ], 'Markdown round-trip preserves content-addressed assets');

  const stale = pages.savePageDocument({ pageId: initial.page.id, expectedRevision: initial.revision, blocks: drafts });
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict.actualRevision, saved.document.revision);

  // A genuine Yjs update produced by a second client converges into the same projection.
  const client = new Y.Doc();
  Y.applyUpdate(client, saved.document.yjsState);
  const beforeVector = Y.encodeStateVector(client);
  const state = readPageYDocument(client);
  state.blocks[0].content = { text: 'Editado desde cliente B' };
  writePageYDocument(client, state.title, state.blocks);
  const update = Y.encodeStateAsUpdate(client, beforeVector);
  const merged = pages.applyPageDocumentUpdate(initial.page.id, update, saved.document.revision, 'client-b');
  assert.equal(merged.ok, true);
  assert.equal(merged.document.blocks[0].content.text, 'Editado desde cliente B');

  // Twenty deltas compact into a durable snapshot and discard only covered updates.
  let current = merged.document;
  for (let index = 0; index < 20; index += 1) {
    const next = current.blocks.map((block, blockIndex) => blockIndex === 0
      ? { id: block.id, parentBlockId: block.parentBlockId, type: block.type, content: { text: `Compactado ${index}` } }
      : { id: block.id, parentBlockId: block.parentBlockId, type: block.type, content: block.content });
    const result = pages.savePageDocument({ pageId: current.page.id, expectedRevision: current.revision, blocks: next });
    assert.equal(result.ok, true);
    current = result.document;
  }
  const documentRow = db.prepare('SELECT * FROM page_documents WHERE page_id = ?').get(current.page.id);
  assert.ok(documentRow.snapshot_sequence > 0);
  assert.ok(documentRow.update_count < 20);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM page_document_updates WHERE page_id = ? AND sequence_no <= ?').get(current.page.id, documentRow.snapshot_sequence).count, 0);
  assert.ok(db.prepare('SELECT COUNT(*) AS count FROM page_document_snapshots WHERE page_id = ?').get(current.page.id).count >= 1);

  // Binary assets are content-addressed and the block reference is FK-checked.
  const assetA = pages.storePageAsset({ name: 'real.txt', mimeType: 'text/plain', bytes: Buffer.from('mismo contenido') });
  const assetB = pages.storePageAsset({ name: 'copia.txt', mimeType: 'text/plain', bytes: Buffer.from('mismo contenido') });
  assert.equal(assetA.blobHash, assetB.blobHash);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM db_blobs WHERE hash = ?').get(assetA.blobHash).count, 1);
  const withFile = [...current.blocks, { id: 'asset-block', type: 'file', content: { ...assetA } }];
  saved = pages.savePageDocument({ pageId: current.page.id, expectedRevision: current.revision, blocks: withFile });
  assert.equal(saved.ok, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM page_block_blobs WHERE block_id = ?').get('asset-block').count, 1);
  assert.deepEqual(Buffer.from(pages.getPageAsset(assetA.blobHash)), Buffer.from('mismo contenido'));

  assert.throws(() => pages.savePageDocument({
    pageId: current.page.id,
    expectedRevision: saved.document.revision,
    blocks: [
      { id: 'cycle-a', parentBlockId: 'cycle-b', type: 'paragraph', content: { text: 'A' } },
      { id: 'cycle-b', parentBlockId: 'cycle-a', type: 'paragraph', content: { text: 'B' } },
    ],
  }), /ciclo/i);

  const independent = pages.createPage({ title: 'Página independiente', blocks: [{ type: 'paragraph', content: { text: 'Propio' } }] });
  assert.throws(() => pages.savePageDocument({
    pageId: independent.page.id,
    expectedRevision: independent.revision,
    blocks: [{ id: saved.document.blocks[0].id, type: 'paragraph', content: { text: 'Colisión' } }],
  }), /otra página/i, 'a block id can never be reused across pages');

  // Legacy Notes is now an adapter over the same block engine, with a checked hash cache.
  const note = notes.createNote({
    title: 'Nota universal',
    content: '# Cabecera\n\nTexto **rico**.\n\n```sin-cerrar\nse conserva',
  });
  let noteDocument = pages.getPageDocumentForNote(note.id);
  assert.equal(noteDocument.page.noteId, note.id);
  assert.ok(noteDocument.blocks.some((block) => block.type === 'markdown'), 'unclosed Markdown is preserved raw');
  workspace.updateWorkspaceNote(note.id, { title: 'Nota editada', contentMarkdown: '## Nueva\n\n- uno\n- dos' });
  noteDocument = pages.getPageDocumentForNote(note.id);
  assert.ok(noteDocument.blocks.some((block) => block.type === 'heading_2'));
  const editedNote = pages.savePageDocument({
    pageId: noteDocument.page.id,
    expectedRevision: noteDocument.revision,
    blocks: [{ type: 'paragraph', content: { text: 'Escrito con bloques' } }],
  });
  assert.equal(editedNote.ok, true);
  const cached = db.prepare('SELECT content, page_markdown_hash FROM notes WHERE id = ?').get(note.id);
  assert.equal(cached.content, 'Escrito con bloques');
  assert.equal(cached.page_markdown_hash, editedNote.document.markdownHash);

  const exportPath = path.join(root, 'pages.json');
  const exported = await exporter.exportDatabaseToFile(database.id, 'json', exportPath);
  assert.equal(exported.maxPageRows, 1);
  const json = JSON.parse(await readFile(exportPath, 'utf8'));
  assert.match(json.rows[0]._page.markdown, /Compactado|Editado|file/i);

  const pageId = initial.page.id;
  databases.deleteRow(row.id);
  assert.equal(pages.getPage(pageId), null, 'deleting a row cascades its page and document');
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  closeDb();
  console.log('Universal pages test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}
