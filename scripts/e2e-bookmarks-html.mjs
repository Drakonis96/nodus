// End-to-end: the Bookmarks start page really exports and imports the collection.
//
// scripts/test-browser-bookmarks.mjs proves the serializer; only the running app
// proves the rest: that the toolbar actions reach the trusted process, that the
// native dialogs are offered the right file, that the export lands on disk with
// every bookmark, that an active search or an open folder cannot narrow what is
// written, and that the file the export writes is a file the import takes back —
// once, without duplicating or overwriting anything. The file dialogs themselves
// are patched here, because a test must not pop a real panel over the user's
// desktop — but the rest of the path (renderer -> preload -> IPC -> serializer ->
// file, and back) is the shipped one.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Re-exec under Electron-as-Node so better-sqlite3 matches the app ABI, exactly
// as every other script in this suite does.
if (!process.argv.includes('--run')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/e2e-bookmarks-html.mjs'), '--run'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  process.exit(0);
}

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  console.log('[e2e-bookmarks] no build found — running npm run build first…');
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

/* ------------------------------------------------------------------ fixtures */

// What the collection holds, and therefore what every exported file must hold.
// Created in this order, so sibling order is deterministic. Between them these
// cover the cases the Netscape format is easy to get wrong: a nested branch, an
// empty folder, Unicode, characters HTML escapes, and URLs that must keep their
// query string and fragment.
const FOLDER_SEED = [
  { key: 'research', name: 'Recherche & Sources', parent: null },
  { key: 'archives', name: 'Archives «presse»', parent: 'research' },
  { key: 'empty', name: 'Vide (à trier)', parent: 'research' },
];
const BOOKMARK_SEED = [
  { title: 'A & B "quoted" <tag> O\'Hara', url: 'https://example.org/search?q=amour&lang=fr&page=2#results', description: 'Ligne 1 & 2 <b>gras</b> "citée"', parent: 'archives' },
  { title: '中国古代文献 · 漢籍', url: 'https://example.cn/古籍?卷=一&index=2', description: '', parent: 'archives' },
  { title: 'Émile Zola — Œuvres', url: 'https://fr.wikisource.org/wiki/Auteur:Émile_Zola', description: '', parent: null },
  { title: 'Gallica', url: 'https://gallica.bnf.fr/', description: 'Bibliothèque numérique', parent: null, faviconDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==' },
  { title: 'JSTOR', url: 'https://www.jstor.org/', description: '', parent: 'research' },
];

// The tree as a browser must read it back: document order, folder nesting depth.
const EXPECTED_LAYOUT = [
  { kind: 'folder', label: 'Recherche & Sources', depth: 1 },
  { kind: 'folder', label: 'Archives «presse»', depth: 2 },
  { kind: 'bookmark', label: 'A & B "quoted" <tag> O\'Hara', depth: 3, url: 'https://example.org/search?q=amour&lang=fr&page=2#results' },
  { kind: 'bookmark', label: '中国古代文献 · 漢籍', depth: 3, url: 'https://example.cn/古籍?卷=一&index=2' },
  { kind: 'folder', label: 'Vide (à trier)', depth: 2 },
  { kind: 'bookmark', label: 'JSTOR', depth: 2, url: 'https://www.jstor.org/' },
  { kind: 'bookmark', label: 'Émile Zola — Œuvres', depth: 1, url: 'https://fr.wikisource.org/wiki/Auteur:Émile_Zola' },
  { kind: 'bookmark', label: 'Gallica', depth: 1, url: 'https://gallica.bnf.fr/' },
];

const failures = [];
let checks = 0;
async function check(name, fn) {
  try {
    await fn();
    checks += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`  FAIL ${name}: ${error?.message ?? error}`);
  }
}

/** Today as the user reads it, which is what the suggested file name must use. */
const localDay = (() => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
})();

const profile = await mkdtemp(path.join(os.tmpdir(), 'nodus-e2e-bookmarks-export-'));
const libraryRoot = path.join(profile, 'library-root');
await mkdir(libraryRoot, { recursive: true });
// Same recovery/first-vault/tutorial skips as e2e-browser.mjs: those walls would
// otherwise cover the shell before any Bookmarks test can reach it.
await writeFile(
  path.join(profile, 'app-prefs.json'),
  JSON.stringify({
    recoverySetupVersion: 1,
    firstVaultVersion: 1,
    basicsTutorialVersion: 999,
    mascotEnabled: false,
    mascotStyleChosen: true,
    tutorialVideosWatched: [],
    uiLanguage: 'es',
    autoBackupFolder: libraryRoot,
    autoBackupEnabled: false,
    libraryGlobalEnabled: true,
    browserDownloadFolder: libraryRoot,
  }),
  'utf8',
);

const exportDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-e2e-bookmarks-files-'));
const searchExport = path.join(exportDir, 'search-active.html');
const folderExport = path.join(exportDir, 'folder-open.html');
const repeatedExport = path.join(exportDir, 'repeat.html');
const cancelledExport = path.join(exportDir, 'never-written.html');
const foreignImport = path.join(exportDir, 'Chrome Bookmarks 2026-09-15.html');
const screenshotDir = path.join(repoRoot, 'tmp');
await mkdir(screenshotDir, { recursive: true });

// A file another browser wrote, shaped the way Chrome and Firefox write it: a
// comment header, attributes Nodus never emits, an empty folder, entities, a
// query string and a nested branch. Importing it must add exactly this.
const FOREIGN_FOLDERS = ['Marcadores de Chrome', 'Subcarpeta importada'];
const FOREIGN_BOOKMARKS = [
  { title: 'Artículo importado', url: 'https://historia.example/articulo?ref=importado&v=2', path: ['Marcadores de Chrome'] },
  { title: 'arXiv · preprint', url: 'https://arxiv.org/abs/1234.5678', path: ['Marcadores de Chrome', 'Subcarpeta importada'] },
];
await writeFile(foreignImport, [
  '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
  '<!-- This is an automatically generated file.',
  '     It will be read and overwritten.',
  '     DO NOT EDIT! -->',
  '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
  '<TITLE>Bookmarks</TITLE>',
  '<H1>Bookmarks</H1>',
  '<DL><p>',
  '    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000001" PERSONAL_TOOLBAR_FOLDER="true">Marcadores de Chrome</H3>',
  '    <DL><p>',
  '        <DT><A HREF="https://historia.example/articulo?ref=importado&amp;v=2" ADD_DATE="1700000002">Artículo importado</A>',
  '        <DT><H3 ADD_DATE="1700000003" LAST_MODIFIED="1700000004">Subcarpeta importada</H3>',
  '        <DL><p>',
  '            <DT><A HREF="https://arxiv.org/abs/1234.5678" ADD_DATE="1700000005">arXiv · preprint</A>',
  '            <DD>Importado desde Chrome',
  '        </DL><p>',
  '    </DL><p>',
  '</DL><p>',
  '',
].join('\n'), 'utf8');

const childEnv = {
  ...process.env,
  NODUS_USERDATA: profile,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

let app;
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [repoRoot],
    env: childEnv,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(async (version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
    await window.nodus.updateSettings({ onboardingComplete: true, tourComplete: true, advancedTourComplete: true });
  }, require(path.join(repoRoot, 'package.json')).version);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  const updateModal = page.getByTestId('startup-update-modal');
  const modalDeadline = Date.now() + 5_000;
  while (Date.now() < modalDeadline && (await updateModal.count()) === 0) await page.waitForTimeout(100);
  if (await updateModal.count()) {
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="startup-update-modal"]')?.getAttribute('data-update-status') === 'not-available');
    await updateModal.getByRole('button', { name: 'Entendido', exact: false }).click();
    await updateModal.waitFor({ state: 'detached' });
  }

  /**
   * A one-time announcement a fresh profile always shows, and which would swallow
   * every click below. Dismissed by its own button rather than by key so a new
   * announcement in a future release cannot silently break this suite.
   */
  const dismissAnnouncements = async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const overlay = page.locator('div.fixed.inset-0').first();
      if ((await overlay.count()) === 0) return;
      const close = overlay.getByRole('button', { name: /Cerrar|Entendido|Empezar a explorar|Ahora no|Saltar/ }).first();
      if ((await close.count()) > 0) await close.click({ timeout: 5_000 }).catch(() => {});
      else await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
  };
  await dismissAnnouncements();
  await page.waitForTimeout(500);

  /** Drive the Browser through the real bridge, exactly as the UI does. */
  const call = (method, ...args) =>
    page.evaluate(([name, rest]) => window.nodus[name](...rest), [method, args]);

  /** Replace the native save panel with a recorded, scriptable answer. */
  const patchSaveDialog = (answer) => app.evaluate(({ dialog }, reply) => {
    globalThis.__nodusSaveDialogCalls = [];
    dialog.showSaveDialog = async (...args) => {
      globalThis.__nodusSaveDialogCalls.push(args.at(-1));
      if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
      return reply.canceled ? { canceled: true } : { canceled: false, filePath: reply.filePath };
    };
  }, answer);
  const saveDialogCalls = () => app.evaluate(() => globalThis.__nodusSaveDialogCalls ?? []);

  /** Replace the native open panel with a recorded, scriptable answer. */
  const patchOpenDialog = (answer) => app.evaluate(({ dialog }, reply) => {
    globalThis.__nodusOpenDialogCalls = [];
    dialog.showOpenDialog = async (...args) => {
      globalThis.__nodusOpenDialogCalls.push(args.at(-1));
      if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
      return reply.canceled ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [reply.filePath] };
    };
  }, answer);
  const openDialogCalls = () => app.evaluate(() => globalThis.__nodusOpenDialogCalls ?? []);

  /** Where a node lives, as the collection itself records it. */
  const folderPathOf = (store, parentId) => {
    const names = [];
    let cursor = store.folders.find((folder) => folder.id === parentId) ?? null;
    while (cursor) { names.unshift(cursor.name); cursor = store.folders.find((folder) => folder.id === cursor.parentId) ?? null; }
    return names;
  };

  await check('the collection is seeded through the trusted bridge', async () => {
    await page.locator('[data-tour="nav-browser"]').click();
    await page.locator('[data-browser-viewport]').waitFor({ state: 'visible' });
    const folderIds = new Map();
    for (const folder of FOLDER_SEED) {
      const result = await call('createBrowserBookmarkFolder', {
        name: folder.name,
        parentId: folder.parent ? folderIds.get(folder.parent) : null,
      });
      folderIds.set(folder.key, result.folder.id);
    }
    for (const bookmark of BOOKMARK_SEED) {
      const result = await call('createBrowserBookmark', {
        title: bookmark.title,
        url: bookmark.url,
        description: bookmark.description,
        faviconDataUrl: bookmark.faviconDataUrl ?? null,
        parentId: bookmark.parent ? folderIds.get(bookmark.parent) : null,
      });
      assert.equal(result.duplicate, false, `${bookmark.title} must be stored once`);
    }
    const store = await call('getBrowserBookmarks');
    assert.equal(store.bookmarks.length, BOOKMARK_SEED.length);
    assert.equal(store.folders.length, FOLDER_SEED.length);
  });

  await check('the Bookmarks start page shows the download action in its toolbar', async () => {
    await call('navigateBrowserStartPage', 'bookmarks');
    const button = page.getByTestId('browser-bookmarks-export-html');
    await button.waitFor({ state: 'visible', timeout: 15_000 });
    const tooltip = 'Exportar todos los marcadores como HTML compatible con Chrome, Edge, Firefox, Brave y Opera';
    assert.equal(await button.getAttribute('title'), tooltip, 'the tooltip must be translated');
    assert.equal(await button.getAttribute('aria-label'), tooltip, 'the accessible name must be translated');
    assert.match((await button.innerText()).trim(), /Exportar HTML/);
    assert.equal(await button.isDisabled(), false);
    const toolbar = await page.locator('.atlas-filterbar').boundingBox();
    const box = await button.boundingBox();
    assert.ok(toolbar && box && box.y >= toolbar.y - 1 && box.y + box.height <= toolbar.y + toolbar.height + 1,
      'the download action must sit inside the toolbar row, next to the other actions');
  });

  /** Every exported file must hold the whole collection, whatever the page shows. */
  const assertWholeCollection = async (file, label) => {
    const html = await readFile(file, 'utf8');
    const lines = html.split('\n');
    assert.equal(lines[0], '<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    assert.match(lines[1], /charset=UTF-8/i);
    assert.equal(lines[2], '<TITLE>Nodus Bookmarks</TITLE>');
    assert.ok(!html.startsWith('\ufeff'), 'a BOM would be read as part of the first tag');
    assert.ok(html.endsWith('</DL><p>\n'), 'the root list must be closed and the file newline-terminated');
    assert.equal((html.match(/<DT><A HREF=/g) ?? []).length, BOOKMARK_SEED.length, label);
    assert.equal((html.match(/<DT><H3 /g) ?? []).length, FOLDER_SEED.length, label);
    assert.equal((html.match(/ADD_DATE="\d{10}"/g) ?? []).length, BOOKMARK_SEED.length + FOLDER_SEED.length,
      'every folder and bookmark carries a Unix-seconds ADD_DATE');

    const escape = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    for (const bookmark of BOOKMARK_SEED) {
      const written = html.match(new RegExp(`<A HREF="([^"]*)" ADD_DATE="\\d{10}"[^>]*>${escape(bookmark.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</A>`));
      assert.ok(written, `${bookmark.title} must be in ${label}, under its own title`);
      assert.equal(new URL(written[1].replace(/&amp;/g, '&')).href, new URL(bookmark.url).href,
        `${bookmark.title} must keep its full URL, query string and fragment included`);
    }
    for (const folder of FOLDER_SEED) {
      assert.ok(html.includes(`>${escape(folder.name)}</H3>`), `${folder.name} must be in ${label}`);
    }
    assert.ok(html.includes('ICON="data:image/png;base64,iVBORw0KGgoAAAA'), 'a cached favicon must travel with its bookmark');

    // Depth is real, and the branch that has no bookmarks is still written.
    const indent = (needle) => html.split('\n').find((line) => line.includes(needle))?.match(/^ */)?.[0].length ?? -1;
    assert.ok(indent('Archives «presse»') > indent('Recherche & Sources'), 'the nested folder must be one level deeper');
    assert.ok(indent('中国古代文献') > indent('Recherche & Sources'), 'a bookmark must stay inside its own folder');
    assert.match(html, /<DT><H3 ADD_DATE="\d+">Vide \(à trier\)<\/H3>\n *<DL><p>\n *<\/DL><p>/,
      'an empty folder is exported as an empty list, not dropped');
    assert.ok(html.includes('Ligne 1 &amp; 2 &lt;b&gt;gras&lt;/b&gt; &quot;citée&quot;'), 'descriptions must be escaped');
    return html;
  };

  await check('exporting from a filtered search still writes the whole collection', async () => {
    await page.getByLabel('Buscar en Nodus Bookmarks').fill('zzz-sin-coincidencias');
    await page.getByText('No hay marcadores que coincidan').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.bookmark-card').count(), 0, 'the page must be filtered before exporting');

    await patchSaveDialog({ filePath: searchExport });
    await page.getByTestId('browser-bookmarks-export-html').click();
    const notice = page.getByTestId('browser-notice');
    await notice.waitFor({ state: 'visible', timeout: 15_000 });
    assert.match(await notice.innerText(),
      new RegExp(`Se exportaron ${BOOKMARK_SEED.length} marcadores y ${FOLDER_SEED.length} carpetas en search-active\\.html`));

    const options = (await saveDialogCalls()).at(-1);
    assert.equal(options.defaultPath, `nodus-bookmarks-${localDay}.html`, 'the dialog must suggest the dated name');
    assert.deepEqual(options.filters, [{ name: 'Marcadores HTML', extensions: ['html'] }]);
    await assertWholeCollection(searchExport, 'the export from a filtered search');
  });

  await check('exporting from inside an open folder still writes the whole collection', async () => {
    await page.getByLabel('Buscar en Nodus Bookmarks').fill('');
    await page.getByText('Recherche & Sources').first().click();
    await page.getByText('Archives «presse»').first().waitFor({ state: 'visible' });
    assert.equal(await page.locator('.bookmark-card').count(), 3, 'the open folder shows two folders and one bookmark');

    await patchSaveDialog({ filePath: folderExport });
    await page.getByTestId('browser-bookmarks-export-html').click();
    await page.getByTestId('browser-notice').waitFor({ state: 'visible', timeout: 15_000 });
    await assertWholeCollection(folderExport, 'the export from an open folder');
  });

  await check('the exported file is one a browser engine reads back correctly', async () => {
    // Chromium is the engine behind Chrome, Edge, Brave and Opera, and this app is
    // Chromium: loading the exact bytes the app wrote proves the parser accepts the
    // file, decodes it as UTF-8 and resolves the escapes back to the original text.
    const view = await app.evaluate(async ({ BrowserWindow }, url) => {
      const win = new BrowserWindow({ show: false, width: 900, height: 700 });
      try {
        await win.loadURL(url);
        return await win.webContents.executeJavaScript(`(() => {
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
        })()`);
      } finally {
        win.destroy();
      }
    }, pathToFileURL(folderExport).href);

    assert.equal(view.charset, 'UTF-8', 'the file must declare UTF-8 and be read as such');
    assert.equal(view.title, 'Nodus Bookmarks');
    assert.equal(view.heading, 'Nodus Bookmarks');
    assert.equal(view.anchors, BOOKMARK_SEED.length);
    assert.equal(view.folders, FOLDER_SEED.length);
    assert.deepEqual(
      view.layout.map((entry) => ({ kind: entry.kind, label: entry.label, depth: entry.depth })),
      EXPECTED_LAYOUT.map(({ kind, label, depth }) => ({ kind, label, depth })),
      'the browser must see the same order and the same nesting the collection has',
    );
    for (const entry of EXPECTED_LAYOUT.filter((row) => row.url)) {
      const read = view.layout.find((row) => row.label === entry.label);
      assert.equal(new URL(read.href).href, new URL(entry.url).href, `${entry.label} must keep its full URL`);
    }
  });

  await check('cancelling the native dialog writes nothing and says so', async () => {
    await patchSaveDialog({ canceled: true });
    await page.getByTestId('browser-bookmarks-export-html').click();
    await page.getByText('Exportación cancelada.').waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal(existsSync(cancelledExport), false);
    assert.equal((await saveDialogCalls()).length, 1);
    const store = await call('getBrowserBookmarks');
    assert.equal(store.bookmarks.length, BOOKMARK_SEED.length, 'a cancelled export must not touch the collection');
    assert.equal(store.folders.length, FOLDER_SEED.length);
  });

  await check('a second click cannot open a second dialog', async () => {
    await patchSaveDialog({ filePath: repeatedExport, delayMs: 900 });
    await page.getByTestId('browser-bookmarks-export-html').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="browser-bookmarks-export-html"]')?.disabled === true);
    // A disabled button swallows the click, which is what stops a second dialog.
    await page.evaluate(() => document.querySelector('[data-testid="browser-bookmarks-export-html"]')?.click());
    await page.waitForFunction(() => document.querySelector('[data-testid="browser-bookmarks-export-html"]')?.disabled === false);
    const notice = await page.getByTestId('browser-notice').innerText();
    assert.match(notice, /repeat\.html/, 'the first export must still finish');
    assert.equal((await saveDialogCalls()).length, 1, 'exactly one dialog may have been opened');
    await assertWholeCollection(repeatedExport, 'the export after a repeated click');
  });

  await check('importing the file the export just wrote changes nothing', async () => {
    // The round trip that matters most: a file Nodus wrote, read back by Nodus.
    // Every address is already saved, so a correct merge reports duplicates and
    // leaves the collection exactly as it was.
    await patchOpenDialog({ filePath: folderExport });
    await page.getByTestId('browser-bookmarks-import-html').click();
    const dialog = page.getByRole('dialog', { name: /Vista previa de importación/ });
    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    const summary = await dialog.innerText();
    assert.match(summary, new RegExp(`${BOOKMARK_SEED.length} marcadores`), summary);
    assert.match(summary, new RegExp(`${FOLDER_SEED.length} carpetas`), summary);
    assert.match(summary, new RegExp(`${BOOKMARK_SEED.length} duplicados`), summary);
    assert.match(summary, /0 URL no válidas omitidas/, 'every address the export wrote is still valid');
    // The dialog fades in; a screenshot mid-animation shows the page through it.
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(screenshotDir, 'bookmarks-import-preview.png') });
    await dialog.getByRole('button', { name: 'Importar sin sobrescribir' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 15_000 });

    const notice = await page.getByTestId('browser-notice').innerText();
    assert.match(notice, /Se importaron 0 marcadores/);
    assert.match(notice, new RegExp(`Se omitieron ${BOOKMARK_SEED.length} duplicados`));
    const store = await call('getBrowserBookmarks');
    assert.equal(store.bookmarks.length, BOOKMARK_SEED.length, 'a re-import must not duplicate the collection');
    assert.equal(store.folders.length, FOLDER_SEED.length, 'and must not duplicate its folders');
    assert.equal((await openDialogCalls()).length, 1);
  });

  await check('a browser-written file imports with its folders, order and text intact', async () => {
    await patchOpenDialog({ filePath: foreignImport });
    await page.getByTestId('browser-bookmarks-import-html').click();
    const dialog = page.getByRole('dialog', { name: /Vista previa de importación/ });
    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    const summary = await dialog.innerText();
    assert.match(summary, /Chrome Bookmarks 2026-09-15\.html/, 'the dialog must name the chosen file');
    assert.match(summary, new RegExp(`${FOREIGN_BOOKMARKS.length} marcadores`), summary);
    assert.match(summary, /0 duplicados/);
    await dialog.getByRole('button', { name: 'Importar sin sobrescribir' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 15_000 });

    const notice = await page.getByTestId('browser-notice').innerText();
    assert.match(notice, new RegExp(`Se importaron ${FOREIGN_BOOKMARKS.length} marcadores`), notice);
    const store = await call('getBrowserBookmarks');
    assert.equal(store.bookmarks.length, BOOKMARK_SEED.length + FOREIGN_BOOKMARKS.length);
    for (const folder of FOREIGN_FOLDERS) assert.ok(store.folders.some((entry) => entry.name === folder), `${folder} must exist`);
    assert.equal(store.folders.length, FOLDER_SEED.length + FOREIGN_FOLDERS.length,
      'the imported tree must be added, never merged into an existing branch');
    for (const bookmark of FOREIGN_BOOKMARKS) {
      const stored = store.bookmarks.find((entry) => entry.title === bookmark.title);
      assert.ok(stored, `${bookmark.title} must be imported`);
      assert.equal(new URL(stored.url).href, new URL(bookmark.url).href, 'query strings and hosts must survive the trip');
      assert.deepEqual(folderPathOf(store, stored.parentId), bookmark.path, 'the imported nesting must be preserved');
    }
    assert.equal(store.bookmarks.find((entry) => entry.title === 'arXiv · preprint').description, 'Importado desde Chrome',
      'a <DD> line must arrive as the description');
    // The page shows what was imported, without a reload.
    await page.locator('.bookmark-breadcrumbs button').first().click();
    await page.getByText('Marcadores de Chrome').first().waitFor({ state: 'visible', timeout: 15_000 });
  });

  await check('cancelling the import picker changes nothing', async () => {
    const before = await call('getBrowserBookmarks');
    await patchOpenDialog({ canceled: true });
    await page.getByTestId('browser-bookmarks-import-html').click();
    await page.getByText('Importación cancelada.').waitFor({ state: 'visible', timeout: 15_000 });
    assert.deepEqual(await call('getBrowserBookmarks'), before);
    assert.equal(await page.getByRole('dialog', { name: /Vista previa de importación/ }).count(), 0,
      'a cancelled picker must not leave a preview behind');
  });

  await check('the toolbar, the confirmation and the action are captured', async () => {
    await page.locator('.bookmark-breadcrumbs button').first().click();
    await page.getByTestId('browser-bookmarks-export-html').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshotDir, 'bookmarks-export-toolbar.png') });
    const toolbar = await page.locator('.atlas-filterbar').boundingBox();
    await page.screenshot({
      path: path.join(screenshotDir, 'bookmarks-export-button.png'),
      clip: { x: Math.max(0, toolbar.x - 10), y: Math.max(0, toolbar.y - 10), width: toolbar.width + 20, height: toolbar.height + 20 },
    });
    await copyFile(folderExport, path.join(screenshotDir, 'bookmarks-export-sample.html'));
  });

  console.log(`\n[e2e-bookmarks] ${checks - failures.length}/${checks} checks passed`);
  if (failures.length) console.error(`[e2e-bookmarks] failed: ${failures.join(', ')}`);
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await app?.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
  await rm(exportDir, { recursive: true, force: true });
}
