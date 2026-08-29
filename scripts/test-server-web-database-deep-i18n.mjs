import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view = fs.readFileSync(new URL('../src/serverWeb/DatabaseDeepResearchServerView.tsx', import.meta.url), 'utf8');
const catalogue = fs.readFileSync(new URL('../src/i18n.server.ts', import.meta.url), 'utf8');

test('database Deep Research localises all fixed browser chrome', () => {
  for (const source of [
    'Deep Research de datos',
    'Nueva investigación',
    '¿Qué quieres descubrir, comparar o explicar?',
    'Fuentes autorizadas',
    'Filtro de filas',
    'Historial y estado',
    'Informes privados',
  ]) {
    assert.ok(view.includes(`t("${source}")`), `${source} must use t()`);
  }
  assert.match(view, /toLocaleString\(getActiveLang\(\)\)/);
  assert.match(view, /tx\(\s*["']Se enviarán como máximo \{n\} filas/);
  assert.doesNotMatch(view, /placeholder="[^"]*[áéíóúñ¿¡]/i);
});

test('database Deep Research has dedicated translations for every non-Spanish locale', () => {
  const block = catalogue.slice(catalogue.indexOf('const DATABASE_DEEP_LOCALE_OVERRIDES'), catalogue.indexOf('const complete ='));
  for (const locale of ['fr', 'de', 'pt', 'pt-BR', 'it', 'tr']) {
    assert.match(block, new RegExp(`(?:["']${locale}["']|${locale}):\\s*\\{`), `${locale} override is required`);
  }
  assert.match(catalogue, /["']Deep Research de datos["']:\s*["']Data Deep Research["']/);
});
