// Cut, Copy and Paste: which of them a right-click offers, and in which order.
//
// Two gaps this covers. A web form used to offer Copy alone, so filling one in
// from the clipboard was impossible without a keyboard shortcut. And Nodus's own
// text fields — the Browser address bar above all — had no context menu at all,
// because Electron shows one only if the app builds it, and nothing did.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-edit-menu-'));
const bundle = path.join(dir, 'edit-menu.cjs');

// `electron` cannot be imported outside Electron. The decision under test is
// pure, so a stub standing in for the menu API is enough to reach it — and if
// the module ever starts DOING something at import time, this stub is what
// notices, because the stub has no behaviour to give it.
const stub = path.join(dir, 'electron-stub.js');
writeFileSync(stub, `
export class Menu { constructor() { this.items = []; } append(item) { this.items.push(item); } }
export class MenuItem { constructor(options) { Object.assign(this, options); } }
export const clipboard = { availableFormats: () => ['text/plain'] };
export const nativeImage = { createFromBuffer: () => ({ setTemplateImage() {} }) };
`);

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/browser/editMenu.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:electron=${stub}`,
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const { editEntries, EDIT_LABELS } = require(bundle);

const field = (over = {}) => ({
  isEditable: true,
  hasSelection: false,
  canCut: true,
  canCopy: true,
  canPaste: true,
  clipboardHasContent: true,
  ...over,
});

const actions = (entries) => entries.map((entry) => entry.action);

test('THE ORDER IS THE FEATURE: cut, copy, paste — never anything else', () => {
  assert.deepEqual(actions(editEntries(field({ hasSelection: true }))), ['cut', 'copy', 'paste']);
});

test('a text field always shows all three, even when some are dead', () => {
  // A greyed-out Paste says "the clipboard is empty". A missing Paste says
  // "this app cannot paste", which is the bug being fixed.
  const entries = editEntries(field({ hasSelection: false, clipboardHasContent: false }));
  assert.deepEqual(actions(entries), ['cut', 'copy', 'paste']);
  assert.deepEqual(entries.map((entry) => entry.enabled), [false, false, false]);
});

test('an empty field with a full clipboard can paste and nothing else', () => {
  const entries = editEntries(field({ hasSelection: false }));
  assert.deepEqual(entries, [
    { action: 'cut', enabled: false },
    { action: 'copy', enabled: false },
    { action: 'paste', enabled: true },
  ]);
});

test('a read-only field keeps Copy and loses Cut and Paste', () => {
  // Chromium answers this for us through editFlags; the menu never re-derives it.
  const entries = editEntries(field({ hasSelection: true, canCut: false, canPaste: false }));
  assert.deepEqual(entries.map((entry) => entry.enabled), [false, true, false]);
});

test('a password field can neither be cut from nor copied', () => {
  const entries = editEntries(field({ hasSelection: true, canCut: false, canCopy: false }));
  assert.deepEqual(entries.map((entry) => entry.enabled), [false, false, true]);
});

test('selected page text, outside any field, gets Copy alone', () => {
  const entries = editEntries({
    isEditable: false, hasSelection: true, canCut: false, canCopy: true, canPaste: false, clipboardHasContent: true,
  });
  assert.deepEqual(entries, [{ action: 'copy', enabled: true }]);
});

test('a right-click on nothing in particular offers no edit entries at all', () => {
  const entries = editEntries({
    isEditable: false, hasSelection: false, canCut: false, canCopy: false, canPaste: false, clipboardHasContent: true,
  });
  assert.deepEqual(entries, [], 'an empty menu must not pop over the page');
});

test('every action has a label', () => {
  assert.deepEqual(Object.keys(EDIT_LABELS).sort(), ['copy', 'cut', 'paste']);
  for (const label of Object.values(EDIT_LABELS)) assert.ok(String(label).length > 0);
});

// ---------------------------------------------------------------------------
// Wiring, checked against source: these are the parts a unit test cannot reach.
// ---------------------------------------------------------------------------

const code = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

test('the edit items act on the WebContents that was clicked, not on a guess', () => {
  // A menu ROLE targets whatever Electron believes is focused, and a browser tab
  // is a WebContentsView rather than a window — the guess is wrong exactly when
  // it matters. Naming the WebContents leaves nothing to guess.
  const source = code('electron/browser/editMenu.ts');
  assert.doesNotMatch(source, /role:\s*'(cut|copy|paste)'/, 'roles must not be used here');
  for (const call of ['contents.cut()', 'contents.copy()', 'contents.paste()']) {
    assert.ok(source.includes(call), `${call} must be the action`);
  }
});

test('Nodus’s own windows install the edit menu, so the address bar has one', () => {
  assert.match(code('electron/main.ts'), /installAppEditContextMenu\(\s*mainWindow\.webContents/,
    'the main window must install it, or right-clicking the address bar does nothing');
});

test('the browser page menu uses the same three entries', () => {
  assert.match(code('electron/browser/contextMenu.ts'), /appendEditItems\(menu, contents/);
});

test('the app-window menu offers nothing but the three edit entries', () => {
  // It is installed on every text field in Nodus, so it must stay minimal: no
  // browser actions, no Nodi, no navigation.
  const source = code('electron/browser/editMenu.ts');
  for (const foreign of ['askNodi', 'addToLibrary', 'openInNewTab', 'openExternal', 'navigationHistory']) {
    assert.ok(!source.includes(foreign), `${foreign} does not belong in the edit menu`);
  }
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
