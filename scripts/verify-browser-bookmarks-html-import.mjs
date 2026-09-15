// Does a real browser read the exported bookmark file the way Nodus wrote it?
//
// The Netscape Bookmark format has no specification to test against, only the
// parsers that accept it. This script writes an export with the same serializer
// the app ships, then loads the file in every Chromium browser installed on this
// machine — headless, each with a throwaway profile, so no real browser data is
// touched — and compares what the browser sees (document order, folder nesting,
// decoded titles, URLs) against the collection the model says it wrote.
//
// Usage:
//   node scripts/verify-browser-bookmarks-html-import.mjs                     # fresh fixture
//   node scripts/verify-browser-bookmarks-html-import.mjs --file <export.html> # what the app wrote
//
// Browsers that are not installed, and engines this toolchain cannot drive
// headlessly (Safari/WebKit), are reported as not executed rather than passed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** Everything on a Mac that can read this format, and where it lives. */
const BROWSERS = [
  { name: 'Google Chrome', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  { name: 'Microsoft Edge', executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
  { name: 'Opera', executablePath: '/Applications/Opera.app/Contents/MacOS/Opera' },
  { name: 'Opera GX', executablePath: '/Applications/Opera GX.app/Contents/MacOS/Opera' },
  { name: 'Brave', executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
  { name: 'Vivaldi', executablePath: '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi' },
  { name: 'Chromium', executablePath: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
];
/** Present or not, but not something this toolchain can drive headlessly. */
const UNSUPPORTED = [
  { name: 'Safari (WebKit)', bundle: '/Applications/Safari.app', reason: 'Playwright cannot drive the system Safari, and no WebKit build is installed' },
  { name: 'Firefox (Gecko)', bundle: '/Applications/Firefox.app', reason: 'not installed, so Gecko is not exercised' },
];

const now = '2026-08-19T18:00:00.000Z';
const fileArgument = process.argv.indexOf('--file');
const providedFile = fileArgument >= 0 ? process.argv[fileArgument + 1] : null;
if (providedFile && !existsSync(providedFile)) throw new Error(`No such export: ${providedFile}`);

/** Bundle the shipped model, so this checks the exact serializer the app runs. */
const workDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-bookmarks-import-'));
const bundle = path.join(workDir, 'browserBookmarks.cjs');
execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'shared/browserBookmarks.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
], { cwd: repoRoot, stdio: 'pipe' });
const model = require(bundle);

let sequence = 0;
const id = () => `verify-${++sequence}`;

/** A collection that uses every part of the format that browsers parse differently. */
function fixture() {
  let store = model.emptyBrowserBookmarkStore();
  const folder = (name, parentId) => { const made = model.insertBrowserBookmarkFolder(store, { name, parentId }, id(), now); store = made.store; return made.folder; };
  const save = (draft) => { const made = model.insertBrowserBookmark(store, draft, id(), now); store = made.store; return made.bookmark; };
  const research = folder('Recherche & Sources', null);
  const archives = folder('Archives «presse»', research.id);
  folder('Vide (à trier)', research.id);
  save({ title: 'A & B "quoted" <tag> O\'Hara', url: 'https://example.org/search?q=amour&lang=fr&page=2#results', description: 'Ligne 1 & 2 <b>gras</b> "citée"', parentId: archives.id });
  save({ title: '中国古代文献 · 漢籍', url: 'https://example.cn/古籍?卷=一&index=2', parentId: archives.id });
  save({ title: 'Émile Zola — Œuvres', url: 'https://fr.wikisource.org/wiki/Auteur:Émile_Zola', parentId: null });
  save({ title: 'Gallica — BnF', url: 'https://gallica.bnf.fr/ark:/12148/btv1b8449691v/f29.item?lang=FR&r=zola', description: 'Bibliothèque nationale de France', parentId: null });
  return store;
}

const original = providedFile ? null : fixture();
const source = providedFile ? readFileSync(providedFile, 'utf8') : model.exportBrowserBookmarksHtml(original);
const exportPath = providedFile ?? path.join(workDir, 'nodus-bookmarks-fixture.html');
if (!providedFile) writeFileSync(exportPath, source, 'utf8');

/** The tree a file describes, in the order a browser reads it. */
function tree(store, { withDescriptions = false } = {}) {
  const out = [];
  const walk = (parentId, depth) => {
    for (const ref of model.browserBookmarkChildren(store, parentId)) {
      if (ref.kind === 'folder') {
        out.push({ kind: 'folder', label: store.folders.find((row) => row.id === ref.id).name, depth });
        walk(ref.id, depth + 1);
      } else {
        const entry = store.bookmarks.find((row) => row.id === ref.id);
        out.push({
          kind: 'bookmark',
          label: entry.title,
          url: entry.url,
          depth,
          ...(withDescriptions ? { description: entry.description } : {}),
        });
      }
    }
  };
  walk(null, 1);
  return out;
}

/* ------------------------------------------------- 1. the file itself

   The format contract, checked on the bytes rather than on the model. */
const header = source.split('\n');
assert.equal(header[0], '<!DOCTYPE NETSCAPE-Bookmark-file-1>', 'a browser keys off this doctype');
assert.match(header[1], /charset=UTF-8/i, 'the file must declare UTF-8');
assert.ok(!source.startsWith('\ufeff'), 'a BOM would be read as part of the first tag');
assert.ok(source.endsWith('</DL><p>\n'), 'the root list must be closed and the file newline-terminated');

const parsed = model.parseBrowserBookmarksHtml(source, id, now);
assert.equal(parsed.invalidUrls, 0, `Nodus rejected ${parsed.invalidUrls} URL(s) in this export`);
assert.equal(parsed.truncated, false);
const written = tree(parsed.store, { withDescriptions: true });

if (original) {
  const nodes = tree(original).length;
  assert.equal((source.match(/ADD_DATE="\d{10}"/g) ?? []).length, nodes, 'every node needs a Unix-seconds ADD_DATE');
  assert.deepEqual(written, tree(original, { withDescriptions: true }),
    'Nodus must import its own export back into the same tree, order, titles, URLs and descriptions');
  console.log(`  ok  Nodus reads its own export back: ${nodes} nodes, same order, nesting, URLs and descriptions`);
} else {
  assert.deepEqual(tree(model.parseBrowserBookmarksHtml(model.exportBrowserBookmarksHtml(parsed.store), id, now).store), tree(parsed.store),
    're-exporting what was just imported must not change the tree');
  console.log(`  ok  re-exporting the given file is stable: ${written.length} nodes`);
}

/* --------------------------------------------- 2. what the installed browsers see */

const EXTRACT = `(() => {
  const text = (element) => (element?.textContent ?? '').trim();
  const depthOf = (element) => {
    let depth = 0;
    let node = element.closest('dl');
    while (node) { depth += 1; node = node.parentElement?.closest('dl') ?? null; }
    return depth;
  };
  return {
    charset: document.characterSet,
    title: text(document.querySelector('title')),
    heading: text(document.querySelector('h1')),
    anchors: document.querySelectorAll('a').length,
    folders: document.querySelectorAll('h3').length,
    layout: Array.from(document.querySelectorAll('a, h3')).map((element) => ({
      kind: element.tagName === 'A' ? 'bookmark' : 'folder',
      label: text(element),
      href: element.getAttribute('href') ?? '',
      depth: depthOf(element),
    })),
  };
})()`;

const wanted = written.map(({ description, ...rest }) => rest);
const wantedShape = wanted.map(({ kind, label, depth }) => ({ kind, label, depth }));
const browserReport = [];
const failures = [];

for (const browser of BROWSERS) {
  if (!existsSync(browser.executablePath)) {
    browserReport.push({ name: browser.name, status: 'not installed' });
    continue;
  }
  let context;
  let view = null;
  try {
    context = await chromium.launchPersistentContext(path.join(workDir, browser.name.replace(/\W/g, '')), {
      executablePath: browser.executablePath,
      headless: true,
      timeout: 60_000,
      args: ['--no-first-run', '--no-default-browser-check'],
    });
    // A fresh page, never the context's first one: Opera GX opens its own start
    // page there, and navigating it away aborts with net::ERR_ABORTED.
    const page = await context.newPage();
    await page.goto(pathToFileURL(exportPath).href, { timeout: 30_000, waitUntil: 'load' });
    view = await page.evaluate(EXTRACT);
    assert.equal(view.charset, 'UTF-8', 'the document must be decoded as UTF-8');
    assert.equal(view.title, 'Nodus Bookmarks');
    assert.equal(view.heading, 'Nodus Bookmarks');
    assert.equal(view.anchors, wanted.filter((row) => row.kind === 'bookmark').length);
    assert.equal(view.folders, wanted.filter((row) => row.kind === 'folder').length);
    assert.deepEqual(
      view.layout.map(({ kind, label, depth }) => ({ kind, label, depth })),
      wantedShape,
      'the browser must see the same document order and nesting the collection has',
    );
    for (const row of wanted.filter((entry) => entry.url)) {
      const read = view.layout.find((entry) => entry.label === row.label);
      assert.ok(read, `${row.label} must be readable`);
      assert.equal(new URL(read.href).href, new URL(row.url).href, `${row.label} must keep its full URL`);
    }
    browserReport.push({ name: browser.name, status: 'ok', version: context.browser()?.version() ?? '' });
  } catch (error) {
    const message = String(error?.message ?? error).split('\n')[0].slice(0, 200);
    failures.push(`${browser.name}: ${message}`);
    browserReport.push({ name: browser.name, status: context ? 'failed' : 'could not launch', detail: message });
    if (view) {
      console.error(`\n  ${browser.name} read the file as:`);
      for (const row of view.layout) console.error(`    ${String(row.depth).padStart(2)} ${row.kind.padEnd(8)} ${row.label}`);
      console.error('  the collection is:');
      for (const row of wanted) console.error(`    ${String(row.depth).padStart(2)} ${row.kind.padEnd(8)} ${row.label}`);
    }
  } finally {
    await context?.close().catch(() => {});
  }
}

/* ------------------------------------------------------------------- report */

console.log(`\nExport checked: ${exportPath}`);
console.log(`Nodes: ${wanted.length} (${wanted.filter((row) => row.kind === 'bookmark').length} bookmarks, ${wanted.filter((row) => row.kind === 'folder').length} folders)\n`);
for (const row of browserReport) {
  const detail = row.version ? ` (Chromium ${row.version})` : row.detail ? ` — ${row.detail}` : '';
  console.log(`  ${row.status.padEnd(15)} ${row.name}${detail}`);
}
for (const row of UNSUPPORTED) {
  console.log(`  ${(existsSync(row.bundle) ? 'not executed' : 'not installed').padEnd(15)} ${row.name} — ${row.reason}`);
}

await rm(workDir, { recursive: true, force: true });
const verified = browserReport.filter((row) => row.status === 'ok').length;
if (failures.length) {
  console.error(`\n[bookmarks-import] FAILED: ${failures.join(' | ')}`);
  process.exit(1);
}
if (!verified) {
  console.error('\n[bookmarks-import] nothing was verified: no installed browser could be driven');
  process.exit(1);
}
console.log(`\n[bookmarks-import] ${verified} installed browser(s) read the export correctly`);
