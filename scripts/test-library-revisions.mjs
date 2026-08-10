import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-revision-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-revisions-'));
installRuntimeHooks(path.join(scratch, 'profile'));
const require = createRequire(import.meta.url);

try {
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const revisions = require(path.join(repoRoot, 'electron/library/libraryRevision.ts'));
  const { reanchorLibraryAnnotations } = require(path.join(repoRoot, 'electron/library/libraryAnnotationReanchor.ts'));
  const { propagateLibraryInvalidations } = require(path.join(repoRoot, 'electron/library/libraryInvalidation.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { getActiveVault } = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const store = new LibraryDiskStore(path.join(scratch, 'nodus-library'), 'revision-device');
  const folder = store.itemFolder('REVISION01');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'original.pdf'), 'original');
  await writeFile(path.join(folder, 'reader.md'), '# Stable text\n\nQuoted passage remains here.\n');
  const created = store.upsertItem({
    id: 'nodus:revision', storageId: 'REVISION01', source: 'nodus',
    metadata: {
      title: 'Stable title', abstract: 'Stable abstract', itemType: 'article-journal', year: 2026,
      creators: [{ creatorType: 'author', name: 'Researcher' }], isbn: [], issn: [], tags: ['organization'],
    },
    collectionIds: ['collection-a'],
    attachments: [{
      id: 'attachment-a', title: 'Original', fileName: 'original.pdf', relativePath: 'original.pdf',
      mimeType: 'application/pdf', byteSize: 8, sha256: 'a'.repeat(64), role: 'original',
    }],
    files: { original: 'original.pdf', reader: 'reader.md', annotations: 'annotations.json' },
    extraction: { status: 'ready' },
  });
  const currentComponents = Object.fromEntries(Object.entries(created.contentRevision.components).map(([key, value]) => [key, {
    ...value, freshness: key === 'extraction' ? 'current' : 'current', fingerprint: `${key}-fingerprint`, generatedAt: created.createdAt,
  }]));
  let item = store.upsertItem({
    ...created,
    contentRevision: {
      ...created.contentRevision,
      revision: created.contentRevision.revision + 1,
      extractionFingerprint: 'extract-fingerprint',
      contentFingerprint: 'content-fingerprint',
      components: currentComponents,
    },
  }, created.clock.revision);

  const organizational = store.upsertItem({
    ...item,
    metadata: { ...item.metadata, tags: ['organization', 'new-folder-tag'] },
    collectionIds: ['collection-b'],
  }, item.clock.revision);
  assert.equal(organizational.contentRevision.revision, item.contentRevision.revision, 'organization-only edits do not invalidate analyses');

  item = store.upsertItem({ ...organizational, metadata: { ...organizational.metadata, title: 'Analytical title changed' } }, organizational.clock.revision);
  assert.equal(item.contentRevision.components.light.freshness, 'stale');
  assert.equal(item.contentRevision.components.summary.freshness, 'stale');
  assert.equal(item.contentRevision.components.deep.freshness, 'current');
  assert.deepEqual(item.contentRevision.pendingInvalidations.at(-1).components, ['light', 'summary']);

  item = store.upsertItem({
    ...item,
    attachments: item.attachments.map((attachment) => ({ ...attachment, sha256: 'b'.repeat(64) })),
  }, item.clock.revision);
  assert.equal(item.extraction.status, 'pending');
  assert.equal(item.contentRevision.components.extraction.freshness, 'queued');
  for (const component of ['deep', 'passages', 'ideas', 'embeddings', 'summary']) {
    assert.equal(item.contentRevision.components[component].freshness, 'stale');
  }

  const embeddingChanged = revisions.setLibraryEmbeddingRevision(item, {
    provider: 'local', model: 'model-v2', dimension: 768, pipeline: 'embeddings/2',
  }, new Date().toISOString());
  assert.equal(embeddingChanged.components.embeddings.freshness, 'stale');
  assert.equal(embeddingChanged.components.deep.freshness, item.contentRevision.components.deep.freshness);
  const summaryChanged = revisions.setLibrarySummaryRevision({ ...item, contentRevision: embeddingChanged }, {
    lightHash: 'light', deepHash: 'deep', model: 'summary-v2', prompt: 'Summarize faithfully.',
  }, new Date().toISOString());
  assert.equal(summaryChanged.components.summary.freshness, 'stale');
  assert.equal(summaryChanged.embeddingFingerprint, embeddingChanged.embeddingFingerprint);

  const catalog = new LibraryCatalog(path.join(scratch, 'profile', 'library', 'catalog.sqlite'));
  catalog.rebuild(store);
  const activeVault = getActiveVault();
  const db = getDb();
  db.prepare(`INSERT INTO works (
    nodus_id, title, authors_json, light_status, light_hash, deep_status, deep_hash, summary_status, summary_hash
  ) VALUES (?, ?, '[]', 'done', 'old-light', 'done', 'old-deep', 'done', 'old-summary')`).run('vault-work', 'Revision work');
  const analysis = {
    lightStatus: 'done', deepStatus: 'done', summaryStatus: 'done', ideaCount: 1, passageCount: 1,
    evidenceCount: 1, gapCount: 0, hasSummary: true, hasNotes: false, archived: false,
  };
  catalog.upsertVaultLinks([
    { itemId: item.id, vaultId: activeVault.id, vaultName: activeVault.name, vaultType: activeVault.type, workId: 'vault-work', analysis },
    { itemId: item.id, vaultId: 'closed-vault', vaultName: 'Closed vault', vaultType: 'academic', workId: 'closed-work', analysis },
  ]);
  const propagated = propagateLibraryInvalidations(item, store, catalog);
  const vaultWork = db.prepare('SELECT light_status, light_hash, deep_status, deep_hash, summary_status, summary_hash FROM works WHERE nodus_id=?').get('vault-work');
  assert.deepEqual(vaultWork, {
    light_status: 'pending', light_hash: 'old-light', deep_status: 'pending', deep_hash: 'old-deep',
    summary_status: 'pending', summary_hash: 'old-summary',
  }, 'invalidation retains the preceding outputs and provenance hashes');
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM library_analysis_freshness WHERE work_id=? AND freshness='stale'").get('vault-work').n >= 3);
  assert.ok(propagated.contentRevision.pendingInvalidations.every((entry) => entry.vaultId === 'closed-vault'));
  assert.ok(propagated.contentRevision.pendingInvalidations.some((entry) => entry.components.includes('embeddings')));
  catalog.close();
  closeDb();

  const oldText = 'Before. Quoted passage remains here. After. Removed quote.';
  const newText = 'New introduction. Quoted passage remains here. New ending.';
  const quoted = 'Quoted passage remains here.';
  const annotationsFile = path.join(folder, 'annotations.json');
  const orphanedFile = path.join(folder, 'orphaned-annotations.json');
  await writeFile(annotationsFile, `${JSON.stringify([
    { id: 'kept', documentId: 'REVISION01', scope: 'source', kind: 'highlight', color: 'yellow', startOffset: oldText.indexOf(quoted), endOffset: oldText.indexOf(quoted) + quoted.length, selectedText: quoted, prefix: 'Before. ', suffix: ' After.', comment: null, createdAt: created.createdAt, updatedAt: created.createdAt },
    { id: 'lost', documentId: 'REVISION01', scope: 'source', kind: 'comment', color: null, startOffset: oldText.indexOf('Removed quote.'), endOffset: oldText.length, selectedText: 'Removed quote.', prefix: 'After. ', suffix: '', comment: 'Keep this note', createdAt: created.createdAt, updatedAt: created.createdAt },
  ], null, 2)}\n`);
  const reanchored = reanchorLibraryAnnotations({
    annotationsFile, orphanedFile, oldText, newText, contentFingerprint: 'new-content', now: new Date().toISOString(),
  });
  assert.deepEqual(reanchored, { current: 1, orphaned: 1 });
  const annotations = JSON.parse(await readFile(annotationsFile, 'utf8'));
  assert.equal(annotations.find((annotation) => annotation.id === 'kept').startOffset, newText.indexOf(quoted));
  assert.equal(annotations.find((annotation) => annotation.id === 'lost').anchorStatus, 'orphaned');
  assert.equal((JSON.parse(await readFile(orphanedFile, 'utf8')))[0].comment, 'Keep this note');

  console.log('Library fingerprint invalidation and annotation reanchoring tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
