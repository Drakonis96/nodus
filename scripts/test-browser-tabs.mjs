// Tab lifecycle: the parts that leak if they are wrong.
//
// A leaked tab does not throw. It keeps a renderer process alive, keeps its
// listeners registered, and keeps painting nothing — the symptom is memory and
// CPU, noticed days later. So these assertions are about teardown being
// complete and ordered, not about tabs appearing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(repoRoot, 'electron/browser/tabs.ts'), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function body(name) {
  const start = code.search(new RegExp(`(?:export )?(?:async )?function ${name}\\b`));
  assert.ok(start >= 0, `${name} must exist`);
  const rest = code.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
}

test('closing a tab destroys its WebContents rather than only detaching it', () => {
  // removeChildView alone stops it painting; the process stays alive.
  const close = body('destroyTab');
  assert.match(close, /removeChildView|detach\(/, 'the view must leave the window');
  assert.match(close, /webContents\.close\(\)/, 'the WebContents must be destroyed');
  assert.match(close, /isDestroyed\(\)/, 'destroying twice must be guarded');
  assert.match(close, /webContents\.stop\(\)/, 'in-flight page loads must stop before destruction');
});

test('closing a tab removes every listener it registered, before destroying it', () => {
  const close = body('destroyTab');
  assert.match(close, /disposers/, 'listeners must be undone through the disposer list');
  // Order matters: a handler firing during teardown would patch state for a tab
  // that has already been dropped from the registry.
  const disposeAt = close.indexOf('disposers');
  const destroyAt = close.indexOf('webContents.close()');
  assert.ok(disposeAt < destroyAt, 'listeners must be removed before the contents is destroyed');
});

test('every listener the tab registers goes through the disposer list', () => {
  // A raw contents.on(...) would survive closeTab and keep the tab reachable.
  const wire = code.slice(code.indexOf('function wire('), code.indexOf('export async function createTab'));
  const raw = [...wire.matchAll(/contents\.on\(/g)];
  assert.deepEqual(raw.map((m) => m[0]), [],
    'listeners must be registered through on(tab, contents, ...), not contents.on directly');
});

test('the tab registry is emptied when the last tab closes', () => {
  const close = body('destroyTab');
  assert.match(close, /tabs\.delete\(/, 'the registry entry must go');
});

test('closing the active tab hands activation to another one', () => {
  // Otherwise the window keeps a detached view and shows nothing.
  const close = body('destroyTab');
  assert.match(close, /activeTabId === id/, 'closing the active tab must be detected');
  assert.match(close, /activateTab\(/, 'another tab must take over');
});

test('shutdown closes every tab through the same path', () => {
  // Not a second teardown implementation: a divergent one is how the careful
  // ordering above gets skipped exactly when the app is exiting.
  const all = body('closeAllBrowserTabs');
  assert.match(all, /destroyTab\(/, 'shutdown must reuse the per-tab destructor');
  assert.match(all, /activeTabId = null/, 'shutdown must clear the active tab');
});

test('the tab cap is enforced where tabs are created, not only in the UI', () => {
  const create = code.slice(code.indexOf('export async function createTab'));
  const guard = create.slice(0, create.indexOf('const view'));
  assert.match(guard, /MAX_BROWSER_TABS/, 'creation must check the cap');
  // A disabled button is a courtesy; setWindowOpenHandler can also create tabs,
  // and a page opening popups in a loop must not be able to walk past the cap.
  assert.match(guard, /return null/, 'creation past the cap must refuse');
});

test('only the active tab is attached to the window', () => {
  // This is what makes a background tab cheap: detached means Chromium neither
  // composites nor paints it, while its WebContents stays alive.
  const activate = body('activateTab');
  assert.match(activate, /detach\(previous\)/, 'the previous tab must be detached');
  assert.match(activate, /attach\(tab\)/, 'the new tab must be attached');
});

test('shutdown is wired into every one of main.ts’s exit paths', () => {
  // window-all-closed, before-quit and before-quit-for-update are three separate
  // handlers. Missing one leaves WebContents alive during an update install.
  const main = readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');
  const occurrences = [...main.matchAll(/destroyBrowserSubsystem\(\)/g)].length;
  assert.equal(occurrences, 3, `expected 3 shutdown call sites, found ${occurrences}`);
});

test('restart and application exit share one Browser subsystem cleanup', () => {
  const lifecycle = readFileSync(path.join(repoRoot, 'electron/browser/lifecycle.ts'), 'utf8');
  const restartAt = lifecycle.indexOf('export async function restartBrowserSubsystem');
  const restart = lifecycle.slice(restartAt);
  assert.match(restart, /destroyBrowserSubsystem\(\{ preserveViewport: true \}\)/,
    'restart must use the same subsystem cleanup as quit');
  assert.ok(restart.indexOf('destroyBrowserSubsystem') < restart.indexOf('createTab'),
    'all old resources must be destroyed before the fresh tab is created');
  assert.doesNotMatch(lifecycle, /clearStorageData|clearCache|clearAllBrowserData/,
    'restart must never clear the persistent Browser session');
});

test('renderer crashes use the same per-tab destructor', () => {
  const crashAt = code.indexOf("'render-process-gone'");
  const crash = code.slice(crashAt, code.indexOf('export async function createTab', crashAt));
  assert.match(crash, /destroyTab\(tab\.id/,
    'crashed Browser renderers must not remain registered or attached');
});

test('restart IPC is trusted-UI only and warns from main-process activity state', () => {
  const ipc = readFileSync(path.join(repoRoot, 'electron/ipc/browser.ts'), 'utf8');
  const start = ipc.indexOf("h('browser:restart'");
  const end = ipc.indexOf("h('browser:openTab'", start);
  const restart = ipc.slice(start, end);
  assert.match(restart, /assertUiSender\(event, getWindow\)/,
    'loaded websites must never be able to request restart');
  assert.match(restart, /activeBrowserDownloadCount\(\)/,
    'the warning must check live downloads in main');
  assert.match(restart, /browserMediaStates\(\)\.length/,
    'the warning must check live media in main');
  assert.match(restart, /requiresConfirmation: true/,
    'activity must require an explicit second request');
});
