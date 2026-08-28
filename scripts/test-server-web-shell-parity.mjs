import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(`${root}/${file}`, 'utf8');
const app = read('src/serverWeb/App.tsx');
const css = read('src/serverWeb/serverDesktop.css');
const settingsCss = read('src/serverWeb/settings/ServerSettings.css');

test('Server shell preserves Desktop sidebar state and compact threshold', () => {
  assert.match(app, /SERVER_NAV_COLLAPSED_STORAGE_KEY/);
  assert.match(app, /SERVER_COLLAPSED_GROUPS_STORAGE_KEY/);
  assert.match(app, /SERVER_SIDEBAR_COMPACT_THRESHOLD\s*=\s*144/);
  assert.ok(app.includes('onKeyDown={resizeWithKeyboard}'));
  assert.ok(app.includes('onDoubleClick={() => setSidebarWidth(SERVER_SIDEBAR_DEFAULT_WIDTH)}'));
  assert.ok(app.includes('data-testid="sidebar-resize-handle"'));
});

test('Server shell keeps tools out of navigation and routes the account glyph to settings', () => {
  assert.match(app, /const SERVER_TOOL_VIEWS = new Set<View>\(\['browser', 'radar', 'compass', 'toolkit'\]\)/);
  assert.match(app, /!SERVER_TOOL_VIEWS\.has\(item\.id\)/);
  assert.match(app, /label=\{t\('Mi cuenta'\)\}[\s\S]*?dataTestId="header-account"/);
  assert.match(app, /navigate\('\/view\/settings\?tab=server'\)/);
});

test('Server header mirrors Desktop measured geometry and action semantics', () => {
  assert.match(app, /data-platform="web"/);
  assert.match(app, /className="app-titlebar relative flex h-11/);
  assert.match(app, /data-testid="sidebar-header-brand"/);
  assert.match(app, /text-lg font-semibold tracking-tight/);
  assert.match(app, /data-vault-trigger data-tour="vault-badge"/);
  assert.match(app, /title=\{t\('Bóveda activa'\)\}/);
  assert.match(app, /visibility: vaultBadgePlacement\?\.fits \? 'visible' : 'hidden'/);
  assert.doesNotMatch(app, /transform: vaultBadgePlacement \? 'translateY/);
  assert.doesNotMatch(app, /header-vault-badge[^>]*-translate-x-1\/2/);
  assert.match(app, /dataTestId="header-search"/);
  assert.match(app, /dataTestId="header-settings"/);
  assert.match(app, /dataTestId="theme-toggle"/);
  assert.match(app, /dataTestId="header-account"/);
});

test('Server responsive header preserves account/settings/theme and yields optional actions first', () => {
  assert.match(css, /header-action-rail > \[data-testid='header-nodi'\]/);
  assert.match(css, /header-action-rail > \[data-testid='header-assistant'\]/);
  assert.doesNotMatch(css, /header-action-rail > :nth-last-child\(-n\+2\)/);
});

test('Server light mode remaps shell hovers, nav, switcher and settings controls', () => {
  assert.match(css, /html\.light \.server-desktop-surface \.server-sidebar-nav-item:not\(\.is-active\):hover/);
  assert.match(css, /html\.light \.server-vault-popover \.bg-neutral-950/);
  assert.match(css, /html\.light \.server-vault-popover button:hover/);
  assert.match(settingsCss, /color-scheme:\s*light/);
  assert.match(settingsCss, /\.server-settings-native\[data-theme=['"]light['"]\]/);
});

test('account settings expose CSRF-protected web sign-out', () => {
  const settings = fs.readFileSync(`${root}/src/serverWeb/settings/ServerSettingsView.tsx`, 'utf8');
  assert.match(settings, /method="post" action="\/logout"/);
  assert.match(settings, /name="csrf" value=\{csrfToken \|\| ''\}/);
  assert.match(settings, /data-testid="account-signout"/);
});
