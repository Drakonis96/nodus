import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-responsiveness-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-responsive-'));
const userData = path.join(scratch, 'user-data');
const root = path.join(scratch, 'backups', 'nodus-library');
const extractionWorker = path.join(scratch, 'extraction-worker.cjs');
const operationWorker = path.join(scratch, 'operation-worker.cjs');
const readerWorker = path.join(scratch, 'reader-worker.cjs');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

async function assertEventLoopResponsive(promise, label, minimumTicks = 12) {
  let ticks = 0;
  let largestGap = 0;
  let previous = performance.now();
  const interval = setInterval(() => {
    const current = performance.now();
    largestGap = Math.max(largestGap, current - previous);
    previous = current;
    ticks += 1;
  }, 10);
  const result = await promise;
  clearInterval(interval);
  assert.ok(ticks >= minimumTicks, `${label} starved the event loop (${ticks} timer ticks)`);
  assert.ok(largestGap < 150, `${label} blocked the event loop for ${largestGap.toFixed(0)} ms`);
  return result;
}

try {
  await mkdir(root, { recursive: true });
  await writeFile(extractionWorker, `
    const { parentPort } = require('node:worker_threads');
    parentPort.once('message', (request) => {
      parentPort.postMessage({ kind: 'progress', progress: { phase: 'ocr', progress: 0.5, message: 'fixture' } });
      const until = Date.now() + 500;
      while (Date.now() < until) Math.sqrt(Math.random());
      parentPort.postMessage({ kind: 'done', result: { item: request.item, report: { worker: true } } });
    });
  `);
  await writeFile(operationWorker, `
    const { parentPort } = require('node:worker_threads');
    parentPort.once('message', () => {
      const until = Date.now() + 500;
      while (Date.now() < until) Math.sqrt(Math.random());
      parentPort.postMessage({ ok: true, result: 42 });
    });
  `);
  await writeFile(readerWorker, `
    const { parentPort } = require('node:worker_threads');
    parentPort.once('message', (request) => {
      const until = Date.now() + 500;
      while (Date.now() < until) Math.sqrt(Math.random());
      parentPort.postMessage({ ok: true, result: request.operation === 'attachment-content'
        ? { attachmentId: request.task.attachmentId, viewer: 'text', text: 'worker reader', html: null, chapters: [] }
        : true });
    });
  `);
  process.env.NODUS_LIBRARY_EXTRACTION_WORKER_FILE = extractionWorker;
  process.env.NODUS_LIBRARY_OPERATION_WORKER_FILE = operationWorker;
  process.env.NODUS_LIBRARY_READER_WORKER_FILE = readerWorker;

  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { LibraryOperations } = require(path.join(repoRoot, 'electron/library/libraryOperations.ts'));
  const { writeGlobalPrefsRaw } = require(path.join(repoRoot, 'electron/db/appPrefs.ts'));
  const extractionHost = require(path.join(repoRoot, 'electron/library/libraryExtractionWorkerHost.ts'));
  const operationHost = require(path.join(repoRoot, 'electron/library/libraryOperationWorkerHost.ts'));
  const readerHost = require(path.join(repoRoot, 'electron/libraryReader/libraryReaderWorkerHost.ts'));
  writeGlobalPrefsRaw({ autoBackupFolder: path.dirname(root) });
  const store = new LibraryDiskStore(root, 'responsiveness-device');
  store.initialize();
  const catalog = new LibraryCatalog(path.join(userData, 'catalog.sqlite'));

  const item = {
    id: 'nodus:responsive', storageId: 'responsive', source: 'nodus', sourceIdentities: [], aliases: [],
    metadata: { title: 'Responsive extraction', itemType: 'journalArticle', creators: [], isbn: [], issn: [], tags: [] },
    citationKey: 'ResponsiveExtraction', collectionIds: [], attachments: [], notes: [], relations: [],
    extraction: { status: 'pending' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    clock: { revision: 1, deviceId: 'responsiveness-device', updatedAt: new Date().toISOString() }, deletedAt: null,
  };
  const progress = [];
  const extractionResult = await assertEventLoopResponsive(extractionHost.extractLibraryItemInWorker({
    item, store, onProgress: (value) => progress.push(value),
  }), 'CPU-heavy extraction');
  assert.equal(extractionResult.report.worker, true);
  assert.equal(progress[0]?.phase, 'ocr');

  const operationResult = await assertEventLoopResponsive(operationHost.runLibraryOperationInWorker(
    { root, deviceId: store.deviceId, catalogFile: catalog.file }, 'rebuild', [],
    () => { throw new Error('The foreground fallback must not run.'); },
  ), 'disk-heavy Library operation');
  assert.equal(operationResult, 42);

  const readerFolder = store.itemFolder('reader-responsive');
  await mkdir(readerFolder, { recursive: true });
  await writeFile(path.join(readerFolder, 'reader.md'), '# Responsive reader\n');
  await writeFile(path.join(readerFolder, 'notes.txt'), 'foreground work is forbidden\n');
  await writeFile(path.join(readerFolder, 'annotations.json'), '[]\n');
  store.upsertItem({
    ...item,
    id: 'nodus:reader-responsive', storageId: 'reader-responsive',
    metadata: { ...item.metadata, title: 'Responsive reader' },
    attachments: [{ id: 'local:notes', title: 'Notes', fileName: 'notes.txt', relativePath: 'notes.txt', mimeType: 'text/plain', byteSize: 30, sha256: 'a'.repeat(64), role: 'supplement', position: 0 }],
    files: { reader: 'reader.md', annotations: 'annotations.json' },
  });
  const readerResult = await assertEventLoopResponsive(
    readerHost.getLibraryReaderAttachmentContentInWorker('nodus:reader-responsive', 'local:notes'),
    'reader attachment parsing',
  );
  assert.equal(readerResult.text, 'worker reader');

  const operations = new LibraryOperations(store, catalog);
  const created = operations.createItem({
    title: 'Incremental item', itemType: 'journalArticle', creators: [], isbn: [], issn: [], tags: [],
  });
  const originalScan = store.scanMaterializedItems.bind(store);
  store.scanMaterializedItems = () => { throw new Error('A single-item mutation performed a whole-library scan.'); };
  const updated = operations.updateItemMetadata(created.id, { title: 'Incrementally updated' });
  assert.equal(updated.metadata.title, 'Incrementally updated');
  assert.equal(catalog.list({ search: 'Incrementally updated' }).total, 1);
  store.scanMaterializedItems = originalScan;

  const queueSource = await readFile(path.join(repoRoot, 'electron/library/libraryExtractionQueue.ts'), 'utf8');
  const serviceSource = await readFile(path.join(repoRoot, 'electron/library/libraryService.ts'), 'utf8');
  const viteSource = await readFile(path.join(repoRoot, 'vite.config.ts'), 'utf8');
  assert.match(queueSource, /options\.extract \?\? extractLibraryItemInWorker/);
  assert.doesNotMatch(queueSource, /catalog\.rebuild/);
  assert.match(serviceSource, /export function getGlobalLibraryStatus\(\)[\s\S]*?return current \? current\.catalog\.status/);
  assert.doesNotMatch(serviceSource.match(/export function getGlobalLibraryStatus\(\)[\s\S]*?\n}/)?.[0] ?? '', /scanMaterializedItems|settleActive/);
  assert.match(viteSource, /libraryExtractionWorker: 'electron\/workers\/libraryExtractionWorker\.ts'/);
  assert.match(viteSource, /libraryOperationWorker: 'electron\/workers\/libraryOperationWorker\.ts'/);
  assert.match(viteSource, /libraryReaderWorker: 'electron\/workers\/libraryReaderWorker\.ts'/);

  // When a production build exists, execute its real ESM worker with Electron's
  // native SQLite ABI. This catches missing shared chunks and accidental imports
  // of main-process-only Electron APIs before packaging.
  const builtOperationWorker = path.join(repoRoot, 'dist-electron', 'libraryOperationWorker.js');
  if (existsSync(builtOperationWorker)) {
    const builtCatalog = path.join(scratch, 'built-worker-catalog.sqlite');
    const builtWorker = new Worker(builtOperationWorker);
    const builtResult = await new Promise((resolve, reject) => {
      builtWorker.once('message', resolve);
      builtWorker.once('error', reject);
      builtWorker.postMessage({
        operation: 'rebuild', root, deviceId: store.deviceId, catalogFile: builtCatalog, args: [],
      });
    });
    await builtWorker.terminate();
    assert.equal(builtResult.ok, true, builtResult.error);
  }

  const builtReaderWorker = path.join(repoRoot, 'dist-electron', 'libraryReaderWorker.js');
  if (existsSync(builtReaderWorker)) {
    const builtWorker = new Worker(builtReaderWorker);
    const builtResult = await new Promise((resolve, reject) => {
      builtWorker.once('message', resolve);
      builtWorker.once('error', reject);
      builtWorker.postMessage({
        operation: 'attachment-content',
        task: { attachmentId: 'local:notes', file: path.join(readerFolder, 'notes.txt'), viewer: 'text' },
      });
    });
    await builtWorker.terminate();
    assert.equal(builtResult.ok, true, builtResult.error);
    assert.equal(builtResult.result.text, 'foreground work is forbidden\n');
  }

  catalog.close();
  extractionHost.disposeLibraryExtractionWorkers();
  operationHost.disposeLibraryOperationWorkers();
  readerHost.disposeLibraryReaderWorkers();
  console.log('Library responsiveness worker/incremental-index tests passed.');
} finally {
  delete process.env.NODUS_LIBRARY_EXTRACTION_WORKER_FILE;
  delete process.env.NODUS_LIBRARY_OPERATION_WORKER_FILE;
  delete process.env.NODUS_LIBRARY_READER_WORKER_FILE;
  await rm(scratch, { recursive: true, force: true });
}
