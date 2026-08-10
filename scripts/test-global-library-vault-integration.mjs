import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-global-library-vault-integration-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-global-vault-link-'));
const userData = path.join(scratch, 'profile');
const backupRoot = path.join(scratch, 'backups');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

try {
  const { writeGlobalPrefsRaw } = require(path.join(repoRoot, 'electron/db/appPrefs.ts'));
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const library = require(path.join(repoRoot, 'electron/library/libraryService.ts'));
  const { withVaultDatabase, getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { getWorkByZoteroKey } = require(path.join(repoRoot, 'electron/db/worksRepo.ts'));
  const { resolveWorkText } = require(path.join(repoRoot, 'electron/extraction/textExtractor.ts'));
  const { createVault } = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));

  writeGlobalPrefsRaw({ autoBackupFolder: backupRoot });
  const store = new LibraryDiskStore(path.join(backupRoot, 'nodus-library'), 'vault-link-device');
  store.initialize();
  const vault = library.listGlobalLibraryVaults()[0];
  assert.ok(vault?.id);
  const folder = store.itemFolder('LIBKEY01');
  await mkdir(folder, { recursive: true });
  const markdown = '# Documento transversal\n\nTexto limpio usado por todos los análisis.\n';
  await writeFile(path.join(folder, 'reader.md'), markdown, 'utf8');
  store.upsertItem({
    id: 'zotero:LIBKEY01', storageId: 'LIBKEY01', source: 'zotero', sourceLibraryId: 'users/0', sourceKey: 'LIBKEY01',
    metadata: {
      title: 'Documento transversal', itemType: 'article-journal', year: 2026,
      creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }],
      doi: '10.1000/transverse', isbn: [], issn: [], tags: ['global'],
    },
    collectionIds: [], attachments: [], files: { reader: 'reader.md', annotations: 'annotations.json', chat: 'chat.json' }, extraction: { status: 'ready' },
  });
  store.upsertItem({
    id: 'nodus:canonical-local', storageId: 'legacy-local-folder', source: 'nodus',
    aliases: ['nodus:old-local-alias'], sourceIdentities: [], vaultWorkIds: { [vault.id]: 'legacy-local-work' },
    metadata: { title: 'Legacy local work', itemType: 'report', creators: [], year: 2025, isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [], extraction: { status: 'unsupported' },
  });

  library.rebuildGlobalLibrary();
  const report = await library.linkGlobalLibraryItemsToVault(['zotero:LIBKEY01'], vault.id);
  assert.equal(report.linked, 1);
  assert.equal(report.links[0].itemId, 'zotero:LIBKEY01');
  assert.equal(library.listGlobalLibraryVaultLinks('zotero:LIBKEY01').length, 1);

  await withVaultDatabase(vault.id, () => {
    const work = getWorkByZoteroKey('LIBKEY01');
    assert.ok(work, 'the vault gets a stable, analyzable work reference');
    const row = getDb().prepare('SELECT source_type FROM works WHERE nodus_id=?').get(work.nodus_id);
    assert.equal(row.source_type, 'markdown');
  });
  const resolved = await resolveWorkText('0', 'LIBKEY01', '', null, null, {
    unpaywallEmail: '', preferZoteroFulltext: true, ocr: { enabled: false, languages: 'spa+eng', maxPages: 0 },
  });
  assert.equal(resolved.text, markdown);
  assert.equal(resolved.sourceType, 'markdown');

  const again = await library.linkGlobalLibraryItemsToVault(['zotero:LIBKEY01'], vault.id);
  assert.equal(again.existing, 1, 'linking twice is idempotent');
  const local = await library.linkGlobalLibraryItemsToVault(['nodus:old-local-alias'], vault.id);
  assert.equal(local.links[0].workId, 'legacy-local-work', 'a migrated Nodus alias relinks to its original vault workId');
  const localAgain = await library.linkGlobalLibraryItemsToVault(['nodus:canonical-local'], vault.id);
  assert.equal(localAgain.links[0].workId, 'legacy-local-work');
  const connectedReader = createVault('Connected reader', 'academic', {
    origin: 'connected',
    remote: {
      url: 'https://server.invalid', spaceId: 'space-reader', spaceName: 'Read only',
      serverName: 'Fixture', userEmail: 'reader@example.invalid', role: 'reader', state: 'active',
      lastPulledRevision: null, lastPulledAt: null,
    },
  });
  await assert.rejects(
    library.linkGlobalLibraryItemsToVault(['zotero:LIBKEY01'], connectedReader.id),
    /solo lectura|no está activo/,
    'a connected reader vault never receives a local write',
  );
  library.closeGlobalLibrary();
  closeDb();
  console.log('Global Library → vault reference, clean Markdown resolution and idempotency tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
