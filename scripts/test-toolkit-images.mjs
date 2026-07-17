// F5 — images (D1, D3, D4) against real fixtures, plus D2's deterministic HEIC
// detection. A real HEIC photo never enters the repo (§6.2-bis), so the actual
// HEIC decode is verified by scripts/verify-toolkit-heic.mjs against a photo the
// user supplies from outside the tree. Here we assert magic-byte detection with a
// tiny synthetic `ftyp` header, and the error path when a non-HEIC is passed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPhoto, buildPng } from './toolkit-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadImage } = require('@napi-rs/canvas');

const bundleDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-toolkit-img-'));
const fxDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-tk-img-fx-'));
const bundle = path.join(bundleDir, 'imageOps.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/toolkit/convert/imageOps.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    '--external:@napi-rs/canvas', '--external:heic-decode',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const { imageOps, isHeic } = require(bundle);

test.after(async () => {
  await rm(bundleDir, { recursive: true, force: true });
  await rm(fxDir, { recursive: true, force: true });
});

function ctx(outputFormat = null, options = {}) {
  return { request: {}, outputFormat, options, signal: { cancelled: false }, onPageProgress() {} };
}
async function dims(bytes) {
  const img = await loadImage(Buffer.from(bytes));
  return { width: img.width, height: img.height };
}
const magic = (bytes) => Buffer.from(bytes.slice(0, 4)).toString('hex');

test('D1 — convert PNG → JPEG/WebP/PNG: decodable, dims intact, magic bytes right', async () => {
  const png = buildPng(fxDir, 'src.png', { width: 320, height: 240 });
  const [jpg] = await imageOps['image-convert'].run([png], ctx('jpeg', { quality: 90 }));
  assert.equal(jpg.ext, 'jpg');
  assert.ok(magic(jpg.data).startsWith('ffd8'), `JPEG SOI marker, got ${magic(jpg.data)}`);
  assert.deepEqual(await dims(jpg.data), { width: 320, height: 240 });

  const [webp] = await imageOps['image-convert'].run([png], ctx('webp', { quality: 90 }));
  assert.equal(Buffer.from(webp.data.slice(0, 4)).toString('ascii'), 'RIFF');
  assert.deepEqual(await dims(webp.data), { width: 320, height: 240 });

  const [asPng] = await imageOps['image-convert'].run([buildPhoto(fxDir, 'p.jpg'), ], ctx('png'));
  assert.equal(magic(asPng.data), '89504e47');
});

test('D2 — HEIC detection by magic bytes; non-HEIC input is rejected clearly', async () => {
  // A minimal synthetic ISO-BMFF header: size + 'ftyp' + brand 'heic'. Not a photo.
  const header = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypheic', 'ascii'),
    Buffer.alloc(12),
  ]);
  assert.equal(isHeic(new Uint8Array(header)), true, 'ftyp/heic detected');
  assert.equal(isHeic(new Uint8Array(Buffer.from('ftypmp42heic', 'ascii'))), false, 'a non-HEIC brand is not HEIC');
  const png = buildPng(fxDir, 'notheic.png');
  assert.equal(isHeic(new Uint8Array(fs.readFileSync(png))), false, 'a PNG is not HEIC');
  await assert.rejects(
    imageOps['heic-convert'].run([png], ctx('jpeg')),
    /HEIC\/HEIF válido/,
    'converting a non-HEIC gives a clear error',
  );
});

test('D3 — resize by max side and by percentage keeps the aspect ratio', async () => {
  const src = buildPng(fxDir, 'big.png', { width: 640, height: 480 });
  const [maxSide] = await imageOps['image-resize'].run([src], ctx(null, { mode: 'maxSide', value: 320 }));
  assert.deepEqual(await dims(maxSide.data), { width: 320, height: 240 });
  assert.equal(maxSide.ext, 'png');

  const [pct] = await imageOps['image-resize'].run([src], ctx(null, { mode: 'percent', value: 25 }));
  assert.deepEqual(await dims(pct.data), { width: 160, height: 120 });
});

test('D4 — compress makes a smaller, still-decodable file', async () => {
  const src = buildPhoto(fxDir, 'photo-big.jpg', { width: 800, height: 600 });
  const inputSize = fs.statSync(src).size;
  const [out] = await imageOps['image-compress'].run([src], ctx('jpeg', { quality: 40 }));
  assert.ok(out.data.length < inputSize, `compressed ${out.data.length} < ${inputSize}`);
  const d = await dims(out.data);
  assert.equal(d.width, 800);
  assert.equal(d.height, 600);
});
