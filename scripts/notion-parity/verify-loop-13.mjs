#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { prepareQaProfile } from './qa-paths.mjs';
import { writeNotionParityReport } from './report.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const require = createRequire(import.meta.url);
const marker = '--electron-loop-13';
if (!process.argv.includes(marker)) { execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker, ...process.argv.slice(2)],
  { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }); process.exit(0); }
const option = (name) => { const inline = process.argv.find((value) => value.startsWith(`--${name}=`)); if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : null; };
const retain = process.argv.includes('--retain'); const skipBuild = process.argv.includes('--skip-build');
const runId = `loop-13-${new Date().toISOString().replace(/[:.]/g, '-')}`; const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports/notion-parity', runId)); await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl'); const axePath = require.resolve('axe-core/axe.min.js'); const appVersion = require(path.join(repoRoot, 'package.json')).version;
const report = { format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 13, runId, startedAt: new Date().toISOString(), finishedAt: null,
  outcome: 'running', profile: { path: profile.profilePath, qaRoot: profile.qaRoot, retained: profile.retained }, gates: [], metrics: {}, screenshots: [], accessibility: [],
  console: { errors: [], pageErrors: [] }, databaseAudit: [], failure: null };
const gate = (name, status, detail = '') => report.gates.push({ name, status, detail }); let app = null; let vault; let fixture;
function environment() { const env = { ...process.env, NODUS_USERDATA: profile.profilePath, NODUS_QA_ROOT: profile.qaRoot,
  NODUS_QA_DATABASE_AUDIT_LOG: auditFile, NODUS_QA_DATABASE_QUERY_DELAY_MS: '900', NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' }; delete env.ELECTRON_RUN_AS_NODE; return env; }
async function closeApp(target) { if (!target) return; const child = target.process(); let timer; const closed = await Promise.race([
  target.close().then(() => true, () => false), new Promise((resolve) => { timer = setTimeout(() => resolve(false), 5_000); })]); clearTimeout(timer);
  if (!closed && child.exitCode === null && !child.killed) child.kill('SIGKILL'); }
async function launchApp() { const target = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: environment() });
  const page = await target.firstWindow(); page.setDefaultTimeout(45_000); await page.addInitScript({ path: axePath });
  page.on('pageerror', (error) => report.console.pageErrors.push(String(error?.stack ?? error)));
  page.on('console', (message) => { if (message.type() === 'error') report.console.errors.push(message.text()); });
  await page.waitForLoadState('domcontentloaded'); await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate(async (version) => { localStorage.setItem('nodus.lastSeenVersion', version); localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1'); localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1'); sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1, firstVaultVersion: 1,
      tourComplete: true, advancedTourComplete: true, databasesTourComplete: true, mascotEnabled: false, theme: 'light', uiLanguage: 'es' }); }, appVersion);
  await page.reload(); await page.getByTestId('app-shell').waitFor(); return { app: target, page }; }
async function openWiki(page, title) { await page.locator('[data-tour="nav-pages"]').click(); await page.getByTestId('page-wiki-view').waitFor();
  if (title) { await page.getByRole('tree').getByRole('button', { name: title, exact: true }).click(); await page.getByTestId('page-block-editor').waitFor(); } }
async function capture(page, label, theme, width, height, locator = null) { await page.setViewportSize({ width, height }); await page.evaluate((value) => window.nodus.updateSettings({ theme: value }), theme);
  await page.waitForFunction((value) => document.documentElement.classList.contains('dark') === (value === 'dark'), theme); if (locator) await locator.scrollIntoViewIfNeeded(); await page.waitForTimeout(180);
  const file = path.join(outputDir, `${label}-${theme}-${width}x${height}.png`); await page.screenshot({ path: file }); const layout = await page.evaluate(() => ({ viewport: innerWidth,
    document: document.documentElement.scrollWidth, body: document.body.scrollWidth })); assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `${label} desborda`);
  report.screenshots.push({ label, theme, viewport: `${width}x${height}`, path: file, layout }); }
async function auditA11y(page, label) { const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } }))
  .violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.slice(0, 12).map((node) => node.target) }))); report.accessibility.push({ label, violations });
  assert.deepEqual(violations.filter((item) => item.impact === 'critical' || item.impact === 'serious'), []); }

try {
  for (const script of ['test-database-sources.mjs','test-database-row-query.mjs','test-pages.mjs','test-ipc-contract.mjs','test-i18n-coverage.mjs'])
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts', script)], { cwd: repoRoot, stdio: 'inherit' });
  gate('Unidad, SQLite, contratos e i18n', 'passed', 'Migración, mapeo tipado, paginación compuesta, bloques, IPC y ocho idiomas.');
  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  gate('Typecheck y build', 'passed', skipBuild ? 'Build de esta revisión reutilizado.' : 'npm run build completado.');

  let page; ({ app, page } = await launchApp()); vault = await page.evaluate(async () => { const created = await window.nodus.createVault({ name: 'Bucle 13 · fuentes', type: 'databases' });
    const switched = await window.nodus.switchVault(created.vault.id); if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1, firstVaultVersion: 1,
      tourComplete: true, advancedTourComplete: true, databasesTourComplete: true, mascotEnabled: false, theme: 'light', uiLanguage: 'es' });
    return created.vault; });
  assert.ok(path.resolve(vault.path).startsWith(path.resolve(profile.profilePath) + path.sep)); await page.reload();
  try { await page.getByTestId('app-shell').waitFor(); } catch (error) {
    const diagnosticPath = path.join(outputDir, 'post-switch-diagnostic.png'); await page.screenshot({ path: diagnosticPath }).catch(() => undefined);
    report.screenshots.push({ label: 'post-switch-diagnostic', theme: 'light', viewport: 'current', path: diagnosticPath, layout: {} });
    report.metrics.postSwitchDiagnostic = await page.evaluate(() => ({ url: location.href, title: document.title,
      body: document.body?.innerText?.slice(0, 4_000), html: document.getElementById('root')?.innerHTML.slice(0, 4_000) })).catch((cause) => ({ evaluateError: String(cause) }));
    throw error;
  }
  fixture = await page.evaluate(async () => {
    const makeRows = (prefix) => Array.from({ length: 60 }, (_, index) => [`${index % 2 ? 'Beta' : 'Alpha'} ${prefix} ${String(index).padStart(3, '0')}`, index % 3 ? 'Activo' : 'Pendiente']);
    const first = await window.nodus.createDatabaseFromCsv('Proyectos fuente', ['Nombre','Estado'], makeRows('Proyecto'), ['title','status']);
    const second = await window.nodus.createDatabaseFromCsv('Publicaciones fuente', ['Título','Fase'], makeRows('Editorial'), ['title','status']);
    const view = await window.nodus.createDatabaseView(first.id, { name: 'Portfolio unido', layout: 'table', filter: { conjunction: 'and', conditions: [] }, sorts: [],
      config: { layout: 'table', filter: null, sorts: [] } });
    const wiki = await window.nodus.createPage({ title: 'Fuentes enlazadas QA', icon: '🧩', fullWidth: true, blocks: [
      { id: 'linked-alpha', type: 'database_view', content: { viewId: view.id, titleFilter: 'Alpha' } },
      { id: 'linked-beta', type: 'database_view', content: { viewId: view.id, titleFilter: 'Beta' } },
      { id: 'linked-empty', type: 'database_view', content: { viewId: view.id, titleFilter: 'No existe QA' } },
      { id: 'linked-error', type: 'database_view', content: { viewId: 'view-inexistente-qa', titleFilter: '' } },
    ] });
    return { first, second, view, wikiPageId: wiki.page.id, viewRevision: view.revision };
  });
  gate('Vault y fixture por APIs reales', 'passed', 'Dos fuentes, 120 filas y cuatro bloques de página creados dentro del perfil QA.');

  await page.reload(); await openWiki(page, 'Fuentes enlazadas QA'); const alpha = page.getByTestId('page-block-linked-alpha').getByTestId('linked-database-block');
  await alpha.getByTestId('linked-database-loading').waitFor(); await capture(page, 'linked-loading', 'light', 1024, 768, alpha);
  await alpha.getByTestId('linked-database-rows').waitFor(); assert.equal(await alpha.locator('[data-source-id]').count(), 30);
  const details = alpha.locator('details'); await details.locator('summary').click(); await details.getByRole('combobox', { name: 'Añadir fuente' }).selectOption({ label: 'Publicaciones fuente' });
  await details.getByRole('button', { name: 'Añadir fuente', exact: true }).click(); await alpha.getByRole('tab', { name: 'Publicaciones fuente', exact: true }).waitFor();
  const attachedState = await page.evaluate(async ({ firstId, secondId, viewId, expectedRevision }) => {
    const definition = await window.nodus.getDatabaseContainer(viewId); const original = (await window.nodus.listDatabaseViews(firstId)).find((entry) => entry.id === viewId);
    const combined = await window.nodus.queryDatabaseContainerRows({ viewId, limit: 500 });
    return { sourceCount: definition.sources.length, propertySourceCounts: definition.properties.map((property) => [property.id, property.sources.length]),
      originalRevision: original.revision, config: original.config, combinedCount: combined.rows.length,
      identities: new Set(combined.rows.map((row) => row.id)).size, secondSource: definition.sources.find((source) => source.databaseId === secondId) };
  }, { firstId: fixture.first.id, secondId: fixture.second.id, viewId: fixture.view.id, expectedRevision: fixture.viewRevision });
  assert.equal(attachedState.sourceCount, 2); assert.equal(attachedState.combinedCount, 120); assert.equal(attachedState.identities, 120);
  assert.equal(attachedState.originalRevision, fixture.viewRevision); assert.equal(attachedState.config.filter, null);
  assert.ok(attachedState.propertySourceCounts.some(([id, count]) => id === 'status' && count === 2));
  gate('Contenedor y mapeo común', 'passed', 'La UI adjuntó la segunda fuente; 120 identidades y propiedades title/status mapeadas sin copiar filas.');

  await page.reload(); await openWiki(page, 'Fuentes enlazadas QA'); const blocks = page.getByTestId('linked-database-block'); await blocks.first().getByTestId('linked-database-rows').waitFor();
  assert.equal(await blocks.nth(0).locator('[data-source-id]').count(), 30); assert.equal(await blocks.nth(1).locator('[data-source-id]').count(), 30);
  assert.ok((await blocks.nth(0).locator('[data-source-id]').allTextContents()).every((text) => text.includes('Alpha')));
  assert.ok((await blocks.nth(1).locator('[data-source-id]').allTextContents()).every((text) => text.includes('Beta')));
  await blocks.nth(0).getByRole('tab', { name: 'Publicaciones fuente', exact: true }).click();
  await page.waitForFunction((sourceId) => [...document.querySelectorAll('[data-testid="page-block-linked-alpha"] [data-source-id]')]
    .every((element) => element.getAttribute('data-source-id') === sourceId), attachedState.secondSource.sourceId);
  await capture(page, 'linked-sources-wide', 'light', 1440, 1000, blocks.first()); await capture(page, 'linked-sources-responsive', 'dark', 1024, 768, blocks.first());
  await capture(page, 'linked-sources-mobile', 'light', 390, 844, blocks.first()); await auditA11y(page, 'linked-sources-mobile');
  gate('Filtros locales y pestañas', 'passed', 'Dos bloques comparten vista con filtros Alpha/Beta independientes; pestaña de fuente y móvil verificados.');

  const empty = page.getByTestId('page-block-linked-empty').getByTestId('linked-database-block'); await empty.getByTestId('linked-database-empty').waitFor();
  await capture(page, 'linked-empty', 'dark', 1024, 768, empty); const broken = page.getByTestId('page-block-linked-error').getByTestId('linked-database-block');
  await broken.getByTestId('linked-database-error').waitFor(); await capture(page, 'linked-error', 'light', 1024, 768, broken);
  const exported = await page.evaluate(async (pageId) => { const value = await window.nodus.exportPageMarkdown(pageId); const copy = await window.nodus.createPage({ title: 'Restauración fuentes QA' });
    const restored = await window.nodus.replacePageFromMarkdown(copy.page.id, value.markdown, copy.revision); return { value, restored }; }, fixture.wikiPageId);
  assert.match(exported.value.markdown, /nodus:database-view/); assert.equal(exported.restored.ok, true);
  assert.equal(exported.restored.document.blocks.filter((block) => block.type === 'database_view').length, 4);
  assert.equal(exported.restored.document.blocks[0].content.titleFilter, 'Alpha'); gate('Vacío, error y restauración', 'passed', 'Estados diferenciados y cuatro bloques reconstruidos semánticamente desde Markdown.');

  await page.setViewportSize({ width: 1024, height: 768 }); await page.evaluate(async (id) => {
    const current = await window.nodus.getPageDocument(id); if (!current) throw new Error('Página QA ausente antes del conflicto.');
    const result = await window.nodus.savePageDocument({ pageId: id, expectedRevision: current.revision,
      blocks: current.blocks.map((block) => ({ id: block.id, parentBlockId: block.parentBlockId, order: block.order, type: block.type, content: block.content })),
      reason: 'qa-external-edit' });
    if (!result.ok) throw new Error('No se pudo preparar el conflicto QA.');
  }, fixture.wikiPageId);
  await blocks.nth(0).getByRole('textbox', { name: 'Filtrar título' }).fill('Alpha Proyecto'); await page.getByTestId('page-conflict').waitFor();
  await capture(page, 'linked-conflict', 'dark', 1024, 768, page.getByTestId('page-conflict')); await page.reload(); await openWiki(page, 'Fuentes enlazadas QA');
  const lockPage = await page.evaluate((id) => window.nodus.getPage(id), fixture.wikiPageId); await page.evaluate(({ id, revision }) => window.nodus.updatePage(id, { locked: true }, revision),
    { id: fixture.wikiPageId, revision: lockPage.revision }); await page.reload(); await openWiki(page, 'Fuentes enlazadas QA');
  await page.getByText('Esta página está bloqueada y se muestra en modo lectura.', { exact: true }).waitFor(); assert.equal(await page.getByRole('combobox', { name: 'Selecciona una vista' }).first().isDisabled(), true);
  await capture(page, 'linked-locked', 'dark', 1024, 768, page.getByTestId('linked-database-block').first()); gate('Conflicto y sólo lectura', 'passed', 'Conflicto de revisión explícito y controles de fuentes desactivados en página bloqueada.');

  await closeApp(app); app = null; ({ app, page } = await launchApp()); const reopened = await page.evaluate(async (viewId) => ({
    definition: await window.nodus.getDatabaseContainer(viewId), page: await window.nodus.queryDatabaseContainerRows({ viewId, limit: 500 }),
  }), fixture.view.id); assert.equal(reopened.definition.sources.length, 2); assert.equal(reopened.page.rows.length, 120); await closeApp(app); app = null;
  gate('Cierre y reapertura', 'passed', 'Dos fuentes, mapeos y 120 identidades rehidratados desde SQLite real.');

  const Database = require('better-sqlite3'); const sqlite = new Database(vault.path, { readonly: true, fileMustExist: true });
  Object.assign(report.metrics, { quickCheck: sqlite.pragma('quick_check', { simple: true }), foreignKeyViolations: sqlite.pragma('foreign_key_check').length,
    dataSources: sqlite.prepare('SELECT COUNT(*) AS n FROM db_data_sources').get().n, viewSources: sqlite.prepare('SELECT COUNT(*) AS n FROM db_view_sources WHERE view_id=?').get(fixture.view.id).n,
    linkedBlocks: sqlite.prepare("SELECT COUNT(*) AS n FROM page_blocks WHERE type='database_view'").get().n, combinedRows: reopened.page.rows.length, maxPayload: 500 }); sqlite.close();
  assert.equal(report.metrics.quickCheck, 'ok'); assert.equal(report.metrics.foreignKeyViolations, 0); assert.equal(report.metrics.viewSources, 2);
  report.databaseAudit = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(report.databaseAudit.length > 0); assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []); assert.deepEqual(report.console.errors.filter((message) => !/favicon|Autofill/i.test(message)), []);
  gate('Integridad, aislamiento y consola', 'passed', `${report.databaseAudit.length} aperturas QA; quick_check=ok; FK=0; consola limpia.`); report.outcome = 'passed';
} catch (error) { report.outcome = 'failed'; report.failure = String(error?.stack ?? error); gate('Resultado', 'failed', report.failure); throw error; }
finally { await closeApp(app); report.finishedAt = new Date().toISOString(); const paths = await writeNotionParityReport(outputDir, report);
  console.log(`Loop 13 report: ${paths.htmlPath}`); await profile.cleanup(); }
