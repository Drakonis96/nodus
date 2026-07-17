// F2 — PDF utilities (B1–B7) exercised against real fixtures. The Electron-free
// pdfOps module is esbuild-bundled and driven directly; every assertion is on the
// *content* of the produced PDF (page count, per-page text, rotation, page size,
// round-tripped metadata, decodable extracted image) — never mere file existence.
//
// The bundle is written under node_modules so pdfOps' runtime `createRequire`
// resolves the external pdfjs-dist / @napi-rs/canvas from the repo (extract-images
// needs pdfjs at run time). Produced PDFs are read back with pdfjs imported here.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTextPdf, buildSecondPdf, buildScannedPdf, buildPng, buildPhoto } from './toolkit-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const { loadImage } = require('@napi-rs/canvas');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

// Bundle inside node_modules so the module's own pdfjs/canvas requires resolve.
const bundleDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-toolkit-pdf-'));
const fxDir = await mkdtemp(path.join((await import('node:os')).tmpdir(), 'nodus-tk-pdf-fx-'));
const bundle = path.join(bundleDir, 'pdfOps.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/toolkit/convert/pdfOps.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    '--external:pdfjs-dist', '--external:@napi-rs/canvas',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const { pdfOps } = require(bundle);

test.after(async () => {
  await rm(bundleDir, { recursive: true, force: true });
  await rm(fxDir, { recursive: true, force: true });
});

function ctx(options = {}) {
  return { request: {}, outputFormat: null, options, signal: { cancelled: false }, onPageProgress() {} };
}
async function readDoc(bytes) {
  return pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
}
async function pageText(bytes, pageNumber) {
  const doc = await readDoc(bytes);
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((it) => (typeof it.str === 'string' ? it.str : '')).join(' ');
}
async function pageCount(bytes) {
  return (await readDoc(bytes)).numPages;
}

const sampleA = await buildTextPdf(fxDir);
const sampleB = await buildSecondPdf(fxDir);

test('B1 — merge concatenates page counts and preserves both texts', async () => {
  const [out] = await pdfOps['pdf-merge'].run([sampleA, sampleB], ctx());
  assert.equal(await pageCount(out.data), 4);
  assert.match(await pageText(out.data, 1), /Introduccion General/);
  assert.match(await pageText(out.data, 4), /Anexo Documental/);
});

test('B2 — split (single) keeps exactly the chosen pages in order', async () => {
  const [out] = await pdfOps['pdf-split'].run([sampleA], ctx({ ranges: '1,3', mode: 'single' }));
  assert.equal(await pageCount(out.data), 2);
  assert.match(await pageText(out.data, 1), /Introduccion General/);
  assert.match(await pageText(out.data, 2), /Resultados y Conclusiones/);
  assert.doesNotMatch(await pageText(out.data, 1), /Metodo del Estudio/);
});

test('B2 — split (per page) yields one single-page PDF per page, suffixed', async () => {
  const produced = await pdfOps['pdf-split'].run([sampleA], ctx({ ranges: '1-2', mode: 'perPage' }));
  assert.equal(produced.length, 2);
  assert.deepEqual(produced.map((p) => p.suffix), ['-p01', '-p02']);
  for (const p of produced) assert.equal(await pageCount(p.data), 1);
  assert.match(await pageText(produced[1].data, 1), /Metodo del Estudio/);
});

test('B3 — rotate writes the expected /Rotate and stays re-openable', async () => {
  const [out] = await pdfOps['pdf-rotate'].run([sampleA], ctx({ angle: '90', ranges: '' }));
  const doc = await readDoc(out.data);
  assert.equal(doc.numPages, 3);
  for (let p = 1; p <= 3; p++) assert.equal((await doc.getPage(p)).rotate, 90);
});

test('B4 — reorder rebuilds pages in the given order and drops omitted ones', async () => {
  const [out] = await pdfOps['pdf-reorder'].run([sampleA], ctx({ order: '3,1' }));
  assert.equal(await pageCount(out.data), 2);
  assert.match(await pageText(out.data, 1), /Resultados y Conclusiones/);
  assert.match(await pageText(out.data, 2), /Introduccion General/);
});

test('B5 — extract embedded images yields canvas-decodable PNGs', async () => {
  const scanned = await buildScannedPdf(fxDir, 'scan-for-extract.pdf');
  const produced = await pdfOps['pdf-extract-images'].run([scanned], ctx());
  assert.ok(produced.length >= 1, `expected at least one image, got ${produced.length}`);
  for (const p of produced) {
    assert.equal(p.ext, 'png');
    const img = await loadImage(Buffer.from(p.data));
    assert.ok(img.width > 0 && img.height > 0);
  }
});

test('B6 — images→PDF makes one page per image sized to the image', async () => {
  const png = buildPng(fxDir, 'small.png', { width: 300, height: 200 });
  const jpg = buildPhoto(fxDir, 'photo.jpg', { width: 640, height: 480 });
  const [out] = await pdfOps['images-to-pdf'].run([png, jpg], ctx());
  const doc = await readDoc(out.data);
  assert.equal(doc.numPages, 2);
  const v1 = (await doc.getPage(1)).getViewport({ scale: 1 });
  assert.equal(Math.round(v1.width), 300);
  assert.equal(Math.round(v1.height), 200);
  const v2 = (await doc.getPage(2)).getViewport({ scale: 1 });
  assert.equal(Math.round(v2.width), 640);
  assert.equal(Math.round(v2.height), 480);
});

test('B7 — metadata round-trips: write → reload → equal', async () => {
  const [out] = await pdfOps['pdf-metadata'].run(
    [sampleA],
    ctx({ title: 'Mi Titulo', author: 'Autora Ejemplo', subject: 'Pruebas', keywords: 'uno, dos, tres' }),
  );
  const reloaded = await PDFDocument.load(out.data);
  assert.equal(reloaded.getTitle(), 'Mi Titulo');
  assert.equal(reloaded.getAuthor(), 'Autora Ejemplo');
  assert.equal(reloaded.getSubject(), 'Pruebas');
  const keywords = reloaded.getKeywords() ?? '';
  for (const k of ['uno', 'dos', 'tres']) assert.match(keywords, new RegExp(k));
});
