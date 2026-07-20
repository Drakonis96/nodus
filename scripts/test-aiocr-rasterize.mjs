// AI OCR — PDF/image rasterization against real fixtures. Renders a scanned PDF and a
// scan image to JPEG buffers and asserts the output is valid JPEG, one page per PDF
// page, downscaled within the edge cap, plus the per-page callback and cancellation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScanImage, buildScannedPdf } from './toolkit-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadImage } = require('@napi-rs/canvas');

const bundleDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-aiocr-raster-'));
const fxDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-aiocr-raster-fx-'));
const bundle = path.join(bundleDir, 'rasterize.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/toolkit/aiOcr/rasterize.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    '--external:pdfjs-dist', '--external:@napi-rs/canvas',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const { rasterizePdf, rasterizeImage } = require(bundle);

test.after(async () => {
  await rm(bundleDir, { recursive: true, force: true });
  await rm(fxDir, { recursive: true, force: true });
});

const isJpeg = (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;

test('rasterizePdf renders one JPEG page per PDF page', { timeout: 60000 }, async () => {
  const pdf = await buildScannedPdf(fxDir, 'raster-2page.pdf', [
    ['The quick brown fox', 'jumps over'],
    ['Second scanned page', 'clear words here'],
  ]);
  const pages = await rasterizePdf(pdf, { maxEdge: 1200 });
  assert.equal(pages.length, 2, 'one image per page');
  for (const page of pages) {
    assert.equal(page.mediaType, 'image/jpeg');
    assert.ok(isJpeg(Buffer.from(page.buffer)), 'valid JPEG magic bytes');
    assert.ok(page.width > 0 && page.height > 0, 'has dimensions');
    assert.ok(Math.max(page.width, page.height) <= 1200, `longest edge within cap (${page.width}x${page.height})`);
  }
  const [decoded] = [await loadImage(Buffer.from(pages[0].buffer))];
  assert.equal(decoded.width, pages[0].width, 'buffer decodes to the reported width');
});

test('rasterizePdf reports progress per page and honours cancellation', { timeout: 60000 }, async () => {
  const pdf = await buildScannedPdf(fxDir, 'raster-cancel.pdf', [
    ['Page one text', 'line two'],
    ['Page two text', 'line two'],
    ['Page three text', 'line two'],
  ]);
  const seen = [];
  const signal = { cancelled: false };
  const pages = await rasterizePdf(pdf, { maxEdge: 900 }, (page, done, total) => {
    seen.push({ done, total });
    if (done === 1) signal.cancelled = true; // stop after the first page
  }, signal);
  assert.equal(seen[0].total, 3, 'total reported');
  assert.equal(pages.length, 1, 'cancellation stops further rendering');
});

test('rasterizeImage normalizes to a downscaled JPEG', { timeout: 60000 }, async () => {
  const png = buildScanImage(fxDir, 'raster-scan.png', ['The quick brown fox', 'jumps over the lazy dog'], 'png');
  const source = await loadImage(png);
  const page = await rasterizeImage(png, { maxEdge: Math.floor(Math.max(source.width, source.height) / 2) });
  assert.equal(page.mediaType, 'image/jpeg');
  assert.ok(isJpeg(Buffer.from(page.buffer)), 'valid JPEG');
  assert.ok(Math.max(page.width, page.height) <= Math.floor(Math.max(source.width, source.height) / 2) + 1, 'downscaled within cap');
  assert.ok(page.width < source.width, 'actually smaller than the source');
});

test('rasterizePdf honours a page range', { timeout: 60000 }, async () => {
  const pdf = await buildScannedPdf(fxDir, 'raster-range.pdf', [
    ['Page one text', 'a'],
    ['Page two text', 'b'],
    ['Page three text', 'c'],
  ]);
  const pages = await rasterizePdf(pdf, { maxEdge: 900, pageRange: '1,3' });
  assert.equal(pages.length, 2, 'only the selected pages are rendered');
  assert.deepEqual(pages.map((p) => p.pageNumber), [1, 3], 'original page numbers are kept');
});

test('rasterizeImage never upscales a small image', { timeout: 60000 }, async () => {
  const png = buildScanImage(fxDir, 'raster-small.png', ['tiny'], 'png');
  const source = await loadImage(png);
  const page = await rasterizeImage(png, { maxEdge: 8000 });
  assert.equal(page.width, source.width, 'width unchanged (no upscale)');
  assert.equal(page.height, source.height, 'height unchanged (no upscale)');
});
