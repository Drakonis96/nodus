import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-extraction-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-extraction-'));
const userData = path.join(scratch, 'user-data');
const root = path.join(scratch, 'backups', 'nodus-library');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

function attachment(file, mime) {
  return {
    id: `attachment:${path.basename(file)}`, title: path.basename(file), fileName: path.basename(file),
    relativePath: path.basename(file), mimeType: mime, byteSize: 0, sha256: '', role: 'original',
  };
}

try {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const { createCanvas } = require('@napi-rs/canvas');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const canvas = createCanvas(220, 220);
  const context = canvas.getContext('2d');
  context.fillStyle = '#f8fafc'; context.fillRect(0, 0, 220, 220);
  context.fillStyle = '#2563eb'; context.fillRect(20, 140, 40, 60);
  context.fillStyle = '#16a34a'; context.fillRect(90, 80, 40, 120);
  context.fillStyle = '#f97316'; context.fillRect(160, 30, 40, 170);
  const embedded = await pdf.embedPng(canvas.toBuffer('image/png'));
  for (let pageNumber = 1; pageNumber <= 3; pageNumber += 1) {
    const page = pdf.addPage([595, 842]);
    page.drawText('REVISTA DE HISTORIA · 2026', { x: 80, y: 810, size: 8, font });
    page.drawText(String(pageNumber), { x: 290, y: 18, size: 8, font });
    if (pageNumber === 1) {
      page.drawText('Entre norma y deseo', { x: 70, y: 760, size: 24, font: bold });
      page.drawText('Introducción', { x: 70, y: 715, size: 16, font: bold });
      page.drawText('Este estudio inter-', { x: 70, y: 680, size: 11, font });
      page.drawText('disciplinar evita  espacios dobles y conserva la puntuación .', { x: 70, y: 664, size: 11, font });
      page.drawText('Tabla 1. Resultados', { x: 70, y: 610, size: 11, font: bold });
      const rows = [['Año', 'Mujeres', 'Total'], ['1940', '120', '500'], ['1941', '135', '520']];
      rows.forEach((row, rowIndex) => row.forEach((cell, column) => page.drawText(cell, {
        x: [70, 220, 370][column], y: 585 - rowIndex * 20, size: 10, font,
      })));
    } else if (pageNumber === 2) {
      page.drawText('Resultados', { x: 70, y: 760, size: 16, font: bold });
      page.drawText('Los resultados confirman la hipótesis planteada.', { x: 70, y: 725, size: 11, font });
      page.drawImage(embedded, { x: 180, y: 420, width: 220, height: 220 });
      page.drawText('Figura 1. Distribución de resultados', { x: 170, y: 400, size: 10, font });
    } else {
      page.drawText('Conclusiones', { x: 70, y: 760, size: 16, font: bold });
      page.drawText('La conclusión mantiene separado el original del texto limpio.', { x: 70, y: 725, size: 11, font });
    }
  }
  const pdfBytes = Buffer.from(await pdf.save());

  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { LibraryExtractionQueue } = require(path.join(repoRoot, 'electron/library/libraryExtractionQueue.ts'));
  const store = new LibraryDiskStore(root, 'extract-device-0001');
  store.initialize();
  const folder = store.itemFolder('EXTRACT01');
  await mkdir(folder, { recursive: true });
  const original = path.join(folder, 'original.pdf');
  await writeFile(original, pdfBytes);
  const originalHash = createHash('sha256').update(pdfBytes).digest('hex');
  const item = store.upsertItem({
    id: 'zotero:EXTRACT01', storageId: 'EXTRACT01', source: 'zotero', sourceLibraryId: 'users/0', sourceKey: 'EXTRACT01',
    metadata: { title: 'Entre norma y deseo', itemType: 'article-journal', creators: [], year: 2020, isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [attachment('original.pdf', 'application/pdf')],
    files: { original: 'original.pdf', annotations: 'annotations.json' }, extraction: { status: 'pending' },
  });
  const catalog = new LibraryCatalog(path.join(userData, 'library', 'catalog.sqlite'));
  catalog.rebuild(store);
  const progress = [];
  const queue = new LibraryExtractionQueue({ store, catalog, onProgress: (value) => progress.push(value) });
  const enqueued = queue.enqueue([item.id], { ocrMode: 'off' });
  assert.equal(enqueued.queued, 1);
  await queue.waitForIdle(30_000);
  assert.equal(catalog.getExtractionJob(enqueued.jobIds[0]).status, 'done');
  const markdown = await readFile(path.join(folder, 'reader.md'), 'utf8');
  assert.match(markdown, /^# Entre norma y deseo/m);
  assert.match(markdown, /interdisciplinar evita espacios dobles/);
  assert.doesNotMatch(markdown, /REVISTA DE HISTORIA/, 'repeated page chrome is removed');
  assert.doesNotMatch(markdown, / {2,}/, 'normalizer leaves no accidental double spaces');
  assert.match(markdown, /\| Año \| Mujeres \| Total \|/);
  assert.match(markdown, /!\[Figura 1\. Distribución de resultados\]\(assets\//);
  const assets = await readdir(path.join(folder, 'assets'));
  assert.ok(assets.some((file) => file.endsWith('.png')));
  const sourceMap = JSON.parse(await readFile(path.join(folder, 'source-map.json'), 'utf8'));
  const quality = JSON.parse(await readFile(path.join(folder, 'quality-report.json'), 'utf8'));
  assert.equal(sourceMap.pages.length, 3);
  assert.equal(sourceMap.source.sha256, originalHash);
  assert.equal(sourceMap.reader.sha256, createHash('sha256').update(markdown).digest('hex'));
  assert.ok(sourceMap.blocks.every((block) => markdown.slice(block.markdown.start, block.markdown.end).length > 0));
  assert.equal(quality.doubleSpaces, 0);
  assert.equal(quality.softHyphens, 0);
  assert.equal(quality.brokenWordLineWraps, 0);
  assert.ok(quality.tables >= 1);
  assert.ok(quality.figures >= 1);
  assert.equal(createHash('sha256').update(await readFile(original)).digest('hex'), originalHash, 'extraction never mutates the original');
  assert.ok(['ready', 'needs-review'].includes(store.readMaterializedItem('EXTRACT01').extraction.status));
  assert.ok(progress.some((value) => value.phase === 'assets'));

  // A job left processing by a shutdown is reset to queued and resumed by the next queue.
  queue.dispose();
  const textFolder = store.itemFolder('TEXT01');
  await mkdir(textFolder, { recursive: true });
  await writeFile(path.join(textFolder, 'original.txt'), 'Documento de texto\n\nContenido reanudado sin  espacios dobles.');
  const textItem = store.upsertItem({
    id: 'nodus:TEXT01', storageId: 'TEXT01', source: 'nodus',
    metadata: { title: 'Documento de texto', itemType: 'document', creators: [], year: 2026, isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [attachment('original.txt', 'text/plain')], files: { original: 'original.txt' }, extraction: { status: 'pending' },
  });
  const interrupted = {
    id: 'interrupted-job', itemId: textItem.id, status: 'processing', phase: 'extract', progress: 0.4, priority: 2,
    options: { ocrMode: 'off', ocrLanguages: 'spa+eng', maxOcrPages: 10, extractImages: true, detectTables: true, force: false },
    attempts: 1, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  catalog.putExtractionJob(interrupted);
  const resumedQueue = new LibraryExtractionQueue({ store, catalog });
  await resumedQueue.waitForIdle(10_000);
  assert.equal(catalog.getExtractionJob('interrupted-job').status, 'done');
  assert.match(await readFile(path.join(textFolder, 'reader.md'), 'utf8'), /sin espacios dobles/);

  // Cancellation is durable and returns a processing item to pending.
  resumedQueue.dispose();
  const cancelFolder = store.itemFolder('CANCEL01');
  await mkdir(cancelFolder, { recursive: true });
  await writeFile(path.join(cancelFolder, 'original.txt'), 'Cancelar esta extracción.');
  const cancelItem = store.upsertItem({
    id: 'nodus:CANCEL01', storageId: 'CANCEL01', source: 'nodus',
    metadata: { title: 'Cancelar', itemType: 'document', creators: [], year: 2026, isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [attachment('original.txt', 'text/plain')], files: { original: 'original.txt' }, extraction: { status: 'pending' },
  });
  const slowExtract = async ({ signal }) => {
    for (let index = 0; index < 100; index += 1) {
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const cancelQueue = new LibraryExtractionQueue({ store, catalog, extract: slowExtract });
  const cancelJob = cancelQueue.enqueue([cancelItem.id]).jobIds[0];
  while (catalog.getExtractionJob(cancelJob).status !== 'processing') await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cancelQueue.cancel(cancelJob), true);
  await cancelQueue.waitForIdle(5_000);
  assert.equal(catalog.getExtractionJob(cancelJob).status, 'canceled');
  assert.equal(store.readMaterializedItem('CANCEL01').extraction.status, 'pending');
  cancelQueue.dispose();
  catalog.close();
  console.log('Clean Markdown extraction, assets, source maps, persistent queue, resume and cancellation tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
