import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-global-library-hardening-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-global-library-hardening-'));
const userData = path.join(scratch, 'profile');
const backupRoot = path.join(scratch, 'backups');
const root = path.join(backupRoot, 'nodus-library');
const outside = path.join(scratch, 'outside');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

async function exists(file) {
  try { await access(file, constants.F_OK); return true; }
  catch { return false; }
}

try {
  const { writeGlobalPrefsRaw } = require(path.join(repoRoot, 'electron/db/appPrefs.ts'));
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { assertInside, safeLibraryFolderName } = require(path.join(repoRoot, 'electron/library/libraryPaths.ts'));
  const reader = require(path.join(repoRoot, 'electron/libraryReader/libraryReaderStore.ts'));

  writeGlobalPrefsRaw({ autoBackupFolder: backupRoot });
  const store = new LibraryDiskStore(root, 'hardening-device-0001');
  store.initialize();
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, 'secret.png'), Buffer.from('not-a-real-image-but-still-private'));
  await writeFile(path.join(outside, 'secret.pdf'), '%PDF-1.4 private fixture\n');

  assert.doesNotMatch(safeLibraryFolderName('../outside'), /[\\/]/, 'stable ids cannot create path components');
  assert.throws(() => assertInside(root, path.join(root, '..', 'outside')), /ruta de biblioteca/);

  const folder = store.itemFolder('SAFEITEM');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const markdown = '# Documento seguro\n\n![Traversal](../outside/secret.png)\n\n![Symlink](assets/secret.png)\n';
  await writeFile(path.join(folder, 'reader.md'), markdown, 'utf8');
  store.upsertItem({
    id: 'zotero:SAFEITEM', storageId: 'SAFEITEM', source: 'zotero', sourceLibraryId: 'users/0', sourceKey: 'SAFEITEM',
    metadata: { title: 'Documento seguro', itemType: 'document', creators: [], isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [],
    files: { reader: 'reader.md', original: 'attachments/secret.pdf', annotations: 'state/annotations.json', chat: 'state/chat.json' },
    extraction: { status: 'ready' },
  });

  let symlinksAvailable = true;
  try {
    await mkdir(path.join(folder, 'attachments'), { recursive: true });
    await symlink(path.join(outside, 'secret.png'), path.join(folder, 'assets', 'secret.png'), 'file');
    await symlink(path.join(outside, 'secret.pdf'), path.join(folder, 'attachments', 'secret.pdf'), 'file');
    await rm(path.join(folder, 'state'), { recursive: true, force: true });
    await symlink(outside, path.join(folder, 'state'), 'dir');
  } catch {
    symlinksAvailable = false;
    await rm(path.join(folder, 'assets', 'secret.png'), { force: true });
    await rm(path.join(folder, 'attachments', 'secret.pdf'), { force: true });
    await rm(path.join(folder, 'state'), { recursive: true, force: true });
    await mkdir(path.join(folder, 'state'), { recursive: true });
    await writeFile(path.join(folder, 'state', 'annotations.json'), '[]\n', 'utf8');
  }

  const document = reader.getLibraryReaderDocument('zotero:SAFEITEM');
  assert.ok(document);
  assert.doesNotMatch(document.markdown, /data:image/, 'paths outside the item are never inlined into renderer Markdown');
  if (symlinksAvailable) assert.equal(document.originalAvailable, false, 'an external original symlink is not exposed by the custom protocol');

  const selectedText = 'Documento seguro';
  reader.createLibraryReaderAnnotation('zotero:SAFEITEM', {
    draftId: 'zotero:SAFEITEM', scope: 'source', kind: 'highlight', color: 'yellow',
    startOffset: 2, endOffset: 2 + selectedText.length, selectedText, prefix: '', suffix: '', comment: null,
  });
  reader.saveLibraryReaderChatMessages('zotero:SAFEITEM', [{
    id: 'message-1', role: 'user', content: 'Pregunta local', createdAt: new Date().toISOString(),
  }]);
  assert.equal(await exists(path.join(outside, 'annotations.json')), false, 'annotations cannot be written through an external symlink');
  assert.equal(await exists(path.join(outside, 'chat.json')), false, 'chat cannot be written through an external symlink');
  const annotationsFile = path.join(folder, symlinksAvailable ? 'annotations.json' : 'state/annotations.json');
  const chatFile = path.join(folder, symlinksAvailable ? 'chat.json' : 'state/chat.json');
  assert.equal(JSON.parse(await readFile(annotationsFile, 'utf8')).length, 1);
  assert.equal(JSON.parse(await readFile(chatFile, 'utf8')).length, 1);
  if (process.platform !== 'win32') {
    assert.equal((await lstat(annotationsFile)).mode & 0o777, 0o600, 'new annotation sidecars are private to the local account');
    assert.equal((await lstat(chatFile)).mode & 0o777, 0o600, 'new chat sidecars are private to the local account');
  }

  if (symlinksAvailable) {
    const externalItem = path.join(outside, 'external-item');
    await mkdir(externalItem, { recursive: true });
    await writeFile(path.join(externalItem, 'reader.md'), '# External secret\n', 'utf8');
    await writeFile(path.join(externalItem, 'metadata.json'), JSON.stringify({
      format: 'nodus.library-item', formatVersion: 1, id: 'zotero:EVILITEM', storageId: 'EVILITEM', source: 'zotero',
      sourceLibraryId: 'users/0', sourceKey: 'EVILITEM',
      metadata: { title: 'External secret', itemType: 'document', creators: [], isbn: [], issn: [], tags: [] },
      collectionIds: [], attachments: [], files: { reader: 'reader.md' }, extraction: { status: 'ready' },
      createdAt: new Date().toISOString(), deletedAt: null,
      clock: { deviceId: 'external-device', revision: 1, baseRevision: 0, updatedAt: new Date().toISOString(), contentHash: 'a'.repeat(64) },
    }), 'utf8');
    await symlink(externalItem, path.join(root, 'EVILITEM'), 'dir');
    assert.equal(reader.getLibraryReaderDocument('zotero:EVILITEM'), null, 'an item folder symlink cannot leave nodus-library');
  }

  console.log('Global Library path containment, private sidecar and symlink hardening tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
