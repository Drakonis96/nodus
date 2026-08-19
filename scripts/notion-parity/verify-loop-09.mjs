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
const marker = '--electron-loop-09';
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
const runId = `loop-09-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const exportDir = path.join(profile.profilePath, 'exports');
const axePath = require.resolve('axe-core/axe.min.js');
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const report = {
  format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 9, runId,
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
    NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available',
    NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
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
  await page.waitForTimeout(120);
  const file = path.join(outputDir, `${label}-${theme}-${width}x${height}.png`);
  await page.screenshot({ path: file });
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map((dialog) => { const box = dialog.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }; }),
  }));
  assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `${label} desborda a ${width}px/${theme}`);
  assert.ok(layout.dialogs.every((box) => box.left >= -1 && box.right <= width + 1 && box.top >= -1 && box.bottom <= height + 1), `${label} tiene un diálogo fuera del viewport`);
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

async function openDatabase(page, name) {
  await page.getByRole('button', { name, exact: true }).first().click();
  await page.getByText('Atlas', { exact: true }).first().waitFor();
}

async function openSettings(page) {
  await page.getByTestId('database-view-settings-button').click();
  await page.getByTestId('database-view-settings').waitFor();
}

let app = null;
let vault;
let fixture;
const databaseName = `Vistas versionadas ${runId}`;
try {
  for (const script of ['test-database-views-v2.mjs', 'test-database-row-query.mjs', 'test-databases.mjs', 'test-ipc-contract.mjs', 'test-i18n-coverage.mjs']) {
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts', script)], { cwd: repoRoot, stdio: 'inherit' });
  }
  gate('Unidad, SQLite, migración, consultas, IPC e i18n', 'passed', 'Config v2, todos los discriminantes, v141, revisiones y siete idiomas.');
  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  gate('Typecheck y build', 'passed', skipBuild ? 'Build de esta revisión reutilizado.' : 'npm run build completado.');

  let page;
  ({ app, page } = await launchApp());
  vault = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Bucle 9 · vistas versionadas', type: 'databases' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1,
      firstVaultVersion: 1, tourComplete: true, advancedTourComplete: true, databasesTourComplete: true,
      mascotEnabled: false, theme: 'light', uiLanguage: 'es' });
    return created.vault;
  });
  assert.ok(path.resolve(vault.path).startsWith(path.resolve(profile.profilePath) + path.sep));
  await page.reload(); await page.getByTestId('app-shell').waitFor();

  fixture = await page.evaluate(async (databaseName) => {
    const database = await window.nodus.createDatabase(databaseName, 'table');
    const title = await window.nodus.createDatabaseColumn(database.id, 'Nombre', 'title');
    const status = await window.nodus.createDatabaseColumn(database.id, 'Estado', 'status');
    const due = await window.nodus.createDatabaseColumn(database.id, 'Fecha', 'date');
    const owner = await window.nodus.createDatabaseColumn(database.id, 'Responsable', 'person');
    const rows = [];
    for (const [name, state] of [['Atlas', 'En curso'], ['Bóreas', 'Pendiente'], ['Cronos', 'Completo'], ['Dédalo', 'En curso']]) {
      const row = await window.nodus.createDatabaseRow(database.id); rows.push(row);
      await window.nodus.setDatabaseCell(row.id, title.id, name);
      await window.nodus.setDatabaseCell(row.id, status.id, state);
    }
    const config = {
      version: 2, layout: 'table',
      properties: [
        { columnId: title.id, visible: true, order: 0, width: 280, frozen: true },
        { columnId: status.id, visible: true, order: 1, width: 180, frozen: false },
        { columnId: due.id, visible: true, order: 2, width: 170, frozen: false },
        { columnId: owner.id, visible: false, order: 3, width: 190, frozen: false },
      ],
      rowHeight: 'tall', wrap: true, density: 'comfortable', openMode: 'side', filter: null, sorts: [], groups: [],
      scope: 'shared', ownerActorId: 'local', editPermission: 'editors', sourceViewId: null, showCalculations: true,
    };
    const mainView = await window.nodus.createDatabaseView(database.id, {
      name: 'Plan editorial', layout: 'table', filter: { conjunction: 'and', conditions: [] }, sorts: [], config,
    });
    const lockedConfig = { ...config, scope: 'shared', ownerActorId: 'remote-owner', editPermission: 'owner' };
    const lockedView = await window.nodus.createDatabaseView(database.id, {
      name: 'Sólo lectura', layout: 'table', filter: { conjunction: 'and', conditions: [] }, sorts: [],
      config: lockedConfig, ownerActorId: 'remote-owner', editPermission: 'owner',
    });
    return { database, title, status, due, owner, rows, mainView, lockedView };
  }, databaseName);
  gate('Vault y fixture por IPC real', 'passed', 'Vault databases aislado, 4 propiedades, 4 filas y vistas editable/restringida.');

  await page.reload();
  await openDatabase(page, databaseName);
  await page.getByRole('button', { name: 'Plan editorial', exact: true }).click();
  await openSettings(page);
  await capture(page, 'settings-populated', 'light', 1440, 1000);
  await capture(page, 'settings-populated', 'dark', 1024, 768);
  await capture(page, 'settings-mobile', 'dark', 390, 844);
  await auditA11y(page, 'settings-mobile');

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByLabel('Altura de fila').selectOption('compact');
  await page.getByLabel('Ajustar contenido en varias líneas').uncheck();
  const statusRow = page.getByTestId('view-property-list').locator(':scope > div').filter({ hasText: 'Estado' });
  await statusRow.getByLabel('Congelar').check();
  await page.getByLabel('Ancho de Nombre').fill('360');
  await page.getByTestId('save-view-settings').click();
  await page.getByTestId('database-view-settings').waitFor({ state: 'detached' });
  const saved = await page.evaluate(async (id) => (await window.nodus.listDatabaseViews(id)).find((view) => view.name === 'Plan editorial'), fixture.database.id);
  assert.equal(saved.config.rowHeight, 'compact');
  assert.equal(saved.config.wrap, false);
  assert.equal(saved.config.properties.find((property) => property.columnId === fixture.title.id).width, 360);
  assert.equal(saved.config.properties.find((property) => property.columnId === fixture.status.id).frozen, true);
  await capture(page, 'configured-table', 'light', 1440, 1000);

  // Restore the initial tall/wrapped snapshot as a new revision; later revisions remain.
  await openSettings(page);
  await page.getByLabel('Historial de revisiones').selectOption('1');
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await page.getByTestId('database-view-settings').waitFor({ state: 'detached' });
  const restored = await page.evaluate(async (id) => (await window.nodus.listDatabaseViews(id)).find((view) => view.name === 'Plan editorial'), fixture.database.id);
  assert.equal(restored.config.rowHeight, 'tall');
  assert.ok((await page.evaluate((id) => window.nodus.listDatabaseViewRevisions(id), restored.id)).length >= 3);

  // Duplicate and link through visible controls. The linked copy receives local gallery
  // settings and leaves the original source untouched.
  await openSettings(page);
  await page.getByRole('button', { name: 'Duplicar vista', exact: true }).click();
  await page.getByTestId('database-view-settings').waitFor({ state: 'detached' });
  await openSettings(page);
  await page.getByRole('button', { name: 'Crear vista enlazada', exact: true }).click();
  await page.getByTestId('database-view-settings').waitFor({ state: 'detached' });
  await openSettings(page);
  await page.getByTestId('view-layout-select').selectOption('gallery');
  await page.getByLabel('Tamaño de tarjeta').selectOption('small');
  await page.getByLabel('Ajuste de imagen').selectOption('contain');
  await page.getByRole('button', { name: 'Mover a la izquierda', exact: true }).click();
  await page.getByTestId('save-view-settings').click();
  await page.getByTestId('database-view-settings').waitFor({ state: 'detached' });
  await page.getByTestId('gallery-card').first().waitFor();
  await capture(page, 'linked-gallery', 'dark', 1440, 1000);
  const linkedState = await page.evaluate(async (id) => {
    const views = await window.nodus.listDatabaseViews(id);
    return { views, original: views.find((view) => view.name === 'Plan editorial'), linked: views.find((view) => view.sourceViewId) };
  }, fixture.database.id);
  assert.equal(linkedState.original.layout, 'table');
  assert.equal(linkedState.linked.layout, 'gallery');
  assert.equal(linkedState.linked.config.cover.fit, 'contain');
  assert.ok(linkedState.views.some((view) => view.name.includes('copia')));
  gate('Guardar, restaurar, duplicar, enlazar y reordenar', 'passed', 'Recorrido visual completo; la configuración local no muta la fuente.');

  // A stale renderer revision must surface an explicit conflict instead of overwriting.
  await openSettings(page);
  await page.evaluate(async (id) => {
    const view = (await window.nodus.listDatabaseViews(id)).find((candidate) => candidate.sourceViewId);
    await window.nodus.updateDatabaseView(view.id, { name: `${view.name} · externo`, expectedRevision: view.revision });
  }, fixture.database.id);
  await page.getByLabel('Densidad').selectOption('spacious');
  await page.getByTestId('save-view-settings').click();
  await page.getByRole('alert').filter({ hasText: 'Conflicto de revisión' }).waitFor();
  await capture(page, 'revision-conflict', 'light', 1024, 768);
  await page.getByTestId('database-view-settings').getByRole('button', { name: 'Cerrar', exact: true }).click();

  await page.getByRole('button', { name: 'Sólo lectura', exact: true }).click();
  await openSettings(page);
  await page.getByTestId('view-no-permission').waitFor();
  assert.equal(await page.getByTestId('save-view-settings').isDisabled(), true);
  await capture(page, 'no-permission', 'dark', 1024, 768);
  await auditA11y(page, 'no-permission');
  await page.getByTestId('database-view-settings').getByRole('button', { name: 'Cerrar', exact: true }).click();
  gate('Permiso y conflicto explícitos', 'passed', 'Vista owner remota bloqueada y expectedRevision obsoleta mostrada sin sobrescritura.');

  await closeApp(app); app = null;
  ({ app, page } = await launchApp());
  const reopened = await page.evaluate(async (databaseId) => {
    const views = await window.nodus.listDatabaseViews(databaseId);
    return { views, histories: await Promise.all(views.map((view) => window.nodus.listDatabaseViewRevisions(view.id))) };
  }, fixture.database.id);
  assert.ok(reopened.views.length >= 4);
  assert.ok(reopened.views.every((view) => view.config.version === 2));
  assert.ok(reopened.histories.every((history) => history.length >= 1));
  gate('Cierre y reapertura', 'passed', `${reopened.views.length} vistas y sus revisiones rehidratadas desde SQLite.`);
  await closeApp(app); app = null;

  const Database = require('better-sqlite3');
  const sqlite = new Database(vault.path, { readonly: true, fileMustExist: true });
  Object.assign(report.metrics, {
    quickCheck: sqlite.pragma('quick_check', { simple: true }),
    foreignKeyViolations: sqlite.pragma('foreign_key_check').length,
    views: sqlite.prepare('SELECT COUNT(*) AS n FROM db_views').get().n,
    revisions: sqlite.prepare('SELECT COUNT(*) AS n FROM db_view_revisions').get().n,
    linkedViews: sqlite.prepare('SELECT COUNT(*) AS n FROM db_views WHERE source_view_id IS NOT NULL').get().n,
    configVersions: sqlite.prepare('SELECT config_version, COUNT(*) AS n FROM db_views GROUP BY config_version').all(),
  });
  assert.equal(report.metrics.quickCheck, 'ok'); assert.equal(report.metrics.foreignKeyViolations, 0);
  assert.ok(report.metrics.revisions >= report.metrics.views); assert.equal(report.metrics.linkedViews, 1);
  sqlite.close();
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
  const paths = await writeNotionParityReport(outputDir, report); console.log(`Loop 9 report: ${paths.htmlPath}`);
  await profile.cleanup();
}
