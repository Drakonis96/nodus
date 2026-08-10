import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
import { buildTextPdf } from './toolkit-fixtures.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-global-library-reader-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-global-reader-'));
const userData = path.join(scratch, 'profile');
const backupRoot = path.join(scratch, 'backups');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

try {
  const { writeGlobalPrefsRaw } = require(path.join(repoRoot, 'electron/db/appPrefs.ts'));
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const readerStore = require(path.join(repoRoot, 'electron/libraryReader/libraryReaderStore.ts'));
  writeGlobalPrefsRaw({ autoBackupFolder: backupRoot });
  const store = new LibraryDiskStore(path.join(backupRoot, 'nodus-library'), 'reader-device-0001');
  store.initialize();
  const folder = store.itemFolder('E7FGXJFE');
  const markdown = '# Mujeres solas en la posguerra\n\n## Introducción\n\nTexto limpio y anotable.\n\n## Conclusiones\n\nResultado final.\n';
  const introduction = markdown.indexOf('## Introducción');
  const conclusions = markdown.indexOf('## Conclusiones');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'reader.md'), markdown);
  await buildTextPdf(folder, 'original.pdf');
  await writeFile(path.join(folder, 'annotations.json'), '[]\n');
  await writeFile(path.join(folder, 'source-map.json'), `${JSON.stringify({
    version: 1,
    pages: [{ page: 1, width: 612, height: 792 }, { page: 2, width: 612, height: 792 }, { page: 3, width: 612, height: 792 }],
    blocks: [
      { kind: 'heading', markdown: { start: introduction, end: introduction + 16 }, anchors: [{ page: 1 }] },
      { kind: 'heading', markdown: { start: conclusions, end: conclusions + 16 }, anchors: [{ page: 2 }] },
    ],
  })}\n`);
  store.upsertItem({
    id: 'zotero:E7FGXJFE', storageId: 'E7FGXJFE', source: 'zotero', sourceLibraryId: 'users/0', sourceKey: 'E7FGXJFE',
    citationKey: 'aliamirandaMujeresSolasPosguerra2017',
    metadata: {
      title: 'Mujeres solas en la posguerra', itemType: 'article-journal', year: 2017,
      creators: [{ creatorType: 'author', firstName: 'María', lastName: 'Aliaga' }], isbn: [], issn: [], tags: [],
    },
    collectionIds: [], attachments: [{
      id: 'zotero:PDF1', title: 'PDF', fileName: 'original.pdf', relativePath: 'original.pdf',
      mimeType: 'application/pdf', byteSize: 1, sha256: 'a'.repeat(64), role: 'original',
    }],
    files: { reader: 'reader.md', original: 'original.pdf', sourceMap: 'source-map.json', annotations: 'annotations.json' },
    extraction: { status: 'ready' },
  });

  const document = readerStore.getLibraryReaderDocument('zotero:E7FGXJFE');
  assert.ok(document);
  assert.equal(document.workId, 'zotero:E7FGXJFE');
  assert.equal(document.storageId, 'E7FGXJFE');
  assert.equal(document.zoteroKey, 'E7FGXJFE');
  assert.deepEqual(document.authors, ['María Aliaga']);
  assert.equal(document.pageCount, 3);
  assert.deepEqual(document.sections.map((section) => section.page), [1, 1, 2]);
  assert.equal(document.originalMimeType, 'application/pdf');
  assert.match(document.originalUrl, /^nodus-library:\/\/original\/zotero%3AE7FGXJFE\?v=/);
  assert.equal(readerStore.libraryReaderOriginalPath('E7FGXJFE'), path.join(folder, 'original.pdf'), 'storage id resolves to the same global document');

  const selectedText = 'Texto limpio';
  const startOffset = markdown.indexOf(selectedText);
  const created = readerStore.createLibraryReaderAnnotation('zotero:E7FGXJFE', {
    draftId: 'zotero:E7FGXJFE', scope: 'source', kind: 'highlight', color: 'yellow',
    startOffset, endOffset: startOffset + selectedText.length, selectedText, prefix: '', suffix: '', comment: null,
  });
  assert.equal(created.draftId, 'zotero:E7FGXJFE');
  assert.equal(readerStore.listLibraryReaderAnnotations('zotero:E7FGXJFE').length, 1);
  const persisted = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(folder, 'annotations.json'), 'utf8'));
  assert.equal(persisted[0].documentId, 'E7FGXJFE', 'annotation identity remains the stable Zotero storage key');
  assert.equal(readerStore.deleteLibraryReaderAnnotation('zotero:E7FGXJFE', created.id), true);
  assert.equal(readerStore.listLibraryReaderAnnotations('zotero:E7FGXJFE').length, 0);
  console.log('Global reader resolution, source mapping, original URL and annotation persistence tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
