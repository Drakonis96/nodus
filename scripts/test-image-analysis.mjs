import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-imganalysis-'));
const bundle = path.join(outDir, 'imageAnalysis.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/imageAnalysis.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const ia = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('vision MIME support matches the OpenAI/Anthropic intersection', () => {
  for (const ok of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'IMAGE/PNG']) {
    assert.equal(ia.isVisionMime(ok), true, `${ok} supported`);
  }
  for (const no of ['image/tiff', 'image/bmp', 'application/pdf', '', null, undefined]) {
    assert.equal(ia.isVisionMime(no), false, `${no} unsupported`);
  }
});

test('openAiVisionContent builds a text part + image_url data URLs', () => {
  const content = ia.openAiVisionContent('describe', [{ base64: 'AAAA', mediaType: 'image/png' }]);
  assert.deepEqual(content[0], { type: 'text', text: 'describe' });
  assert.deepEqual(content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
});

test('anthropicVisionContent builds a text block + native image blocks', () => {
  const content = ia.anthropicVisionContent('describe', [{ base64: 'BBBB', mediaType: 'image/jpeg' }]);
  assert.deepEqual(content[0], { type: 'text', text: 'describe' });
  assert.deepEqual(content[1], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBBB' } });
});

test('normalizeAnalysis coerces and trims, defaults missing fields to empty', () => {
  assert.deepEqual(ia.normalizeAnalysis({ description: '  a photo  ', text: 'HELLO\nWORLD' }), {
    description: 'a photo',
    text: 'HELLO\nWORLD',
  });
  assert.deepEqual(ia.normalizeAnalysis({ description: 'only desc' }), { description: 'only desc', text: '' });
  assert.deepEqual(ia.normalizeAnalysis({ description: 42, text: null }), { description: '', text: '' });
});

test('the analysis prompt pins the JSON shape and a bounded length', () => {
  assert.match(ia.IMAGE_ANALYSIS_SYSTEM, /"description"/);
  assert.match(ia.IMAGE_ANALYSIS_SYSTEM, /"text"/);
  assert.match(ia.IMAGE_ANALYSIS_SYSTEM, /60 y 100 palabras/);
});

test('shape guard accepts objects, rejects primitives', () => {
  assert.equal(ia.isImageAnalysisShape({}), true);
  assert.equal(ia.isImageAnalysisShape({ description: 'x' }), true);
  assert.equal(ia.isImageAnalysisShape(null), false);
  assert.equal(ia.isImageAnalysisShape('x'), false);
});
