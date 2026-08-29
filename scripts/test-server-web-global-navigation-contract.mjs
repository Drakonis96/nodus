import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
const read = (file) => variants(fs.readFileSync(path.join(root, file), 'utf8'));

test('Server Web keeps every navigation entry on a reloadable URL contract', () => {
  const app = read('src/serverWeb/App.tsx');
  const surfaces = read('src/serverWeb/vaults/index.tsx');
  const settings = read('src/serverWeb/settings/ServerSettingsView.tsx');

  // The shell is intentionally a tiny history router. Keep the compatibility
  // alias and decoded detail segments in the same contract as the links emitted
  // by the catalogue adapters.
  assert.match(app, /function routeFromLocation\(\)/);
  assert.match(app, /replace\(\/\^\\\/app\(\?:\\\/\|\$\)\/, ["']\/["']\)/);
  assert.match(app, /decodeURIComponent\(parts\[2\]\)/);
  assert.match(app, /decodeURIComponent\(parts\[3\]\)/);
  assert.match(app, /history\.pushState\(\{\}, ["']["'], path\)/);
  assert.match(app, /window\.dispatchEvent\(new PopStateEvent\(["']popstate["']\)\)/);
  assert.match(app, /initialId=\{route\.id\}/);
  assert.match(app, /initialCollection=\{route\.collection\}/);

  // A row opened from a dedicated surface must carry both the owning view and
  // the encoded collection/id. This prevents spaces, slashes and non-ASCII ids
  // from opening a tab that cannot be restored after a hard reload.
  assert.match(app, /onOpenRecord=\{\(collection, id\) =>\s*navigate\(\s*`\/detail\/\$\{route\.view\}\/\$\{encodeURIComponent\(collection\)\}\/\$\{encodeURIComponent\(id\)\}`,?\s*\)\s*\}/);
  assert.match(surfaces, /onOpenRecord\?: \(collection: string, id: string\) => void/);
  assert.match(surfaces, /encodeURIComponent|onOpenRecord\?\./);

  // Account/settings is a real URL deep link and Back/Forward must update the
  // selected tab instead of leaving the old panel mounted.
  assert.match(app, /navigate\(["']\/view\/settings\?tab=server["']\)/);
  assert.match(app, /initialTab=\{settingsTab as TabId\}/);
  assert.match(settings, /history\.pushState\(\{\}, ["']["'], `\/view\/settings\?tab=\$\{next\}`\)/);
  assert.match(settings, /addEventListener\(["']popstate["'], onPopState\)/);
  assert.match(settings, /setTab\(next as TabId\)/);
});

test('Server Web preserves safe new-tab semantics for published readers', () => {
  const library = read('src/serverWeb/LibraryServerView.tsx');
  const personal = read('src/serverWeb/PersonalViews.tsx');

  // These are user-visible external document actions, not same-tab SPA links.
  // Keep the opener isolated when a report or published library document is
  // opened in a new tab.
  assert.match(library, /target="_blank"/);
  assert.match(library, /rel="noreferrer"/);
  assert.match(personal, /window\.open\([\s\S]*?["']_blank["'],\s*["']noopener,noreferrer["'],?\s*\)/);
  assert.match(personal, /data-testid="deep-research-new-tab"/);
  assert.match(personal, /data-testid="deep-research-print"/);
  assert.match(personal, /data-testid="deep-research-pdf"/);
});
