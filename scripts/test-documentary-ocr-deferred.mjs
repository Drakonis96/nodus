import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-ocr-deferred')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-documentary-ocr-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  let ocrCalls = 0, modelCalls = 0;
  load('electron/extraction/ocr.ts').ocrPdfPages = async () => { ocrCalls++; throw new Error('OCR must stay deferred'); };
  const ai = load('electron/ai/aiClient.ts');
  for (const method of ['complete', 'completeJson', 'embedMany']) ai[method] = async () => { modelCalls++; throw new Error('No model call allowed'); };
  const { buildScannedPdf } = await import('./toolkit-fixtures.mjs');
  const file = await buildScannedPdf(root, 'scan.pdf', [['The quick brown fox'], ['Second scanned page']]);
  const { LibraryDiskStore } = load('electron/library/libraryStorage.ts');
  const { extractLibraryItem } = load('electron/library/libraryExtractionEngine.ts');
  const store = new LibraryDiskStore(path.join(root, 'library'), 'fixture-ocr-deferred');
  const folder = store.itemFolder('scan'); fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(file, path.join(folder, 'original.pdf'));
  const item = store.upsertItem({ id: 'local:scan', storageId: 'scan', source: 'local', metadata: { title: 'Synthetic scan', itemType: 'book', creators: [], isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [], files: { original: 'original.pdf' }, extraction: { status: 'pending' } });
  await assert.rejects(() => extractLibraryItem({ item, store, extractionOptions: { ocrMode: 'off', localOcrOnly: true, maxOcrPages: 0 } }), /ocr_deferred/);
  assert.equal(store.readMaterializedItem('scan').files.reader, undefined, 'a scan cannot publish misleading full-text availability');
  const { readOriginalPages, inspectOriginalPdf } = load('electron/extraction/researchOriginal.ts');
  const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal((await inspectOriginalPdf({ file, sha256 })).needsOcr, true);
  await assert.rejects(() => readOriginalPages({ file, sha256, from: 1, to: 1, maxBytes: 2000, languages: 'eng' }), /ocr_deferred/);
  assert.equal(ocrCalls, 0); assert.equal(modelCalls, 0);
  console.log('Scans are identified and skipped in preparation/original reads without OCR or model calls.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
