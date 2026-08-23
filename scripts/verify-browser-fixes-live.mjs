// Live verification of the Browser fixes, against the REAL Electron app.
//
// The unit tests hold the decisions; this holds the wiring, which is the half
// that cannot be faked: a real WebContentsView, a real <audio> element decoding
// a real WAV, real IPC, and real native menus (captured rather than popped, so
// the run needs no one at the keyboard).
//
// The page it serves is shaped like elevenreader.io — eight <audio> tags of
// which one has a source — because that shape is what broke every one of these
// controls. Run it after `npm run build`:
//
//   npm run verify:browser-fixes
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import http from 'node:http';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-browserfix-'));
await mkdir(userData, { recursive: true });
// Skip "we detected a previous installation".
await writeFile(path.join(userData, 'app-prefs.json'), JSON.stringify({ recoverySetupVersion: 1 }));

// A local page shaped like elevenreader.io: eight <audio> tags, one sourced.
const PAGE = `<!doctype html><meta charset="utf-8"><title>Eight players</title>
<body style="font:16px system-ui;padding:2rem;background:#fff">
<h1>Media harness</h1>
<input id="field" value="hello" style="font-size:20px;padding:8px">
${Array.from({ length: 6 }, () => '<audio preload="none"></audio>').join('\n')}
<audio id="real" controls src="/tone.wav"></audio>
<audio preload="none"></audio>
<a id="next" href="/second">second page</a>
<script>
  // What the real site does: spare players get paused constantly.
  const real = document.getElementById('real');
  document.querySelectorAll('audio:not(#real)').forEach((a) => { try { a.pause(); } catch {} });
  window.__nodusState = () => ({ realPaused: real.paused, realTime: real.currentTime });
  window.__nodusPlay = () => real.play();
</script>`;

// A 3-second 8-bit mono WAV so playback is real, not simulated.
function tone() {
  const rate = 8000, seconds = 120, n = rate * seconds;
  const data = Buffer.alloc(n);
  for (let i = 0; i < n; i += 1) data[i] = 128 + Math.round(60 * Math.sin((2 * Math.PI * 220 * i) / rate));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + n, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate, 28);
  header.writeUInt16LE(1, 32); header.writeUInt16LE(8, 34);
  header.write('data', 36); header.writeUInt32LE(n, 40);
  return Buffer.concat([header, data]);
}
const WAV = tone();

const server = http.createServer((req, res) => {
  if (req.url === '/tone.wav') { res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': WAV.length }); return res.end(WAV); }
  if (req.url === '/second') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>Second page</title><h1>second</h1>'); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
console.log('harness at', origin);

const shots = process.env.NODUS_BROWSER_FIX_SHOTS || await mkdtemp(path.join(os.tmpdir(), 'nodus-browserfix-shots-'));
console.log('screenshots in', shots);

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

let app;
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [repoRoot],
    env: { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', ELECTRON_RUN_AS_NODE: undefined },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
  }, appVersion);
  await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Browser Fix', type: 'research' });
    await window.nodus.switchVault(created.vault.id);
    // Skip first-run onboarding: this harness is about the Browser, not the tour.
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 99,
      tourComplete: true,
      recoverySetupVersion: 1,
    });
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  // Dismiss the startup modal if it shows.
  const modal = page.getByTestId('startup-update-modal');
  if (await modal.count()) {
    await modal.getByRole('button', { name: 'Entendido', exact: false }).click().catch(() => {});
    await modal.waitFor({ state: 'detached' }).catch(() => {});
  }

  // Dismiss the one-off "choose your Nodi" announcement if this build shows it.
  const nodiStyle = page.getByRole('button', { name: /Nodi cl.sico/i });
  if (await nodiStyle.count()) { await nodiStyle.first().click().catch(() => {}); await page.waitForTimeout(600); }
  await page.screenshot({ path: path.join(shots, '00-home.png') });
  console.log('booted');

  // ---------------------------------------------------------------- Browser
  await page.evaluate((url) => window.nodus.openBrowserTab(url), origin);
  // Get to the Browser section.
  await page.getByRole('button', { name: /Navegador|Browser/i }).first().click().catch(async () => {
    await page.evaluate(() => { window.location.hash = '#browser'; });
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(shots, '01-browser.png') });

  const tabsNow = await page.evaluate(() => window.nodus.getBrowserState());
  console.log('tabs:', JSON.stringify(tabsNow.tabs.map((t) => ({ id: t.id, url: t.url })), null, 0));

  // ---- 1. Media: play the real track and confirm the header agrees ---------
  const playing = await app.evaluate(async ({ webContents }) => {
    const target = webContents.getAllWebContents().find((c) => c.getURL().startsWith('http://127.0.0.1'));
    if (!target) return { error: 'no page webContents' };
    await target.executeJavaScript('document.getElementById("real").play().then(()=>true).catch(e=>String(e))', true);
    await new Promise((r) => setTimeout(r, 1200));
    return target.executeJavaScript('window.__nodusState()');
  });
  console.log('page state after play:', JSON.stringify(playing));

  await page.waitForTimeout(1200);
  let media = await page.evaluate(() => window.nodus.getBrowserMedia());
  check('media session exists while a page with 8 <audio> tags plays one', media.length === 1, JSON.stringify(media[0] && { playing: media[0].playing, kind: media[0].kind }));
  check('THE BUG: the header reports PLAYING, not paused', media[0]?.playing === true, `playing=${media[0]?.playing}`);

  // ---- 2. Pause through the header actually pauses -------------------------
  await page.evaluate((id) => window.nodus.browserMediaCommand(id, 'pause'), media[0].tabId);
  await page.waitForTimeout(800);
  const afterPause = await app.evaluate(async ({ webContents }) => {
    const target = webContents.getAllWebContents().find((c) => c.getURL().startsWith('http://127.0.0.1'));
    return target.executeJavaScript('window.__nodusState()');
  });
  media = await page.evaluate(() => window.nodus.getBrowserMedia());
  check('header Pause really pauses the page', afterPause.realPaused === true, JSON.stringify(afterPause));
  check('header shows paused after Pause', media[0]?.playing === false);

  // ---- 3. Play through the header actually resumes -------------------------
  await page.evaluate((id) => window.nodus.browserMediaCommand(id, 'play'), media[0].tabId);
  await page.waitForTimeout(900);
  const afterPlay = await app.evaluate(async ({ webContents }) => {
    const target = webContents.getAllWebContents().find((c) => c.getURL().startsWith('http://127.0.0.1'));
    return target.executeJavaScript('window.__nodusState()');
  });
  media = await page.evaluate(() => window.nodus.getBrowserMedia());
  check('header Play really resumes the page', afterPlay.realPaused === false, JSON.stringify(afterPlay));
  check('header shows playing after Play', media[0]?.playing === true);
  check('Play resumed where it stopped, it did not restart', afterPlay.realTime >= afterPause.realTime - 0.05, `${afterPause.realTime} -> ${afterPlay.realTime}`);

  // ---- 4. The popover must not blank the page -----------------------------
  const headerPresent = await page.evaluate(() => Boolean(document.querySelector('[data-testid="browser-media-header-action"]')));
  check('the header shows a media button while a browser tab holds a session', headerPresent);
  await page.screenshot({ path: path.join(shots, '01b-header.png') });
  await page.getByTestId('browser-media-header-action').click();
  await page.getByTestId('browser-media-popover').waitFor();
  await page.waitForTimeout(700);
  const snapshotShown = await page.evaluate(() => {
    const img = document.querySelector('[data-testid="browser-media-page-snapshot"]');
    if (!img) return { present: false };
    const rect = img.getBoundingClientRect();
    return { present: true, complete: img.complete, width: rect.width, height: rect.height, bytes: img.getAttribute('src')?.length ?? 0 };
  });
  check('the page is frozen into React instead of vanishing', snapshotShown.present && snapshotShown.width > 200 && snapshotShown.bytes > 5000, JSON.stringify(snapshotShown));
  await page.screenshot({ path: path.join(shots, '02-media-popover.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shots, '03-after-close.png') });

  // ---- 5. Cmd/Ctrl+T while the PAGE has focus ------------------------------
  const before = (await page.evaluate(() => window.nodus.getBrowserState())).tabs.length;
  await app.evaluate(async ({ webContents }) => {
    const target = webContents.getAllWebContents().find((c) => c.getURL().startsWith('http://127.0.0.1'));
    target.focus();
    target.sendInputEvent({ type: 'keyDown', keyCode: 't', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    target.sendInputEvent({ type: 'keyUp', keyCode: 't', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    await new Promise((r) => setTimeout(r, 800));
  });
  await page.waitForTimeout(900);
  const after = (await page.evaluate(() => window.nodus.getBrowserState())).tabs.length;
  check('Cmd/Ctrl+T opens a tab while the page has focus', after === before + 1, `${before} -> ${after}`);
  await page.screenshot({ path: path.join(shots, '04-new-tab.png') });

  // ---- 6. Cmd-click on Back opens the previous page in a new tab -----------
  // Give the harness tab some history first.
  const state = await page.evaluate(() => window.nodus.getBrowserState());
  const harness = state.tabs.find((t) => t.url.startsWith(origin));
  await page.evaluate((id) => window.nodus.activateBrowserTab(id), harness.id);
  await page.waitForTimeout(600);
  await page.evaluate((url) => window.nodus.submitBrowserOmnibox(`${url}/second`), origin);
  await page.waitForTimeout(1500);
  const beforeBack = (await page.evaluate(() => window.nodus.getBrowserState())).tabs;
  const newTabId = await page.evaluate(() => window.nodus.openBrowserHistoryNeighbourTab('back'));
  await page.waitForTimeout(1500);
  const afterBack = (await page.evaluate(() => window.nodus.getBrowserState())).tabs;
  const created = afterBack.find((t) => t.id === newTabId);
  const stillOnSecond = afterBack.find((t) => t.id === harness.id)?.url ?? '';
  check('Cmd-click on Back opens the PREVIOUS page in a new tab', Boolean(created) && afterBack.length === beforeBack.length + 1, `${beforeBack.length} -> ${afterBack.length}, new url=${created?.url}`);
  check('and the original tab stays where it was', stillOnSecond.endsWith('/second'), stillOnSecond);
  await page.screenshot({ path: path.join(shots, '05-back-new-tab.png') });

  // ---- 7. Context menus: capture what a real right-click would show --------
  const menus = await app.evaluate(async ({ Menu, webContents, BrowserWindow }) => {
    const captured = [];
    const originalPopup = Menu.prototype.popup;
    Menu.prototype.popup = function capture() { captured.push(this.items.map((i) => ({ label: i.label, enabled: i.enabled, type: i.type }))); };
    try {
      const pageContents = webContents.getAllWebContents().find((c) => c.getURL().startsWith('http://127.0.0.1'));
      const appContents = BrowserWindow.getAllWindows()[0].webContents;
      const editable = {
        selectionText: 'hello', isEditable: true, linkURL: '', menuSourceType: 'mouse',
        editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true, canUndo: false, canRedo: false },
      };
      // A right-click in a text field of a web page.
      pageContents.emit('context-menu', { preventDefault() {} }, editable);
      // A right-click in the address bar (Nodus's own window).
      appContents.emit('context-menu', { preventDefault() {} }, editable);
      // A right-click on nothing in the app window: must not pop an empty menu.
      appContents.emit('context-menu', { preventDefault() {} }, {
        selectionText: '', isEditable: false, linkURL: '', menuSourceType: 'mouse',
        editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: false, canUndo: false, canRedo: false },
      });
    } finally {
      Menu.prototype.popup = originalPopup;
    }
    return captured;
  });
  console.log('captured menus:', JSON.stringify(menus, null, 1));
  const pageMenu = menus[0] ?? [];
  const barMenu = menus[1] ?? [];
  check('a web form field offers Cortar, Copiar, Pegar in that order',
    pageMenu.slice(0, 3).map((i) => i.label).join(',') === 'Cortar,Copiar,Pegar',
    pageMenu.slice(0, 4).map((i) => i.label).join(' | '));
  check('the address bar now has a right-click menu at all', barMenu.length === 3, JSON.stringify(barMenu.map((i) => i.label)));
  check('the address bar menu is Cortar, Copiar, Pegar and nothing else',
    barMenu.map((i) => i.label).join(',') === 'Cortar,Copiar,Pegar');
  check('right-clicking empty app chrome pops no menu', menus.length === 2, `${menus.length} menus popped`);

  await page.screenshot({ path: path.join(shots, '06-final.png') });
} catch (error) {
  console.error('HARNESS ERROR:', error);
  results.push({ name: 'harness completed', ok: false, detail: String(error).slice(0, 400) });
} finally {
  if (app) { try { await app.close(); } catch {} }
  server.close();
  await rm(userData, { recursive: true, force: true });
}

console.log('\n===== SUMMARY =====');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
