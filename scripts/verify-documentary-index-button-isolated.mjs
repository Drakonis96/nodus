/**
 * Focused live verification for the per-work Documentary Index button.
 *
 * The run creates a brand-new Nodus profile below the OS temporary directory,
 * copies only the encrypted OpenRouter key, imports one synthetic PDF, clicks the
 * renderer button and removes the profile afterward. Real vault paths are never
 * registered in the test process.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const fixturePath = path.resolve(
  process.env.NODUS_DOCUMENTARY_FIXTURE
    ?? path.join(repoRoot, 'output/pdf/documentary-index-isolated-test.pdf'),
);
const reportPath = path.resolve(
  process.env.NODUS_DOCUMENTARY_REPORT
    ?? path.join(repoRoot, 'artifacts/documentary-index-verification/report.json'),
);
const screenshotDirectory = path.dirname(reportPath);
const defaultSourceUserData = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Nodus')
  : process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Nodus')
    : path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'Nodus');
const sourceUserData = path.resolve(
  process.env.NODUS_SOURCE_USERDATA
    ?? defaultSourceUserData,
);
const textModel = Object.freeze({ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' });
const embeddingModel = Object.freeze({ provider: 'openrouter', model: 'baai/bge-m3' });
const sourceKeyPath = path.join(sourceUserData, 'secrets/ai_key_openrouter.bin');
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const startedAt = new Date().toISOString();
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-documentary-button-'));
const userData = path.join(isolatedRoot, 'profile');
const backupRoot = path.join(isolatedRoot, 'library-root');
const isolatedKeyPath = path.join(userData, 'secrets', path.basename(sourceKeyPath));

const translations = [
  { language: 'es', heading: 'Índice documental', action: 'Escanear obra completa' },
  { language: 'en', heading: 'Documentary index', action: 'Scan complete work' },
  { language: 'fr', heading: 'Index documentaire', action: 'Analyser l’œuvre complète' },
  { language: 'de', heading: 'Dokumentenindex', action: 'Vollständiges Werk scannen' },
  { language: 'pt', heading: 'Índice documental', action: 'Analisar obra completa' },
  { language: 'pt-BR', heading: 'Índice documental', action: 'Escanear obra completa' },
  { language: 'it', heading: 'Indice documentario', action: 'Analizza l’opera completa' },
  { language: 'tr', heading: 'Belgesel dizin', action: 'Eserin tamamını tara' },
];

const report = {
  startedAt,
  finishedAt: null,
  success: false,
  isolation: {
    temporaryProfileCreated: true,
    temporaryProfileDeleted: false,
    onlyLocalVaultPaths: false,
    sourceUnchanged: false,
  },
  fixture: {},
  models: { text: textModel, embedding: embeddingModel },
  import: {},
  button: {},
  translations: [],
  generation: {},
  ui: {},
  errors: [],
};

let app = null;
let page = null;
let sourceBefore = null;

function log(message) {
  process.stdout.write(`[documentary-button] ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fileState(file, includeHash = false) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ...(includeHash ? { sha256: hashFile(file) } : {}),
  };
}

function sourceState() {
  const registryPath = path.join(sourceUserData, 'vaults.json');
  assert.ok(fs.existsSync(registryPath), `Missing source vault registry: ${registryPath}`);
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const active = registry.vaults?.find((vault) => vault.id === registry.activeVaultId) ?? null;
  return {
    registry: fileState(registryPath, true),
    activeDatabase: active?.path ? fileState(active.path, false) : null,
    activeDatabasePath: active?.path ?? null,
    openrouterKey: fileState(sourceKeyPath, true),
  };
}

function isInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function comparableSourceState(value) {
  return {
    registry: value.registry,
    activeDatabase: value.activeDatabase,
    activeDatabasePath: value.activeDatabasePath,
    openrouterKey: value.openrouterKey,
  };
}

async function dismissStartupUi() {
  const modal = page.getByTestId('startup-update-modal');
  await modal.waitFor({ state: 'attached', timeout: 1_500 }).catch(() => undefined);
  if (await modal.count()) {
    await page.waitForFunction(() => document.querySelector('[data-testid="startup-update-modal"]')?.getAttribute('data-update-status') === 'not-available');
    const accept = modal.getByRole('button').last();
    await accept.click();
    await modal.waitFor({ state: 'detached' });
  }
}

async function waitForExtraction(itemId) {
  const deadline = Date.now() + 4 * 60_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate((id) => window.nodus.getGlobalLibraryItem(id), itemId);
    if (last?.files?.reader && last?.extraction?.status === 'ready') return last;
    if (last?.extraction?.status === 'failed' || last?.extraction?.status === 'unsupported') {
      throw new Error(`PDF extraction failed: ${last.extraction.error ?? last.extraction.status}`);
    }
    await sleep(500);
  }
  const jobs = await page.evaluate(() => window.nodus.listLibraryExtractionJobs());
  throw new Error(`Timed out waiting for PDF extraction: ${JSON.stringify({ extraction: last?.extraction, jobs })}`);
}

async function openLibraryWork(workId, workTitle) {
  await page.locator('[data-tour="nav-library"]').click();
  await page.getByTestId('library-vault-header').waitFor({ state: 'visible' });
  const search = page.getByTestId('library-vault-search');
  await search.fill(workTitle);
  const row = page.getByTestId(`vault-library-item-${workId}`);
  await row.waitFor({ state: 'visible' });
  return row;
}

async function openStatusModal(workId, workTitle) {
  const row = await openLibraryWork(workId, workTitle);
  const pill = row.locator('.library-status-pill');
  await pill.waitFor({ state: 'visible' });
  await pill.click();
  const section = page.getByTestId('work-status-documentary-index');
  await section.waitFor({ state: 'visible' });
  return { row, pill, section, dialog: section.locator('xpath=ancestor::*[@role="dialog"]').first() };
}

async function closeStatusModal(dialog) {
  await dialog.click({ position: { x: 5, y: 5 } });
  await page.getByTestId('work-status-documentary-index').waitFor({ state: 'detached' });
}

async function verifyTranslations(workId, workTitle) {
  const rendered = [];
  for (const expected of translations) {
    await page.evaluate((language) => window.nodus.updateSettings({ uiLanguage: language }), expected.language);
    await page.reload();
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });
    await dismissStartupUi();
    const { section, dialog } = await openStatusModal(workId, workTitle);
    const heading = (await section.locator('span').first().innerText()).trim();
    const action = (await page.getByTestId('work-status-documentary-action').innerText()).trim();
    const beta = (await page.getByTestId('work-status-documentary-beta').innerText()).trim();
    assert.equal(heading, expected.heading, `Documentary heading is not translated in ${expected.language}`);
    assert.equal(action, expected.action, `Documentary action is not translated in ${expected.language}`);
    assert.equal(beta, 'BETA', `Beta tag is missing in ${expected.language}`);
    assert.equal(await page.evaluate(() => document.documentElement.lang), expected.language);
    rendered.push({ ...expected, beta, rendered: true });
    await closeStatusModal(dialog);
  }
  return rendered;
}

async function waitForDocumentJob(workId) {
  const deadline = Date.now() + 25 * 60_000;
  let lastLine = '';
  let lastJob = null;
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => window.nodus.getDocumentIndexProgress());
    lastJob = snapshot.jobs.find((job) => job.nodusId === workId) ?? null;
    if (lastJob) {
      const line = `${lastJob.status} · ${lastJob.phase} · ${Math.round(lastJob.progress * 100)}%`;
      if (line !== lastLine) {
        log(line);
        lastLine = line;
      }
      if (['completed', 'failed', 'unavailable', 'cancelled'].includes(lastJob.status)) return lastJob;
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for Documentary Index: ${JSON.stringify(lastJob)}`);
}

try {
  assert.ok(fs.existsSync(path.join(repoRoot, 'dist-electron/main.js')), 'Run npm run build before this verification.');
  assert.ok(fs.existsSync(fixturePath), `Missing PDF fixture: ${fixturePath}`);
  assert.ok(fs.existsSync(sourceKeyPath), 'The encrypted OpenRouter key is not available.');
  sourceBefore = sourceState();
  report.fixture = {
    path: fixturePath,
    bytes: fs.statSync(fixturePath).size,
    sha256: hashFile(fixturePath),
    pages: 6,
  };

  fs.mkdirSync(path.dirname(isolatedKeyPath), { recursive: true, mode: 0o700 });
  fs.copyFileSync(sourceKeyPath, isolatedKeyPath);
  fs.chmodSync(isolatedKeyPath, 0o600);
  fs.mkdirSync(backupRoot, { recursive: true });
  fs.mkdirSync(screenshotDirectory, { recursive: true });

  const env = {
    ...process.env,
    NODUS_USERDATA: userData,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available',
    NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  log('launching isolated Nodus profile');
  app = await electron.launch({
    executablePath: require('electron'),
    args: [repoRoot],
    cwd: repoRoot,
    env,
    timeout: 5 * 60_000,
  });
  page = await app.firstWindow({ timeout: 5 * 60_000 });
  page.setDefaultTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const setup = await page.evaluate(async ({ version, backup, model, embedding }) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.libraryTutorialSeen.v1', '1');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 999,
      recoverySetupVersion: 999,
      tourComplete: true,
      advancedTourComplete: true,
      uiLanguage: 'es',
      promptLanguage: 'es',
      mascotEnabled: false,
      reduceMotion: true,
      libraryGlobalEnabled: true,
      libraryScope: 'vault',
      libraryScopeOnboardingVersion: 1,
      autoBackupFolder: backup,
      autoBackupEnabled: false,
      backupCleanupEnabled: false,
      syncMode: 'manual',
      autoLightScan: false,
      autoDeepScanOnReadTag: false,
      autoSummaryAfterDeep: false,
      autoBridgeAfterQueue: false,
      autoResumeQueue: false,
      documentIndexingEnabled: false,
      documentIndexIncludeArchived: false,
      documentIndexConcurrency: 1,
      announcementsEnabled: false,
      betaUpdates: false,
      mcpEnabled: false,
      nodusServerEnabled: false,
      localServerEnabled: false,
      copilotEnabled: false,
      zoteroPluginEnabled: false,
      browserConnectorEnabled: false,
    });
    await window.nodus.seedDemoData();
    const settings = await window.nodus.updateSettings({
      modelSettingsMode: 'advanced',
      documentProfileModel: model,
      documentAuditModel: model,
      summaryModel: model,
      synthesisModel: model,
      extractionModel: model,
      fusionModel: model,
      embeddingProvider: embedding.provider,
      embeddingModel: embedding.model,
      documentIndexingEnabled: false,
      autoBackupFolder: backup,
    });
    await window.nodus.getGlobalLibraryStatus();
    const librarySettings = await window.nodus.getGlobalLibrarySettings();
    await window.nodus.setGlobalLibrarySettings({ ...librarySettings, autoPrepareAttachments: true });
    return {
      settings,
      activeVault: await window.nodus.getActiveVault(),
      vaults: await window.nodus.listVaults(),
    };
  }, { version: appVersion, backup: backupRoot, model: textModel, embedding: embeddingModel });

  assert.equal(setup.settings.providerKeys.openrouter, true, 'The isolated profile could not decrypt the OpenRouter key.');
  assert.deepEqual(setup.settings.documentProfileModel, textModel);
  assert.deepEqual(setup.settings.documentAuditModel, textModel);
  assert.equal(setup.settings.documentIndexingEnabled, false);
  assert.ok(setup.activeVault, 'The isolated demo vault was not created.');
  assert.ok(setup.vaults.length > 0);
  assert.ok(setup.vaults.every((vault) => vault.origin === 'local' && isInside(vault.path, userData)));
  report.isolation.onlyLocalVaultPaths = true;

  log('importing and extracting the six-page PDF');
  const imported = await page.evaluate((pdf) => window.nodus.importDroppedGlobalLibraryFiles([pdf]), fixturePath);
  assert.equal(imported.created, 1, `The PDF was not imported: ${JSON.stringify(imported)}`);
  assert.equal(imported.itemIds.length, 1);
  const itemId = imported.itemIds[0];
  const plan = await page.evaluate((id) => window.nodus.prepareGlobalLibraryReading(id), itemId);
  assert.equal(plan.pageCount, 6, `Expected six pages, got ${plan.pageCount}`);
  const libraryItem = await waitForExtraction(itemId);
  report.import = {
    created: imported.created,
    warnings: imported.warnings,
    itemId,
    pageCount: plan.pageCount,
    preparationAction: plan.action,
    extractionStatus: libraryItem.extraction?.status ?? null,
    cleanReaderCreated: Boolean(libraryItem.files?.reader),
  };

  const linked = await page.evaluate(
    ({ id, vaultId }) => window.nodus.linkGlobalLibraryItemsToVault([id], vaultId),
    { id: itemId, vaultId: setup.activeVault.id },
  );
  assert.equal(linked.linked, 1);
  assert.equal(linked.links.length, 1);
  const workId = linked.links[0].workId;
  const work = await page.evaluate((id) => window.nodus.getWork(id), workId);
  assert.ok(work, 'The imported item did not materialize as a vault work.');
  const workTitle = work.title;

  const before = await page.evaluate(async (id) => ({
    states: await window.nodus.getDocumentProfileStatuses([id]),
    jobs: (await window.nodus.getDocumentIndexProgress()).jobs.filter((job) => job.nodusId === id),
    profile: await window.nodus.getDocumentProfile(id),
  }), workId);
  assert.equal(before.states[0]?.status, 'missing');
  assert.equal(before.jobs.length, 0, 'Documentary Index started automatically before the button click.');
  assert.equal(before.profile, null);

  log('checking the real button in all eight interface languages');
  report.translations = await verifyTranslations(workId, workTitle);

  await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'es' }));
  await page.reload();
  await page.getByTestId('app-shell').waitFor({ state: 'visible' });
  await dismissStartupUi();
  const { row, pill, section } = await openStatusModal(workId, workTitle);
  const readinessBefore = (await pill.innerText()).trim();
  assert.equal(await page.getByTestId('document-index-manager-button').count(), 0, 'The global Documentary Index button is visible.');
  assert.match(await section.innerText(), /opcional.*no afecta al estado general.*Deep Research/is);
  await page.screenshot({ path: path.join(screenshotDirectory, 'button-before-click.png'), fullPage: true });

  log('clicking the per-work Documentary Index action');
  await page.getByTestId('work-status-documentary-action').click();
  await page.waitForFunction(async (id) => {
    const jobs = (await window.nodus.getDocumentIndexProgress()).jobs;
    return jobs.some((job) => job.nodusId === id && job.reason === 'manual');
  }, workId);
  const queued = await page.evaluate(async (id) => {
    const jobs = (await window.nodus.getDocumentIndexProgress()).jobs;
    return jobs.find((job) => job.nodusId === id) ?? null;
  }, workId);
  assert.equal(queued?.reason, 'manual');
  report.button = {
    clicked: true,
    queueReason: queued.reason,
    automaticJobBeforeClick: false,
    globalManagerHidden: true,
    betaTagVisible: true,
  };

  const job = await waitForDocumentJob(workId);
  assert.equal(job.status, 'completed', `Documentary Index failed: ${job.error ?? job.status}`);
  const profile = await page.evaluate((id) => window.nodus.getDocumentProfile(id), workId);
  assert.ok(profile, 'No document profile was published.');
  assert.equal(profile.status, 'current');
  assert.deepEqual(profile.generatorModel, textModel);
  assert.deepEqual(profile.auditorModel, textModel);
  assert.ok(profile.overview.length >= 80);
  assert.ok(profile.fields.length >= 3);
  assert.ok(profile.sections.length >= 3);
  assert.ok(profile.supports.length >= 3);
  assert.equal(profile.audit?.passed, true);
  assert.ok((profile.audit?.supportCoverage ?? 0) >= 0.5);
  const generatedText = [
    profile.overview,
    ...profile.fields.map((field) => field.text),
    ...profile.sections.flatMap((section) => [section.title, section.summary]),
  ].join('\n').toLocaleLowerCase('es');
  const expectedConcepts = ['valdemora', '1908', '1967', '1998', 'escorrentía', '18 %'];
  const conceptsFound = expectedConcepts.filter((concept) => generatedText.includes(concept));
  assert.ok(conceptsFound.length >= 4, `The profile missed expected concepts: ${JSON.stringify(conceptsFound)}`);

  await page.reload();
  await page.getByTestId('app-shell').waitFor({ state: 'visible' });
  await dismissStartupUi();
  const generatedModal = await openStatusModal(workId, workTitle);
  const readinessAfter = (await generatedModal.pill.innerText()).trim();
  assert.equal(readinessAfter, readinessBefore, 'Documentary Index changed the work overall status.');
  assert.equal((await page.getByTestId('work-status-documentary-action').innerText()).trim(), 'Abrir la ficha documental completa');
  await page.getByTestId('work-status-documentary-action').click();
  const documentDialog = page.getByRole('dialog', { name: 'Comprensión documental' });
  await documentDialog.waitFor({ state: 'visible' });
  await documentDialog.getByText('Visión de conjunto', { exact: true }).waitFor({ state: 'visible' });
  assert.match((await documentDialog.innerText()).toLocaleLowerCase('es'), /valdemora/);
  await page.screenshot({ path: path.join(screenshotDirectory, 'profile-generated.png'), fullPage: true });

  report.generation = {
    jobStatus: job.status,
    jobReason: job.reason,
    generatorModel: profile.generatorModel,
    auditorModel: profile.auditorModel,
    profileStatus: profile.status,
    overviewCharacters: profile.overview.length,
    fields: profile.fields.length,
    sections: profile.sections.length,
    supports: profile.supports.length,
    validSupports: profile.supports.filter((support) => support.validationStatus === 'valid').length,
    audit: profile.audit,
    qualityScore: profile.qualityScore,
    expectedConceptsFound: conceptsFound,
  };
  report.ui = {
    readinessBefore,
    readinessAfter,
    overallStatusUnaffected: readinessBefore === readinessAfter,
    generatedProfileOpenedFromSameButton: true,
    screenshots: ['button-before-click.png', 'profile-generated.png'],
    pageErrors,
  };
  assert.deepEqual(pageErrors, []);
  report.success = true;
  log(`completed: ${profile.fields.length} fields, ${profile.sections.length} sections, ${profile.supports.length} supports`);
} catch (error) {
  report.errors.push(error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) });
  throw error;
} finally {
  if (app) await app.close().catch(() => undefined);
  const sourceAfter = sourceState();
  report.isolation.sourceUnchanged = sourceBefore
    ? JSON.stringify(comparableSourceState(sourceBefore)) === JSON.stringify(comparableSourceState(sourceAfter))
    : false;
  if (sourceBefore) assert.equal(report.isolation.sourceUnchanged, true, 'The source Nodus registry, active vault, or OpenRouter key changed.');
  assert.ok(isInside(isolatedRoot, os.tmpdir()), 'Refusing to remove a non-temporary isolation root.');
  fs.rmSync(isolatedRoot, { recursive: true, force: true });
  report.isolation.temporaryProfileDeleted = !fs.existsSync(isolatedRoot);
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  log(`report: ${reportPath}`);
}
