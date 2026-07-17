// F4 — OCR (C1–C4) against rendered fixtures. Recognition is real: the first run
// downloads the `eng` traineddata (Tesseract's one network call) into a repo cache
// (scripts/.cache/tessdata); with no network and no cache the test fails, which is
// correct per the plan ("no real processing, no green"). Assertions are on the
// recognised words, page count, a preserved page image, and pixel histograms.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScanImage, buildScannedPdf } from './toolkit-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadImage, createCanvas } = require('@napi-rs/canvas');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

// Persistent traineddata cache so repeat runs don't re-download.
const cacheDir = path.join(repoRoot, 'scripts/.cache/tessdata');
fs.mkdirSync(cacheDir, { recursive: true });
process.env.NODUS_TESSDATA_CACHE = cacheDir;

const bundleDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-toolkit-ocr-'));
const fxDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-tk-ocr-fx-'));
const bundle = path.join(bundleDir, 'ocrOps.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/toolkit/convert/ocrOps.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    '--external:pdfjs-dist', '--external:@napi-rs/canvas', '--external:tesseract.js', '--external:pdf-lib',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const { ocrOps } = require(bundle);

test.after(async () => {
  await rm(bundleDir, { recursive: true, force: true });
  await rm(fxDir, { recursive: true, force: true });
});

function ctx(options = {}) {
  return { request: {}, outputFormat: null, options, signal: { cancelled: false }, onPageProgress() {} };
}
const norm = (bytes) => Buffer.from(bytes).toString('utf8').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
const EN_LINES = ['The quick brown fox', 'jumps over the lazy dog'];
const opts = { languages: 'eng' };

test('C1 — image → text recognises the rendered words', { timeout: 180000 }, async () => {
  const img = buildScanImage(fxDir, 'scan-en.png', EN_LINES, 'png');
  const [out] = await ocrOps['ocr-image-to-txt'].run([img], ctx(opts));
  const text = norm(out.data);
  for (const word of ['quick', 'brown', 'fox', 'lazy']) assert.match(text, new RegExp(`\\b${word}\\b`), `OCR found ${word}`);
});

test('C2 — scanned PDF → text covers both pages', { timeout: 180000 }, async () => {
  const pdf = await buildScannedPdf(fxDir, 'scanned-en.pdf', [
    ['The quick brown fox', 'jumps over'],
    ['Second scanned page', 'with clear words'],
  ]);
  const [out] = await ocrOps['ocr-pdf-to-txt'].run([pdf], ctx(opts));
  const text = norm(out.data);
  assert.match(text, /\bquick\b/);
  assert.match(text, /\bsecond\b/);
  assert.match(text, /\bwords\b/);
});

test('C3 — scanned PDF → searchable PDF keeps pages, images and adds a text layer', { timeout: 180000 }, async () => {
  const pdf = await buildScannedPdf(fxDir, 'scanned-search.pdf', [
    ['The quick brown fox', 'jumps over'],
    ['Second scanned page', 'clear words here'],
  ]);
  const [out] = await ocrOps['ocr-pdf-searchable'].run([pdf], ctx(opts));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(out.data), isEvalSupported: false }).promise;
  assert.equal(doc.numPages, 2, 'same page count');
  let allText = '';
  let hasImage = false;
  for (let p = 1; p <= 2; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    allText += ' ' + content.items.map((it) => (typeof it.str === 'string' ? it.str : '')).join(' ');
    const ops = await page.getOperatorList();
    if (ops.fnArray.some((fn) => fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintJpegXObject)) hasImage = true;
  }
  const text = allText.toLowerCase();
  assert.match(text, /quick/, 'searchable layer contains OCR words');
  assert.match(text, /second|clear|words/, 'second page text present');
  assert.ok(hasImage, 'the original page image is preserved');
});

test('C4 — preprocess: grayscale is neutral, Otsu is strictly binary, dims intact', { timeout: 180000 }, async () => {
  const img = buildScanImage(fxDir, 'scan-pre.png', EN_LINES, 'png');
  const source = await loadImage(fs.readFileSync(img));

  const [gray] = await ocrOps['image-preprocess'].run([img], ctx({ mode: 'grayscale' }));
  const g = await sample(gray.data);
  assert.equal(g.width, source.width);
  assert.equal(g.height, source.height);
  assert.ok(g.pixels.every(([r, gg, b]) => r === gg && gg === b), 'grayscale has R=G=B');

  const [bin] = await ocrOps['image-preprocess'].run([img], ctx({ mode: 'binarize' }));
  const b = await sample(bin.data);
  assert.equal(b.width, source.width);
  assert.ok(b.pixels.every(([r]) => r === 0 || r === 255), 'binarized values are 0 or 255');

  // OCR still works on the binarized image.
  const binPath = path.join(fxDir, 'scan-bin.png');
  fs.writeFileSync(binPath, Buffer.from(bin.data));
  const [txt] = await ocrOps['ocr-image-to-txt'].run([binPath], ctx(opts));
  assert.match(norm(txt.data), /\bquick\b/, 'OCR reads the preprocessed image');
});

async function sample(pngBytes) {
  const image = await loadImage(Buffer.from(pngBytes));
  const canvas = createCanvas(image.width, image.height);
  const cctx = canvas.getContext('2d');
  cctx.drawImage(image, 0, 0);
  const data = cctx.getImageData(0, 0, image.width, image.height).data;
  const pixels = [];
  const step = Math.max(4, Math.floor(data.length / 4 / 500) * 4);
  for (let i = 0; i < data.length; i += step) pixels.push([data[i], data[i + 1], data[i + 2]]);
  return { width: image.width, height: image.height, pixels };
}
