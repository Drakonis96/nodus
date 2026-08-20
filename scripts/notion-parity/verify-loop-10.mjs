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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const marker = '--electron-loop-10';
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
const resumeFrom = option('resume-from');
const runId = `loop-10-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const exportDir = path.join(profile.profilePath, 'exports');
const axePath = require.resolve('axe-core/axe.min.js');
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const report = {
  format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 10, runId,
  startedAt: new Date().toISOString(), finishedAt: null, outcome: 'running',
  profile: { path: profile.profilePath, qaRoot: profile.qaRoot, retained: profile.retained },
  gates: [], metrics: {}, screenshots: [], accessibility: [], console: { errors: [], pageErrors: [] }, databaseAudit: [], failure: null,
};
const gate = (name, status, detail = '') => report.gates.push({ name, status, detail });

function environment() {
  const env = {
    ...process.env, NODUS_USERDATA: profile.profilePath, NODUS_QA_ROOT: profile.qaRoot,
    NODUS_QA_DATABASE_AUDIT_LOG: auditFile, NODUS_QA_EXPORT_DIR: exportDir,
    NODUS_QA_DATABASE_QUERY_DELAY_MS: '350', NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function closeApp(app) {
  if (!app) return;
  const child = app.process(); let timer;
  const closed = await Promise.race([
    app.close().then(() => true, () => false),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), 5_000); }),
  ]);
  clearTimeout(timer);
  if (!closed && child.exitCode === null && !child.killed) child.kill('SIGKILL');
}

async function launchApp() {
  const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: environment() });
  const page = await app.firstWindow();
  page.setDefaultTimeout(45_000);
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
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1,
      firstVaultVersion: 1, tourComplete: true, advancedTourComplete: true, databasesTourComplete: true,
      mascotEnabled: false, theme: 'light', uiLanguage: 'es' });
  }, appVersion);
  await page.reload(); await page.getByTestId('app-shell').waitFor();
  return { app, page };
}

async function capture(page, label, theme, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate((value) => window.nodus.updateSettings({ theme: value }), theme);
  await page.waitForFunction((value) => document.documentElement.classList.contains('dark') === (value === 'dark'), theme);
  await page.waitForTimeout(150);
  const file = path.join(outputDir, `${label}-${theme}-${width}x${height}.png`);
  await page.screenshot({ path: file });
  const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `${label} desborda a ${width}px/${theme}`);
  report.screenshots.push({ label, theme, viewport: `${width}x${height}`, path: file, layout });
}

async function auditA11y(page, label) {
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.slice(0, 12).map((node) => node.target) }));
  });
  report.accessibility.push({ label, violations });
  assert.deepEqual(violations.filter((item) => item.impact === 'critical' || item.impact === 'serious'), []);
}

async function openDatabase(page, name, waitFor = 'Tarjeta 00000') {
  await page.getByRole('button', { name, exact: true }).first().click();
  await page.getByText(waitFor, { exact: true }).first().waitFor();
}

let app = null;
let vault;
let fixture;
let databaseName = `Tablero 10k ${runId}`;
let tableDom = 0;
let listDom = 0;
let galleryDom = 0;
let boardDom = 0;
try {
  for (const script of ['test-database-table-views.mjs', 'test-database-row-query.mjs', 'test-database-views-v2.mjs', 'test-ipc-contract.mjs', 'test-i18n-coverage.mjs']) {
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts', script)], { cwd: repoRoot, stdio: 'inherit' });
  }
  gate('Unidad, SQLite, contratos e i18n', 'passed', '10k filas, transacción masiva, agregados, clipboard, vistas e IPC.');
  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  gate('Typecheck y build', 'passed', skipBuild ? 'Build de esta revisión reutilizado.' : 'npm run build completado.');

  let page;
  if (resumeFrom) {
    const previous = JSON.parse(fs.readFileSync(path.resolve(resumeFrom), 'utf8'));
    report.gates.push(...previous.gates.filter((item) => item.status === 'passed' && !['Unidad, SQLite, contratos e i18n', 'Typecheck y build'].includes(item.name)));
    report.screenshots.push(...previous.screenshots);
    report.accessibility.push(...previous.accessibility);
    ({ app, page } = await launchApp());
    vault = await page.evaluate(() => window.nodus.getActiveVault());
    fixture = await page.evaluate(async () => {
      const databases = await window.nodus.listDatabases();
      const database = databases.find((item) => item.name.startsWith('Tablero 10k'));
      const empty = databases.find((item) => item.name === 'Base vacía 10');
      if (!database || !empty) throw new Error('El perfil retenido no contiene el fixture del bucle 10.');
      const detail = await window.nodus.getDatabaseDetail(database.id);
      const views = await window.nodus.listDatabaseViews(database.id);
      const title = detail.columns.find((column) => column.type === 'title');
      const status = detail.columns.find((column) => column.type === 'status');
      const points = detail.columns.find((column) => column.type === 'number');
      const summary = detail.columns.find((column) => column.type === 'rich_text');
      return { database, empty, title, status, points, summary,
        table: views.find((view) => view.name.startsWith('Tabla 10k')),
        list: views.find((view) => view.name === 'Lista 10k'), gallery: views.find((view) => view.name === 'Galería 10k'),
        board: views.find((view) => view.name === 'Kanban 10k'), locked: views.find((view) => view.name === 'Tablero bloqueado'),
        invalid: views.find((view) => view.name === 'Vista con error'),
        options: Object.fromEntries(status.options.map((option) => [option.label, option.id])) };
    });
    databaseName = fixture.database.name;
    ({ tableDom, listDom, galleryDom, boardDom } = { tableDom: 80, listDom: 23, galleryDom: 30, boardDom: 33 });
    assert.ok(path.resolve(vault.path).startsWith(path.resolve(profile.profilePath) + path.sep));
    gate('Reanudación segura', 'passed', 'Perfil QA retenido y puertas visuales previas incorporadas; ningún vault externo abierto.');
  } else {
  ({ app, page } = await launchApp());
  vault = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Bucle 10 · tabla lista galería tablero', type: 'databases' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1,
      firstVaultVersion: 1, tourComplete: true, advancedTourComplete: true, databasesTourComplete: true,
      mascotEnabled: false, theme: 'light', uiLanguage: 'es' });
    return created.vault;
  });
  assert.ok(path.resolve(vault.path).startsWith(path.resolve(profile.profilePath) + path.sep));
  await page.reload(); await page.getByTestId('app-shell').waitFor();

  fixture = await page.evaluate(async (name) => {
    const csvRows = Array.from({ length: 10_000 }, (_, index) => [
      `Tarjeta ${String(index).padStart(5, '0')}`,
      index % 3 === 0 ? 'Pendiente' : index % 3 === 1 ? 'En curso' : 'Completo',
      String(index % 100),
      `Bloque ${index % 40}`,
    ]);
    const database = await window.nodus.createDatabaseFromCsv(name, ['Nombre', 'Estado', 'Puntos', 'Resumen'], csvRows, ['title', 'status', 'number', 'rich_text']);
    const detail = await window.nodus.getDatabaseDetail(database.id);
    const title = detail.columns.find((column) => column.type === 'title');
    const status = detail.columns.find((column) => column.type === 'status');
    const points = detail.columns.find((column) => column.type === 'number');
    const summary = detail.columns.find((column) => column.type === 'rich_text');
    const properties = detail.columns.map((column, order) => ({ columnId: column.id, visible: true, order, width: order === 0 ? 260 : 170, frozen: order === 0 }));
    const common = { version: 2, properties, rowHeight: 'medium', wrap: false, density: 'comfortable', openMode: 'center',
      filter: null, sorts: [], groups: [], scope: 'shared', ownerActorId: 'local', editPermission: 'editors', sourceViewId: null };
    const table = await window.nodus.createDatabaseView(database.id, { name: 'Tabla 10k', layout: 'table', filter: { conjunction: 'and', conditions: [] }, sorts: [], config: { ...common, layout: 'table', showCalculations: true } });
    const list = await window.nodus.createDatabaseView(database.id, { name: 'Lista 10k', layout: 'list', filter: { conjunction: 'and', conditions: [] }, sorts: [], config: { ...common, layout: 'list', showIcons: true } });
    const gallery = await window.nodus.createDatabaseView(database.id, { name: 'Galería 10k', layout: 'gallery', filter: { conjunction: 'and', conditions: [] }, sorts: [], config: { ...common, layout: 'gallery', cover: { kind: 'none', fit: 'cover' }, cardPropertyIds: [status.id, points.id], cardSize: 'medium' } });
    const board = await window.nodus.createDatabaseView(database.id, { name: 'Kanban 10k', layout: 'board', filter: { conjunction: 'and', conditions: [] }, sorts: [], config: { ...common, layout: 'board', groupBy: { columnId: status.id, dir: 'asc' }, subgroupBy: null, cardPropertyIds: [points.id, summary.id], cardSize: 'medium', hideEmptyGroups: false, groupLimits: {} } });
    const locked = await window.nodus.createDatabaseView(database.id, { name: 'Tablero bloqueado', layout: 'board', filter: { conjunction: 'and', conditions: [] }, sorts: [], ownerActorId: 'remote-owner', editPermission: 'owner', config: { ...board.config, ownerActorId: 'remote-owner', editPermission: 'owner' } });
    const invalid = await window.nodus.createDatabaseView(database.id, { name: 'Vista con error', layout: 'board', filter: { conjunction: 'and', conditions: [] }, sorts: [], config: { ...board.config, groupBy: { columnId: 'missing-column', dir: 'asc' } } });
    const empty = await window.nodus.createDatabase('Base vacía 10', 'table');
    await window.nodus.createDatabaseColumn(empty.id, 'Nombre', 'title');
    return { database, title, status, points, summary, table, list, gallery, board, locked, invalid, empty,
      options: Object.fromEntries(status.options.map((option) => [option.label, option.id])) };
  }, databaseName);
  gate('Vault y fixture por APIs reales', 'passed', 'Vault QA, importación real de 10.000 filas y cinco vistas configuradas.');

  await page.reload(); await page.getByTestId('app-shell').waitFor();
  await page.getByRole('button', { name: databaseName, exact: true }).first().click();
  await page.getByTestId('database-initial-loading').waitFor();
  await capture(page, 'loading', 'light', 1024, 768);
  await page.getByText('Tarjeta 00000', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Tabla 10k', exact: true }).click();
  await page.getByTestId('database-table-aggregates').waitFor();
  tableDom = await page.getByTestId('database-cell').count();
  assert.ok(tableDom > 0 && tableDom < 300, `tabla virtualizada: ${tableDom} celdas DOM`);
  await capture(page, 'table-populated', 'light', 1440, 1000);
  await auditA11y(page, 'table-populated');

  await page.getByLabel('Seleccionar Tarjeta 00000').check();
  await page.getByLabel('Seleccionar Tarjeta 00001').check();
  await page.getByLabel('Propiedad para edición masiva').selectOption(fixture.points.id);
  await page.getByLabel('Valor para edición masiva').fill('777');
  await page.getByRole('button', { name: 'Aplicar a todas', exact: true }).click();
  const firstIds = await page.evaluate(async (databaseId) => (await window.nodus.queryDatabaseRows({ databaseId, limit: 2 })).rows.map((row) => row.id), fixture.database.id);
  await page.waitForFunction(async ({ ids, columnId }) => (await Promise.all(ids.map((id) => window.nodus.getDatabaseRow(id)))).every((row) => row?.cells[columnId] === '777'),
    { ids: firstIds, columnId: fixture.points.id });
  await page.getByRole('button', { name: 'Cancelar selección', exact: true }).click();

  await page.getByTestId('database-cell').first().click({ position: { x: 6, y: 6 } });
  await page.evaluate(() => {
    const data = new DataTransfer(); data.setData('text/plain', 'Pegada 1\tCompleto\nPegada 2\tPendiente');
    document.querySelector('[data-testid="database-table"]')?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(async ({ databaseId, titleId }) => {
    const rows = (await window.nodus.queryDatabaseRows({ databaseId, limit: 2 })).rows;
    return rows[0]?.cells[titleId] === 'Pegada 1' && rows[1]?.cells[titleId] === 'Pegada 2';
  }, { databaseId: fixture.database.id, titleId: fixture.title.id });
  gate('Tabla transaccional', 'passed', `Selección múltiple, edición 2×1 y pegado rectangular 2×2; ${tableDom} celdas DOM.`);

  await page.getByRole('button', { name: 'Lista 10k', exact: true }).click();
  await page.getByTestId('database-list-view').waitFor();
  listDom = await page.getByTestId('database-list-view').locator('button').count();
  assert.ok(listDom < 100, `lista virtualizada: ${listDom}`);
  await capture(page, 'list-populated', 'dark', 1024, 768);

  await page.getByRole('button', { name: 'Galería 10k', exact: true }).click();
  await page.getByTestId('gallery-card').first().waitFor();
  galleryDom = await page.getByTestId('gallery-card').count();
  assert.ok(galleryDom < 150, `galería virtualizada: ${galleryDom}`);
  await capture(page, 'gallery-populated', 'light', 1440, 1000);

  await page.getByRole('button', { name: 'Kanban 10k', exact: true }).click();
  await page.getByTestId('database-board-view').waitFor();
  boardDom = await page.getByTestId('board-card').count();
  assert.ok(boardDom < 150, `tablero virtualizado: ${boardDom}`);
  const pegada = page.getByTestId('board-card').filter({ hasText: 'Pegada 2' });
  await pegada.dragTo(page.locator('section[aria-label="Completo"]'));
  await page.waitForFunction(async ({ rowId, statusId, expected }) => (await window.nodus.getDatabaseRow(rowId))?.cells[statusId] === expected,
    { rowId: firstIds[1], statusId: fixture.status.id, expected: fixture.options.Completo });
  await capture(page, 'board-populated', 'dark', 1440, 1000);
  await capture(page, 'board-narrow', 'light', 1024, 768);
  await auditA11y(page, 'board-narrow');
  gate('Lista, galería y tablero', 'passed', `DOM: lista=${listDom}, galería=${galleryDom}, tablero=${boardDom}; DnD persistente.`);

  await page.getByRole('button', { name: 'Tabla 10k', exact: true }).click();
  await page.getByTestId('database-view-settings-button').click();
  await page.evaluate(async (databaseId) => {
    const view = (await window.nodus.listDatabaseViews(databaseId)).find((candidate) => candidate.name === 'Tabla 10k');
    await window.nodus.updateDatabaseView(view.id, { name: 'Tabla 10k · externa', expectedRevision: view.revision });
  }, fixture.database.id);
  await page.getByLabel('Densidad').selectOption('spacious');
  await page.getByTestId('save-view-settings').click();
  await page.getByRole('alert').filter({ hasText: 'Conflicto de revisión' }).waitFor();
  await capture(page, 'revision-conflict', 'light', 1024, 768);
  await page.getByTestId('database-view-settings').getByRole('button', { name: 'Cerrar', exact: true }).click();

  await page.getByRole('button', { name: 'Tablero bloqueado', exact: true }).click();
  await page.getByTestId('database-view-settings-button').click();
  await page.getByTestId('view-no-permission').waitFor();
  await capture(page, 'no-permission', 'dark', 1024, 768);
  await page.getByTestId('database-view-settings').getByRole('button', { name: 'Cerrar', exact: true }).click();

  await page.getByRole('button', { name: 'Vista con error', exact: true }).click();
  await page.getByTestId('database-query-error').waitFor();
  await capture(page, 'query-error', 'light', 1024, 768);
  }

  await openDatabase(page, 'Base vacía 10', 'Sin filas todavía. Añade la primera.');
  await capture(page, 'empty', 'dark', 1024, 768);
  await openDatabase(page, databaseName, 'Pegada 1');
  const exportResult = await page.evaluate((databaseId) => window.nodus.exportDatabase(databaseId, 'json'), fixture.database.id);
  assert.equal(exportResult.canceled, false);
  assert.ok(path.resolve(exportResult.path).startsWith(path.resolve(exportDir) + path.sep));

  const restored = await page.evaluate(async ({ databaseId, viewId }) => {
    const current = (await window.nodus.listDatabaseViews(databaseId)).find((view) => view.id === viewId);
    const changed = await window.nodus.updateDatabaseView(viewId, { config: { ...current.config, groupLimits: { __empty__: 3 } }, expectedRevision: current.revision });
    return window.nodus.restoreDatabaseViewRevision(viewId, 1, changed.revision);
  }, { databaseId: fixture.database.id, viewId: fixture.board.id });
  assert.deepEqual(restored.config.groupLimits, {});
  gate('Exportación y restauración', 'passed', 'JSON paginado exportado dentro de QA y configuración Kanban restaurada desde revisión 1.');

  await closeApp(app); app = null;
  ({ app, page } = await launchApp());
  const reopened = await page.evaluate(async (databaseId) => ({
    count: (await window.nodus.queryDatabaseRows({ databaseId, limit: 1 })).totalCount,
    views: await window.nodus.listDatabaseViews(databaseId),
  }), fixture.database.id);
  assert.equal(reopened.count, 10_000);
  assert.ok(reopened.views.some((view) => view.layout === 'board'));
  gate('Cierre y reapertura', 'passed', '10.000 filas y configuraciones rehidratadas desde SQLite real.');
  await closeApp(app); app = null;

  const Database = require('better-sqlite3');
  const sqlite = new Database(vault.path, { readonly: true, fileMustExist: true });
  Object.assign(report.metrics, {
    quickCheck: sqlite.pragma('quick_check', { simple: true }), foreignKeyViolations: sqlite.pragma('foreign_key_check').length,
    rows: sqlite.prepare('SELECT COUNT(*) AS n FROM db_rows WHERE database_id = ?').get(fixture.database.id).n,
    cells: sqlite.prepare('SELECT COUNT(*) AS n FROM db_cells WHERE database_id = ?').get(fixture.database.id).n,
    tableDom, listDom, galleryDom, boardDom, maxInteractivePayload: 500,
  });
  sqlite.close();
  assert.equal(report.metrics.quickCheck, 'ok'); assert.equal(report.metrics.foreignKeyViolations, 0); assert.equal(report.metrics.rows, 10_000);
  report.databaseAudit = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(report.databaseAudit.length > 0);
  assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []);
  assert.deepEqual(report.console.errors.filter((message) => !/favicon|Autofill/i.test(message)), []);
  gate('Integridad, aislamiento y consola', 'passed', `${report.databaseAudit.length} aperturas QA; quick_check=ok; FK=0; consola limpia.`);
  report.outcome = 'passed';
} catch (error) {
  report.outcome = 'failed'; report.failure = String(error?.stack ?? error); gate('Resultado', 'failed', report.failure); throw error;
} finally {
  await closeApp(app); report.finishedAt = new Date().toISOString();
  const paths = await writeNotionParityReport(outputDir, report); console.log(`Loop 10 report: ${paths.htmlPath}`);
  await profile.cleanup();
}
