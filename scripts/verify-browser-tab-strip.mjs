// Live verification of the Browser tab strip, against the REAL Electron app.
//
// The unit tests in test-browser-tabs.mjs hold the decisions — one fixed width,
// arrows only where there is something left to show. This holds the half that
// only real layout can answer: whether twelve tabs of one width actually
// overflow, whether the arrows appear at the right moments, and whether clicking
// one moves the tabs. Chromium does the measuring; nothing here is simulated.
//
// Run it after `npm run build`:
//
//   npm run verify:browser-tab-strip
//
// Screenshots land in .tmp-shots/browser-tab-strip/ (gitignored) unless
// NODUS_TAB_STRIP_SHOTS points somewhere else.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import sharp from 'sharp';
import http from 'node:http';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-tabstrip-'));
await mkdir(userData, { recursive: true });
// Skip "we detected a previous installation".
await writeFile(path.join(userData, 'app-prefs.json'), JSON.stringify({ recoverySetupVersion: 1 }));

// Titles of the length a research browser actually shows, so a screenshot is
// judged on the real thing: long enough to truncate, distinct enough to tell one
// tab from another at a glance.
const PAGES = [
  ['Attention Is All You Need', 'arXiv'],
  ['Zotero | Your personal research assistant', 'Zotero'],
  ['Neural machine translation - Wikipedia', 'Wikipedia'],
  ['Genomic epidemiology of tuberculosis', 'PubMed'],
  ['Deep residual learning for image recognition', 'arXiv'],
  ['Citing sources: APA 7th edition', 'Purdue OWL'],
  ['The Structure of Scientific Revolutions', 'Press'],
  ['BERT: Pre-training of deep bidirectional transformers', 'arXiv'],
  ['Reproducible research: a practical guide', 'Nature'],
  ['A survey of graph layout algorithms', 'ACM'],
  ['Open citations and the research graph', 'Crossref'],
  ['What makes a good literature review?', 'Nodus'],
];

const server = http.createServer((req, res) => {
  const index = Number(new URL(req.url || '/', 'http://127.0.0.1').pathname.slice(1)) || 1;
  const [title, site] = PAGES[(index - 1) % PAGES.length];
  // A distinct tint per page: which tab is active has to be visible in a
  // screenshot, not only in the strip.
  const tint = `hsl(${(index * 47) % 360} 45% 94%)`;
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px system-ui;padding:3rem;background:${tint};color:#18181b">
<p style="font:600 12px system-ui;letter-spacing:.08em;text-transform:uppercase;color:#52525b">${site}</p>
<h1 style="max-width:34ch">${title}</h1>
<p style="max-width:60ch;color:#3f3f46">Página ${index} de ${PAGES.length}, servida en local para la verificación de la tira de pestañas.</p>
</body>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const shots = process.env.NODUS_TAB_STRIP_SHOTS || path.join(repoRoot, '.tmp-shots/browser-tab-strip');
await mkdir(shots, { recursive: true });
console.log('screenshots in', shots);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** What the strip actually looks like right now, measured from the DOM. */
const readStrip = (page) => page.evaluate(() => {
  const bar = document.querySelector('[data-testid="browser-tab-bar"]');
  const viewport = document.querySelector('[data-testid="browser-tab-strip"]');
  const tabs = Array.from(document.querySelectorAll('[data-testid="browser-tab"]'));
  const selected = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
  return {
    count: tabs.length,
    widths: tabs.map((tab) => Math.round(tab.getBoundingClientRect().width)),
    titles: tabs.map((tab) => tab.textContent ?? ''),
    selected,
    scrollLeft: Math.round(viewport.scrollLeft),
    maxScroll: Math.round(viewport.scrollWidth - viewport.clientWidth),
    // A hidden scrollbar takes no height; a shown one costs about 15px.
    scrollbarHeight: viewport.offsetHeight - viewport.clientHeight,
    leftArrow: Boolean(document.querySelector('[data-testid="browser-tab-scroll-left"]')),
    rightArrow: Boolean(document.querySelector('[data-testid="browser-tab-scroll-right"]')),
    newTab: Boolean(document.querySelector('[data-testid="browser-new-tab"]')),
    barWidth: Math.round(bar.getBoundingClientRect().width),
  };
});

/** Full window, plus the strip itself cropped, so both the context and the
 *  detail can be read without zooming into a 24px row. */
async function capture(page, name) {
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
  await page.getByTestId('browser-tab-bar').screenshot({ path: path.join(shots, `${name}-tira.png`) })
    .catch(() => {});
  await recomposeWindow(page, name);
  captureWindow(name);
}

/**
 * The window as the user sees it, put back together from the two layers it is
 * actually made of.
 *
 * A page in a Browser tab is a native WebContentsView painted OVER the renderer,
 * so page.screenshot() cannot see it: the frame comes out with an empty content
 * area. Chromium will hand over the page's own pixels (`capturePage`), and the
 * rectangle the renderer published to main says where it is drawn, so the two go
 * back together into one image. Writing to <name>-app.png, alongside the raw
 * renderer capture, keeps both readable.
 */
async function recomposeWindow(page, name) {
  const { url } = await page.evaluate(async () => {
    const state = await window.nodus.getBrowserState();
    return { url: state.tabs.find((tab) => tab.id === state.activeTabId)?.url ?? '' };
  });
  if (!url) return;
  const pagePng = await app.evaluate(async ({ webContents }, target) => {
    const contents = webContents.getAllWebContents().find((entry) => entry.getURL() === target);
    if (!contents) return null;
    try {
      const image = await contents.capturePage();
      return image.isEmpty() ? null : image.toPNG().toString('base64');
    } catch {
      return null;
    }
  }, url).catch(() => null);
  const box = await page.evaluate(() => {
    const element = document.querySelector('[data-browser-viewport]');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  if (!pagePng || !box) return;

  const frame = path.join(shots, `${name}.png`);
  const { width: frameWidth } = await sharp(frame).metadata();
  const cssWidth = await page.evaluate(() => window.innerWidth);
  const scale = frameWidth / cssWidth;
  const width = Math.round(box.width * scale);
  const height = Math.round(box.height * scale);
  const layer = await sharp(Buffer.from(pagePng, 'base64')).resize(width, height, { fit: 'fill' }).toBuffer();
  await sharp(frame)
    .composite([{ input: layer, left: Math.round(box.x * scale), top: Math.round(box.y * scale) }])
    .toFile(path.join(shots, `${name}-app.png`));
}

/**
 * On macOS, when asked, the whole window is also grabbed from the window server.
 * It is the only capture that needs no reconstruction — and the only one that
 * needs the Screen Recording grant.
 *
 *   NODUS_TAB_STRIP_WINDOW_SHOTS=1 npm run verify:browser-tab-strip
 */
const windowShots = process.env.NODUS_TAB_STRIP_WINDOW_SHOTS === '1' && process.platform === 'darwin';
let nativeWindowId = null;
let windowShotWarningShown = false;
function captureWindow(name) {
  if (!nativeWindowId) return;
  // Best effort by design: without the grant this writes nothing, and the
  // recomposed capture above is already the same picture. The reason is printed
  // once, because a silently missing file reads as a bug in the strip rather
  // than as a macOS permission.
  try {
    execFileSync('/usr/sbin/screencapture', ['-x', '-o', '-l', String(nativeWindowId), path.join(shots, `${name}-app.png`)],
      { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (cause) {
    if (!windowShotWarningShown) {
      windowShotWarningShown = true;
      console.log(`no window-server screenshots: ${String(cause.stderr || cause.message).trim().split('\n')[0]}`);
    }
  }
}

let app;
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [repoRoot],
    env: { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', ELECTRON_RUN_AS_NODE: undefined },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  if (windowShots) {
    const source = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMediaSourceId());
    nativeWindowId = Number(String(source).split(':')[1]) || null;
    console.log('native window id', nativeWindowId, '(window-level capture)');
  }
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
  }, appVersion);
  await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Tira de pestañas', type: 'research' });
    await window.nodus.switchVault(created.vault.id);
    // Skip first-run onboarding: this harness is about the strip, not the tour.
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 99,
      tourComplete: true,
      recoverySetupVersion: 1,
    });
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  const modal = page.getByTestId('startup-update-modal');
  if (await modal.count()) {
    await modal.getByRole('button', { name: 'Entendido', exact: false }).click().catch(() => {});
    await modal.waitFor({ state: 'detached' }).catch(() => {});
  }
  const nodiStyle = page.getByRole('button', { name: /Nodi cl.sico/i });
  if (await nodiStyle.count()) { await nodiStyle.first().click().catch(() => {}); await page.waitForTimeout(600); }

  // Open a first page, then walk into the Browser section.
  await page.evaluate((url) => window.nodus.openBrowserTab(url), `${origin}/1`);
  await page.getByRole('button', { name: /Navegador|Browser/i }).first().click().catch(async () => {
    await page.evaluate(() => { window.location.hash = '#browser'; });
  });
  await page.getByTestId('browser-tab-strip').waitFor();
  await page.waitForTimeout(2500);

  // ------------------------------------------------------------ Two tabs
  // The size every tab now has, in the state a reader spends most of the day in.
  await page.evaluate((url) => window.nodus.openBrowserTab(url), `${origin}/2`);
  await page.waitForTimeout(2000);
  const two = await readStrip(page);
  await capture(page, '01-dos-pestanas');

  check('tabs keep their titles in the strip', two.titles[1]?.includes(PAGES[1][0]) === true,
    two.titles.map((title) => title.slice(0, 22)).join(' | '));
  check('with two tabs, every tab is exactly the same width',
    two.count === 2 && two.widths[0] === two.widths[1], `widths ${two.widths.join(', ')}`);
  check('with two tabs, no arrows: nothing is out of view',
    !two.leftArrow && !two.rightArrow, `left=${two.leftArrow} right=${two.rightArrow}`);
  check('the native scrollbar is hidden, so the arrows are the only affordance',
    two.scrollbarHeight === 0, `scrollbar height ${two.scrollbarHeight}px`);

  // ------------------------------------------------------------- Twelve
  for (let index = 3; index <= PAGES.length; index += 1) {
    await page.evaluate((url) => window.nodus.openBrowserTab(url), `${origin}/${index}`);
    await page.waitForTimeout(900);
  }
  await page.waitForTimeout(2000);
  const full = await readStrip(page);
  check(`the strip holds the full cap of ${PAGES.length} tabs`, full.count === PAGES.length,
    `${full.count} tabs`);

  // Every tab the same width, at the cap as much as at two.
  check('at the cap, every tab still measures the same width',
    new Set(full.widths).size === 1, `distinct widths: ${[...new Set(full.widths)].join(', ')}`);
  check('at the cap, the new-tab button is still reachable at the end of the row', full.newTab);

  // The cap forces overflow, which is the whole point of the arrows.
  check('twelve tabs of one width overflow the strip', full.maxScroll > 0,
    `${full.maxScroll}px hidden`);

  // Walk back to the start with the real control, and count the clicks.
  let leftClicks = 0;
  while (leftClicks < 40) {
    const arrow = page.getByTestId('browser-tab-scroll-left');
    if (!(await arrow.count())) break;
    await arrow.click();
    leftClicks += 1;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(700);
  const atStart = await readStrip(page);
  await capture(page, '02-lleno-inicio');
  check('scrolled to the start, only the right arrow is offered',
    !atStart.leftArrow && atStart.rightArrow,
    `left=${atStart.leftArrow} right=${atStart.rightArrow} scrollLeft=${atStart.scrollLeft}`);
  check('the left arrow walked the strip back to its start', atStart.scrollLeft <= 1,
    `${leftClicks} clicks, scrollLeft=${atStart.scrollLeft}`);
  check('the first tab is on screen again at the start',
    atStart.selected >= 0 && atStart.selected < atStart.count,
    `selected index ${atStart.selected}`);
  check('a tab is never narrower at the cap than with two tabs',
    Math.min(...atStart.widths) >= Math.min(...two.widths),
    `${Math.min(...atStart.widths)}px vs ${Math.min(...two.widths)}px`);

  // -------------------------------------------------------- In the middle
  // One click of the right arrow: the state with somewhere to go in both
  // directions, which is where both arrows have to be visible at once.
  await page.getByTestId('browser-tab-scroll-right').click();
  await page.waitForTimeout(900);
  const middle = await readStrip(page);
  await capture(page, '03-desplazado');
  check('one click of the right arrow moves the strip', middle.scrollLeft > atStart.scrollLeft + 100,
    `scrollLeft ${atStart.scrollLeft} -> ${middle.scrollLeft}`);
  // A viewport-sized step would land on the last tab in one click and leave the
  // arrow lit a few pixels short of the end — a click that looks like it did
  // nothing.
  check('one click reveals a few tabs rather than jumping to the end',
    middle.scrollLeft < middle.maxScroll - 100,
    `scrollLeft=${middle.scrollLeft} max=${middle.maxScroll}`);
  check('in the middle, both arrows are offered at once',
    middle.leftArrow && middle.rightArrow,
    `left=${middle.leftArrow} right=${middle.rightArrow}`);
  check('the new-tab button has not moved with the tabs',
    middle.newTab && middle.barWidth === atStart.barWidth,
    `bar ${atStart.barWidth} -> ${middle.barWidth}px`);

  // ----------------------------------------------------------- At the end
  let rightClicks = 0;
  while (rightClicks < 40) {
    const arrow = page.getByTestId('browser-tab-scroll-right');
    if (!(await arrow.count())) break;
    await arrow.click();
    rightClicks += 1;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(700);
  const atEnd = await readStrip(page);
  await capture(page, '04-final');
  check('clicking right reaches the last tab, and stops there',
    atEnd.scrollLeft >= atEnd.maxScroll - 1, `scrollLeft=${atEnd.scrollLeft} max=${atEnd.maxScroll}`);
  check('at the end, the right arrow is gone and the left arrow remains',
    atEnd.leftArrow && !atEnd.rightArrow,
    `left=${atEnd.leftArrow} right=${atEnd.rightArrow}`);
  check('the last tab is fully visible at the end', atEnd.selected === atEnd.count - 1,
    `selected ${atEnd.selected + 1} of ${atEnd.count}`);

  // -------------------------------------------------------------- One tab
  // Closing every tab but one has to return the strip to its quiet state: no
  // arrows over a strip that fits is the same claim as the arrows over one that
  // does not.
  await page.evaluate(async () => {
    const state = await window.nodus.getBrowserState();
    for (const tab of state.tabs.slice(0, -1)) await window.nodus.closeBrowserTab(tab.id);
  });
  await page.waitForTimeout(1500);
  const one = await readStrip(page);
  await capture(page, '05-una-pestana');
  check('back to one tab, the arrows are gone again',
    one.count === 1 && !one.leftArrow && !one.rightArrow, `${one.count} tab`);
  check('the single remaining tab has the same width as the others',
    one.widths[0] === two.widths[0], `${one.widths[0]}px vs ${two.widths[0]}px`);
} finally {
  await app?.close().catch(() => {});
  server.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const result of failed) console.log(`FAILED  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
  process.exitCode = 1;
}
