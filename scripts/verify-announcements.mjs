// Live verification of the announcements channel, against a real HTTP server and the
// real app.
//
// The unit tests cover the parser, which is where hostile input is handled. What they
// cannot show is the part the whole design rests on: that the second check sends
// If-None-Match and is answered with a 304 carrying no body, that a notice reaches the
// renderer in the reader's language, that reading one is per notice and survives a
// restart, and — the promise made in Settings and in PRIVACY.md — that switching the
// setting off means NO request is made at all. Every one of those is a claim about two
// processes and a socket, so it is checked here with a server that counts what it is
// asked for.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-announcements-'));

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  throw new Error('Run `npm run build` before this focused verification.');
}

const LANGUAGES = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
const copy = (prefix) => Object.fromEntries(LANGUAGES.map((language) => [
  language,
  { title: `${prefix} ${language}`, body: `Body for ${language}, long enough to read.`, linkLabel: `Open ${language}` },
]));

const PAYLOAD = {
  version: 1,
  notices: [
    { id: 'live-notice', date: '2026-08-06', severity: 'warning', url: 'https://example.com/survey', copy: copy('Live') },
    { id: 'expired-notice', date: '2020-01-01', expiresAt: '2020-02-01', copy: copy('Expired') },
    { id: 'future-build-notice', date: '2026-08-06', minVersion: '99.0.0', copy: copy('Future') },
    { id: 'hostile-notice', date: '2026-08-06', url: 'javascript:alert(1)', copy: copy('Hostile') },
  ],
};

const ETAG = '"announcements-v1"';
let requests = [];
const server = createServer((req, res) => {
  requests.push({ url: req.url, ifNoneMatch: req.headers['if-none-match'] ?? null });
  res.setHeader('ETag', ETAG);
  if (req.headers['if-none-match'] === ETAG) {
    res.writeHead(304);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(PAYLOAD));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const announcementsUrl = `http://127.0.0.1:${server.address().port}/announcements.json`;

const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_ANNOUNCEMENTS_URL: announcementsUrl,
};
delete childEnv.ELECTRON_RUN_AS_NODE;

async function closeElectronApp(instance) {
  if (!instance) return;
  const child = instance.process();
  let timeout;
  const closed = instance.close().then(() => true, () => false);
  const ok = await Promise.race([closed, new Promise((r) => { timeout = setTimeout(() => r(false), 5_000); })]);
  clearTimeout(timeout);
  if (!ok && child.exitCode === null && !child.killed) child.kill('SIGKILL');
}

async function launch() {
  const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(60_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  }, appVersion);
  await page.evaluate(async () => {
    await window.nodus.updateSettings({
      onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1,
      tourComplete: true, advancedTourComplete: true, mascotEnabled: false, uiLanguage: 'es',
    });
  });
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  return { app, page };
}

/** The main process schedules its first check 45s out; ask for one now instead. */
async function refresh(page) {
  const before = requests.length;
  await page.evaluate(() => window.nodus.listAnnouncements());
  // The renderer cannot trigger a fetch, so drive it the way the timer does: the
  // main process exposes refreshAnnouncements only internally, which is exactly why
  // this runs through the IPC the app itself uses after a settings change.
  await page.evaluate(() => window.nodus.updateSettings({ announcementsEnabled: true }));
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && requests.length === before) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return requests.length > before;
}

let app;
try {
  ({ app } = await launch());
  let page = await app.firstWindow();

  // ── 1. The first check downloads and stores the list ───────────────────────
  const gotFirst = await refresh(page);
  assert.ok(gotFirst, 'the app must ask for the announcements file');
  assert.equal(requests[0].ifNoneMatch, null, 'the first request carries no validator');
  console.log(`[announcements] first request: ${requests[0].url} (no If-None-Match)`);

  const list = await page.evaluate(() => window.nodus.listAnnouncements());
  const ids = list.map((entry) => entry.id);
  assert.deepEqual(ids, ['live-notice', 'hostile-notice'], `only the applicable notices survive, got ${ids.join(', ')}`);
  console.log(`[announcements] ${ids.length} notices reached the renderer: ${ids.join(', ')}`);

  const live = list.find((entry) => entry.id === 'live-notice');
  assert.equal(live.read, false, 'a new notice starts unread');
  assert.equal(live.severity, 'warning');
  assert.equal(live.url, 'https://example.com/survey');
  assert.equal(live.copy.es.title, 'Live es', 'the notice carries its Spanish copy');
  assert.equal(live.copy.tr.title, 'Live tr', 'and every other language');

  const hostile = list.find((entry) => entry.id === 'hostile-notice');
  assert.equal(hostile.url, undefined, 'a javascript: link must never reach the renderer');
  console.log('[announcements] expired, version-targeted and javascript: entries filtered as designed');

  // ── 2. The second check is conditional and answered with 304 ───────────────
  await refresh(page);
  const second = requests[requests.length - 1];
  assert.equal(second.ifNoneMatch, ETAG, 'the second request must replay the ETag');
  console.log(`[announcements] second request sent If-None-Match: ${second.ifNoneMatch} → 304, no body`);

  // ── 3. Reading is per notice, and it persists across a restart ─────────────
  const afterRead = await page.evaluate(() => window.nodus.markAnnouncementRead('live-notice'));
  assert.equal(afterRead.find((entry) => entry.id === 'live-notice').read, true);
  assert.equal(afterRead.find((entry) => entry.id === 'hostile-notice').read, false, 'reading one must not mark the rest');

  await closeElectronApp(app);
  ({ app } = await launch());
  page = await app.firstWindow();
  const afterRestart = await page.evaluate(() => window.nodus.listAnnouncements());
  assert.equal(afterRestart.find((entry) => entry.id === 'live-notice').read, true, 'the read mark must survive a restart');
  assert.equal(afterRestart.find((entry) => entry.id === 'hostile-notice').read, false);
  console.log('[announcements] per-notice read state survived a restart');

  // ── 4. Turned off means no request at all ─────────────────────────────────
  await page.evaluate(() => window.nodus.updateSettings({ announcementsEnabled: false }));
  requests = [];
  await page.evaluate(() => window.nodus.updateSettings({ announcementsEnabled: false }));
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  assert.deepEqual(requests, [], `the setting is off, so nothing may be requested (got ${requests.length})`);
  // And the notices already downloaded stay readable — turning it off stops the asking,
  // it does not erase what arrived.
  const offline = await page.evaluate(() => window.nodus.listAnnouncements());
  assert.equal(offline.length, 2, 'notices already downloaded stay available with the setting off');
  console.log('[announcements] with the setting off: 0 requests, list still readable');

  console.log('announcements live verification passed');
} finally {
  await closeElectronApp(app);
  await new Promise((resolve) => server.close(resolve));
  await rm(userData, { recursive: true, force: true });
}
