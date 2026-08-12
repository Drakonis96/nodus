import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-recovery-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-recovery-'));
const userData = path.join(scratch, 'user-data');
const root = path.join(scratch, 'backups', 'nodus-library');
const catalogPath = path.join(userData, 'library', 'catalog.sqlite');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

const analysis = {
  lightStatus: 'done', deepStatus: 'done', summaryStatus: 'done', ideaCount: 2,
  passageCount: 3, evidenceCount: 1, gapCount: 0, hasSummary: true, hasNotes: true, archived: false,
};

try {
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { LibraryOperations } = require(path.join(repoRoot, 'electron/library/libraryOperations.ts'));
  const store = new LibraryDiskStore(root, 'recovery-device');
  let catalog = new LibraryCatalog(catalogPath);
  let operations = new LibraryOperations(store, catalog);

  const makeItem = async (id, title, deleted = false) => {
    const folder = store.itemFolder(id); await mkdir(path.join(folder, 'attachments'), { recursive: true });
    const payload = `attachment:${id}`; const sha256 = createHash('sha256').update(payload).digest('hex');
    await writeFile(path.join(folder, 'attachments', 'original.pdf'), payload);
    await writeFile(path.join(folder, 'reader.md'), `# ${title}\n`);
    await writeFile(path.join(folder, 'annotations.json'), JSON.stringify([{ id: `annotation:${id}`, documentId: id }]));
    await writeFile(path.join(folder, 'orphaned-annotations.json'), JSON.stringify([{ id: `orphan:${id}`, documentId: id }]));
    await writeFile(path.join(folder, 'chat.json'), JSON.stringify([{ id: `chat:${id}`, role: 'user', content: title, createdAt: new Date(0).toISOString() }]));
    return store.upsertItem({
      id, storageId: id, source: 'nodus',
      metadata: { title, itemType: 'document', creators: [], year: 2024, isbn: [], issn: [], tags: [] },
      collectionIds: [], attachments: [{ id: `attachment:${id}`, title: 'Original', fileName: 'original.pdf', relativePath: 'attachments/original.pdf', mimeType: 'application/pdf', byteSize: payload.length, sha256, role: 'original' }],
      notes: [{ id: `note:${id}`, title: 'Note', markdown: title, source: 'nodus', readOnly: false, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }],
      relations: [], files: { original: 'attachments/original.pdf', reader: 'reader.md', annotations: 'annotations.json', orphanedAnnotations: 'orphaned-annotations.json', chat: 'chat.json' },
      extraction: { status: 'ready' }, deletedAt: deleted ? new Date(0).toISOString() : null,
    });
  };

  const linkedTrash = await makeItem('nodus:linked-trash', 'Linked trash', true);
  const purgeable = await makeItem('nodus:purgeable', 'Purgeable', true);
  const canonical = await makeItem('nodus:canonical', 'Duplicate title');
  const duplicate = await makeItem('nodus:duplicate', 'Duplicate title');
  const related = await makeItem('nodus:related', 'Related');
  store.upsertItem({ ...related, relations: [{ id: 'relation:duplicate', targetItemId: duplicate.id, relationType: 'related', createdAt: new Date(0).toISOString() }] }, related.clock.revision);
  catalog.rebuild(store);
  catalog.upsertVaultLinks([
    { itemId: linkedTrash.id, vaultId: 'vault:linked', vaultName: 'Linked vault', vaultType: 'academic', workId: 'work:linked', analysis },
    { itemId: duplicate.id, vaultId: 'vault:merge', vaultName: 'Merge vault', vaultType: 'academic', workId: 'work:duplicate', analysis },
  ]);

  const trash = operations.trashImpact([]);
  assert.equal(trash.items.length, 2, 'an empty selection previews the complete trash');
  assert.equal(trash.purgeBlocked, true);
  assert.match(trash.blockers.join(' '), /Linked vault/);
  assert.throws(() => operations.purgeTrash([linkedTrash.id]), /vinculado/i, 'active vault links block purging');
  const purged = operations.purgeTrash([purgeable.id]);
  assert.equal(purged.purged, 1);
  assert.equal(purged.archivedRecoveryCopies, 1, 'manual emptying keeps a recovery copy outside the active catalogue');
  assert.equal(store.readMaterializedItem(purgeable.storageId), null);
  assert.ok((await readdir(path.join(root, '.nodus', 'recovery', 'purged'))).length > 0);

  const mergePreview = operations.mergeImpact(canonical.id, [duplicate.id]);
  assert.equal(mergePreview.linkedVaultCount, 1);
  assert.equal(mergePreview.vaultWorksPreserved, 1);
  assert.equal(mergePreview.noteCount, 2);
  assert.equal(mergePreview.chatMessageCount, 2);
  const merged = operations.mergeItems(canonical.id, [duplicate.id]);
  assert.ok(merged.aliases.includes(duplicate.id));
  assert.equal(merged.notes.length, 2);
  const mergedChats = JSON.parse(await readFile(path.join(store.itemFolder(merged.storageId), merged.files.chat), 'utf8'));
  assert.equal(mergedChats.length, 2, 'chat histories are preserved during merge');
  const mergedOrphans = JSON.parse(await readFile(path.join(store.itemFolder(merged.storageId), merged.files.orphanedAnnotations), 'utf8'));
  assert.equal(mergedOrphans.length, 2, 'orphaned annotations remain reviewable after merge');
  assert.equal(catalog.listVaultLinks(merged.id).some((link) => link.workId === 'work:duplicate'), true, 'vault links remap without deleting the duplicate vault work');
  assert.equal(store.readMaterializedItem(related.storageId).relations[0].targetItemId, merged.id, 'inbound relations never dangle after merge');

  await writeFile(path.join(store.itemFolder(linkedTrash.storageId), 'attachments', 'original.pdf'), 'damaged');
  const audit = operations.auditRecovery();
  assert.equal(audit.corruptFiles, 1);
  assert.ok(audit.issues.some((issue) => issue.code === 'corrupt-attachment'));

  catalog.close(); await rm(path.dirname(catalogPath), { recursive: true, force: true });
  catalog = new LibraryCatalog(catalogPath); operations = new LibraryOperations(store, catalog);
  catalog.rebuild(store);
  assert.equal(catalog.listVaultLinks(merged.id).some((link) => link.workId === 'work:duplicate'), true, 'vault links rebuild from nodus-library, not SQLite');
  assert.equal(catalog.resolveItemId(duplicate.id), merged.id, 'aliases rebuild from canonical manifests');
  catalog.close();

  console.log('Library trash, merge impact, recovery audit and rebuild tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
