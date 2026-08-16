// Build the screenshot set used by the public Wiki and its PDF manuals.
//
// The source is always the current Electron application. It runs with an isolated
// temporary profile, seeds disposable example data, then disables the demo flag
// before capturing so the documented chrome is the normal desktop workspace.
// No browser-demo HTML and no developer vault are read by this script.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repoRoot, 'site', 'wiki', 'assets');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;

if (!existsSync(path.join(repoRoot, 'dist-electron', 'main.js')) || !existsSync(path.join(repoRoot, 'dist', 'index.html'))) {
  throw new Error('Run `npm run build` before capturing Wiki screenshots.');
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-wiki-shots-'));
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

const settings = {
  onboardingComplete: true,
  basicsTutorialVersion: 999,
  recoverySetupVersion: 999,
  tourComplete: true,
  advancedTourComplete: true,
  genealogyTourComplete: true,
  databasesTourComplete: true,
  studyTourComplete: true,
  docenciaTourComplete: true,
  theme: 'dark',
  uiLanguage: 'en',
  mascotEnabled: false,
  mascotStyleChosen: true,
  reduceMotion: true,
  demoMode: false,
  sidebarCustomized: true,
  sidebarHidden: [],
  sidebarOrder: [],
};

let app;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Nodus') ?? BrowserWindow.getAllWindows()[0];
    main.setContentSize(1440, 900);
    main.center();
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));

  async function applyDocumentationSettings() {
    await page.evaluate(({ version, nextSettings }) => {
      localStorage.setItem('nodus.lastSeenVersion', version);
      localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
      localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
      localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
      localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
      localStorage.setItem('nodus.websiteLaunchSeen.2026-08', '1');
      sessionStorage.setItem('nodus.startupUpdateChecked', '1');
      return window.nodus.updateSettings(nextSettings);
    }, { version: appVersion, nextSettings: settings });
  }

  async function settle() {
    await applyDocumentationSettings();
    await page.reload();
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });
    await page.waitForFunction(() => (
      document.documentElement.classList.contains('dark')
      && document.documentElement.lang === 'en'
      && !document.body.innerText.includes('Demo mode:')
    ));
    const dismiss = page.locator('.backup-health-dismiss');
    if (await dismiss.count() === 1 && await dismiss.isVisible()) await dismiss.click();
  }

  async function createAndSwitch(name, type) {
    const result = await page.evaluate(({ vaultName, vaultType }) => window.nodus.createVault({ name: vaultName, type: vaultType }), { vaultName: name, vaultType: type });
    const switched = await page.evaluate((id) => window.nodus.switchVault(id), result.vault.id);
    assert.equal(switched.ok, true, switched.message);
    return result.vault;
  }

  async function seed(seedMethod) {
    const result = await page.evaluate((method) => window.nodus[method](), seedMethod);
    assert.ok(result === true || result?.seeded === true, `${seedMethod} must seed the isolated vault`);
    await settle();
  }

  async function openView(view, readySelector) {
    const button = page.locator(`[data-tour="nav-${view}"]`);
    assert.equal(await button.count(), 1, `navigation target ${view} must be available once`);
    await button.click();
    await page.waitForFunction((target) => document.querySelector(`[data-tour="nav-${target}"]`)?.classList.contains('bg-indigo-600'), view);
    if (readySelector) await page.locator(readySelector).waitFor({ state: 'visible' });
    await page.waitForTimeout(view.includes('Graph') || view === 'graph' || view === 'tree' ? 1_200 : 450);
  }

  async function capture(relativePath) {
    const state = await page.evaluate(() => ({
      dark: document.documentElement.classList.contains('dark'),
      language: document.documentElement.lang,
      demoBanner: document.body.innerText.includes('Demo mode:'),
    }));
    assert.deepEqual(state, { dark: true, language: 'en', demoBanner: false });
    const target = path.join(outputRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await page.screenshot({ path: target, animations: 'disabled', type: 'png' });
    console.log(`[wiki] ${relativePath}`);
  }

  async function captureView(view, relativePath, readySelector) {
    await openView(view, readySelector);
    await capture(relativePath);
  }

  // Academic Research
  await applyDocumentationSettings();
  assert.equal(await page.evaluate(() => window.nodus.seedDemoData()), true);
  await settle();
  await captureView('home', 'academic/home.png');
  await page.locator('[data-tour="vault-badge"]').click();
  await page.getByPlaceholder('Search vaults…').waitFor({ state: 'visible' });
  await capture('common/vault-switcher.png');
  await page.keyboard.press('Escape');
  await captureView('search', 'academic/search.png');
  await captureView('library', 'academic/library.png');
  await captureView('graph', 'academic/graph.png', 'canvas.sigma-nodes');
  await captureView('argument', 'academic/argument.png');
  await captureView('ideas', 'academic/ideas.png');
  await captureView('authors', 'academic/authors.png');
  await captureView('immersion', 'academic/immersion.png');
  await captureView('research', 'academic/coverage.png');
  for (const [tab, filename] of [['Gaps', 'academic/gaps.png'], ['Debates', 'academic/debates.png']]) {
    const target = page.getByRole('button', { name: tab, exact: true });
    if (await target.count()) {
      await target.click();
      await page.waitForTimeout(350);
    }
    await capture(filename);
  }
  await captureView('hypothesis', 'academic/hypotheses.png');
  await captureView('reading', 'academic/reading.png');
  await captureView('deepResearch', 'academic/deep-research.png');
  await captureView('workspace', 'academic/workspace.png');
  await captureView('toolkit', 'common/toolkit.png');
  await captureView('settings', 'academic/settings.png');

  // Genealogy
  await createAndSwitch('Family History', 'genealogy');
  await seed('seedGenealogyDemoData');
  for (const [view, filename] of [
    ['home', 'home.png'], ['search', 'search.png'], ['persons', 'people.png'], ['tree', 'tree.png'],
    ['timeline', 'timeline.png'], ['relations', 'relations.png'], ['map', 'map.png'], ['archive', 'archive.png'],
    ['deepResearch', 'research.png'], ['notes', 'notes.png'], ['settings', 'settings.png'],
  ]) await captureView(view, `genealogy/${filename}`);

  // Databases
  await createAndSwitch('Research Dataset', 'databases');
  await seed('seedDatabasesDemoData');
  await captureView('home', 'databases/home.png');
  const databaseButton = page.getByText('Field samples', { exact: true }).first();
  await databaseButton.click();
  await page.locator('[data-tour="db-table"]').waitFor({ state: 'visible' });
  await capture('databases/table.png');
  await page.getByTitle('Gallery').click();
  await page.getByTestId('gallery-card').first().waitFor({ state: 'visible' });
  await capture('databases/gallery.png');
  await page.getByTestId('gallery-card').first().click();
  await page.getByTestId('database-record-modal').waitFor({ state: 'visible' });
  await capture('databases/record.png');
  await page.getByTestId('database-record-modal').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTitle('Table').click();
  await capture('databases/relations.png');
  await captureView('dbSearch', 'databases/search.png');
  await captureView('dbAnalysis', 'databases/analysis.png');
  await captureView('dbChat', 'databases/chat.png');
  await captureView('notes', 'databases/notes.png');
  await captureView('settings', 'databases/settings.png');

  // Study
  await createAndSwitch('Biology Study', 'estudio');
  await seed('seedStudyDemoData');
  for (const [view, filename] of [
    ['home', 'home.png'], ['studyCourses', 'courses.png'], ['studySchedule', 'schedule.png'], ['studyCalendar', 'calendar.png'],
    ['studySearch', 'search.png'], ['studyLibrary', 'materials.png'], ['studyRecordings', 'recordings.png'], ['studyChat', 'chat.png'],
    ['studyIdeas', 'ideas.png'], ['studyGraph', 'graph.png'], ['studyQuestions', 'questions.png'], ['studyReview', 'review.png'],
    ['studyDeepResearch', 'research.png'], ['settings', 'settings.png'],
  ]) await captureView(view, `study/${filename}`);

  // Teaching
  await createAndSwitch('Teaching 2026', 'docencia');
  await seed('seedTeachingDemoData');
  for (const [view, filename] of [
    ['home', 'home.png'], ['studyCourses', 'courses.png'], ['teachingGroups', 'groups.png'], ['studySchedule', 'timetable.png'],
    ['studyCalendar', 'calendar.png'], ['studyLibrary', 'materials.png'], ['studyRecordings', 'recordings.png'],
    ['studyChat', 'chat.png'], ['studyIdeas', 'ideas.png'], ['studyGraph', 'graph.png'],
    ['studyQuestions', 'questions.png'], ['teachingRubrics', 'rubrics.png'], ['teachingExams', 'exams.png'],
    ['teachingGrades', 'grades.png'], ['teachingUnits', 'units.png'], ['settings', 'settings.png'],
  ]) await captureView(view, `teaching/${filename}`);

  console.log(`Current desktop screenshots written to ${outputRoot}`);
} finally {
  if (app) await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true });
}
