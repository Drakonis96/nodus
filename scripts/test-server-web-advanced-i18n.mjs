import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const advanced = fs.readFileSync(new URL('../src/serverWeb/advanced/AdvancedWorkspace.tsx', import.meta.url), 'utf8');
const shim = fs.readFileSync(new URL('../src/serverWeb/i18nShim.ts', import.meta.url), 'utf8');

test('advanced server surfaces use the shared locale adapter for fixed chrome', () => {
  assert.match(advanced, /import \{[^}]*getActiveLang[^}]*t[^}]*tx[^}]*\} from ['"]\.\.\/i18nShim['"]/);
  for (const source of ['Ideas', 'Autores', 'Grafo', 'Buscar ideas…', 'Buscar autor…', 'Buscar en el grafo…', 'Superficies académicas']) {
    assert.ok(advanced.includes(`t("${source}")`), `${source} must use t()`);
  }
  assert.doesNotMatch(advanced, /placeholder="[^"]+"|aria-label="[^"]+"/);
  assert.match(advanced, /toLocaleString\(getActiveLang\(\)\)/);
});

test('advanced localisation never rewrites published record values', () => {
  assert.doesNotMatch(advanced, /translateNode/);
  assert.match(advanced, /\{idea\.label\}/);
  assert.match(advanced, /\{author\.firstName \|\| author\.fullName \|\| author\.name\}/);
  assert.match(advanced, /\{theme\}/);
});

test('server locale catalogue retains every supported non-Spanish language', () => {
  for (const locale of ['en:', 'fr:', 'de:', 'pt:', 'pt-BR', 'it:', 'tr:']) {
    assert.match(shim, new RegExp(locale.replace('-', '\\-')), `${locale} catalogue must remain available`);
  }
});
