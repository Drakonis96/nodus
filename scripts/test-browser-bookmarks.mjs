// Nodus Bookmarks: the pure hierarchy plus the architectural boundaries that
// keep it separate from Chromium browsing data and untrusted websites.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-bookmarks-'));
const bundle = path.join(dir, 'bookmarks.cjs');
execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'shared/browserBookmarks.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
], { cwd: repoRoot, stdio: 'inherit' });
const require = createRequire(import.meta.url);
const model = require(bundle);
let sequence = 0;
const id = () => `test-${++sequence}`;
const now = '2026-08-19T18:00:00.000Z';

function sample() {
  let store = model.emptyBrowserBookmarkStore();
  const research = model.insertBrowserBookmarkFolder(store, { name: 'Research' }, id(), now); store = research.store;
  const archives = model.insertBrowserBookmarkFolder(store, { name: 'Archives', parentId: research.folder.id }, id(), now); store = archives.store;
  const france = model.insertBrowserBookmarkFolder(store, { name: 'France', parentId: archives.folder.id }, id(), now); store = france.store;
  const gallica = model.insertBrowserBookmark(store, { title: 'Gallica', url: 'https://gallica.bnf.fr/', description: 'French digital library', parentId: france.folder.id }, id(), now); store = gallica.store;
  return { store, research: research.folder, archives: archives.folder, france: france.folder, gallica: gallica.bookmark };
}

test('nested folders retain hierarchy, order and metadata', () => {
  const value = sample();
  assert.deepEqual(model.browserBookmarkFolderPath(value.store, value.france.id), ['Research', 'Archives', 'France']);
  assert.equal(value.gallica.parentId, value.france.id);
  assert.equal(value.gallica.description, 'French digital library');
  assert.equal(value.gallica.createdAt, now);
});

test('moves and manual ordering are stable', () => {
  let { store, research, gallica } = sample();
  const jstor = model.insertBrowserBookmark(store, { title: 'JSTOR', url: 'https://www.jstor.org/', parentId: research.id }, id(), now); store = jstor.store;
  store = model.moveBrowserBookmarkNode(store, { kind: 'bookmark', id: gallica.id }, research.id, 0, now);
  assert.deepEqual(model.browserBookmarkChildren(store, research.id).slice(0, 2), [
    { kind: 'bookmark', id: gallica.id }, { kind: 'folder', id: store.folders.find((f) => f.name === 'Archives').id },
  ]);
  store = model.moveBrowserBookmarkNode(store, { kind: 'bookmark', id: jstor.bookmark.id }, research.id, 0, now);
  assert.equal(model.browserBookmarkChildren(store, research.id)[0].id, jstor.bookmark.id);
});

test('cyclic folder moves and excessive nesting are rejected', () => {
  const { store, research, france } = sample();
  assert.throws(() => model.moveBrowserBookmarkNode(store, { kind: 'folder', id: research.id }, france.id, 0), /descend|misma/i);
  let deep = model.emptyBrowserBookmarkStore(); let parentId = null;
  for (let i = 0; i < model.MAX_BOOKMARK_FOLDER_DEPTH; i += 1) { const made = model.insertBrowserBookmarkFolder(deep, { name: `L${i}`, parentId }, id(), now); deep = made.store; parentId = made.folder.id; }
  assert.throws(() => model.insertBrowserBookmarkFolder(deep, { name: 'Too deep', parentId }, id(), now), /profunda/i);
});

test('duplicate URLs ignore fragments and trailing slash', () => {
  let store = model.emptyBrowserBookmarkStore();
  const first = model.insertBrowserBookmark(store, { title: 'Example', url: 'https://example.org/path/#one' }, id(), now); store = first.store;
  const second = model.insertBrowserBookmark(store, { title: 'Again', url: 'https://example.org/path#two' }, id(), now);
  assert.equal(second.duplicate.id, first.bookmark.id);
  assert.equal(second.store.bookmarks.length, 1);
});

test('unsafe bookmark and favicon values fail closed', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'nodus-library://item/1', 'nodus://bookmarks', 'data:text/html,x']) assert.equal(model.sanitizeBookmarkUrl(url), null);
  assert.equal(model.sanitizeBookmarkUrl('https://user:pass@example.org/x'), 'https://example.org/x');
  assert.equal(model.sanitizeFaviconDataUrl('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(model.sanitizeFaviconDataUrl('https://evil.test/icon.png'), null);
});

test('search includes title, domain, description and every folder name', () => {
  const { store, gallica } = sample();
  for (const query of ['gallica', 'bnf.fr', 'digital library', 'archives', 'france']) {
    assert.deepEqual(model.searchBrowserBookmarks(store, query).map((hit) => hit.bookmark.id), [gallica.id], query);
  }
});

test('delete folder recursively removes descendants but not siblings', () => {
  let { store, archives } = sample();
  const keep = model.insertBrowserBookmark(store, { title: 'Keep', url: 'https://example.org/' }, id(), now); store = keep.store;
  store = model.deleteBrowserBookmarkNode(store, { kind: 'folder', id: archives.id });
  assert.equal(store.folders.some((folder) => folder.id === archives.id), false);
  assert.deepEqual(store.bookmarks.map((bookmark) => bookmark.id), [keep.bookmark.id]);
});

test('JSON roundtrip preserves IDs, hierarchy, order and descriptions', () => {
  const { store } = sample();
  const restored = model.parseBrowserBookmarksJson(model.exportBrowserBookmarksJson(store));
  assert.deepEqual(restored.folders, store.folders);
  assert.deepEqual(restored.bookmarks, store.bookmarks);
});

test('standard Netscape HTML roundtrip and malformed imports are safe', () => {
  const { store } = sample();
  const parsed = model.parseBrowserBookmarksHtml(model.exportBrowserBookmarksHtml(store), id, now);
  assert.equal(parsed.store.bookmarks.length, 1);
  assert.equal(parsed.store.folders.length, 3);
  assert.deepEqual(model.browserBookmarkFolderPath(parsed.store, parsed.store.bookmarks[0].parentId), ['Research', 'Archives', 'France']);
  const hostile = model.parseBrowserBookmarksHtml('<DL><DT><A HREF="javascript:alert(1)">Bad</A><DT><A HREF="https://safe.example/">Safe</A></DL>', id, now);
  assert.equal(hostile.invalidUrls, 1);
  assert.deepEqual(hostile.store.bookmarks.map((bookmark) => bookmark.title), ['Safe']);
  assert.throws(() => model.parseBrowserBookmarksJson('{broken'), /no es válido/i);
});

test('imports merge without overwriting and report duplicates', () => {
  const { store } = sample();
  let incoming = model.emptyBrowserBookmarkStore();
  incoming = model.insertBrowserBookmark(incoming, { title: 'Duplicate', url: 'https://gallica.bnf.fr/' }, id(), now).store;
  incoming = model.insertBrowserBookmark(incoming, { title: 'New', url: 'https://openalex.org/' }, id(), now).store;
  const merged = model.mergeBrowserBookmarkStores(store, incoming, id, now);
  assert.equal(merged.summary.duplicates, 1);
  assert.equal(merged.summary.bookmarks, 1);
  assert.equal(merged.store.bookmarks.length, 2);
});

test('a 1,000 bookmark collection remains searchable and normalizable', () => {
  const raw = model.emptyBrowserBookmarkStore();
  raw.bookmarks = Array.from({ length: 1_000 }, (_, index) => ({ id: `bulk-${index}`, title: `Resource ${index}`, url: `https://example.org/${index}`, description: index === 777 ? 'needle research' : '', faviconDataUrl: null, parentId: null, order: index, createdAt: now, updatedAt: now }));
  const normalized = model.normalizeBrowserBookmarkStore(raw);
  assert.equal(normalized.bookmarks.length, 1_000);
  assert.equal(model.searchBrowserBookmarks(normalized, 'needle').length, 1);
});

test('bookmarks use Nodus auxiliary persistence and never Chromium storage', () => {
  const repository = readFileSync(path.join(repoRoot, 'electron/browser/bookmarks.ts'), 'utf8');
  assert.match(repository, /app\.getPath\('userData'\)/);
  assert.match(repository, /browser-bookmarks\.json/);
  assert.doesNotMatch(repository, /localStorage|sessionStorage|cookies|browserSession/);
  const backup = readFileSync(path.join(repoRoot, 'electron/export/exportImport.ts'), 'utf8');
  assert.match(backup, /GLOBAL_AUXILIARY_FILES[^\n]+browser-bookmarks\.json/);
  const browsingData = readFileSync(path.join(repoRoot, 'electron/browser/storage.ts'), 'utf8');
  const lifecycle = readFileSync(path.join(repoRoot, 'electron/browser/lifecycle.ts'), 'utf8');
  assert.doesNotMatch(browsingData, /browserBookmarks|browser-bookmarks\.json/);
  assert.doesNotMatch(lifecycle, /browserBookmarks|browser-bookmarks\.json/);
});

test('trusted Bookmarks UI reuses Atlas styling and avoids native prompt dialogs', () => {
  const styles = readFileSync(path.join(repoRoot, 'src/components/browser/NodusBookmarks.css'), 'utf8');
  const pages = readFileSync(path.join(repoRoot, 'src/components/browser/NodusStartPages.tsx'), 'utf8');
  const manager = readFileSync(path.join(repoRoot, 'src/components/browser/BrowserBookmarksManager.tsx'), 'utf8');
  const browserView = readFileSync(path.join(repoRoot, 'src/views/NodusBrowserView.tsx'), 'utf8');
  assert.match(styles, /@import url\([^)]*research-atlas\.css/);
  assert.match(pages, /isSaved \? 'Saved' : 'Save'/);
  assert.match(pages, /global search/);
  assert.doesNotMatch(manager, /window\.(?:prompt|confirm)\(/);
  assert.doesNotMatch(browserView, /window\.(?:prompt|confirm)\(/);
  assert.match(browserView, /setBookmarksManager\(false\)[\s\S]{0,180}setReturnToBookmarksManager\(true\)/);
  const omniboxStart = browserView.indexOf('data-testid="browser-omnibox-shell"');
  const bookmarkButton = browserView.indexOf('data-testid="browser-add-bookmark"');
  const omniboxEnd = browserView.indexOf('</div>', bookmarkButton);
  const managerButton = browserView.indexOf('dataTestId="browser-bookmarks-manager-button"');
  assert.ok(omniboxStart >= 0 && bookmarkButton > omniboxStart && omniboxEnd > bookmarkButton,
    'the page bookmark action must live inside the navigation bar');
  assert.ok(managerButton > omniboxEnd,
    'the separate toolbar bookmark icon must only open the bookmark manager');
});

test('home-page preferences expose Atlas, Bookmarks, custom and blank modes', () => {
  const shared = readFileSync(path.join(repoRoot, 'shared/browser.ts'), 'utf8');
  const quickSettings = readFileSync(path.join(repoRoot, 'src/views/NodusBrowserView.tsx'), 'utf8');
  assert.match(shared, /BrowserHomeMode = 'start' \| 'bookmarks' \| 'blank' \| 'custom'/);
  assert.match(quickSettings, /\['start', 'bookmarks', 'blank', 'custom'\]/);
  assert.match(quickSettings, /Nodus Bookmarks/);
});

test('all bookmark mutations are trusted-UI IPC and the remote preload exposes none', () => {
  const ipc = readFileSync(path.join(repoRoot, 'electron/ipc/browser.ts'), 'utf8');
  for (const channel of ['bookmarks:create', 'bookmarks:update', 'bookmarks:delete', 'bookmarks:move', 'bookmarks:previewImport', 'bookmarks:export']) {
    const start = ipc.indexOf(`h('browser:${channel}'`); assert.ok(start >= 0, channel);
    assert.match(ipc.slice(start, start + 500), /assertUiSender\(event, getWindow\)/, channel);
  }
  const remote = readFileSync(path.join(repoRoot, 'electron/preload/browserPage.ts'), 'utf8');
  assert.doesNotMatch(remote, /bookmark/i);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
