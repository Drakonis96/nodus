// AI OCR — prompt builders (pure). Bundles shared/aiOcrPrompt.ts and asserts that the
// mode/option flags flip the right instruction fragments in both the structured and the
// verbatim-text prompts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const bundleDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-aiocr-prompt-'));
const bundle = path.join(bundleDir, 'prompt.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/aiOcrPrompt.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const { buildOcrSystemPrompt, buildOcrTextPrompt, OCR_USER_PROMPT } = require(bundle);

test.after(async () => { await rm(bundleDir, { recursive: true, force: true }); });

const opts = (over = {}) => ({ outputMode: 'structured', processingMode: 'ocr', removeReferences: true, ...over });

test('structured OCR mode asks for literal extraction and JSON only', () => {
  const p = buildOcrSystemPrompt(opts());
  assert.match(p, /EXTRACCIÓN LITERAL/);
  assert.match(p, /SOLO JSON/);
  assert.match(p, /"blankPage"/);
  assert.match(p, /MAIN_TEXT/);
});

test('translation mode injects the target language and asks to translate', () => {
  const p = buildOcrSystemPrompt(opts({ processingMode: 'translation', targetLanguage: 'inglés' }));
  assert.match(p, /TRADUCCIÓN/);
  assert.match(p, /inglés/);
  assert.doesNotMatch(p, /EXTRACCIÓN LITERAL/);
});

test('manual mode appends the custom user instructions as additive', () => {
  const p = buildOcrSystemPrompt(opts({ processingMode: 'manual', customPrompt: 'Marca las fechas en negrita' }));
  assert.match(p, /INSTRUCCIONES ADICIONALES DEL USUARIO/);
  assert.match(p, /Marca las fechas en negrita/);
  assert.match(p, /prevalecen las reglas obligatorias/);
});

test('removeReferences toggles the citation-stripping rule', () => {
  const on = buildOcrSystemPrompt(opts({ removeReferences: true }));
  const off = buildOcrSystemPrompt(opts({ removeReferences: false }));
  assert.match(on, /omite las citas académicas/);
  assert.match(off, /Conserva las citas/);
});

test('singleColumn switches the multi-column rule off', () => {
  const multi = buildOcrSystemPrompt(opts({ singleColumn: false }));
  const single = buildOcrSystemPrompt(opts({ singleColumn: true }));
  assert.match(multi, /ORDEN DE LECTURA MULTICOLUMNA/);
  assert.match(single, /COLUMNA ÚNICA/);
  assert.doesNotMatch(single, /ORDEN DE LECTURA MULTICOLUMNA/);
});

test('text prompt asks for plain text only, no JSON', () => {
  const p = buildOcrTextPrompt(opts());
  assert.match(p, /SOLO EL TEXTO/);
  assert.doesNotMatch(p, /"blocks"/);
  assert.match(p, /EXTRACCIÓN LITERAL/);
});

test('OCR_USER_PROMPT is a non-empty trigger', () => {
  assert.equal(typeof OCR_USER_PROMPT, 'string');
  assert.ok(OCR_USER_PROMPT.length > 0);
});
