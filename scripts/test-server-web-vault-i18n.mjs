import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const vault = fs.readFileSync(new URL('../src/serverWeb/vaults/index.tsx', import.meta.url), 'utf8');
const archive = fs.readFileSync(new URL('../src/serverWeb/PrimarySourcesArchiveServerView.tsx', import.meta.url), 'utf8');
const shim = fs.readFileSync(new URL('../src/serverWeb/i18nShim.ts', import.meta.url), 'utf8');

test('vault surfaces route fixed UI vocabulary through the active locale', () => {
  assert.match(vault, /from ['"](?:\.\.\/|\.\/)?i18nShim['"]/);
  assert.match(archive, /from ['"](?:\.\.\/|\.\/)?i18nShim['"]/);
  assert.match(archive, /t\(['"]Archivo['"]\)/, 'archive label is translated');
  assert.match(archive, /t\(['"]Descripción['"]\)/, 'description label is translated');
  assert.match(vault, /t\(['"]Línea temporal['"]\)/);
  assert.match(vault, /t\(['"]Cargando…['"]\)/);
  assert.match(vault, /t\(['"]Árbol genealógico publicado['"]\)/);
});

test('vault-specific vocabulary has translations for every non-Spanish locale', () => {
  const locales = ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
  const required = ['eventos', 'Todas las personas', 'Buscar persona…', 'Todos los tipos', 'Ver detalles del evento', 'Abrir ficha', 'Apariencia', 'Facetas'];
  for (const locale of locales) {
    // The vault table is keyed by locale and the resolver uses it before the
    // generic server/academic dictionaries.
    assert.ok(shim.includes(`${locale}: {`) || shim.includes(`'${locale}': {`) || shim.includes(`"${locale}": {`), `${locale} locale exists`);
  }
  assert.match(shim, /SERVER_WEB_VAULT_TRANSLATIONS\[normalized\]/);
  for (const key of required) assert.ok(shim.includes(key), `${key} is in the vault vocabulary`);
});
