import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'text-provenance-'));
await build({ entryPoints: ['shared/textProvenance.ts'], outfile: path.join(dir, 'p.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { parseTextNotes, isScannedWork } = await import(pathToFileURL(path.join(dir, 'p.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

test('extraction notes read back as OCR, capped and blank pages', () => {
  assert.deepEqual(parseTextNotes('3 página(s) recuperadas por OCR. 342 página(s) no procesadas: superan el límite de OCR (1000 páginas por documento). 2 página(s) sin texto omitidas.'),
    { ocrPages: 3, cappedPages: 342, cap: 1000, blankPages: 2 });
  // Klein: a few OCR pages across two attachments, some blank ones.
  assert.deepEqual(parseTextNotes('2 página(s) recuperadas por OCR. 1 página(s) sin texto omitidas. 4 página(s) recuperadas por OCR. 3 página(s) sin texto omitidas.'),
    { ocrPages: 6, cappedPages: 0, cap: null, blankPages: 4 });
  assert.deepEqual(parseTextNotes(null), { ocrPages: 0, cappedPages: 0, cap: null, blankPages: 0 });
});

test('an old note where the OCR cap cut the book short is recognised (McMurry 7e)', () => {
  const mcmurry = parseTextNotes('1000 página(s) recuperadas por OCR. 342 página(s) sin texto omitidas.');
  assert.deepEqual(mcmurry, { ocrPages: 1000, cappedPages: 342, cap: 1000, blankPages: 0 });
  assert.equal(isScannedWork(mcmurry, 1100), true);
  // A few OCR pages in a digital book do not make it scanned.
  assert.equal(isScannedWork(parseTextNotes('6 página(s) recuperadas por OCR.'), 1400), false);
  // 27 OCR pages with no other information: not called cut off, not scanned without a page count.
  assert.deepEqual(parseTextNotes('27 página(s) recuperadas por OCR. 5 página(s) sin texto omitidas.').cappedPages, 0);
});
