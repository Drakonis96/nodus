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
const { buildOcrSystemPrompt, buildOcrTextPrompt, buildLocalizedOcrSystemPrompt, buildLocalizedOcrTextPrompt, ocrUserPrompt, OCR_USER_PROMPT } = require(bundle);

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

test('every prompt language keeps the complete OCR contract', () => {
  const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
  for (const language of languages) {
    const base = opts({ promptLanguage: language, singleColumn: false, removeReferences: true });
    const structured = language === 'es' ? buildOcrSystemPrompt(base) : buildLocalizedOcrSystemPrompt(base);
    const text = language === 'es' ? buildOcrTextPrompt(base) : buildLocalizedOcrTextPrompt(base);
    for (const token of ['blankPage', 'blocks', 'text', 'label', 'box_2d', 'TITLE', 'MAIN_TEXT', 'FOOTNOTE', 'HEADER', 'FOOTER', 'CAPTION']) {
      assert.ok(structured.includes(token), `${language} structured prompt keeps ${token}`);
    }
    assert.match(structured, /0[^\n]*1000/, `${language} structured prompt keeps normalized coordinates`);
    assert.ok(text.length >= 1100, `${language} text prompt is not a condensed fallback`);
    assert.match(text, /JSON|json/);
    assert.match(structured, /Author|Auteur|Autor|Autore|Yazar/, `${language} keeps citation examples`);
    if (language !== 'es') assert.doesNotMatch(structured, /Eres una IA|EXTRACCIÓN LITERAL|SALTOS DE PÁRRAFO REALES/);
    if (language !== 'es') assert.notEqual(ocrUserPrompt(language), OCR_USER_PROMPT, `${language} user prompt is localized`);
  }
});

test('localized OCR prompts preserve mode flags, custom text, references and column behavior', () => {
  for (const language of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr']) {
    const translated = buildLocalizedOcrSystemPrompt(opts({ promptLanguage: language, processingMode: 'translation', targetLanguage: 'TARGET-LANGUAGE', removeReferences: false }));
    assert.match(translated, /TARGET-LANGUAGE/);
    assert.match(translated, /references|références|verweise|referências|riferimenti|kaynaklar/i);
    assert.doesNotMatch(translated, /omit|omets|omita|omiti|atlay/);
    const manual = buildLocalizedOcrTextPrompt(opts({ promptLanguage: language, outputMode: 'text', processingMode: 'manual', customPrompt: 'KEEP_THIS_CUSTOM_INSTRUCTION', singleColumn: true }));
    assert.match(manual, /KEEP_THIS_CUSTOM_INSTRUCTION/);
    assert.doesNotMatch(manual, /MULTI-COLUMN|MULTICOLONNE|MEHRSPALTIGE|MULTICOLUNA|MULTICOLONNA|ÇOK SÜTUNLU/);
  }
});
