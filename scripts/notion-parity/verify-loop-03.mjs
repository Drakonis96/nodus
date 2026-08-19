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
const marker = '--electron-loop-03';
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
const runId = `loop-03-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const exportDir = path.join(profile.profilePath, 'exports');
const axePath = require.resolve('axe-core/axe.min.js');
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const report = {
  format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 3, runId,
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
    NODUS_QA_DATABASE_QUERY_DELAY_MS: '700',
    NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available',
    NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
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

let app = null;
let vault;
let ids;
const databaseName = `Paginación QA ${runId}`;
try {
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/test-database-row-query.mjs')], { cwd: repoRoot, stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/test-ipc-contract.mjs')], { cwd: repoRoot, stdio: 'inherit' });
  gate('Unidad, SQLite y contrato IPC', 'passed', 'Filtro recursivo, cursor, mutaciones, keyset bidireccional e IPC.');
  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }
  gate('Build y typecheck', 'passed', skipBuild ? 'Build existente reutilizada.' : 'npm run build completado.');

  let page;
  ({ app, page } = await launchApp());
  vault = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Bucle 3 · paginación', type: 'databases' });
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

  const fixtureRows = Array.from({ length: 1_200 }, (_, index) => [
    `Fila ${String(index).padStart(6, '0')}`,
    String(index),
    index % 2 === 0 ? 'true' : 'false',
    `2026-08-${String((index % 28) + 1).padStart(2, '0')}`,
    index % 3 === 0 ? 'B' : 'A',
  ]);
  ids = await page.evaluate(async ({ name, rows }) => {
    const database = await window.nodus.createDatabaseFromCsv(
      name, ['Nombre', 'Índice', 'Activo', 'Fecha', 'Grupo'], rows,
      ['title', 'number', 'checkbox', 'date', 'select'],
    );
    const detail = await window.nodus.getDatabaseDetail(database.id);
    const title = detail.columns.find((column) => column.type === 'title');
    const number = detail.columns.find((column) => column.type === 'number');
    if (!title || !number) throw new Error('Fixture paginado incompleto.');
    const view = await window.nodus.createDatabaseView(database.id, {
      name: 'Últimas 100', layout: 'table',
      filter: { conjunction: 'and', conditions: [{ id: 'last', columnId: number.id, op: 'gte', value: '1100' }] },
      sorts: [{ columnId: number.id, dir: 'desc' }],
    });
    await window.nodus.createDatabaseView(database.id, {
      name: 'Error QA', layout: 'table',
      filter: { conjunction: 'and', conditions: [{ id: 'broken', columnId: number.id, op: 'qa_invalid_operator', value: '1' }] },
      sorts: [],
    });
    let cursor = null;
    const seen = [];
    let largestPayload = 0;
    do {
      const result = await window.nodus.queryDatabaseRows({ databaseId: database.id, cursor, limit: 999 });
      largestPayload = Math.max(largestPayload, result.rows.length);
      seen.push(...result.rows.map((row) => row.id));
      cursor = result.nextCursor;
    } while (cursor);
    const viewPage = await window.nodus.queryDatabaseRows({ databaseId: database.id, viewId: view.id, limit: 500 });
    const exported = await window.nodus.exportDatabase(database.id, 'json');
    return { databaseId: database.id, viewId: view.id, titleId: title.id, numberId: number.id, seen, largestPayload, viewCount: viewPage.totalCount, exported };
  }, { name: databaseName, rows: fixtureRows });
  assert.equal(ids.seen.length, 1_200);
  assert.equal(new Set(ids.seen).size, 1_200);
  assert.equal(ids.largestPayload, 500);
  assert.equal(ids.viewCount, 100);
  assert.ok(ids.exported.path.startsWith(exportDir));
  gate('Aplicación real y payload acotado', 'passed', '1.200 filas exactas; payload máximo 500; vista filtrada 100; exportación JSON.');

  await page.reload();
  await page.getByRole('button', { name: databaseName, exact: true }).first().click();
  await page.getByText('Fila 000000', { exact: true }).first().waitFor();
  const scroller = page.locator('[data-tour="db-table"] .overflow-y-auto').last();
  await scroller.waitFor();
  report.metrics.initialVirtualHeight = await scroller.evaluate((element) => element.scrollHeight);
  assert.ok(report.metrics.initialVirtualHeight <= 200 * 40 + 2);
  for (let pageIndex = 0; pageIndex < 6; pageIndex += 1) {
    await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
    // The guarded QA bridge holds each query for 700 ms so every iteration must
    // finish before the next scroll can request another cursor.
    await page.waitForTimeout(1_000);
  }
  await page.getByText('Fila 001199', { exact: true }).first().waitFor();
  report.metrics.maxWindowVirtualHeight = await scroller.evaluate((element) => element.scrollHeight);
  report.metrics.renderedRowControls = await page.getByTitle('Abrir ficha').count();
  assert.ok(report.metrics.maxWindowVirtualHeight <= 1_000 * 40 + 2, 'the UI retains at most five 200-row pages');
  assert.ok(report.metrics.renderedRowControls < 80, 'the DOM remains virtualized');

  await scroller.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(1_000);
  const preservedTop = await scroller.evaluate((element) => element.scrollTop);
  assert.ok(preservedTop > 0, 'prepending a discarded page preserves the visible anchor');
  await scroller.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await page.getByText('Fila 000000', { exact: true }).first().waitFor();
  gate('Scroll progresivo y descarte', 'passed', `Ventana ≤${report.metrics.maxWindowVirtualHeight}px; ${report.metrics.renderedRowControls} filas DOM; ancla=${preservedTop}px.`);

  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }]) {
    for (const theme of ['light', 'dark']) await capture(page, 'paged-grid', theme, viewport.width, viewport.height);
  }
  await auditA11y(page, 'paged-grid');

  // The preload adds deterministic latency only when the guarded QA root is active.
  await page.getByRole('button', { name: 'Últimas 100', exact: true }).click();
  await page.getByText('Cargando…', { exact: true }).waitFor();
  await capture(page, 'loading', 'light', 1024, 768);
  await page.getByText(/100 filtradas/).waitFor();
  assert.equal(await page.getByText('Fila 001199', { exact: true }).first().isVisible(), true);

  // A deliberately malformed saved view exercises the real validation/IPC error path.
  await page.getByRole('button', { name: 'Error QA', exact: true }).click();
  await page.getByTestId('database-query-error').waitFor();
  for (const theme of ['light', 'dark']) await capture(page, 'error', theme, 1024, 768);
  await auditA11y(page, 'paged-error');
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await page.getByTestId('database-query-error').waitFor();
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  await page.getByText('Fila 000000', { exact: true }).first().waitFor();
  await capture(page, 'narrow', 'light', 390, 844);
  gate('Estados y QA visual', 'passed', 'Vacío, poblado, cargando y error; claro/oscuro; 1440/1024/390; axe AA.');
  gate('Permisos y conflicto visual', 'not-applicable', 'El conflicto de revisión se prueba en repositorio; sus superficies UI llegan con ACL/colaboración.');

  await closeApp(app);
  app = null;
  ({ app, page } = await launchApp());
  const reopened = await page.evaluate(async ({ databaseId, titleId }) => {
    const result = await window.nodus.queryDatabaseRows({ databaseId, limit: 200 });
    return { total: result.totalCount, first: result.rows[0]?.cells[titleId], payload: result.rows.length };
  }, ids);
  assert.deepEqual(reopened, { total: 1_200, first: 'Fila 000000', payload: 200 });
  gate('Cierre y reapertura real', 'passed', '1.200 filas; primera página 200; orden estable.');
  await closeApp(app);
  app = null;

  const Database = require('better-sqlite3');
  const sqlite = new Database(vault.path, { readonly: true, fileMustExist: true });
  report.metrics.quickCheck = sqlite.pragma('quick_check', { simple: true });
  report.metrics.foreignKeyViolations = sqlite.pragma('foreign_key_check').length;
  report.metrics.offsetPlans = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name IN ('db_rows','db_cells') ORDER BY name").all();
  assert.equal(report.metrics.quickCheck, 'ok');
  assert.equal(report.metrics.foreignKeyViolations, 0);
  sqlite.close();

  const exported = JSON.parse(await readFile(ids.exported.path, 'utf8'));
  assert.equal(exported.rows.length, 1_200);
  report.databaseAudit = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []);
  assert.deepEqual(report.console.errors.filter((message) => !/favicon|Autofill/i.test(message)), []);
  gate('Integridad, exportación, aislamiento y consola', 'passed', `${report.databaseAudit.length} aperturas QA; quick_check=ok; exportación 1.200; consola limpia.`);
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
  console.log(`Loop 3 report: ${paths.htmlPath}`);
  await profile.cleanup();
}
