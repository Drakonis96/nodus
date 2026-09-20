// Capture the website's additional galleries from the current Electron build.
// Uses only a disposable profile; existing white README captures are preserved.
// Run: npm run build && node scripts/capture-site-gallery.mjs
import { enrichLearningWorkspace, enrichDatabaseWorkspace } from './fixtures/site-gallery.mjs';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repoRoot, 'docs', 'screenshots', 'site');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;

if (!existsSync(path.join(repoRoot, 'dist-electron', 'main.js')) || !existsSync(path.join(repoRoot, 'dist', 'index.html'))) {
  throw new Error('Run `npm run build` before capturing site gallery screenshots.');
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-site-gallery-'));
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
  theme: 'light',
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
  page.setDefaultTimeout(15_000);
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
      localStorage.setItem('nodus.sidebarWidth', '208');
      localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
      localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
      localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
      localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
      localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
      sessionStorage.setItem('nodus.startupUpdateChecked', '1');
      return window.nodus.updateSettings(nextSettings);
    }, { version: appVersion, nextSettings: settings });
  }

  async function settle() {
    await applyDocumentationSettings();
    await page.reload();
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });
    await page.waitForFunction(() => (
      document.documentElement.classList.contains('light')
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
    await applyDocumentationSettings();
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
    const dismiss = page.locator('.backup-health-dismiss');
    if (await dismiss.isVisible()) await dismiss.click();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => ({
      light: document.documentElement.classList.contains('light'),
      language: document.documentElement.lang,
      demoBanner: document.body.innerText.includes('Demo mode:'),
    }));
    assert.deepEqual(state, { light: true, language: 'en', demoBanner: false });
    const target = path.join(outputRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await page.screenshot({ path: target, animations: 'disabled', type: 'png', scale: 'css' });
    console.log(`[site-gallery] ${relativePath}`);
  }

  async function captureView(view, relativePath, readySelector) {
    await openView(view, readySelector);
    await capture(relativePath);
  }

  await createAndSwitch('Teaching 2026', 'docencia');
  await seed('seedTeachingDemoData');
  await page.evaluate(enrichLearningWorkspace, true);
  await openView('teachingExams');
  await page.getByText('Written test · unit 3', { exact: true }).click();
  await page.getByRole('button', { name: 'Exam header', exact: true }).click();
  await page.frameLocator('[data-testid="exam-preview"]').getByText('SAMPLE SECONDARY SCHOOL', { exact: false }).waitFor();
  await capture('teaching-exams.png');
  await openView('teachingRubrics');
  await page.locator('[data-testid^="rubric-row-"]').first().click();
  await page.getByTestId('rubric-grid').waitFor();
  await capture('teaching-rubrics.png');
  await captureView('studyQuestions', 'teaching-questions.png');
  await captureView('studySchedule', 'teaching-timetable.png');
  await captureView('studyCalendar', 'teaching-calendar.png');
  await openView('teachingGrades');
  await page.getByText('History · Year 9 A', { exact: true }).click();
  await capture('teaching-grades.png');

  await createAndSwitch('Biology Study', 'estudio');
  await seed('seedStudyDemoData');
  await page.evaluate(enrichLearningWorkspace, false);
  await captureView('studyQuestions', 'study-questions.png');
  await openView('studyReview');
  await page.getByTestId('study-review-start').click();
  await page.getByTestId('study-review-session').getByRole('button', { expanded: false }).click();
  await capture('study-review.png');
  await captureView('studySchedule', 'study-schedule.png');
  await captureView('studyCalendar', 'study-calendar.png');
  await openView('studyCourses');
  await page.getByTestId('study-browser-course-demo-study-course-biology').getByRole('button').first().click();
  await capture('study-courses.png');
  await openView('studyGraph');
  await page.getByTestId('stellar-tabs-workspace').waitFor();
  await page.getByText('Process', { exact: true }).click();
  await page.getByLabel('Show ideas', { exact: true }).selectOption('2');
  await page.waitForTimeout(1500);
  await capture('study-graph.png');

  await createAndSwitch('Research Dataset', 'databases');
  await seed('seedDatabasesDemoData');
  await page.evaluate(enrichDatabaseWorkspace, path.join(repoRoot, 'scripts', 'fixtures', 'site-gallery'));
  await page.getByText('Field samples', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Photo catalogue', exact: true }).click();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('[data-testid="gallery-card"] img')];
    return images.length === 3 && images.every(img => img.complete && img.naturalWidth > 0);
  });
  await capture('databases-gallery.png');
  await page.getByTestId('gallery-card').first().click();
  await page.getByTestId('database-record-modal').waitFor();
  await capture('databases-record.png');
  await page.getByTestId('database-record-modal').getByRole('button', { name: 'Close', exact: true }).click();
  await captureView('dbAnalysis', 'databases-analysis.png');
  await page.getByText('Experiments', { exact: true }).first().click();
  await page.getByTitle('Table', { exact: true }).click();
  await capture('databases-relations.png');
  await page.getByTitle('Board', { exact: true }).click();
  await capture('databases-board.png');
} finally {
  if (app) await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true });
}
