import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = await mkdtemp(path.join(os.tmpdir(), 'nodus-database-prompts-'));
const require = createRequire(import.meta.url);

function load(source) {
  const target = path.join(out, `${path.basename(source, '.ts')}.cjs`);
  execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [path.join(root, source), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${target}`], { cwd: root, stdio: 'ignore' });
  return require(target);
}

const ai = load('shared/databaseAi.ts');
const chat = load('shared/databaseChat.ts');
const image = load('shared/imageAnalysis.ts');
const records = load('shared/recordsExtraction.ts');
const profile = load('shared/dataProfile.ts');
const catalog = load('shared/analysisCatalog.ts');
const locales = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];

test.after(() => rm(out, { recursive: true, force: true }));

test('AI database-cell prompts and row scaffolds are native in all locales', () => {
  for (const locale of locales) {
    const system = ai.aiColumnSystem(locale);
    assert.match(system, /ONE|UNE|EINE|UMA|UN[AO]?|TEK|UNA/i);
    assert.match(system, /empty|vide|leer|vazia|vuota|boş|vacía/i);
    const cell = ai.buildAiCellPrompt('DO_IT', '', locale);
    const imagePrompt = ai.buildAiImagePrompt('DRAW_IT', 'name: value', locale);
    assert.match(cell, /DO_IT/);
    assert.match(imagePrompt, /DRAW_IT/);
    if (locale !== 'es') {
      assert.doesNotMatch(cell, /DATOS DE LA FILA|fila vacía/);
      assert.doesNotMatch(imagePrompt, /Contexto de la fila|registro concreto/);
    }
  }
});

test('database-chat contracts preserve every statistical and chart safeguard in all locales', () => {
  for (const locale of locales) {
    const system = chat.databaseChatSystem(locale);
    for (const token of ['"chart"', '"type"', '"bar"', '"pie"', '"items"', '"label"', '"value"', 'Markdown']) {
      assert.ok(system.includes(token), `${locale} missing ${token}`);
    }
    assert.match(system, /1\.[\s\S]+2\./);
    assert.ok(system.length > 900, `${locale} database-chat contract was condensed`);
    const context = chat.buildDbChatContext([{ name: 'People', profileText: 'rows=12', sample: '', rowCount: 12, sampleSize: 0 }], locale);
    const user = chat.buildDbChatUser(context, 'How many?', [{ role: 'user', content: 'Earlier' }], locale);
    assert.match(user, /People/);
    assert.match(user, /How many\?/);
    if (locale !== 'es') assert.doesNotMatch(user, /BASE DE DATOS|CONVERSACIÓN PREVIA|PREGUNTA|sin filas/);
  }
});

test('image-analysis prompts retain the complete two-field OCR contract in all locales', () => {
  for (const locale of locales) {
    const prompt = image.imageAnalysisPrompt(locale);
    for (const token of ['"description"', '"text"', '60', '100', 'JSON', '""']) assert.ok(prompt.system.includes(token), `${locale} missing ${token}`);
    assert.ok(prompt.system.length > 850, `${locale} image-analysis contract was condensed`);
    assert.ok(prompt.user.includes('"description"') && prompt.user.includes('"text"'));
    if (locale !== 'es') assert.doesNotMatch(prompt.system, /Eres un archivero|Analiza la imagen|No añadas/);
  }
});

test('record-extraction prompts preserve the full evidence and kinship contract in all locales', () => {
  const invariant = ['"persons"', '"places"', '"events"', '"relations"', 'male|female|unknown', 'parish|municipality|province|country|other', 'birth|baptism|marriage|death|burial|census|residence|migration|occupation|other', 'principal|spouse|father|mother|child|witness|officiant|other', 'father|mother|parent|son|daughter|child|husband|wife|spouse', '[[p. N]]', '"subject"', '"object"', '"quote"', '"location"', '"participants"', 'null'];
  for (const locale of locales) {
    const prompt = records.recordsExtractionPrompt(locale);
    for (const token of invariant) assert.ok(prompt.includes(token), `${locale} record extraction missing ${token}`);
    assert.ok(prompt.length > 2450, `${locale} record-extraction contract was condensed`);
    if (locale !== 'es') assert.doesNotMatch(prompt, /Eres un archivero|REGLA DE ORO|Devuelve SOLO|No inventes páginas|Si un dato no consta/);
  }
});

test('statistical profiles and analysis catalogs use native scaffolds without changing protocol roles', () => {
  const sampleProfile = {
    rowCount: 3,
    columns: [
      { columnId: 'n1', name: 'Score', type: 'number', valueType: 'number', filled: 3, fillRate: 1, number: { count: 3, min: 1, max: 3, mean: 2, median: 2, sum: 6, stdev: 1, histogram: [] } },
      { columnId: 'g1', name: 'Group', type: 'select', valueType: 'select', filled: 3, fillRate: 1, distinct: 2, distribution: [{ label: 'A', count: 2 }, { label: 'B', count: 1 }] },
    ],
  };
  for (const locale of locales) {
    const text = profile.profileToText('Results', sampleProfile, locale);
    const manifest = catalog.catalogManifest(sampleProfile, locale);
    for (const token of ['descriptive', 'numeric', 'category', 'lowCard', 'date', 'n1', 'g1']) assert.ok(manifest.includes(token), `${locale} manifest lost ${token}`);
    assert.ok(manifest.length > 850, `${locale} analysis catalog was condensed`);
    assert.match(text, /Results/);
    assert.match(text, /2/);
    if (locale !== 'es') {
      assert.doesNotMatch(text, /^Base de datos:|^Filas:| · relleno/m);
      assert.doesNotMatch(manifest, /ANÁLISIS DISPONIBLES|COLUMNAS POR ROL/);
    }
  }
});
