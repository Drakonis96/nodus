import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
const read = (file) => variants(fs.readFileSync(path.join(root, file), 'utf8'));

test('server vault manager localises lifecycle UI instead of leaking Spanish copy', () => {
  const manager = read('src/serverWeb/vaults/ServerVaultManager.tsx');
  const shim = read('src/serverWeb/i18nShim.ts');
  for (const source of ['Vaults', 'Añadir', 'Nuevo vault', 'Connected Vault', 'Crear un vault editable directamente en Server.', 'Conectar un vault de Desktop para publicarlo y sincronizarlo.', 'Buscar vaults…', 'Todos los tipos', 'Último uso', 'Vault eliminado.', 'Exportación preparada.', 'Importación recibida.']) {
    assert.match(manager, new RegExp(`t\\(['"]${source.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}['"]\\)`), `${source} must use the translation adapter`);
    assert.ok(shim.includes(source), `${source} must be registered in the server catalogue`);
  }
  for (const locale of ['fr:', 'de:', 'pt:', 'pt-BR:', 'it:', 'tr:']) {
    const localePattern = locale === 'pt-BR:' ? '["\\\']pt-BR["\\\']:' : locale;
    assert.match(shim, new RegExp(`\\n  ${localePattern}`), `${locale} catalogue must remain available`);
  }
  assert.match(manager, /^(?:.*)const match = \/\^\(Eliminar\|Renombrar\|Duplicar\|Exportar\|Importar\|Activar\|Importar en\)/m, 'dynamic action labels must preserve the record name while translating the action');
});

test('vault Add distinguishes native and connected setup routes in Server Settings', () => {
  const manager = read('src/serverWeb/vaults/ServerVaultManager.tsx');
  const app = read('src/serverWeb/App.tsx');
  const settings = read('src/serverWeb/settings/ServerSettingsView.tsx');
  const css = read('src/serverWeb/serverDesktop.css');
  assert.match(manager, /aria-haspopup=["']menu["']/);
  assert.match(manager, /data-testid=["']vault-add-native["'][\s\S]*?onAddVault\(["']native["']\)/);
  assert.match(manager, /data-testid=["']vault-add-connected["'][\s\S]*?onAddVault\(["']connected["']\)/);
  assert.match(app, /kind === ["']native["'] \? ["']new-vault["'] : ["']connected-vault["']/);
  assert.match(app, /\/view\/settings\?tab=server&focus=/);
  assert.match(settings, /focusId=["']server-new-vault["']/);
  assert.match(settings, /focusId=["']server-connected-vault["']/);
  assert.match(settings, /scrollIntoView\(/);
  assert.match(css, /\.server-vault-add-options/);
});

test('citation modal localises its fixed chrome', () => {
  const modal = read('src/serverWeb/ServerCitationModal.tsx');
  for (const source of ['No se ha podido cargar esta cita.', 'Cargando fuente…', 'Fuentes y contexto', 'Explora las relaciones sin salir del informe']) {
    assert.match(modal, new RegExp(`t\\(['"]${source.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}['"]\\)`), `${source} must use t()`);
  }
});
