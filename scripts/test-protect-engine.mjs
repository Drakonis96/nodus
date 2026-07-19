import assert from 'node:assert/strict';
import crypto, { webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createCanvas, ImageData } from '@napi-rs/canvas';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalCandidates = [
  process.env.IDPROTECTOR_ROOT && path.join(process.env.IDPROTECTOR_ROOT, 'public/js'),
  path.join(root, 'scripts/fixtures/idprotector-v0.4.1/public/js'),
  path.join(os.homedir(), 'Documents/GitHub/idprotector/public/js'),
  path.resolve(root, '../idprotector/public/js'),
].filter(Boolean);
const original = originalCandidates.find((candidate) => fs.existsSync(path.join(candidate, 'app.js')));
assert.ok(original, `IDprotector v0.4.1 source not found; set IDPROTECTOR_ROOT (checked ${originalCandidates.join(', ')})`);
const out = await mkdtemp(path.join(os.tmpdir(), 'nodus-protect-engine-'));
const require = createRequire(import.meta.url);
try {
  const load = (source, name) => {
    const target = path.join(out, `${name}.cjs`);
    execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [path.join(root, source), '--bundle', '--platform=node', '--format=cjs', `--outfile=${target}`]);
    return require(target);
  };
  const stego = load('src/lib/protect/stego.ts', 'stego');
  const editor = load('src/lib/protect/editor.ts', 'editor');
  const watermark = load('src/lib/protect/watermark.ts', 'watermark');

  const sandbox = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Uint8ClampedArray, ArrayBuffer, DataView, Math, JSON, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(original, 'stego.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(original, 'watermark.js'), 'utf8'), sandbox);
  const legacyStego = sandbox.SL.stego;

  const originalApp = fs.readFileSync(path.join(original, 'app.js'), 'utf8');
  const currentEngine = fs.readFileSync(path.join(root, 'src/lib/protect/engine.ts'), 'utf8');
  const literal = (source, pattern, label) => {
    const match = source.match(pattern);
    assert.ok(match?.[1], `${label} literal exists`);
    return Function(`"use strict"; return (${match[1]});`)();
  };
  const legacyAuthorities = literal(originalApp, /var DPA_AUTHORITIES = (\[[\s\S]*?\n  \]);/, 'legacy authorities');
  const currentAuthorities = literal(currentEngine, /PROTECT_AUTHORITIES[^=]*= (\[[\s\S]*?\n\]);/, 'ported authorities');
  assert.equal(currentAuthorities.length, 32);
  assert.deepEqual(currentAuthorities, legacyAuthorities, 'all 32 official authorities and URLs stay identical');
  const legacyEu = literal(originalApp, /var EU_REGULATION_URLS = (\{[\s\S]*?\n  \});/, 'legacy GDPR URLs');
  const currentEu = literal(currentEngine, /EU_REGULATION_URLS[^=]*= (\{[\s\S]*?\n\});/, 'ported GDPR URLs');
  for (const language of ['es', 'en', 'fr', 'de', 'pt', 'it']) assert.equal(currentEu[language], legacyEu[language], `GDPR URL parity (${language})`);
  assert.match(currentEngine, /PROTECT_DECODED_PAGE_CACHE_SIZE = 3/, 'decoded page LRU is fixed at three');
  assert.match(currentEngine, /await ensureProtectPage\(options\.pages\[index\]\)/, 'multipage export resolves pages sequentially');

  const copyId = new Uint8Array([0, 1, 2, 3, 0xfa, 0xfb, 0xfc, 0xfd]);
  for (const passphrase of ['', 'frase secreta · 密碼']) {
    const expected = new Uint8Array(await legacyStego.buildPayload(copyId, passphrase));
    const actual = await stego.buildIdpsPayload(copyId, passphrase);
    assert.deepEqual(actual, expected, `IDPS record is byte-identical (${passphrase ? 'keyed' : 'open'})`);
  }

  const pixels = new ImageData(new Uint8ClampedArray(320 * 90 * 4), 320, 90);
  for (let index = 0; index < pixels.data.length; index += 4) {
    pixels.data[index] = index % 251; pixels.data[index + 1] = (index * 3) % 253;
    pixels.data[index + 2] = (index * 7) % 255; pixels.data[index + 3] = 255;
  }
  const keyed = await stego.buildIdpsPayload(copyId, 'secreto');
  stego.embedIdpsIntoImageData(pixels, keyed);
  const legacyRead = await legacyStego.decode(pixels, 'secreto');
  assert.equal(legacyRead.verified, true, 'IDprotector verifies pixels emitted by Nodus');
  assert.equal(legacyRead.copyIdHex, '00010203fafbfcfd');
  const wrong = await stego.decodeIdps(pixels, 'incorrecta');
  assert.equal(wrong.found, true); assert.equal(wrong.verified, false, 'wrong phrase finds but does not authenticate');

  const legacyPixels = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
  const legacyCanvas = { width: pixels.width, height: pixels.height, getContext: () => ({ getImageData: () => legacyPixels, putImageData: () => undefined }) };
  legacyStego.embedIntoCanvas(legacyCanvas, await legacyStego.buildPayload(copyId, 'secreto'));
  const nodusRead = await stego.decodeIdps(legacyPixels, 'secreto');
  assert.equal(nodusRead.found && nodusRead.verified, true, 'Nodus verifies pixels emitted by IDprotector');

  // A crop starts at an arbitrary RGB bit offset; the scanner must resynchronise.
  const cropWidth = 197; const cropHeight = 55; const cropped = new ImageData(cropWidth, cropHeight);
  for (let y = 0; y < cropHeight; y += 1) {
    const from = ((y + 13) * pixels.width + 37) * 4;
    cropped.data.set(pixels.data.slice(from, from + cropWidth * 4), y * cropWidth * 4);
  }
  const cropRead = await stego.decodeIdps(cropped, 'secreto');
  assert.equal(cropRead.found && cropRead.verified, true, 'IDPS survives a lossless crop and majority vote');

  const pngCanvas = createCanvas(12, 12);
  pngCanvas.getContext('2d').fillRect(0, 0, 12, 12);
  const png = new Uint8Array(pngCanvas.toBuffer('image/png'));
  const metadata = { copyId: '00010203fafbfcfd', purpose: 'Prueba ñ', created: '2026-07-19T00:00:00.000Z', version: 'idps1' };
  const fromLegacy = new Uint8Array(legacyStego.pngInsertTextChunk(png, 'idprotector', JSON.stringify(metadata)));
  assert.deepEqual(stego.readIdpsPngMetadata(fromLegacy), metadata, 'Nodus reads legacy iTXt metadata');
  const fromNodus = stego.pngInsertTextChunk(png, 'idprotector', JSON.stringify(metadata));
  const legacyText = legacyStego.pngReadTextChunks(fromNodus).find((entry) => entry.keyword === 'idprotector');
  assert.deepEqual(JSON.parse(legacyText.text), metadata, 'IDprotector reads Nodus iTXt metadata');
  assert.equal(stego.crc32(copyId), legacyStego.crc32(copyId), 'CRC32 stays byte-compatible');

  // The seven drawing algorithms are pixel-golden against v0.4.1. The footer is
  // disabled because its brand string is intentionally adapted to Nodus Protect.
  const patterns = ['dense', 'topographic', 'diagonal', 'mesh', 'grid', 'single', 'manual'];
  for (const pattern of patterns) {
    const wm = { enabled: true, text: 'DESTINO', pattern, opacity: 0.31, size: 24, color: '#1d6fd6', footer: false,
      manual: { items: [{ text: 'A', x: 0.31, y: 0.72, angle: -17 }, { text: '', x: 0.76, y: 0.24, angle: 33 }], randomizePerPage: true } };
    const legacy = createCanvas(640, 420); const current = createCanvas(640, 420);
    sandbox.SL.renderWatermark(legacy.getContext('2d'), 640, 420, wm, 0.64, 3);
    watermark.renderWatermark(current.getContext('2d'), 640, 420, wm, 0.64, 3, { unauthorized: 'SIN AUTORIZAR', protectedWith: 'Protegido con' });
    const hash = (canvas) => crypto.createHash('sha256').update(canvas.getContext('2d').getImageData(0, 0, 640, 420).data).digest('hex');
    assert.equal(hash(current), hash(legacy), `${pattern} is pixel-identical to v0.4.1`);
  }

  // Pure geometry and destructive operations: selection proportions, crop,
  // rotation and straighten preserve/transform redactions rather than dropping them.
  globalThis.document = { createElement: () => createCanvas(1, 1) };
  const line = editor.rectFromTo({ x: 10, y: 20 }, { x: 110, y: 70 }, 34);
  assert.ok(Math.abs(line.angle - Math.atan2(50, 100)) < 1e-12);
  const fromPage = { base: createCanvas(200, 100), rects: [line], undo: [], straighten: 0 };
  const toPage = { base: createCanvas(400, 300), rects: [], undo: [], straighten: 0 };
  const clone = editor.cloneRedactionForPage(line, fromPage, toPage);
  assert.ok(clone.w > line.w && clone.h > line.h, 'copy-to-all scales with the destination page');
  assert.equal(editor.rotateProtectPage(fromPage, 1), true);
  assert.equal(fromPage.base.width, 100); assert.equal(fromPage.base.height, 200);
  assert.equal(editor.cropProtectPage(fromPage, { x: 5, y: 5, w: 80, h: 120 }), true);
  assert.equal(fromPage.base.width, 80); assert.equal(fromPage.undo.length, 0);
  const beforeStraighten = { ...fromPage.rects[0] };
  assert.equal(editor.straightenProtectPage(fromPage, 5), true);
  assert.notDeepEqual(fromPage.rects[0], beforeStraighten, 'straighten transforms the redaction geometry');

  console.log('Nodus Protect engine parity test passed');
} finally {
  await rm(out, { recursive: true, force: true });
}
