import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Personal server views route fixed chrome through the locale adapter', () => {
  const source = read('src/serverWeb/PersonalViews.tsx');
  assert.match(source, /getActiveLang, t, tx/);
  for (const phrase of [
    'Conversaciones privadas', 'Pestañas del espacio de trabajo',
    'Buscar en notas e ideas…', 'Diccionario', 'Buscar concepto, alias o evidencia…',
    'Privado para ti', 'Eliminar anotación',
  ]) {
    assert.match(source, new RegExp(`(?:t|tx)\\(['"]${phrase.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['"]`), `${phrase} must use the translation adapter`);
  }
  assert.doesNotMatch(source, /toLocale(?:Date|String)\([^)]*['"]es['"]/);
  assert.doesNotMatch(source, /localeCompare\([^)]*['"]es['"]/);
});

test('Personal server translation catalog covers every supported locale', () => {
  const shim = read('src/serverWeb/i18nShim.ts');
  assert.match(shim, /SERVER_WEB_PERSONAL_TRANSLATIONS/);
  for (const locale of ['en:', 'fr:', 'de:', 'pt:', 'pt-BR:', 'it:', 'tr:']) {
    const pattern = locale === 'pt-BR:' ? '["\\\']pt-BR["\\\']:' : locale;
    assert.match(shim, new RegExp(`SERVER_WEB_PERSONAL_TRANSLATIONS[\\s\\S]*?\\n  ${pattern}`), `${locale} catalogue must exist`);
  }
});
