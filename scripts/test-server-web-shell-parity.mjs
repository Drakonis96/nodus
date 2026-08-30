import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = process.cwd();
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
const read = (file) => variants(fs.readFileSync(`${root}/${file}`, 'utf8'));
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
  assert.match(app, /const SERVER_TOOL_VIEWS = new Set<View>\(\[\s*'browser',\s*'radar',\s*'compass',\s*'toolkit',?\s*\]\)/);
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

test('Server header orders commands, assistant, account, theme and settings', () => {
  const orderedActions = [
    'header-search',
    'header-assistant',
    'header-account',
    'theme-toggle',
    'header-settings',
  ].map((testId) => app.indexOf(`dataTestId="${testId}"`));
  assert.ok(orderedActions.every((position) => position >= 0));
  assert.deepEqual(orderedActions, [...orderedActions].sort((a, b) => a - b));
  assert.doesNotMatch(app, /dataTestId="header-nodi"/);
  assert.match(css, /header-action-rail > \[data-testid='header-assistant'\]/);
  assert.doesNotMatch(css, /header-action-rail > \[data-testid='header-nodi'\]/);
  assert.doesNotMatch(css, /header-action-rail > :nth-last-child\(-n\+2\)/);
});

test('active Server header actions retain contrast in light mode and on hover', () => {
  assert.match(
    css,
    /\.server-desktop-surface \.server-header-action\.bg-indigo-600:hover[\s\S]*?background:\s*var\(--vault-accent,\s*#4f46e5\);[\s\S]*?color:\s*#fff;/,
  );
  assert.match(
    css,
    /\.server-desktop-surface \.server-header-action\.bg-indigo-600:focus-visible/,
  );
});

test('central view shows a circular loader while sidebar navigation resolves', () => {
  assert.match(app, /const \[pendingView, setPendingView\] = useState<View \| null>\(null\)/);
  assert.match(app, /setPendingView\(view\)[\s\S]*?navigate\(viewPath\(view\)\)/);
  assert.match(app, /className=["']server-view-host relative[\s\S]*?data-loading-view=/);
  assert.match(app, /aria-busy=\{pendingView === activeView \? true : undefined\}/);
  assert.match(app, /data-testid=["']view-loading-spinner["']/);
  assert.match(app, /querySelector\('\[data-testid="loading"\]'\)/);
  assert.doesNotMatch(app, /<nav[\s\S]{0,400}?data-loading-view=/);
  assert.match(css, /\.server-view-loading-overlay[\s\S]*?place-items:\s*center/);
  assert.match(css, /\.server-view-loading-spinner[\s\S]*?border-radius:\s*50%/);
  assert.match(css, /@keyframes server-view-loading-spin/);
  assert.doesNotMatch(css, /server-sidebar-loading-dots|content:\s*"•••"/);
});

test('Server light mode remaps shell hovers, nav, switcher and settings controls', () => {
  assert.match(css, /html\.light \.server-desktop-surface \.server-sidebar-nav-item:not\(\.is-active\):hover/);
  assert.match(css, /html\.light \.server-vault-popover \.bg-neutral-950/);
  assert.match(css, /html\.light \.server-vault-popover button:hover/);
  assert.match(settingsCss, /color-scheme:\s*light/);
  assert.match(settingsCss, /\.server-settings-native\[data-theme=['"]light['"]\]/);
});

test('account settings expose CSRF-protected web sign-out', () => {
  const settings = variants(fs.readFileSync(`${root}/src/serverWeb/settings/ServerSettingsView.tsx`, 'utf8'));
  assert.match(settings, /method="post"[\s\S]*?action="\/logout"/);
  assert.match(settings, /name=["']csrf["'] value=\{csrfToken \|\| ["']{2}\}/);
  assert.match(settings, /data-testid="account-signout"/);
});
