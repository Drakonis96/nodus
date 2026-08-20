import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const version = require(path.join(root, 'package.json')).version;
const testRoot = await mkdtemp(path.join(os.tmpdir(), 'nodus-radar-e2e-'));
const profile = path.join(testRoot, 'profile');
const fixtureFile = path.join(testRoot, 'radar-fixtures.json');
const output = process.env.NODUS_RADAR_CAPTURE_DIR || path.join(root, 'design', 'radar-implemented');
const keepOpen = process.env.NODUS_E2E_KEEP_OPEN === '1';
await mkdir(output, { recursive: true });

const sourceFor = { topic: 'OpenAlex', search: 'Semantic Scholar', author: 'ORCID', journal: 'Crossref', paper: 'OpenAlex', rss: 'RSS', website: 'Web monitor' };
const values = {
  topic: 'AI & scholarly communication', search: 'knowledge graphs AND humanities', author: '0000-0002-1825-0097',
  journal: 'Journal of Informetrics', paper: '10.1145/3589334.3645492', rss: 'https://example.org/feed.xml', website: 'https://example.org/research',
};
const labels = { topic: 'AI & scholarly communication', search: 'Knowledge graphs in the humanities', author: 'Dr. Elena García', journal: 'Journal of Informetrics', paper: 'LLMs for Evidence Retrieval', rss: 'Digital Humanities Now', website: 'Research lab announcements' };
const titles = {
  topic: 'How researchers use generative AI during literature discovery',
  search: 'Three new results match your saved search', author: 'New work added: Community archives as research infrastructure',
  journal: 'New issue: Measuring open research infrastructure', paper: 'Your followed paper received new citations',
  rss: 'Digital humanities funding and calls roundup', website: 'Research lab announcements changed',
};

let generations = Object.fromEntries(Object.keys(values).map((type) => [type, 1]));
async function writeFixtures() {
  const candidates = Object.fromEntries(Object.keys(values).map((type) => [type, [{
    source: sourceFor[type], externalId: `${type}-fixture-${generations[type]}`, title: titles[type],
    authors: type === 'author' ? 'Elena García · Digital Scholarship in the Humanities' : 'M. Chen, A. Rahman, L. Kovács · Journal of Informetrics',
    summary: `A deterministic ${type} result used to verify the complete Radar workflow without depending on a public service.`,
    url: `https://example.org/radar/${type}/${generations[type]}`,
    ...(type === 'paper' ? { doi: values.paper, signal: 'Citation burst' } : type === 'search' ? { signal: '3 papers' } : {}),
  }]]));
  await writeFile(fixtureFile, JSON.stringify({ candidates }, null, 2), 'utf8');
}
await writeFixtures();

const childEnv = { ...process.env, NODUS_USERDATA: profile, NODUS_RADAR_FIXTURE_PATH: fixtureFile, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' };
delete childEnv.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/favicon|ERR_NAME_NOT_RESOLVED/.test(message.text())) failures.push(message.text()); });
  await page.waitForFunction(() => typeof window.nodus === 'object');
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win?.setMinimumSize(900, 640); win?.setBounds({ width: 1440, height: 900 }); win?.center(); });

  const vaults = await page.evaluate(async (appVersion) => {
    localStorage.setItem('nodus.lastSeenVersion', appVersion);
    localStorage.setItem(`nodus.mobileTeaserSeen.${appVersion}`, '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.navCollapsed', '0'); localStorage.setItem('nodus.sidebarWidth', '220');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, firstVaultVersion: 1, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true, mascotEnabled: false, mascotStyleChosen: true, uiLanguage: 'en', promptLanguage: 'en', theme: 'light', sidebarCustomized: false });
    const academic = await window.nodus.createVault({ name: 'Radar academic vault', type: 'academic' });
    const study = await window.nodus.createVault({ name: 'Radar study vault', type: 'estudio' });
    await window.nodus.switchVault(study.vault.id);
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, firstVaultVersion: 1, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, mascotEnabled: false, mascotStyleChosen: true, uiLanguage: 'en', promptLanguage: 'en', theme: 'light', sidebarCustomized: false });
    await window.nodus.switchVault(academic.vault.id);
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, firstVaultVersion: 1, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, mascotEnabled: false, mascotStyleChosen: true, uiLanguage: 'en', promptLanguage: 'en', theme: 'light', sidebarCustomized: false });
    return { academic: academic.vault.id, study: study.vault.id };
  }, version);
  await page.reload();
  await page.getByTestId('app-shell').waitFor().catch(async (failure) => {
    console.error('[radar-e2e] startup body:', await page.locator('body').innerText().catch(() => '<unavailable>'));
    throw failure;
  });
  await page.locator('.backup-health-dismiss').click().catch(() => undefined);
  await page.getByRole('button', { name: 'Nodus Radar', exact: true }).click();
  await page.getByTestId('radar-view').waitFor();
  await page.getByTestId('radar-empty-state').waitFor();
  await page.screenshot({ path: path.join(output, '01-radar-empty-real.png') });

  const toolsText = await page.getByTestId('sidebar-scroll-region').innerText();
  assert.ok(toolsText.indexOf('Nodus Browser') < toolsText.indexOf('Nodus Radar') && toolsText.indexOf('Nodus Radar') < toolsText.indexOf('Nodus Tools'), 'Tools order is Browser, Radar, Tools');

  await page.getByTestId('radar-follow-open').click();
  await page.getByTestId('radar-follow-dialog').waitFor();
  await page.screenshot({ path: path.join(output, '01b-radar-follow-flow-real.png') });
  await page.getByTestId('radar-follow-close').click();

  for (const type of Object.keys(values)) {
    await page.getByTestId('radar-follow-open').click();
    await page.getByTestId(`radar-follow-type-${type}`).click();
    await page.getByTestId('radar-follow-value').fill(values[type]);
    await page.getByTestId('radar-follow-title-input').fill(labels[type]);
    await page.getByTestId('radar-follow-save').click();
    await page.getByTestId('radar-following').waitFor();
    await page.waitForFunction((expected) => window.nodus.getRadarSnapshot().then((snapshot) => snapshot.follows.length === expected), Object.keys(values).indexOf(type) + 1);
  }
  await page.waitForFunction(() => window.nodus.getRadarSnapshot().then((snapshot) => !snapshot.checking));
  await page.evaluate(() => window.nodus.checkRadar({ reason: 'manual' }));
  await page.getByTestId('radar-tab-inbox').click();
  await page.waitForFunction(() => window.nodus.getRadarSnapshot().then((snapshot) => snapshot.updates.length === 7 && snapshot.unreadCount === 7));
  await page.getByTestId('radar-notice').waitFor({ state: 'hidden' }).catch(() => undefined);

  const alignment = await page.evaluate(() => {
    const card = document.querySelector('[data-radar-update-id]')?.getBoundingClientRect();
    const summary = document.querySelector('[data-testid="radar-summary-column"] > div')?.getBoundingClientRect();
    return { card: card?.top ?? -1, summary: summary?.top ?? -2 };
  });
  assert.ok(Math.abs(alignment.card - alignment.summary) <= 1, `summary column is aligned with the first Inbox card (${JSON.stringify(alignment)})`);
  assert.ok(await page.getByTestId('radar-inbox-badge').isVisible());
  await page.screenshot({ path: path.join(output, '02-radar-populated-aligned-real.png') });
  if (keepOpen) {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((win) => !win.webContents.getURL().includes('mascot'))?.setBounds({ width: 1600, height: 1000 });
    });
    console.log('[radar-review] Electron queda abierto en Nodus Radar. Cierra la ventana cuando termines.');
    await new Promise((resolve) => app.process().once('exit', resolve));
    await rm(testRoot, { recursive: true, force: true });
    process.exit(0);
  }

  await page.getByTestId('radar-tab-following').click();
  assert.equal(await page.locator('[data-testid^="radar-follow-radar-follow-"]').count(), 7);
  await page.screenshot({ path: path.join(output, '03-radar-following-real.png') });
  await page.getByTestId('radar-tab-sources').click();
  assert.equal(await page.locator('[data-testid^="radar-source-"]').count(), 6);
  await page.screenshot({ path: path.join(output, '04-radar-sources-real.png') });

  const journal = (await page.evaluate(() => window.nodus.getRadarSnapshot())).follows.find((follow) => follow.type === 'journal');
  await page.getByTestId('radar-tab-following').click();
  await page.getByTestId(`radar-follow-edit-${journal.id}`).click();
  await page.getByTestId('radar-follow-title-input').fill('Journal of Informetrics — edited');
  await page.getByTestId('radar-follow-save').click();
  await page.getByText('Journal of Informetrics — edited', { exact: true }).waitFor();

  const searchFollow = (await page.evaluate(() => window.nodus.getRadarSnapshot())).follows.find((follow) => follow.type === 'search');
  await page.getByTestId(`radar-follow-pause-${searchFollow.id}`).click();
  await page.waitForFunction((id) => window.nodus.getRadarSnapshot().then((snapshot) => snapshot.follows.find((follow) => follow.id === id)?.paused === true), searchFollow.id);
  generations.search += 1; await writeFixtures();
  await page.evaluate(() => window.nodus.checkRadar({ reason: 'manual' }));
  assert.equal((await page.evaluate(() => window.nodus.getRadarSnapshot())).updates.filter((update) => update.externalId === 'search-fixture-2').length, 0, 'paused follow generated no update');
  await page.getByTestId(`radar-follow-pause-${searchFollow.id}`).click();

  const website = (await page.evaluate(() => window.nodus.getRadarSnapshot())).follows.find((follow) => follow.type === 'website');
  await page.getByTestId(`radar-follow-remove-${website.id}`).click();
  await page.getByTestId('radar-remove-confirm').click();
  await page.waitForFunction(() => window.nodus.getRadarSnapshot().then((snapshot) => snapshot.follows.length === 6 && !snapshot.follows.some((follow) => follow.type === 'website')));
  generations.website += 1; await writeFixtures();
  await page.evaluate(() => window.nodus.checkRadar({ reason: 'manual' }));
  assert.equal((await page.evaluate(() => window.nodus.getRadarSnapshot())).updates.some((update) => update.externalId === 'website-fixture-2'), false, 'removed follow generated no update');

  await page.getByTestId('radar-tab-inbox').click();
  const unreadBefore = (await page.evaluate(() => window.nodus.getRadarSnapshot())).unreadCount;
  const firstUnread = (await page.evaluate(() => window.nodus.getRadarSnapshot())).updates.find((update) => !update.read);
  await page.getByTestId(`radar-mark-read-${firstUnread.id}`).click();
  await page.waitForFunction((expected) => window.nodus.getRadarSnapshot().then((snapshot) => snapshot.unreadCount === expected), unreadBefore - 1);
  await page.getByTestId('radar-mark-all-read').click();
  await page.waitForFunction(() => window.nodus.getRadarSnapshot().then((snapshot) => snapshot.unreadCount === 0));
  await page.getByTestId('radar-unread-toggle').click(); await page.getByTestId('radar-empty-state').waitFor();
  await page.getByTestId('radar-unread-toggle').click();

  await page.getByTestId('radar-notice').waitFor({ state: 'hidden' }).catch(() => undefined);

  // A fresh result proves the header badge, global panel, and its Radar deep link.
  generations.topic += 1; await writeFixtures();
  await page.evaluate(() => window.nodus.checkRadar({ reason: 'manual' }));
  await page.waitForFunction(() => window.nodus.listNotifications().then((list) => list.some((item) => !item.read && item.action?.type === 'radar')));
  await page.getByTestId('radar-tab-sources').click();
  await page.locator('[data-notifications-trigger]').click();
  await page.getByTestId('header-notifications-panel').waitFor();
  await page.screenshot({ path: path.join(output, '05-radar-global-notification-real.png') });
  await page.locator('[data-testid^="notification-open-radar-"]').first().click();
  await page.getByTestId('radar-inbox').waitFor();

  // A second fresh result is surfaced through the real always-on-top Nodi window.
  await page.evaluate(() => window.nodus.clearNotifications());
  generations.author += 1; await writeFixtures();
  await page.evaluate(() => window.nodus.checkRadar({ reason: 'manual' }));
  await page.waitForFunction(() => window.nodus.listNotifications().then((list) => list.some((item) => item.action?.type === 'radar')));
  const newest = (await page.evaluate(() => window.nodus.getRadarSnapshot())).updates[0];
  await page.evaluate(() => window.nodus.updateSettings({ mascotEnabled: true, mascotAlwaysOnTop: true, mascotStyle: 'orb', reduceMotion: true }));
  let overlay;
  for (let i = 0; i < 40 && !overlay; i += 1) { overlay = app.windows().find((window) => window.url().includes('mascot')); if (!overlay) await page.waitForTimeout(250); }
  assert.ok(overlay, 'Nodi overlay appeared');
  overlay.setDefaultTimeout(30_000);
  await overlay.locator('.nodi-figure').waitFor();
  await page.getByTestId('radar-tab-sources').click();
  await overlay.waitForFunction(() => window.nodus.listNotifications().then((list) => list.some((item) => item.action?.type === 'radar')));
  const nodiRadarNotification = await overlay.evaluate(() => window.nodus.listNotifications().then((list) => list.find((item) => item.action?.type === 'radar')));
  assert.ok(nodiRadarNotification, 'Nodi received the Radar notification through its isolated bridge');
  await overlay.evaluate((id) => window.nodus.openNotification(id), nodiRadarNotification.id);
  await page.getByTestId(`radar-update-${newest.id}`).waitFor();
  assert.match(await page.getByTestId(`radar-update-${newest.id}`).getAttribute('class'), /ring-2/, 'Nodi deep link highlights the relevant update');

  // The same global store remains visible after switching to a different vault type.
  await page.evaluate((id) => window.nodus.switchVault(id), vaults.study);
  await page.getByRole('button', { name: 'Nodus Radar', exact: true }).click();
  await page.getByTestId('radar-view').waitFor();
  assert.equal((await page.evaluate(() => window.nodus.getRadarSnapshot())).follows.length, 6);
  const toolsAfterSwitch = await page.getByTestId('sidebar-scroll-region').innerText();
  assert.ok(toolsAfterSwitch.includes('Nodus Radar'));

  await page.evaluate(() => window.nodus.updateSettings({ theme: 'dark', mascotEnabled: false }));
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.getByTestId('radar-tab-sources').click();
  await page.screenshot({ path: path.join(output, '07-radar-dark-real.png') });
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((win) => !win.webContents.getURL().includes('mascot'))?.setBounds({ width: 980, height: 720 }); });
  await page.getByTestId('radar-tab-inbox').click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `compact layout has no horizontal overflow (${overflow}px)`);
  await page.screenshot({ path: path.join(output, '08-radar-compact-real.png') });

  assert.deepEqual(failures, [], `renderer failures: ${failures.join('\n')}`);
  console.log(JSON.stringify({ followsCreated: 7, followsRemaining: 6, captures: 8, output }, null, 2));
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(testRoot, { recursive: true, force: true });
}
