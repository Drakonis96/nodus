import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');
const shellCss = read('src/serverWeb/serverDesktop.css');
const settingsCss = read('src/serverWeb/settings/ServerSettings.css');
const appTsx = read('src/serverWeb/App.tsx');
const advancedTsx = read('src/serverWeb/advanced/AdvancedWorkspace.tsx');

test('Server Web custom shell has an explicit light palette', () => {
  assert.match(shellCss, /--server-shell-bg:\s*#0a0a0a/);
  assert.match(shellCss, /html\.light \.server-desktop-surface/);
  assert.match(shellCss, /\.server-desktop-surface\[data-theme=['"]light['"]\]/);
  for (const selector of [
    'server-vault-popover', 'server-record-card', 'server-detail-list',
    'server-chat-composer', 'server-note-editor', 'server-desktop-record',
  ]) {
    assert.match(shellCss, new RegExp(`html\\.light \\.${selector}`), `missing light remap for .${selector}`);
  }
});

test('Server settings has theme-scoped tokens and controls', () => {
  assert.match(settingsCss, /\.server-settings-native\[data-theme=['"]light['"]\]/);
  assert.match(settingsCss, /--ss-bg:\s*#fff/);
  assert.match(settingsCss, /color-scheme:\s*light/);
  assert.match(settingsCss, /\.ss-select/);
});

test('Server shell no longer ships disabled tool navigation styling', () => {
  assert.doesNotMatch(shellCss, /nav-browser|nav-radar|nav-compass|nav-toolkit/);
});

test('light mode covers the Server shell and advanced read-only states', () => {
  for (const token of [
    'text-neutral-100', 'text-neutral-200', 'text-neutral-300', 'text-neutral-400',
    'text-neutral-700', 'border-neutral-800', 'border-neutral-900',
    'bg-neutral-950', 'bg-neutral-950/45', 'bg-neutral-900', 'bg-neutral-900/55',
    'hover:bg-neutral-900', 'hover:bg-neutral-800', 'hover:text-neutral-200',
  ]) {
    const escaped = token;
    assert.match(shellCss, new RegExp(`(?:\\.${escaped}|\\[class~=['"]${escaped}['"]\\])`), `missing light override for ${token}`);
  }
  assert.match(shellCss, /button:disabled/);
  assert.match(shellCss, /focus-visible/);
  assert.match(appTsx, /data-testid="app-shell"/);
  assert.match(advancedTsx, /data-testid="advanced-ideas-view"/);
  assert.match(advancedTsx, /data-testid="advanced-authors-view"/);
  assert.match(advancedTsx, /data-testid="advanced-graph-view"/);
  assert.match(advancedTsx, /role="alert"/);
  assert.match(advancedTsx, /No hay ideas publicadas/);
  assert.match(advancedTsx, /No hay autores todavía/);
  assert.match(advancedTsx, /Publica ideas para explorar su grafo/);
});
