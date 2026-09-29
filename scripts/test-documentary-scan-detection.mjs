import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-scan-detection')) process.exit(0);

// Any image-only page used to defer a whole PDF to OCR. Measured on 52 real deferred
// sources, 47 were digital books whose cover, plates or photographs were the only pages
// without text (one had 1,077 pages and 1.8 M characters). A scan is now a document whose
// pages mostly lack text, and it is recognized from a spread sample instead of a full pass.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-scan-detection-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const { LibraryDiskStore } = load('electron/library/libraryStorage.ts');
const { extractLibraryItem } = load('electron/library/libraryExtractionEngine.ts');
const { DOCUMENTARY_EXTRACTION_OPTIONS } = load('electron/ai/documentaryExtraction.ts');
const { inspectOriginalPdf } = load('electron/extraction/researchOriginal.ts');
const scan = load('electron/extraction/scanDetection.ts');

/** 'T' pages carry a text layer, 'I' pages are a photograph with no text. */
async function buildPdf(name, pattern) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const canvas = createCanvas(400, 300);
  const context = canvas.getContext('2d');
  for (let x = 0; x < 400; x += 4) { context.fillStyle = `rgb(${x % 255},90,${255 - (x % 255)})`; context.fillRect(x, 0, 4, 300); }
  const photo = await pdf.embedPng(canvas.toBuffer('image/png'));
  [...pattern].forEach((kind, index) => {
    const page = pdf.addPage([595, 842]);
    if (kind === 'I') page.drawImage(photo, { x: 50, y: 200, width: 495, height: 400 });
    else {
      // Distinct prose per page: repeated lines would be dropped as running headers.
      const places = ['Toledo', 'Seville', 'Granada', 'Cordoba', 'Ronda', 'Cadiz', 'Burgos', 'Leon', 'Avila', 'Segovia', 'Cuenca', 'Teruel'];
      const place = places[index % places.length];
      for (let line = 0; line < 6; line++) {
        page.drawText(`${line ? 'Then' : 'The road from Toledo to Seville'} the traveller reached ${place} on day ${index * 7 + line} and wrote about ${places[(index + line) % places.length]}.`,
          { x: 60, y: 700 - line * 22 - (index % 3) * 9, size: 11, font });
      }
    }
  });
  const file = path.join(root, name);
  fs.writeFileSync(file, await pdf.save());
  return file;
}
let items = 0;
async function extract(file) {
  const store = new LibraryDiskStore(path.join(root, `library-${++items}`), 'scan-detection');
  const folder = store.itemFolder('item'); fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(file, path.join(folder, 'original.pdf'));
  const item = store.upsertItem({ id: 'local:item', storageId: 'item', source: 'local', metadata: { title: 'Fixture', itemType: 'book', creators: [], isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [], files: { original: 'original.pdf' }, extraction: { status: 'pending' } });
  const result = await extractLibraryItem({ item, store, extractionOptions: DOCUMENTARY_EXTRACTION_OPTIONS });
  return { result, markdown: fs.readFileSync(path.join(folder, result.item.files.reader), 'utf8') };
}
try {
  // 1. A digital book with a photographic cover and a plate keeps its text.
  const book = await buildPdf('book.pdf', 'ITTTTITTTTTT');
  const { result, markdown } = await extract(book);
  assert.match(markdown, /road from Toledo to Seville/);
  assert.equal(result.quality.blankPages, 2, 'the image-only pages are reported, not hidden');
  assert.equal((await inspectOriginalPdf({ file: book })).needsOcr, false, 'the preflight agrees with preparation');

  // 2. A few text pages do not make a scan digital: most pages have no text.
  const mostlyScanned = await buildPdf('mostly-scanned.pdf', 'TIIIIIIITIIIIIIIIIIT');
  await assert.rejects(() => extract(mostlyScanned), /documentary_ocr_deferred/);
  assert.equal((await inspectOriginalPdf({ file: mostlyScanned })).needsOcr, true);

  // 3. Mixed documents are counted in full, and the majority decides.
  const plates = await buildPdf('plates.pdf', 'TTITTITTITTITTITTITTITTITTITTI');
  assert.equal((await extract(plates)).result.quality.blankPages, 10);
  assert.equal((await inspectOriginalPdf({ file: plates })).needsOcr, false);

  // 4. A long scan is recognized from the sample without reading every page.
  const { loadPdfjs } = load('electron/extraction/pdfjsLoader.ts');
  const pdfjs = await loadPdfjs();
  const read = new Set();
  const fakeScan = { numPages: 834, getPage: async number => {
    read.add(number);
    return { getTextContent: async () => ({ items: [] }), getOperatorList: async () => ({ fnArray: [pdfjs.OPS.paintImageXObject] }), cleanup() {} };
  } };
  assert.equal(await scan.sampleScanVerdict(fakeScan), 'scan');
  assert.equal(read.size, scan.SCAN_SAMPLE_PAGES, 'an 834-page scan is decided from 16 pages');
  const sample = scan.scanSamplePages(834);
  assert.equal(sample[0], 1); assert.equal(sample.at(-1), 834);
  assert.deepEqual(sample, [...sample].sort((a, b) => a - b));
  assert.deepEqual(scan.scanSamplePages(5), [1, 2, 3, 4, 5], 'a short document is read whole and decided exactly');
  assert.equal(scan.isScannedDocument({ pages: 10, textless: 6, imageOnly: 0, characters: 0 }), false, 'blank leaves without images are not a scan');
  assert.equal(scan.isScannedDocument({ pages: 1077, textless: 3, imageOnly: 1, characters: 1815114 }), false, 'a cover does not defer a book');
  // A real 16-page article: three image pages, the rest a residual layer of 1,051 characters.
  assert.equal(scan.isScannedDocument({ pages: 16, textless: 6, imageOnly: 3, characters: 1051 }), true, 'a sparse residual text layer is still a scan');
  assert.equal(scan.isScannedDocument({ pages: 144, textless: 36, imageOnly: 36, characters: 56085 }), false, 'a photography book with captions keeps its text');
  console.log('Scans are deferred by majority from a spread sample; digital books with image pages keep their text.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
