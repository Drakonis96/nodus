// Nodus Browser keyboard and click shortcuts.
//
// Why any of this is not simply a `keydown` listener in React: a browser tab is
// a native WebContentsView, and it takes the keyboard the same way it takes the
// pointer. Nothing in Nodus's own renderer hears a key pressed while the user is
// reading a page — which is exactly when Cmd/Ctrl+T means "new tab". Main claims
// the keystroke first, and it must claim ONLY Nodus's own shortcuts: anything
// else it swallowed would be a binding stolen from the website.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-shortcuts-'));
const bundle = path.join(dir, 'shortcuts.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/browserShortcuts.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const { browserShortcutFor, opensInNewTab, historyNeighbourIndex } = require(bundle);

const press = (over = {}) => ({
  type: 'keyDown', key: 't', control: false, meta: false, alt: false, shift: false, isAutoRepeat: false, ...over,
});

test('Cmd+T and Ctrl+T both open a new tab', () => {
  assert.equal(browserShortcutFor(press({ meta: true })), 'newTab');
  assert.equal(browserShortcutFor(press({ control: true })), 'newTab');
});

test('the letter is matched whatever case the keyboard reports', () => {
  assert.equal(browserShortcutFor(press({ meta: true, key: 'T' })), 'newTab');
});

test('a bare T is the user typing, and must reach the page', () => {
  assert.equal(browserShortcutFor(press()), null);
});

test('adding Alt or Shift is a DIFFERENT shortcut and is not ours', () => {
  assert.equal(browserShortcutFor(press({ meta: true, alt: true })), null);
  assert.equal(browserShortcutFor(press({ meta: true, shift: true })), null);
});

test('holding the key down opens one tab, not one per repeat', () => {
  assert.equal(browserShortcutFor(press({ meta: true, isAutoRepeat: true })), null);
});

test('only the key going down counts, so one press is one tab', () => {
  assert.equal(browserShortcutFor(press({ meta: true, type: 'keyUp' })), null);
  assert.equal(browserShortcutFor(press({ meta: true, type: 'char' })), null);
});

test('every other accelerator passes through to the website untouched', () => {
  // The whole safety of intercepting input: what this does not claim, it does
  // not take. A site binding Cmd+K or Cmd+S keeps it.
  for (const key of ['k', 's', 'a', 'c', 'v', 'r', 'w', 'f', 'Enter', 'ArrowLeft']) {
    assert.equal(browserShortcutFor(press({ meta: true, key })), null, `Cmd+${key} is not ours`);
  }
});

test('malformed input is not a crash', () => {
  assert.equal(browserShortcutFor(null), null);
  assert.equal(browserShortcutFor(undefined), null);
  assert.equal(browserShortcutFor({}), null);
});

test('Cmd/Ctrl-click and middle-click mean "new tab"', () => {
  assert.equal(opensInNewTab({ metaKey: true }), true);
  assert.equal(opensInNewTab({ ctrlKey: true }), true);
  assert.equal(opensInNewTab({ button: 1 }), true);
});

test('an ordinary left click still navigates in place', () => {
  assert.equal(opensInNewTab({ button: 0 }), false);
  assert.equal(opensInNewTab({}), false);
  assert.equal(opensInNewTab({ shiftKey: true }), false);
});

test('the history neighbour is one step either way', () => {
  assert.equal(historyNeighbourIndex(3, 5, 'back'), 2);
  assert.equal(historyNeighbourIndex(3, 5, 'forward'), 4);
});

test('there is no neighbour past either end of the history', () => {
  // What keeps main from asking Electron for an entry that does not exist.
  assert.equal(historyNeighbourIndex(0, 5, 'back'), null);
  assert.equal(historyNeighbourIndex(4, 5, 'forward'), null);
  assert.equal(historyNeighbourIndex(0, 1, 'back'), null);
  assert.equal(historyNeighbourIndex(0, 1, 'forward'), null);
  assert.equal(historyNeighbourIndex(-1, 0, 'back'), null, 'an empty history has no neighbours');
});

// ---------------------------------------------------------------------------
// Wiring, checked against source.
// ---------------------------------------------------------------------------

const code = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

test('main claims the keystroke before the page can swallow it', () => {
  const tabs = code('electron/browser/tabs.ts');
  assert.match(tabs, /'before-input-event'/, 'without this, Cmd/Ctrl+T does nothing while reading a page');
  assert.match(tabs, /browserShortcutFor/);
  assert.match(tabs, /shortcutActions\?\.newTab\(\)/);
});

test('the renderer covers the case main cannot: focus in the Nodus chrome', () => {
  assert.match(code('src/views/NodusBrowserView.tsx'), /key\.toLowerCase\(\) === 't'/);
});

test('a new tab has ONE definition, so the shortcut and the "+" cannot drift', () => {
  const ipc = code('electron/ipc/browser.ts');
  assert.match(ipc, /const openNewTab = /);
  assert.match(ipc, /newTab: \(\) => \{ void openNewTab\(''\); \}/);
  assert.match(ipc, /h\('browser:openTab'[\s\S]{0,200}return openNewTab\(url\);/);
});

test('the history destination is resolved in main, and only if policy allows it', () => {
  // The renderer has no access to a tab's navigation history at all, and a URL
  // out of history is still a URL: it goes through the same navigation policy as
  // anything else before a tab is opened on it.
  const tabs = code('electron/browser/tabs.ts');
  assert.match(tabs, /export function historyNeighbourUrl/);
  assert.match(tabs, /historyNeighbourUrl[\s\S]{0,900}decideNavigation\(url, \{ isMainFrame: true \}\)\.allowed/);
  assert.match(code('electron/ipc/browser.ts'), /h\('browser:openHistoryNeighbour'/);
});

test('the history IPC is trusted-UI only and refuses an unknown direction', () => {
  const ipc = code('electron/ipc/browser.ts');
  const handler = ipc.slice(ipc.indexOf("h('browser:openHistoryNeighbour'"));
  assert.match(handler.slice(0, 400), /assertUiSender\(event, getWindow\)/);
  assert.match(handler.slice(0, 400), /direction !== 'back' && direction !== 'forward'/);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
