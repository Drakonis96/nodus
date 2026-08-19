#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

import { prepareQaProfile } from './qa-paths.mjs';
import { writeNotionParityReport } from './report.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const marker = '--electron-loop-04';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker, ...process.argv.slice(2)], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const option = (name) => {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
};
const retain = process.argv.includes('--retain');
const skipBuild = process.argv.includes('--skip-build');
const runId = `loop-04-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const exportDir = path.join(profile.profilePath, 'exports');
const axePath = require.resolve('axe-core/axe.min.js');
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const report = {
  format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 4, runId,
  startedAt: new Date().toISOString(), finishedAt: null, outcome: 'running',
  profile: { path: profile.profilePath, qaRoot: profile.qaRoot, retained: profile.retained },
  gates: [], metrics: {}, screenshots: [], accessibility: [],
  console: { errors: [], pageErrors: [] }, databaseAudit: [], failure: null,
};
const gate = (name, status, detail = '') => report.gates.push({ name, status, detail });

function environment() {
  const env = {
    ...process.env, NODUS_USERDATA: profile.profilePath, NODUS_QA_ROOT: profile.qaRoot,
    NODUS_QA_DATABASE_AUDIT_LOG: auditFile, NODUS_QA_EXPORT_DIR: exportDir,
    NODUS_QA_DATABASE_COMPUTE_DELAY_MS: '1000', NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function closeApp(app) {
  if (!app) return;
  const child = app.process();
  let timer;
  const closed = await Promise.race([
    app.close().then(() => true, () => false),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), 5_000); }),
  ]);
  clearTimeout(timer);
  if (!closed && child.exitCode === null && !child.killed) child.kill('SIGKILL');
}

async function launchApp() {
  const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: environment() });
  let timer;
  const page = await Promise.race([
    app.firstWindow(),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Electron no abrió la ventana QA.')), 30_000); }),
  ]).finally(() => clearTimeout(timer));
  page.setDefaultTimeout(30_000);
  await page.addInitScript({ path: axePath });
  page.on('pageerror', (error) => report.console.pageErrors.push(String(error?.stack ?? error)));
  page.on('console', (message) => { if (message.type() === 'error') report.console.errors.push(message.text()); });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate(async (version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    await window.nodus.updateSettings({
      onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1,
      tourComplete: true, advancedTourComplete: true, databasesTourComplete: true,
      mascotEnabled: false, theme: 'light', uiLanguage: 'es',
    });
  }, appVersion);
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  return { app, page };
}

async function capture(page, label, theme, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate((value) => window.nodus.updateSettings({ theme: value }), theme);
  await page.waitForFunction((value) => document.documentElement.classList.contains('dark') === (value === 'dark'), theme);
  await page.waitForTimeout(120);
  const file = path.join(outputDir, `${label}-${theme}-${width}x${height}.png`);
  await page.screenshot({ path: file });
  const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `${label} desborda a ${width}px/${theme}`);
  report.screenshots.push({ label, theme, viewport: `${width}x${height}`, path: file, layout });
}

async function auditA11y(page, label) {
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document.querySelector('main') ?? document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    });
    return result.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.slice(0, 10).map((node) => node.target) }));
  });
  report.accessibility.push({ label, violations });
  assert.deepEqual(violations.filter((item) => item.impact === 'critical' || item.impact === 'serious'), []);
}

async function waitCalculation(page, databaseId, statuses, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let current = null;
  while (Date.now() < deadline) {
    current = await page.evaluate((id) => window.nodus.getDatabaseCalculationStatus(id), databaseId);
    if (current && statuses.includes(current.status)) return current;
    await page.waitForTimeout(100);
  }
  throw new Error(`El cálculo no alcanzó ${statuses.join('/')} (último estado: ${current?.status ?? 'ninguno'}).`);
}

let app = null;
let vault;
let fixture;
const databaseName = `Índices QA ${runId}`;
try {
  for (const script of ['test-database-indexing.mjs', 'test-database-analysis.mjs', 'test-databases.mjs', 'test-ipc-contract.mjs']) {
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts', script)], { cwd: repoRoot, stdio: 'inherit' });
  }
  gate('Unidad, SQLite e IPC', 'passed', 'FTS, índices tipados, dependencias, perfil SQL, streaming y contratos públicos.');
  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'databaseComputeWorker.cjs'))) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }
  assert.ok(fs.existsSync(path.join(repoRoot, 'dist-electron', 'databaseComputeWorker.cjs')));
  gate('Typecheck, build y worker', 'passed', 'Worker dedicado empaquetado en dist-electron.');

  let page;
  ({ app, page } = await launchApp());
  vault = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Bucle 4 · índices y cálculo', type: 'databases' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({
      onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1,
      tourComplete: true, advancedTourComplete: true, databasesTourComplete: true,
      mascotEnabled: false, theme: 'light', uiLanguage: 'es',
    });
    return created.vault;
  });
  assert.ok(path.resolve(vault.path).startsWith(path.resolve(profile.profilePath) + path.sep));
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await capture(page, 'empty', 'light', 1440, 1000);

  const rows = Array.from({ length: 3_000 }, (_, index) => [
    `Expediente ${String(index).padStart(5, '0')}`,
    `evidencia común lote-${index % 41}`,
    String(index % 997),
    `2026-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
  ]);
  fixture = await page.evaluate(async ({ name, values }) => {
    const database = await window.nodus.createDatabaseFromCsv(name, ['Nombre', 'Texto', 'Importe', 'Fecha'], values, ['title', 'text', 'number', 'date']);
    let detail = await window.nodus.getDatabaseDetail(database.id);
    const amount = detail.columns.find((column) => column.type === 'number');
    if (!amount) throw new Error('No se creó la columna numérica.');
    const total = await window.nodus.createDatabaseColumn(database.id, 'Importe + 10', 'formula', {
      formula: { kind: 'arithmetic', op: 'add', operands: [
        { kind: 'column', columnId: amount.id }, { kind: 'number', value: 10 },
      ] },
    });
    detail = await window.nodus.getDatabaseDetail(database.id);
    const started = performance.now();
    const first = await window.nodus.queryDatabaseRows({ databaseId: database.id, limit: 200 });
    const firstPageMs = performance.now() - started;
    const ftsStarted = performance.now();
    const search = await window.nodus.searchDatabaseRowsPage({ query: 'evidencia común', limit: 80 });
    const ftsMs = performance.now() - ftsStarted;
    const profileStarted = performance.now();
    const profile = await window.nodus.getDatabaseProfile(database.id);
    const profileMs = performance.now() - profileStarted;
    const analysis = await window.nodus.runDatabaseAnalysis(database.id, { kind: 'descriptive', columns: [amount.id] });
    const exports = [];
    for (const format of ['csv', 'json', 'xlsx']) exports.push(await window.nodus.exportDatabase(database.id, format));
    return { databaseId: database.id, amountId: amount.id, formulaId: total.id, first, search, profile, analysis, exports, firstPageMs, ftsMs, profileMs, columnCount: detail.columns.length };
  }, { name: databaseName, values: rows });
  assert.equal(fixture.first.totalCount, 3_000);
  assert.equal(fixture.first.rows.length, 200);
  assert.equal(fixture.search.hits.length, 80);
  assert.equal(fixture.profile.profile.rowCount, 3_000);
  assert.equal(fixture.analysis.result.kind, 'descriptive');
  for (const exported of fixture.exports) {
    assert.equal(exported.canceled, false);
    assert.ok(exported.path.startsWith(exportDir));
    assert.deepEqual(exported.metrics.rows, 3_000);
    assert.ok(exported.metrics.maxPageRows <= 500);
  }
  Object.assign(report.metrics, { firstPageMs: fixture.firstPageMs, ftsMs: fixture.ftsMs, profileMs: fixture.profileMs, exportMaxPageRows: 500 });
  gate('Datos, FTS, análisis y exportación reales', 'passed', '3.000 filas; FTS paginada; perfil SQL; análisis vectorial; CSV/JSON/XLSX con páginas ≤500.');

  await page.reload();
  await page.getByRole('button', { name: databaseName, exact: true }).first().click();
  await page.getByText('Expediente 00000', { exact: true }).first().waitFor();
  assert.ok(await page.getByTitle('Recalcular fórmulas y rollups').isVisible());
  await page.getByTitle('Recalcular fórmulas y rollups').click();
  await page.getByRole('status').filter({ hasText: 'Actualizando fórmulas y rollups' }).waitFor();
  // Progress updates intentionally replace the status banner; force targets the visible
  // button immediately instead of Playwright waiting for a motionless DOM generation.
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click({ force: true });
  const cancelled = await waitCalculation(page, fixture.databaseId, ['cancelled']);
  assert.equal(cancelled.status, 'cancelled');
  const restarted = await page.evaluate((id) => window.nodus.recalculateDatabase(id), fixture.databaseId);
  assert.ok(restarted.jobId);
  await page.getByRole('status').filter({ hasText: 'Actualizando fórmulas y rollups' }).waitFor();
  await capture(page, 'calculation-running', 'light', 1440, 1000);
  await capture(page, 'calculation-running', 'dark', 1024, 768);
  const completed = await waitCalculation(page, fixture.databaseId, ['completed', 'failed'], 45_000);
  assert.equal(completed.status, 'completed', completed.message ?? 'el cálculo no terminó');
  assert.equal(completed.done, completed.total);
  gate('Worker, progreso y cancelación', 'passed', `Cancelación atómica y reintento completo: ${completed.done}/${completed.total}.`);

  await page.locator('[data-tour="nav-dbSearch"]').click();
  const searchInput = page.getByPlaceholder('Escribe para buscar…');
  await searchInput.fill('evidencia común');
  const rowResults = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Filas', exact: true }) }).locator('button');
  await rowResults.first().waitFor();
  assert.ok(await rowResults.count() >= 80, 'la primera página visual contiene 80 resultados FTS');
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }]) {
    for (const theme of ['light', 'dark']) await capture(page, 'fts-results', theme, viewport.width, viewport.height);
  }
  await auditA11y(page, 'fts-results');
  await searchInput.fill('sin-coincidencia-qa-irrepetible');
  await page.getByText('Sin coincidencias.', { exact: true }).waitFor();
  await capture(page, 'search-empty', 'light', 390, 844);
  await auditA11y(page, 'fts-empty');
  gate('QA visual y accesibilidad', 'passed', 'Cálculo, resultados y vacío; claro/oscuro; 1440/1024/390; WCAG AA; sin desbordamiento.');
  gate('Sin permisos y conflicto', 'not-applicable', 'Las superficies ACL y conflicto se incorporan en los bucles 16 y 17.');

  await closeApp(app);
  app = null;
  ({ app, page } = await launchApp());
  const reopened = await page.evaluate(async ({ databaseId, formulaId }) => {
    const page = await window.nodus.queryDatabaseRows({ databaseId, limit: 200 });
    return { total: page.totalCount, formula: page.rows[0]?.cells[formulaId], status: await window.nodus.getDatabaseCalculationStatus(databaseId) };
  }, fixture);
  assert.equal(reopened.total, 3_000);
  assert.equal(reopened.formula, '10');
  assert.equal(reopened.status.status, 'completed');
  gate('Cierre y reapertura', 'passed', '3.000 filas, proyección calculada y estado del trabajo persistidos.');
  await closeApp(app);
  app = null;

  const Database = require('better-sqlite3');
  const sqlite = new Database(vault.path, { readonly: true, fileMustExist: true });
  report.metrics.quickCheck = sqlite.pragma('quick_check', { simple: true });
  report.metrics.foreignKeyViolations = sqlite.pragma('foreign_key_check').length;
  report.metrics.ftsRows = sqlite.prepare('SELECT COUNT(*) AS count FROM db_search_fts WHERE database_id = ?').get(fixture.databaseId).count;
  report.metrics.computedRows = sqlite.prepare('SELECT COUNT(*) AS count FROM db_computed_cells WHERE database_id = ? AND column_id = ?').get(fixture.databaseId, fixture.formulaId).count;
  report.metrics.numberPlan = sqlite.prepare('EXPLAIN QUERY PLAN SELECT row_id FROM db_cells WHERE database_id=? AND column_id=? AND value_number>?').all(fixture.databaseId, fixture.amountId, 500);
  assert.equal(report.metrics.quickCheck, 'ok');
  assert.equal(report.metrics.foreignKeyViolations, 0);
  assert.equal(report.metrics.computedRows, 3_000);
  assert.match(JSON.stringify(report.metrics.numberPlan), /idx_db_cells_number_value/);
  sqlite.close();

  const jsonExport = fixture.exports.find((item) => item.path.endsWith('.json'));
  assert.equal(JSON.parse(await readFile(jsonExport.path, 'utf8')).rows.length, 3_000);
  report.databaseAudit = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []);
  assert.deepEqual(report.console.errors.filter((message) => !/favicon|Autofill/i.test(message)), []);
  gate('Integridad, aislamiento y consola', 'passed', `${report.databaseAudit.length} aperturas QA; quick_check=ok; FK=0; índices y proyecciones completas; consola limpia.`);
  report.outcome = 'passed';
} catch (error) {
  report.outcome = 'failed';
  report.failure = String(error?.stack ?? error);
  gate('Resultado', 'failed', report.failure);
  throw error;
} finally {
  await closeApp(app);
  report.finishedAt = new Date().toISOString();
  const paths = await writeNotionParityReport(outputDir, report);
  console.log(`Loop 4 report: ${paths.htmlPath}`);
  await profile.cleanup();
}
