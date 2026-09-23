import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-local-ocr')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-documentary-ocr-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const cache = path.join(root, 'tessdata');
fs.mkdirSync(cache);
process.env.NODUS_TESSDATA_CACHE = cache;
try {
  const { installedOcrOptions } = load('electron/extraction/ocr.ts');
  assert.throws(() => installedOcrOptions('eng'), /resources_missing/);
  assert.throws(() => installedOcrOptions('../eng'), /resources_missing/);
  const { buildScannedPdf } = await import('./toolkit-fixtures.mjs');
  const file = await buildScannedPdf(root, 'scan.pdf', [['The quick brown fox'], ['Second scanned page']]);
  const { LibraryDiskStore } = load('electron/library/libraryStorage.ts');
  const { extractLibraryItem } = load('electron/library/libraryExtractionEngine.ts');
  const store = new LibraryDiskStore(path.join(root, 'library'), 'fixture-local-ocr');
  const folder = store.itemFolder('scan');
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(file, path.join(folder, 'original.pdf'));
  const item = store.upsertItem({
    id: 'local:scan', storageId: 'scan', source: 'local',
    metadata: { title: 'Synthetic scan', itemType: 'book', creators: [], isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [], files: { original: 'original.pdf' }, extraction: { status: 'pending' },
  });
  const events = [];
  let remoteCalls = 0;
  const options = { item, store, extractionOptions: { ocrMode: 'local', localOcrOnly: true, ocrLanguages: 'eng', maxOcrPages: 100 },
    onProgress: event => events.push(event), remoteOcr: async () => { remoteCalls++; throw new Error('unexpected_remote_ocr'); } };
  await assert.rejects(() => extractLibraryItem(options), /resources_missing/);
  assert.equal(remoteCalls, 0);
  assert.equal(store.readMaterializedItem('scan').files.reader, undefined, 'missing resources publish no misleading full-text revision');
  const installed = path.join(repoRoot, 'scripts/.cache/tessdata/eng.traineddata');
  if (!fs.existsSync(installed)) throw new Error('Provide installed eng.traineddata through NODUS_RESEARCH_TESSDATA; this test never downloads resources.');
  fs.copyFileSync(installed, path.join(cache, 'eng.traineddata'));
  fs.symlinkSync(installed, path.join(cache, 'escaped.traineddata'));
  assert.throws(() => installedOcrOptions('escaped'), /resources_missing/, 'reject resources escaping the configured cache');
  const controller = new AbortController();
  await assert.rejects(() => extractLibraryItem({ ...options, signal: controller.signal, onProgress: event => { if (event.phase === 'ocr') controller.abort(); } }), /abort/i);
  assert.equal(store.readMaterializedItem('scan').files.reader, undefined, 'cancelled OCR publishes nothing');
  const result = await extractLibraryItem(options);
  const text = fs.readFileSync(path.join(folder, result.item.files.reader), 'utf8');
  assert.match(text, /quick brown fox/i);
  assert.match(text, /second scanned page/i);
  assert.equal(result.quality.ocrPages, 2);
  assert.ok(events.some(event => event.phase === 'ocr' && event.page === 2 && event.totalPages === 2));
  assert.ok(result.sourceMap.blocks.some(block => block.anchors.some(anchor => anchor.page === 2)), 'OCR evidence keeps real physical page anchors');
  assert.equal(remoteCalls, 0);
  console.log('Installed-only real OCR: missing resource block, no remote fallback, cancellation, both scanned pages and physical page provenance passed.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
