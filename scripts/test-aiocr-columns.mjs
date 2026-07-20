// AI OCR — real multi-column detection against synthetic pages. A two-column page (two
// ink blocks with a white gutter) must crop into two parts; a single block must stay one.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createCanvas } = require('@napi-rs/canvas');

const bundleDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-aiocr-columns-'));
const bundle = path.join(bundleDir, 'columns.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/toolkit/aiOcr/columns.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    '--external:@napi-rs/canvas',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const { detectAndCropColumns } = require(bundle);

test.after(async () => { await rm(bundleDir, { recursive: true, force: true }); });

function page(draw) {
  const c = createCanvas(1000, 800);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1000, 800);
  ctx.fillStyle = '#000000';
  draw(ctx);
  return c.toBuffer('image/png');
}

test('a two-column page crops into two column images', async () => {
  // Two ink blocks with a wide white gutter (420–580) down the middle.
  const buf = page((ctx) => { ctx.fillRect(60, 40, 360, 720); ctx.fillRect(580, 40, 360, 720); });
  const parts = await detectAndCropColumns(buf, 'image/png');
  assert.equal(parts.length, 2, 'detected two columns');
  for (const part of parts) {
    assert.equal(part.mediaType, 'image/jpeg');
    assert.ok(part.base64.length > 0);
  }
});

test('a single-column page stays a single image', async () => {
  const buf = page((ctx) => { ctx.fillRect(120, 40, 760, 720); });
  const parts = await detectAndCropColumns(buf, 'image/png');
  assert.equal(parts.length, 1, 'no false column split');
});

test('a blank page stays a single image', async () => {
  const buf = page(() => { /* all white */ });
  const parts = await detectAndCropColumns(buf, 'image/png');
  assert.equal(parts.length, 1);
});
