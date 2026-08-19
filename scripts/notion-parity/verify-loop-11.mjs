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
const marker = '--electron-loop-11';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker, ...process.argv.slice(2)], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const option = (name) => {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : null;
};
const retain = process.argv.includes('--retain'); const skipBuild = process.argv.includes('--skip-build');
const runId = `loop-11-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const exportDir = path.join(profile.profilePath, 'exports');
const axePath = require.resolve('axe-core/axe.min.js'); const appVersion = require(path.join(repoRoot, 'package.json')).version;
const report = { format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 11, runId,
  startedAt: new Date().toISOString(), finishedAt: null, outcome: 'running',
  profile: { path: profile.profilePath, qaRoot: profile.qaRoot, retained: profile.retained }, gates: [], metrics: {},
  screenshots: [], accessibility: [], console: { errors: [], pageErrors: [] }, databaseAudit: [], failure: null };
const gate = (name, status, detail = '') => report.gates.push({ name, status, detail });

function environment() {
  const env = { ...process.env, NODUS_USERDATA: profile.profilePath, NODUS_QA_ROOT: profile.qaRoot,
    NODUS_QA_DATABASE_AUDIT_LOG: auditFile, NODUS_QA_EXPORT_DIR: exportDir, NODUS_QA_DATABASE_QUERY_DELAY_MS: '350',
    NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' };
  delete env.ELECTRON_RUN_AS_NODE; return env;
}
async function closeApp(app) {
  if (!app) return; const child = app.process(); let timer;
  const closed = await Promise.race([app.close().then(() => true, () => false), new Promise((resolve) => { timer = setTimeout(() => resolve(false), 5_000); })]);
  clearTimeout(timer); if (!closed && child.exitCode === null && !child.killed) child.kill('SIGKILL');
}
async function launchApp() {
  const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: environment() });
  const page = await app.firstWindow(); page.setDefaultTimeout(45_000); await page.addInitScript({ path: axePath });
  page.on('pageerror', (error) => report.console.pageErrors.push(String(error?.stack ?? error)));
  page.on('console', (message) => { if (message.type() === 'error') report.console.errors.push(message.text()); });
  await page.waitForLoadState('domcontentloaded'); await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate(async (version) => {
    localStorage.setItem('nodus.lastSeenVersion', version); localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1'); localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1'); sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1,
      firstVaultVersion: 1, tourComplete: true, advancedTourComplete: true, databasesTourComplete: true,
      mascotEnabled: false, theme: 'light', uiLanguage: 'es' });
  }, appVersion);
  await page.reload(); await page.getByTestId('app-shell').waitFor(); return { app, page };
}
async function capture(page, label, theme, width, height) {
  await page.setViewportSize({ width, height }); await page.evaluate((value) => window.nodus.updateSettings({ theme: value }), theme);
  await page.waitForFunction((value) => document.documentElement.classList.contains('dark') === (value === 'dark'), theme); await page.waitForTimeout(150);
  const file = path.join(outputDir, `${label}-${theme}-${width}x${height}.png`); await page.screenshot({ path: file });
  const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `${label} desborda a ${width}px/${theme}`);
  report.screenshots.push({ label, theme, viewport: `${width}x${height}`, path: file, layout });
}
async function auditA11y(page, label) {
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } })).violations
    .map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.slice(0, 12).map((node) => node.target) })));
  report.accessibility.push({ label, violations }); assert.deepEqual(violations.filter((item) => item.impact === 'critical' || item.impact === 'serious'), []);
}
const emptyFilter = { conjunction: 'and', conditions: [] };
let app = null; let vault; let fixture;
try {
  for (const script of ['test-database-temporal-views.mjs', 'test-database-row-query.mjs', 'test-database-views-v2.mjs', 'test-ipc-contract.mjs', 'test-i18n-coverage.mjs']) {
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts', script)], { cwd: repoRoot, stdio: 'inherit' });
  }
  gate('Unidad, SQLite, contratos e i18n', 'passed', 'Rangos, solapes, recurrencia, DST, límites, dependencias, IPC y 8 idiomas.');
  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  gate('Typecheck y build', 'passed', skipBuild ? 'Build de esta revisión reutilizado.' : 'npm run build completado.');

  let page; ({ app, page } = await launchApp());
  vault = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Bucle 11 · calendario y timeline', type: 'databases' });
    const switched = await window.nodus.switchVault(created.vault.id); if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1,
      firstVaultVersion: 1, tourComplete: true, advancedTourComplete: true, databasesTourComplete: true,
      mascotEnabled: false, theme: 'light', uiLanguage: 'es' });
    return created.vault;
  });
  assert.ok(path.resolve(vault.path).startsWith(path.resolve(profile.profilePath) + path.sep));
  await page.reload(); await page.getByTestId('app-shell').waitFor();
  fixture = await page.evaluate(async ({ runId, emptyFilter }) => {
    const database = await window.nodus.createDatabase(`Agenda temporal ${runId}`, 'calendar');
    const title = await window.nodus.createDatabaseColumn(database.id, 'Nombre', 'title');
    const start = await window.nodus.createDatabaseColumn(database.id, 'Inicio', 'date', { dateIncludeTime: true, dateTimeZone: 'Europe/Madrid' });
    const end = await window.nodus.createDatabaseColumn(database.id, 'Final', 'date', { dateIncludeTime: true, dateTimeZone: 'Europe/Madrid' });
    const dependency = await window.nodus.createDatabaseColumn(database.id, 'Depende de', 'relation', {
      relationTargetKind: 'db_row', relationTargetDatabaseId: database.id, relationCardinality: 'many',
    });
    const base = new Date(); const date = (delta) => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + delta)).toISOString().slice(0, 10);
    const rows = [];
    const definitions = [
      ['Entrega editorial', 0, '09:00:00', 2, '17:00:00', null],
      ['Revisión solapada', 0, '10:00:00', 0, '12:30:00', null],
      ['Reunión diaria', -2, '11:00:00', -2, '12:00:00', 'daily'],
      ['Hito semanal', -7, '15:00:00', -7, '16:00:00', 'weekly'],
      ['Tarea dependiente', 3, '08:00:00', 4, '18:00:00', null],
    ];
    for (const [name, startDelta, startTime, endDelta, endTime, recurrence] of definitions) {
      const row = await window.nodus.createDatabaseRow(database.id); rows.push(row);
      await window.nodus.setDatabaseCell(row.id, title.id, name);
      await window.nodus.setDatabaseCell(row.id, start.id, JSON.stringify({ start: `${date(startDelta)}T${startTime}`, end: null,
        includeTime: true, timeZone: 'Europe/Madrid', reminderMinutes: null, recurrence }));
      await window.nodus.setDatabaseCell(row.id, end.id, JSON.stringify({ start: `${date(endDelta)}T${endTime}`, end: null,
        includeTime: true, timeZone: 'Europe/Madrid', reminderMinutes: null, recurrence: null }));
    }
    for (let index = 5; index < 80; index += 1) {
      const row = await window.nodus.createDatabaseRow(database.id); rows.push(row);
      await window.nodus.setDatabaseCell(row.id, title.id, `Evento ${String(index).padStart(2, '0')}`);
      await window.nodus.setDatabaseCell(row.id, start.id, JSON.stringify({ start: `${date(index % 24 - 10)}T${String(8 + index % 10).padStart(2, '0')}:00:00`,
        end: null, includeTime: true, timeZone: 'Europe/Madrid', reminderMinutes: null, recurrence: null }));
      await window.nodus.setDatabaseCell(row.id, end.id, JSON.stringify({ start: `${date(index % 24 - 10)}T${String(9 + index % 10).padStart(2, '0')}:00:00`,
        end: null, includeTime: true, timeZone: 'Europe/Madrid', reminderMinutes: null, recurrence: null }));
    }
    await window.nodus.addDatabaseRelation(rows[4].id, dependency.id, 'db_row', rows[0].id);
    const createView = (name, layout, config, extras = {}) => window.nodus.createDatabaseView(database.id,
      { name, layout, filter: emptyFilter, sorts: [], config: { layout, ...config }, ...extras });
    const month = await createView('Mes', 'calendar', { dateColumnId: start.id, endDateColumnId: end.id, scale: 'month', weekStartsOn: 1 });
    const week = await createView('Semana', 'calendar', { dateColumnId: start.id, endDateColumnId: end.id, scale: 'week', weekStartsOn: 1 });
    const day = await createView('Día', 'calendar', { dateColumnId: start.id, endDateColumnId: end.id, scale: 'day', weekStartsOn: 1 });
    const timeline = await createView('Timeline semanas', 'timeline', { startColumnId: start.id, endColumnId: end.id,
      dependencyColumnId: dependency.id, scale: 'weeks', showSideTable: true });
    const locked = await createView('Timeline bloqueado', 'timeline', { startColumnId: start.id, endColumnId: end.id,
      scale: 'weeks', showSideTable: true }, { scope: 'shared', ownerActorId: 'remote-owner', editPermission: 'owner' });
    const invalid = await window.nodus.createDatabaseView(database.id, { name: 'Vista temporal con error', layout: 'calendar', filter: emptyFilter,
      sorts: [{ columnId: 'missing-column', dir: 'asc' }], config: { layout: 'calendar', dateColumnId: start.id, scale: 'month' } });
    const empty = await window.nodus.createDatabase('Agenda vacía', 'calendar');
    const emptyTitle = await window.nodus.createDatabaseColumn(empty.id, 'Nombre', 'title');
    const emptyDate = await window.nodus.createDatabaseColumn(empty.id, 'Fecha', 'date', { dateTimeZone: 'Europe/Madrid' });
    await window.nodus.createDatabaseView(empty.id, { name: 'Calendario vacío', layout: 'calendar', filter: emptyFilter, sorts: [],
      config: { layout: 'calendar', dateColumnId: emptyDate.id, scale: 'month' } });
    return { database, title, start, end, dependency, rows: rows.map((row) => row.id), month, week, day, timeline, locked, invalid,
      empty, emptyTitle, emptyDate, today: date(0), tomorrow: date(1) };
  }, { runId, emptyFilter });
  gate('Vault y fixture por APIs reales', 'passed', 'Vault aislado, 80 filas/páginas, rangos, recurrencias, solapes, dependencia y seis vistas.');

  await page.reload(); await page.getByTestId('app-shell').waitFor();
  await page.getByRole('button', { name: fixture.database.name, exact: true }).first().click();
  await page.getByRole('button', { name: 'Mes', exact: true }).click(); await page.getByTestId('database-temporal-loading').waitFor();
  await capture(page, 'calendar-loading', 'light', 1024, 768); await page.getByTestId('database-temporal-loading').waitFor({ state: 'detached' });
  await page.getByTestId('database-calendar-month').waitFor();
  const initialStart = await page.evaluate(({ rowId, columnId }) => window.nodus.getDatabaseRow(rowId).then((row) => row.cells[columnId]),
    { rowId: fixture.rows[0], columnId: fixture.start.id });
  const delivery = page.getByTestId('calendar-event').filter({ hasText: 'Entrega editorial' }).first();
  await delivery.dragTo(page.locator(`[data-testid="calendar-day"][data-day="${fixture.tomorrow}"]`));
  await page.waitForFunction(async ({ rowId, columnId, initial }) => (await window.nodus.getDatabaseRow(rowId))?.cells[columnId] !== initial,
    { rowId: fixture.rows[0], columnId: fixture.start.id, initial: initialStart });
  await page.getByTestId('database-temporal-loading').waitFor({ state: 'detached' }); await page.waitForTimeout(450);
  await capture(page, 'calendar-month-populated', 'light', 1440, 1000); await auditA11y(page, 'calendar-month-populated');

  await page.getByRole('button', { name: 'Semana', exact: true }).click(); await page.getByTestId('database-calendar-time-grid').waitFor();
  await page.getByTestId('database-temporal-loading').waitFor({ state: 'detached' }); await page.waitForTimeout(450);
  assert.ok(await page.getByTestId('calendar-event').count() >= 2); await capture(page, 'calendar-week-overlaps', 'dark', 1024, 768);
  await page.getByRole('button', { name: 'Día', exact: true }).click(); await page.getByTestId('database-calendar-time-grid').waitFor();
  await page.getByTestId('database-temporal-loading').waitFor({ state: 'detached' }); await page.waitForTimeout(450);
  await capture(page, 'calendar-day', 'light', 1024, 768);
  gate('Calendario mensual, semanal y diario', 'passed', 'Rangos/solapes/recurrencias renderizados; drag entre días persistente en SQLite.');

  await page.getByRole('button', { name: 'Timeline semanas', exact: true }).click(); await page.getByTestId('database-timeline-view').waitFor();
  await page.getByTestId('database-temporal-loading').waitFor({ state: 'detached' });
  assert.ok(await page.getByTestId('timeline-dependency').count() >= 1);
  const beforeResize = await page.evaluate(({ rowId, columnId }) => window.nodus.getDatabaseRow(rowId).then((row) => row.cells[columnId]),
    { rowId: fixture.rows[0], columnId: fixture.end.id });
  await page.getByTestId('timeline-row').filter({ hasText: 'Entrega editorial' }).getByTestId('timeline-resize-end').click();
  await page.waitForFunction(async ({ rowId, columnId, initial }) => (await window.nodus.getDatabaseRow(rowId))?.cells[columnId] !== initial,
    { rowId: fixture.rows[0], columnId: fixture.end.id, initial: beforeResize });
  await capture(page, 'timeline-dependencies-resize', 'dark', 1440, 1000); await capture(page, 'timeline-narrow', 'light', 1024, 768);
  await auditA11y(page, 'timeline-narrow');
  const temporalPage = await page.evaluate(({ databaseId, startColumnId, endColumnId, dependencyColumnId }) => {
    const now = new Date(); const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 20));
    const end = new Date(start.getTime() + 120 * 86400000);
    return window.nodus.queryDatabaseTemporalEvents({ databaseId, startColumnId, endColumnId, dependencyColumnId,
      windowStart: start.toISOString(), windowEnd: end.toISOString(), timeZone: 'Europe/Madrid', limit: 500 });
  }, { databaseId: fixture.database.id, startColumnId: fixture.start.id, endColumnId: fixture.end.id, dependencyColumnId: fixture.dependency.id });
  assert.ok(temporalPage.events.length <= 500); assert.ok(temporalPage.events.some((event) => event.dependencies.length));
  gate('Timeline y consulta temporal', 'passed', `Resize y dependencias persistentes; payload=${temporalPage.events.length}/500; zona Europe/Madrid.`);

  await page.getByTestId('database-view-settings-button').click();
  await page.evaluate(async (databaseId) => { const view = (await window.nodus.listDatabaseViews(databaseId)).find((item) => item.name === 'Timeline semanas');
    await window.nodus.updateDatabaseView(view.id, { name: 'Timeline semanas · externa', expectedRevision: view.revision }); }, fixture.database.id);
  await page.getByLabel('Densidad').selectOption('spacious'); await page.getByTestId('save-view-settings').click();
  await page.getByRole('alert').filter({ hasText: 'Conflicto de revisión' }).waitFor(); await capture(page, 'revision-conflict', 'light', 1024, 768);
  await page.getByTestId('database-view-settings').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline bloqueado', exact: true }).click(); await page.getByTestId('database-view-settings-button').click();
  await page.getByTestId('view-no-permission').waitFor(); await capture(page, 'no-permission', 'dark', 1024, 768);
  await page.getByTestId('database-view-settings').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Vista temporal con error', exact: true }).click(); await page.getByTestId('database-query-error').waitFor();
  await capture(page, 'query-error', 'light', 1024, 768);

  await page.getByRole('button', { name: fixture.empty.name, exact: true }).first().click(); await page.getByRole('button', { name: 'Calendario vacío', exact: true }).click();
  await page.getByTestId('database-calendar-empty').waitFor(); await capture(page, 'empty-calendar', 'dark', 1024, 768);
  await page.getByRole('button', { name: fixture.database.name, exact: true }).first().click();
  const exportResult = await page.evaluate((databaseId) => window.nodus.exportDatabase(databaseId, 'json'), fixture.database.id);
  assert.equal(exportResult.canceled, false); assert.ok(path.resolve(exportResult.path).startsWith(path.resolve(exportDir) + path.sep));
  const restored = await page.evaluate(async ({ databaseId, viewId }) => { const current = (await window.nodus.listDatabaseViews(databaseId)).find((view) => view.id === viewId);
    const changed = await window.nodus.updateDatabaseView(viewId, { config: { ...current.config, scale: 'years' }, expectedRevision: current.revision });
    return window.nodus.restoreDatabaseViewRevision(viewId, 1, changed.revision); }, { databaseId: fixture.database.id, viewId: fixture.timeline.id });
  assert.equal(restored.config.scale, 'weeks'); gate('Estados, exportación y restauración', 'passed', 'Vacío, error, sin permisos, conflicto, export JSON y restauración de vista verificados.');

  await closeApp(app); app = null; ({ app, page } = await launchApp());
  const reopened = await page.evaluate(async ({ databaseId, startColumnId, endColumnId }) => {
    const now = new Date(); return { rows: (await window.nodus.queryDatabaseRows({ databaseId, limit: 1 })).totalCount,
      events: (await window.nodus.queryDatabaseTemporalEvents({ databaseId, startColumnId, endColumnId,
        windowStart: new Date(now.getTime() - 30 * 86400000).toISOString(), windowEnd: new Date(now.getTime() + 90 * 86400000).toISOString(),
        timeZone: 'Europe/Madrid' })).events.length, views: await window.nodus.listDatabaseViews(databaseId) };
  }, { databaseId: fixture.database.id, startColumnId: fixture.start.id, endColumnId: fixture.end.id });
  assert.equal(reopened.rows, 80); assert.ok(reopened.events > 0); assert.ok(reopened.views.some((view) => view.layout === 'timeline'));
  gate('Cierre y reapertura', 'passed', '80 filas, eventos temporales y configuraciones rehidratados desde SQLite real.');
  await closeApp(app); app = null;

  const Database = require('better-sqlite3'); const sqlite = new Database(vault.path, { readonly: true, fileMustExist: true });
  Object.assign(report.metrics, { quickCheck: sqlite.pragma('quick_check', { simple: true }), foreignKeyViolations: sqlite.pragma('foreign_key_check').length,
    rows: sqlite.prepare('SELECT COUNT(*) AS n FROM db_rows WHERE database_id = ?').get(fixture.database.id).n,
    cells: sqlite.prepare('SELECT COUNT(*) AS n FROM db_cells WHERE database_id = ?').get(fixture.database.id).n,
    calendarEventsDom: report.screenshots.length, temporalPayload: temporalPage.events.length, maxInteractivePayload: 500 }); sqlite.close();
  assert.equal(report.metrics.quickCheck, 'ok'); assert.equal(report.metrics.foreignKeyViolations, 0);
  report.databaseAudit = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(report.databaseAudit.length > 0); assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []); assert.deepEqual(report.console.errors.filter((message) => !/favicon|Autofill/i.test(message)), []);
  gate('Integridad, aislamiento y consola', 'passed', `${report.databaseAudit.length} aperturas QA; quick_check=ok; FK=0; consola limpia.`); report.outcome = 'passed';
} catch (error) {
  report.outcome = 'failed'; report.failure = String(error?.stack ?? error); gate('Resultado', 'failed', report.failure); throw error;
} finally {
  await closeApp(app); report.finishedAt = new Date().toISOString(); const paths = await writeNotionParityReport(outputDir, report);
  console.log(`Loop 11 report: ${paths.htmlPath}`); await profile.cleanup();
}
