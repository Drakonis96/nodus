import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Deep Research reader uses the active locale for fixed chrome and dates', () => {
  const source = read('src/serverWeb/PersonalViews.tsx');
  const deep = source.slice(source.indexOf('export function DeepResearchServerView'));
  assert.doesNotMatch(deep, /toLocale(?:Date|String)\([^)]*['"]es['"]/);
  assert.doesNotMatch(deep, /localeCompare\([^)]*['"]es['"]/);
  for (const phrase of ['Volver a la galería', 'Acciones del lector', 'Marcadores y subrayados', 'Eliminar anotación', 'No hay informes publicados.']) {
    assert.match(deep, new RegExp(`t\\(['"]${phrase.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['"]\\)`), `${phrase} must use the translation adapter`);
  }
});

test('Deep Research annotation rail exposes an accessible delete action', () => {
  const source = read('src/serverWeb/PersonalViews.tsx');
  assert.match(source, /deep-research-annotation-\$\{note\.id\}/);
  assert.match(source, /deep-research-annotation-delete-\$\{note\.id\}/);
  assert.match(source, /t\(['"]Eliminar anotación['"]\)/);
  assert.match(source, /api\.deleteAnnotation\(\s*spaceId,\s*id,\s*annotationVersionRef\.current/);
});
