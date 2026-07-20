// AI OCR — the per-page engine, with a MOCK model call (no AI stack). Asserts the
// structured path, the verbatim-text fallback when JSON is unusable, blank-page
// handling, the empty-response error (never a fake blank in structured mode), the
// user-chosen text mode, and that the page image + call options are threaded through.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const bundleDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-aiocr-engine-'));
const bundle = path.join(bundleDir, 'engine.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/toolkit/aiOcr/engine.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const { ocrPageImage } = require(bundle);

test.after(async () => { await rm(bundleDir, { recursive: true, force: true }); });

const IMAGE = { base64: 'QUJD', mediaType: 'image/jpeg' };
const structuredOpts = { outputMode: 'structured', processingMode: 'ocr', removeReferences: true };

/** Build a mock OcrModelCall and a record of what it received. */
function mockCall({ json, jsonThrows, text }) {
  const seen = {};
  return {
    seen,
    call: {
      async completeJson(opts, guard, model) {
        seen.json = { images: opts.images, temperature: opts.temperature, plainContext: opts.plainContext, model };
        if (jsonThrows) throw new Error('unparseable');
        return json;
      },
      async completeText(opts, model) {
        seen.text = { images: opts.images, model };
        return text ?? '';
      },
    },
  };
}

test('structured mode returns labelled blocks and threads image + opts through', async () => {
  const { call, seen } = mockCall({ json: { blankPage: false, blocks: [{ text: 'Hola mundo', label: 'MAIN_TEXT' }] } });
  const model = { provider: 'openai', model: 'gpt' };
  const out = await ocrPageImage(IMAGE, structuredOpts, model, call);
  assert.equal(out.mode, 'structured');
  assert.equal(out.result.blocks[0].text, 'Hola mundo');
  assert.deepEqual(seen.json.images, [IMAGE], 'the page image is passed to the model');
  assert.equal(seen.json.plainContext, true, 'plainContext is set so vault type does not steer OCR');
  assert.equal(seen.json.temperature, 0.1);
  assert.deepEqual(seen.json.model, model);
});

test('falls back to verbatim text when the JSON is unusable', async () => {
  const { call, seen } = mockCall({ jsonThrows: true, text: 'Texto plano reconstruido.' });
  const out = await ocrPageImage(IMAGE, structuredOpts, null, call);
  assert.equal(out.mode, 'text', 'fell back to the text path');
  assert.equal(out.result.blocks[0].text, 'Texto plano reconstruido.');
  assert.equal(out.result.blocks[0].label, 'MAIN_TEXT');
  assert.deepEqual(seen.text.images, [IMAGE], 'the fallback also sends the image');
});

test('an explicit blank page is returned as blank without a fallback call', async () => {
  const { call, seen } = mockCall({ json: { blankPage: true, blocks: [] }, text: 'SHOULD NOT BE USED' });
  const out = await ocrPageImage(IMAGE, structuredOpts, null, call);
  assert.equal(out.result.blankPage, true);
  assert.equal(out.mode, 'structured');
  assert.equal(seen.text, undefined, 'text fallback not invoked for an explicit blank page');
});

test('empty structured + empty text throws instead of faking a blank page', async () => {
  const { call } = mockCall({ json: { blankPage: false, blocks: [] }, text: '   ' });
  await assert.rejects(() => ocrPageImage(IMAGE, structuredOpts, null, call), /respuesta vacía/);
});

test('a fenced text response is unwrapped', async () => {
  const { call } = mockCall({ jsonThrows: true, text: '```\nContenido dentro de fence\n```' });
  const out = await ocrPageImage(IMAGE, structuredOpts, null, call);
  assert.equal(out.result.blocks[0].text, 'Contenido dentro de fence');
});

test('user-chosen text mode uses completeText and treats empty as blank', async () => {
  const withText = mockCall({ text: 'Transcripción verbatim.' });
  const outText = await ocrPageImage(IMAGE, { ...structuredOpts, outputMode: 'text' }, null, withText.call);
  assert.equal(outText.mode, 'text');
  assert.equal(outText.result.blocks[0].text, 'Transcripción verbatim.');
  assert.equal(withText.seen.json, undefined, 'completeJson is not called in text mode');

  const withEmpty = mockCall({ text: '' });
  const outBlank = await ocrPageImage(IMAGE, { ...structuredOpts, outputMode: 'text' }, null, withEmpty.call);
  assert.equal(outBlank.result.blankPage, true);
});
