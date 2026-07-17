// Manual verification for HEIC → JPEG/PNG (D2). A real HEIC is a personal file
// (device metadata, date, possibly GPS) and the repo is public, so it NEVER enters
// the tree (§6.2-bis). Instead the user supplies a real iPhone photo from outside
// the repo and this script processes it for real:
//
//   npm run verify:toolkit-heic -- /path/to/photo.HEIC
//   NODUS_HEIC_FIXTURE=/path/to/photo.HEIC npm run verify:toolkit-heic
//
// It decodes the HEIC, converts to JPEG and PNG through the real image operation,
// and asserts the outputs are valid and dimension-correct. With no file it fails
// loudly with instructions — it never silently skips.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const input = process.argv[2] || process.env.NODUS_HEIC_FIXTURE;
if (!input) {
  console.error(
    [
      'No HEIC file provided.',
      '',
      'Supply a real iPhone photo from OUTSIDE the repo (it must never be committed):',
      '  npm run verify:toolkit-heic -- /path/to/photo.HEIC',
      '  NODUS_HEIC_FIXTURE=/path/to/photo.HEIC npm run verify:toolkit-heic',
    ].join('\n'),
  );
  process.exit(1);
}

const bytes = readFileSync(input);
const { loadImage } = require('@napi-rs/canvas');
const heicDecode = require('heic-decode');
const decode = heicDecode.default ?? heicDecode;

// Bundle the real image operation (under node_modules so its externals resolve).
const bundleDir = mkdtempSync(path.join(repoRoot, 'node_modules', '.nodus-verify-heic-'));
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

const ctx = (outputFormat, options = {}) => ({
  request: {},
  outputFormat,
  options,
  signal: { cancelled: false },
  onPageProgress() {},
});

try {
  assert.ok(isHeic(new Uint8Array(bytes)), 'the supplied file is detected as HEIC by magic bytes');
  const source = await decode({ buffer: bytes });
  assert.ok(source.width > 0 && source.height > 0, 'HEIC decodes to positive dimensions');
  console.log(`HEIC decoded: ${source.width}×${source.height}`);

  const [jpg] = await imageOps['heic-convert'].run([input], ctx('jpeg', { quality: 90 }));
  const jpgImg = await loadImage(Buffer.from(jpg.data));
  assert.equal(jpgImg.width, source.width, 'JPEG width matches');
  assert.equal(jpgImg.height, source.height, 'JPEG height matches');
  assert.ok(Buffer.from(jpg.data.slice(0, 2)).toString('hex') === 'ffd8', 'JPEG SOI marker present');
  console.log(`JPEG output OK: ${jpg.data.length} bytes`);

  const [png] = await imageOps['heic-convert'].run([input], ctx('png'));
  const pngImg = await loadImage(Buffer.from(png.data));
  assert.equal(pngImg.width, source.width, 'PNG width matches');
  assert.equal(pngImg.height, source.height, 'PNG height matches');
  assert.equal(Buffer.from(png.data.slice(0, 4)).toString('hex'), '89504e47', 'PNG signature present');
  console.log(`PNG output OK: ${png.data.length} bytes`);

  console.log('\n✅ HEIC verification passed.');
} finally {
  rmSync(bundleDir, { recursive: true, force: true });
}
