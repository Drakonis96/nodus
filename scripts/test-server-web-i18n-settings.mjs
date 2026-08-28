import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const shim = read('src/serverWeb/i18nShim.ts');
const app = read('src/serverWeb/App.tsx');
const settings = read('src/serverWeb/settings/ServerSettingsView.tsx');
const css = read('src/serverWeb/settings/ServerSettings.css');

test('Server Web defaults to English and reuses every Desktop language catalogue', () => {
  assert.match(shim, /let active: AppLanguage = 'en'/);
  for (const module of ['i18n.en', 'i18n.fr', 'i18n.de', 'i18n.pt', 'i18n.pt-BR', 'i18n.it', 'i18n.tr']) {
    assert.match(shim, new RegExp(`from '../${module.replace('.', '\\.')}'`));
  }
  for (const token of ["es: 'Español'", "en: 'English'", "fr: 'Français'", "de: 'Deutsch'", "pt: 'Português'", "'pt-BR': 'Português (Brasil)'", "it: 'Italiano'", "tr: 'Türkçe'"]) assert.ok(settings.includes(token), `${token} must be exposed`);
  assert.match(settings, /uiLanguage: 'en', promptLanguage: 'en'/);
  assert.match(app, /useState<AppLanguage>\('en'\)/);
  assert.match(app, /setLanguage\(response\.profile\.values\.appearance\.uiLanguage \|\| 'en'\)/);
  assert.match(app, /setActiveLang\(language\)/);
});

test('Server is the first and default Settings tab', () => {
  const firstTab = settings.indexOf("{ id: 'server', label: 'Servidor'");
  const providersTab = settings.indexOf("{ id: 'providers', label: 'Proveedores'");
  assert.ok(firstTab > 0 && firstTab < providersTab);
  assert.match(settings, /get\('tab'\) \|\| 'server'/);
  assert.match(settings, /as TabId : 'server'/);
  assert.match(app, /get\('tab'\) \|\| 'server'/);
  assert.match(app, /icon="settings"[\s\S]*?navigate\('\/view\/settings\?tab=server'\)/);
});

test('Server Settings accent follows the active vault in dark and light themes', () => {
  assert.match(css, /--ss-accent: var\(--vault-accent, #6366f1\)/);
  assert.match(css, /--ss-accent: var\(--vault-accent, #4f46e5\)/);
  assert.match(css, /\.ss-tabs button\.server-priority/);
  assert.match(settings, /entry\.id === 'server' \? 'server-priority '/);
  assert.match(settings, /data-testid="interface-language"/);
});
