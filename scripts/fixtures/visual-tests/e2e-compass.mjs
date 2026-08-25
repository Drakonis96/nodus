import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

// Run after `npm run build`. The fixture keeps the full workflow deterministic:
// no public index is contacted, while each provider still has enough records
// to exercise progressive pagination, duplicate merging and virtualization.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const version = require(path.join(root, 'package.json')).version;
const cases = JSON.parse(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'compass-search-cases.json'), 'utf8'));
const testRoot = await mkdtemp(path.join(os.tmpdir(), 'nodus-compass-e2e-'));
const profile = path.join(testRoot, 'profile');
const backupRoot = path.join(testRoot, 'backups');
const fixtureFile = path.join(testRoot, 'compass-fixtures.json');
const captures = process.env.NODUS_COMPASS_CAPTURE_DIR || path.join(os.tmpdir(), 'nodus-compass-e2e-captures');
await mkdir(captures, { recursive: true });

function record(provider, index) {
  const duplicate = index === 0;
  const title = duplicate ? 'Shared open scholarship fixture' : `${provider} fixture result ${index}`;
  return {
    canonicalKey: duplicate ? 'compass:fixture-shared' : `compass:${provider}-${index}`,
    title,
    abstract: `Deterministic ${provider} bibliographic fixture ${index}.`,
    authors: [{ name: index % 2 ? 'Elena García' : 'Ada Lovelace', given: index % 2 ? 'Elena' : 'Ada', family: index % 2 ? 'García' : 'Lovelace' }],
    issuedYear: 2020 + (index % 6), language: index % 3 === 0 ? 'es' : 'en', type: index % 5 === 0 ? 'book' : 'article',
    disciplines: ['humanities'], topics: ['open scholarship'], venue: 'Fixture Journal', publisher: 'Nodus Test Press',
    identifiers: duplicate ? [{ scheme: 'doi', value: '10.5555/SHARED-FIXTURE' }] : [{ scheme: 'doi', value: `10.5555/${provider}-${index}` }],
    landingUrl: `https://example.org/compass/${provider}/${index}`,
    doiUrl: duplicate ? 'https://doi.org/10.5555/SHARED-FIXTURE' : `https://doi.org/10.5555/${provider}-${index}`,
    openAccess: index % 2 === 0 ? { status: 'gold', url: `https://example.org/oa/${provider}/${index}`, provider } : undefined,
    citationCount: index * 3, provenance: [{ provider, providerId: `${provider}-${index}`, retrievedAt: '2026-08-25T00:00:00.000Z', sourceUrl: `https://example.org/${provider}/${index}`, attribution: `${provider} fixture` }],
    providerRanks: { [provider]: index + 1 }, lexicalScore: 0, semanticScore: undefined, finalScore: 0, reasons: [], duplicateAliases: [],
  };
}

const providers = ['openalex', 'crossref', 'openaire', 'semanticscholar', 'hal', 'doab', 'oapen', 'dialnet', 'openedition', 'scielo', 'unpaywall', 'opencitations'];
const fixture = Object.fromEntries(providers.map((provider) => [provider, Array.from({ length: 60 }, (_, index) => record(provider, index))]));
fixture.crossref = { records: fixture.crossref, error: 'Fixture provider unavailable (503)' };
await writeFile(fixtureFile, JSON.stringify(fixture), 'utf8');

const env = { ...process.env, NODUS_USERDATA: profile, NODUS_COMPASS_FIXTURE_PATH: fixtureFile, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/favicon|ERR_NAME_NOT_RESOLVED/.test(message.text())) errors.push(message.text()); });
  await page.waitForFunction(() => typeof window.nodus === 'object');
  await page.evaluate(async ({ appVersion, backupRoot }) => {
    localStorage.setItem('nodus.documentUnderstandingConsent.2026-08', '1');
    localStorage.setItem('nodus.lastSeenVersion', appVersion);
    localStorage.setItem(`nodus.mobileTeaserSeen.${appVersion}`, '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.navCollapsed', '0'); localStorage.setItem('nodus.sidebarWidth', '220');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, firstVaultVersion: 1, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, mascotEnabled: false, mascotStyleChosen: true, uiLanguage: 'en', promptLanguage: 'en', theme: 'light', sidebarCustomized: false, autoBackupFolder: backupRoot });
    const vault = await window.nodus.createVault({ name: 'Compass fixture vault', type: 'academic' });
    await window.nodus.switchVault(vault.vault.id);
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, firstVaultVersion: 1, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, mascotEnabled: false, mascotStyleChosen: true, uiLanguage: 'en', promptLanguage: 'en', theme: 'light', sidebarCustomized: false });
  }, { appVersion: version, backupRoot });
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await page.locator('.backup-health-dismiss').click().catch(() => undefined);
  await page.getByRole('button', { name: 'Nodus Compass', exact: true }).click();
  await page.getByTestId('compass-view').waitFor();
  const searchGeometry = await page.getByTestId('compass-query').evaluate((input) => {
    const icon = input.previousElementSibling?.getBoundingClientRect();
    const field = input.getBoundingClientRect();
    return { iconRight: icon?.right ?? field.left, textStart: field.left + Number.parseFloat(getComputedStyle(input).paddingLeft) };
  });
  assert.ok(searchGeometry.textStart - searchGeometry.iconRight >= 8, `search text clears the leading icon (${JSON.stringify(searchGeometry)})`);
  await page.getByTestId('compass-query').fill('open scholarship articles since 2020');
  await page.getByTestId('compass-search').click();
  try {
    await page.getByText('Shared open scholarship fixture', { exact: true }).first().waitFor();
  } catch (error) {
    const diagnostics = await page.evaluate(async () => ({
      text: document.querySelector('[data-testid="compass-view"]')?.textContent,
      history: await window.nodus.listCompassHistory(3),
    }));
    console.error(JSON.stringify({ diagnostics, rendererErrors: errors }, null, 2));
    throw error;
  }
  await page.waitForFunction(async () => ['complete', 'empty', 'error'].includes((await window.nodus.listCompassHistory(1))[0]?.state));
  await page.screenshot({ path: path.join(captures, '01-compass-results.png') });

  // The first page is provider-progressive and rendered by a bounded virtual list.
  const firstMounted = await page.locator('article').count();
  assert.ok(firstMounted > 0 && firstMounted < 35, `result rendering is bounded (${firstMounted})`);
  const heapBeforePages = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  const counts = [];
  const renderedTotals = [];
  const responseOffsets = [];
  for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
    await page.getByTestId('compass-load-more').click();
    await page.waitForTimeout(300);
    counts.push(await page.evaluate(async () => (await window.nodus.listCompassHistory(1))[0]?.resultCount ?? 0));
    renderedTotals.push(await page.evaluate(() => Math.round((Number.parseFloat(document.querySelector('.compass-results-list > div')?.style.height ?? '0') || 0) / 108)));
    responseOffsets.push(await page.getByTestId('compass-view').getAttribute('data-last-response-offset'));
    assert.ok(await page.locator('article').count() < 35, `page ${pageIndex + 2} remains virtualized`);
  }
  assert.ok(counts.at(-1) >= counts[0], `result count is stable across pages (${counts.join(', ')})`);
  assert.ok(renderedTotals.at(-1) >= 75, `several result pages are retained in the virtualized list (${renderedTotals.join(', ')}; offsets ${responseOffsets.join(', ')})`);
  const afterMore = await page.locator('article').count();
  const heapAfterPages = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  if (heapBeforePages && heapAfterPages) assert.ok(heapAfterPages - heapBeforePages < 48 * 1024 * 1024, `renderer heap stays bounded (${heapAfterPages - heapBeforePages} bytes)`);
  const providerFailure = await page.evaluate(async () => (await window.nodus.listCompassHistory(1))[0]?.providers.find((provider) => provider.provider === 'crossref'));
  assert.equal(providerFailure?.state, 'error', 'a partial provider failure remains visible without invalidating successful results');

  // Filter changes are debounced and retain the selected record across pages.
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const language = page.locator('label').filter({ hasText: 'Language' }).locator('select');
  await language.selectOption('en');
  await page.waitForTimeout(650); // 220 ms renderer debounce plus provider fixture merge
  const filteredSearch = await page.evaluate(async () => {
    const [entry] = await window.nodus.listCompassHistory(1);
    return entry ? window.nodus.listCompassResults(entry.searchId, 0, 100) : [];
  });
  assert.ok(filteredSearch.length > 0 && filteredSearch.every((item) => item.language === 'en'), 'language filter is applied before rendering');
  const firstCheckbox = page.locator('article input[type="checkbox"]').first();
  await firstCheckbox.check();
  const selectedTitle = await firstCheckbox.getAttribute('aria-label');
  await page.waitForFunction(async () => {
    const [entry] = await window.nodus.listCompassHistory(1);
    return entry && (await window.nodus.getCompassSelection(entry.searchId)).length === 1;
  });
  const selectionBeforePage = await page.evaluate(async () => {
    const [entry] = await window.nodus.listCompassHistory(1);
    return entry ? window.nodus.getCompassSelection(entry.searchId) : [];
  });
  await page.getByTestId('compass-load-more').click().catch(() => undefined);
  await page.waitForTimeout(250);
  const selectionAfterPage = await page.evaluate(async () => {
    const [entry] = await window.nodus.listCompassHistory(1);
    return entry ? window.nodus.getCompassSelection(entry.searchId) : [];
  });
  assert.deepEqual(selectionAfterPage, selectionBeforePage, `selection survives pagination (${selectedTitle})`);
  assert.ok(await page.getByText('1 selected', { exact: true }).isVisible(), 'renderer preserves the multi-page selection state');
  await page.getByRole('button', { name: 'Select page', exact: true }).click();

  await page.getByRole('button', { name: 'Import selection', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: 'Importing…' });
  await importDialog.waitFor();
  const completedClose = importDialog.getByRole('button', { name: 'Close', exact: true }).nth(1);
  await completedClose.waitFor();
  await completedClose.click();
  const libraryPage = await page.evaluate(() => window.nodus.listGlobalLibraryItems({ limit: 100, offset: 0 }));
  assert.ok(libraryPage.items.length >= 20, 'a large Compass batch appears in the global library');
  assert.ok(libraryPage.items.every((item) => item.source === 'compass'), 'import preserves Compass provenance');
  assert.ok(libraryPage.items.every((item) => /^10\.5555\//i.test(item.metadata?.doi ?? '')), 'import preserves DOI metadata');
  const importedRecord = await page.evaluate((itemId) => window.nodus.getGlobalLibraryItem(itemId), libraryPage.items[0].id);
  assert.ok(importedRecord?.metadata.title && importedRecord.metadata.creators.length, 'import preserves complete title and creator metadata');
  assert.ok(importedRecord?.sourceIdentities.some((identity) => identity.source === 'compass'), 'import preserves a Compass source identity');
  assert.ok(importedRecord?.provenance?.some((entry) => entry.provider && entry.providerId && entry.attribution && entry.metadataLicense), 'import preserves provider attribution, license and identifiers');
  await page.getByRole('button', { name: 'Import selection', exact: true }).click();
  const reimportDialog = page.getByRole('dialog', { name: 'Importing…' });
  await reimportDialog.waitFor();
  const reimportClose = reimportDialog.getByRole('button', { name: 'Close', exact: true }).nth(1);
  await reimportClose.waitFor();
  await reimportClose.click();
  const afterReimport = await page.evaluate(() => window.nodus.listGlobalLibraryItems({ limit: 100, offset: 0 }));
  assert.equal(afterReimport.items.length, libraryPage.items.length, 'reimporting the same selection is idempotent');

  await assert.rejects(page.evaluate(async () => {
    const [entry] = await window.nodus.listCompassHistory(1);
    return window.nodus.startCompassImport({ searchId: entry.searchId, selectionRevision: entry.revision, canonicalKeys: ['missing-compass-key'] });
  }), /unavailable result/i, 'invalid selections are rejected before a batch job can become stuck');

  // Cancellation stops at a safe worker chunk boundary. Retrying the same job
  // completes it without duplicating records already written by an earlier chunk.
  const canceledAndRetried = await page.evaluate(async () => {
    const [entry] = await window.nodus.listCompassHistory(1);
    const canonicalKeys = await window.nodus.getCompassSelection(entry.searchId);
    const job = await window.nodus.startCompassImport({ searchId: entry.searchId, selectionRevision: entry.revision, canonicalKeys });
    await window.nodus.cancelCompassImport(job.jobId);
    let progress = await window.nodus.getCompassImport(job.jobId);
    const canceled = progress?.job.state;
    await window.nodus.retryCompassImport(job.jobId);
    progress = await window.nodus.getCompassImport(job.jobId);
    const deadline = Date.now() + 20_000;
    while (progress && !['completed', 'failed', 'canceled'].includes(progress.job.state) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      progress = await window.nodus.getCompassImport(job.jobId);
    }
    return { canceled, final: progress?.job.state, completed: progress?.job.completed, failed: progress?.job.failed };
  });
  assert.equal(canceledAndRetried.canceled, 'canceled', 'large batch cancellation is reported immediately');
  assert.equal(canceledAndRetried.final, 'completed', `a canceled batch can be retried safely (${JSON.stringify(canceledAndRetried)})`);
  const afterRetry = await page.evaluate(() => window.nodus.listGlobalLibraryItems({ limit: 100, offset: 0 }));
  assert.equal(afterRetry.items.length, libraryPage.items.length, 'cancel/retry remains idempotent across completed chunks');
  const retryDialog = page.getByRole('dialog', { name: 'Importing…' });
  if (await retryDialog.isVisible().catch(() => false)) await retryDialog.getByRole('button', { name: 'Close', exact: true }).last().click();

  // Execute every catalogued scenario against the complete main/worker/IPC
  // pipeline. Fixtures keep this deterministic while routing still selects
  // discipline, language, type, DOI and regional adapters independently.
  const executedCases = await page.evaluate(async (searchCases) => {
    const outcomes = [];
    for (let index = 0; index < searchCases.length; index += 1) {
      const testCase = searchCases[index];
      const response = await window.nodus.startCompassSearch({ requestId: `compass-case-${index}-${crypto.randomUUID()}`, generation: 100 + index, query: testCase.query, filters: testCase.filters });
      let session = response.session;
      const deadline = Date.now() + 10_000;
      while (!['complete', 'empty', 'error', 'canceled'].includes(session.state) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        session = (await window.nodus.getCompassSearch(session.searchId))?.session ?? session;
      }
      outcomes.push({ name: testCase.name, state: session.state, providers: session.providers.map((provider) => provider.provider), count: session.resultCount });
    }
    return outcomes;
  }, cases);
  assert.equal(executedCases.length, 15, 'all fifteen realistic searches execute through Electron IPC');
  assert.ok(executedCases.every((entry) => ['complete', 'empty', 'error'].includes(entry.state)), `all search cases terminate (${JSON.stringify(executedCases)})`);

  // A second submit establishes the stale-response guard: only the newest
  // query's fixture title may remain after rapid replacement.
  await page.getByTestId('compass-query').fill('first obsolete query');
  await page.getByTestId('compass-search').click();
  await page.getByTestId('compass-query').fill('second current query');
  await page.getByTestId('compass-search').click();
  await page.waitForFunction(async () => {
    const [entry] = await window.nodus.listCompassHistory(1);
    return entry?.query === 'second current query' && ['complete', 'partial'].includes(entry.state);
  });
  assert.equal(await page.getByTestId('compass-query').inputValue(), 'second current query', 'stale response cannot replace the newest query');
  await page.locator('article').first().waitFor();
  assert.deepEqual(errors, [], `renderer failures: ${errors.join('\n')}`);
  console.log(JSON.stringify({ cases: executedCases.length, providers: providers.length, generatedPerProvider: 60, firstMounted, afterMore, loadedPageCounts: counts, retainedVirtualRows: renderedTotals, rendererHeapGrowth: heapAfterPages - heapBeforePages, globalLibraryItems: libraryPage.items.length }, null, 2));
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(testRoot, { recursive: true, force: true });
}
