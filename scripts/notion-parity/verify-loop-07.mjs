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
const marker = '--electron-loop-07';
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
const runId = `loop-07-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const exportDir = path.join(profile.profilePath, 'exports');
const axePath = require.resolve('axe-core/axe.min.js');
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const report = {
  format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 7, runId,
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
    NODUS_QA_DATABASE_QUERY_DELAY_MS: '900', NODUS_DISABLE_AUTO_UPDATE: '1',
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
      firstVaultVersion: 1, tourComplete: true, advancedTourComplete: true,
      databasesTourComplete: true, mascotEnabled: false, theme: 'light', uiLanguage: 'es',
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
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth, dialogs: [...document.querySelectorAll('[role="dialog"]')].map((dialog) => {
      const box = dialog.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }),
  }));
  assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `${label} desborda a ${width}px/${theme}`);
  assert.ok(layout.dialogs.every((box) => box.left >= -1 && box.right <= width + 1 && box.top >= -1 && box.bottom <= height + 1), `${label} tiene un diálogo fuera del viewport`);
  report.screenshots.push({ label, theme, viewport: `${width}x${height}`, path: file, layout });
}

async function auditA11y(page, label) {
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    });
    return result.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.slice(0, 12).map((node) => node.target) }));
  });
  report.accessibility.push({ label, violations });
  assert.deepEqual(violations.filter((item) => item.impact === 'critical' || item.impact === 'serious'), []);
}

function rowFor(page, label) {
  return page.getByTestId('database-record-modal').locator('.database-record-row').filter({ hasText: label });
}

let app = null;
let vault;
let fixture;
const databaseName = `Propiedades QA ${runId}`;
try {
  for (const script of [
    'test-database-properties.mjs', 'test-database-typed-storage.mjs', 'test-database-row-query.mjs',
    'test-databases.mjs', 'test-databases-theme.mjs', 'test-ipc-contract.mjs', 'test-i18n-coverage.mjs',
  ]) execFileSync(process.execPath, [path.join(repoRoot, 'scripts', script)], { cwd: repoRoot, stdio: 'inherit' });
  gate('Unidad, SQLite, migración, dominio, IPC e i18n', 'passed', 'Propiedades tipadas, v139→v140, filtros, orden, exportación, contratos y siete idiomas.');
  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }
  gate('Typecheck y build', 'passed', skipBuild ? 'Build generado en esta revisión reutilizado.' : 'npm run build completado.');

  let page;
  ({ app, page } = await launchApp());
  vault = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Bucle 7 · paridad de propiedades', type: 'databases' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({
      onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1, firstVaultVersion: 1,
      tourComplete: true, advancedTourComplete: true, databasesTourComplete: true,
      mascotEnabled: false, theme: 'light', uiLanguage: 'es',
    });
    return created.vault;
  });
  assert.ok(path.resolve(vault.path).startsWith(path.resolve(profile.profilePath) + path.sep));
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await capture(page, 'empty-databases', 'light', 1440, 1000);
  await capture(page, 'empty-databases', 'dark', 1024, 768);

  fixture = await page.evaluate(async (name) => {
    const database = await window.nodus.createDatabase(name, 'table');
    const columns = {};
    const add = async (key, label, type, config = {}) => {
      columns[key] = await window.nodus.createDatabaseColumn(database.id, label, type, config); return columns[key];
    };
    await add('title', 'Nombre', 'title');
    await add('rich', 'Descripción', 'rich_text');
    await add('budget', 'Presupuesto', 'number', { numberFormat: 'currency', numberCurrency: 'EUR', numberDecimals: 2 });
    await add('progress', 'Progreso', 'number', { numberFormat: 'progress', progressMaximum: 100, numberDecimals: 0 });
    await add('status', 'Estado', 'status');
    await add('period', 'Periodo', 'date', { dateIncludeTime: true, dateTimeZone: 'Europe/Madrid' });
    await add('people', 'Responsables', 'person');
    await add('url', 'Sitio', 'url');
    await add('email', 'Correo', 'email');
    await add('phone', 'Teléfono', 'phone');
    await add('location', 'Sede', 'location');
    await add('files', 'Archivos', 'files');
    await add('createdBy', 'Creado por', 'created_by');
    await add('editedBy', 'Editado por', 'last_edited_by');
    await add('createdTime', 'Fecha de creación', 'created_time');
    await add('editedTime', 'Última edición', 'last_edited_time');
    await add('unique', 'Clave', 'unique_id', { uniqueIdPrefix: 'TASK-', uniqueIdPadding: 5 });
    await add('button', 'Acción', 'button', { buttonLabel: 'Publicar', buttonColor: '#4f46e5' });
    const pending = await window.nodus.addDatabaseOption(columns.status.id, 'Pendiente', '#64748b', 'pending');
    const active = await window.nodus.addDatabaseOption(columns.status.id, 'En curso', '#2563eb', 'in_progress');
    const complete = await window.nodus.addDatabaseOption(columns.status.id, 'Completo', '#16a34a', 'complete');
    const rows = [];
    for (const values of [
      ['Proyecto Atlas', 'Especificación **local-first**', '1234.5', '65', active.id, '2026-08-14T09:30', 'Madrid'],
      ['Proyecto Beta', 'Documentación pública', '850', '100', complete.id, '2026-09-01T10:00', 'Lisboa'],
      ['Proyecto Gamma', 'Migración compatible', '3200', '20', pending.id, '2026-07-20T08:00', 'Berlín'],
    ]) {
      const row = await window.nodus.createDatabaseRow(database.id); rows.push(row);
      await window.nodus.setDatabaseCell(row.id, columns.title.id, values[0]);
      await window.nodus.setDatabaseCell(row.id, columns.rich.id, values[1]);
      await window.nodus.setDatabaseCell(row.id, columns.budget.id, values[2]);
      await window.nodus.setDatabaseCell(row.id, columns.progress.id, values[3]);
      await window.nodus.setDatabaseCell(row.id, columns.status.id, values[4]);
      await window.nodus.setDatabaseCell(row.id, columns.period.id, JSON.stringify({ start: values[5], end: null, includeTime: true, timeZone: 'Europe/Madrid', reminderMinutes: 30, recurrence: null }));
      await window.nodus.setDatabaseCell(row.id, columns.people.id, JSON.stringify([{ id: 'actor-ada', label: 'Ada Lovelace', kind: 'person' }]));
      await window.nodus.setDatabaseCell(row.id, columns.url.id, 'https://nodus.app/docs');
      await window.nodus.setDatabaseCell(row.id, columns.email.id, 'qa@nodus.app');
      await window.nodus.setDatabaseCell(row.id, columns.phone.id, '+34 600 123 456');
      await window.nodus.setDatabaseCell(row.id, columns.location.id, JSON.stringify({ name: values[6], address: 'Sede QA', latitude: 40.4168, longitude: -3.7038 }));
    }
    const completed = await window.nodus.createDatabaseView(database.id, {
      name: 'Completados', layout: 'table', filter: { conjunction: 'and', conditions: [
        { id: 'status-complete', columnId: columns.status.id, op: 'isAnyOf', value: [complete.id] },
      ] }, sorts: [{ columnId: columns.period.id, dir: 'asc' }],
    });
    await window.nodus.createDatabaseView(database.id, {
      name: 'Error QA', layout: 'table', filter: { conjunction: 'and', conditions: [
        { id: 'invalid', columnId: columns.status.id, op: 'qa_invalid_operator', value: [complete.id] },
      ] }, sorts: [],
    });
    const checks = {
      status: await window.nodus.queryDatabaseRows({ databaseId: database.id, filter: { type: 'condition', columnId: columns.status.id, op: 'isAnyOf', value: [active.id] }, limit: 500 }),
      date: await window.nodus.queryDatabaseRows({ databaseId: database.id, filter: { type: 'condition', columnId: columns.period.id, op: 'after', value: '2026-08-01' }, sorts: [{ columnId: columns.period.id, dir: 'asc' }], limit: 500 }),
      person: await window.nodus.queryDatabaseRows({ databaseId: database.id, filter: { type: 'condition', columnId: columns.people.id, op: 'contains', value: 'Ada' }, limit: 500 }),
      location: await window.nodus.queryDatabaseRows({ databaseId: database.id, filter: { type: 'condition', columnId: columns.location.id, op: 'contains', value: 'Madrid' }, limit: 500 }),
      unique: await window.nodus.queryDatabaseRows({ databaseId: database.id, filter: { type: 'condition', columnId: columns.unique.id, op: 'contains', value: 'TASK-00001' }, limit: 500 }),
    };
    const exported = {
      csv: await window.nodus.exportDatabase(database.id, 'csv'), json: await window.nodus.exportDatabase(database.id, 'json'),
      xlsx: await window.nodus.exportDatabase(database.id, 'xlsx'),
    };
    return { databaseId: database.id, columns, rows, options: { pending, active, complete }, completedViewId: completed.id, checks: {
      status: checks.status.totalCount, date: checks.date.totalCount, person: checks.person.totalCount,
      location: checks.location.totalCount, unique: checks.unique.totalCount,
    }, exported };
  }, databaseName);
  assert.deepEqual(fixture.checks, { status: 1, date: 2, person: 3, location: 1, unique: 1 });
  assert.ok(Object.values(fixture.exported).every((item) => path.resolve(item.path).startsWith(path.resolve(exportDir) + path.sep)));
  gate('Vault, IPC y fixture reales', 'passed', '18 propiedades, estados agrupados, 3 filas, filtros/orden y CSV/JSON/XLSX dentro del perfil QA.');

  await page.reload();
  const initialLoading = page.getByText('Cargando…', { exact: true }).waitFor();
  await page.getByRole('button', { name: databaseName, exact: true }).first().click();
  await initialLoading;
  await capture(page, 'loading-properties', 'light', 1024, 768);
  await page.getByText('Proyecto Atlas', { exact: true }).first().waitFor();
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }]) {
    for (const theme of ['light', 'dark']) await capture(page, 'property-grid', theme, viewport.width, viewport.height);
  }
  await auditA11y(page, 'property-grid');

  await page.getByTitle('Abrir ficha').first().click();
  const modal = page.getByTestId('database-record-modal');
  await modal.waitFor();
  for (const theme of ['light', 'dark']) await capture(page, 'property-record', theme, 1440, 1000);
  await capture(page, 'property-record', 'light', 1024, 768);
  await capture(page, 'property-record-mobile', 'dark', 390, 844);
  await auditA11y(page, 'property-record-mobile');

  await page.setViewportSize({ width: 1024, height: 768 });
  await rowFor(page, 'Presupuesto').getByRole('button').click();
  const budgetInput = rowFor(page, 'Presupuesto').locator('input[type="number"]');
  await budgetInput.fill('2500.75'); await budgetInput.press('Enter');

  await rowFor(page, 'Periodo').getByRole('button', { name: /^Periodo:/ }).click();
  const dateDialog = page.getByRole('dialog', { name: 'Configurar fecha' });
  const dateInputs = dateDialog.locator('input[type="datetime-local"]');
  await dateInputs.nth(0).fill('2026-10-05T11:30');
  await dateInputs.nth(1).fill('2026-10-06T16:45');
  await dateDialog.getByText('Guardar', { exact: true }).click();

  await rowFor(page, 'Responsables').getByRole('button', { name: /^Responsables:/ }).click();
  await page.getByPlaceholder('Nombre').fill('Grace Hopper');
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await page.keyboard.press('Escape');

  await rowFor(page, 'Sede').getByRole('button', { name: /^Sede:/ }).click();
  const locationDialog = page.getByRole('dialog', { name: 'Editar ubicación' });
  await locationDialog.getByLabel('Lugar').fill('Valencia');
  await locationDialog.getByLabel('Dirección').fill('Calle QA 7');
  await locationDialog.getByText('Guardar', { exact: true }).click();

  await rowFor(page, 'Correo').getByRole('button').click();
  const emailInput = rowFor(page, 'Correo').locator('input[type="email"]');
  await emailInput.fill('atlas@nodus.app'); await emailInput.press('Enter');
  await rowFor(page, 'Estado').getByRole('button').first().click();
  await page.getByRole('button', { name: 'Completo', exact: true }).click();
  await rowFor(page, 'Acción').getByRole('button', { name: 'Publicar', exact: true }).click();

  const edited = await page.evaluate(async ({ rowId, columns, completeId }) => {
    const row = await window.nodus.getDatabaseRow(rowId);
    return {
      budget: row.cells[columns.budget.id], status: row.cells[columns.status.id], period: JSON.parse(row.cells[columns.period.id]),
      people: JSON.parse(row.cells[columns.people.id]), location: JSON.parse(row.cells[columns.location.id]),
      email: row.cells[columns.email.id], button: JSON.parse(row.cells[columns.button.id]), unique: row.cells[columns.unique.id], completeId,
    };
  }, { rowId: fixture.rows[0].id, columns: fixture.columns, completeId: fixture.options.complete.id });
  assert.equal(edited.budget, '2500.75');
  assert.equal(edited.status, edited.completeId);
  assert.equal(edited.period.end, '2026-10-06T16:45');
  assert.ok(edited.people.some((person) => person.label === 'Grace Hopper'));
  assert.equal(edited.location.name, 'Valencia');
  assert.equal(edited.email, 'atlas@nodus.app');
  assert.equal(edited.button.clicks, 1);
  assert.equal(edited.unique, 'TASK-00001');
  await capture(page, 'property-record-edited', 'light', 1024, 768);
  await auditA11y(page, 'property-record-edited');
  gate('Edición visual y persistencia', 'passed', 'Moneda, rango, personas, ubicación, email, status y botón editados desde la ficha y leídos por IPC.');

  await modal.getByRole('button', { name: 'Cerrar', exact: true }).click();
  const filteredLoading = page.getByText('Cargando…', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Completados', exact: true }).click();
  await filteredLoading;
  await page.getByText(/2 filtradas/).waitFor();
  await capture(page, 'filtered-properties', 'dark', 1024, 768);
  await page.getByRole('button', { name: 'Error QA', exact: true }).click();
  await page.getByTestId('database-query-error').waitFor();
  await capture(page, 'property-error', 'light', 1024, 768);
  await capture(page, 'property-error', 'dark', 1024, 768);
  await auditA11y(page, 'property-error');
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  await page.getByText('Proyecto Atlas', { exact: true }).first().waitFor();
  await page.getByRole('main').getByRole('button', { name: 'Presupuesto', exact: true }).click();
  await page.getByLabel('Formato numérico').waitFor();
  await capture(page, 'number-configuration', 'light', 1024, 768);
  await page.keyboard.press('Escape');
  gate('Filtros, estados y configuración', 'passed', 'Vista status+orden fecha, carga real, error validado y configuración numérica renderizada.');
  gate('Permisos y conflicto', 'not-applicable', 'La matriz sin permisos y el conflicto simultáneo tienen su implementación/QA obligatoria en los bucles 16 y 17.');

  await closeApp(app); app = null;
  ({ app, page } = await launchApp());
  const reopened = await page.evaluate(async ({ databaseId, rowId, columns }) => {
    const detail = await window.nodus.getDatabaseDetail(databaseId);
    const row = await window.nodus.getDatabaseRow(rowId);
    return { types: detail.columns.map((column) => column.type), budget: row.cells[columns.budget.id], location: JSON.parse(row.cells[columns.location.id]).name,
      unique: row.cells[columns.unique.id], button: JSON.parse(row.cells[columns.button.id]).clicks };
  }, { databaseId: fixture.databaseId, rowId: fixture.rows[0].id, columns: fixture.columns });
  assert.equal(reopened.budget, '2500.75');
  assert.equal(reopened.location, 'Valencia');
  assert.equal(reopened.unique, 'TASK-00001');
  assert.equal(reopened.button, 1);
  assert.ok(['rich_text', 'status', 'person', 'location', 'files', 'created_by', 'unique_id', 'button'].every((type) => reopened.types.includes(type)));
  gate('Cierre y reapertura', 'passed', 'Valores estructurados, metadatos e ID estable rehidratados desde SQLite.');
  await closeApp(app); app = null;

  const Database = require('better-sqlite3');
  const sqlite = new Database(vault.path, { readonly: true, fileMustExist: true });
  Object.assign(report.metrics, {
    quickCheck: sqlite.pragma('quick_check', { simple: true }),
    foreignKeyViolations: sqlite.pragma('foreign_key_check').length,
    propertyTypes: sqlite.prepare('SELECT type, COUNT(*) AS count FROM db_columns WHERE database_id=? GROUP BY type ORDER BY type').all(fixture.databaseId),
    jsonCells: sqlite.prepare("SELECT COUNT(*) AS count FROM db_cells WHERE database_id=? AND value_type='json'").get(fixture.databaseId).count,
    statusGroups: sqlite.prepare('SELECT group_key, COUNT(*) AS count FROM db_select_options WHERE database_id=? GROUP BY group_key ORDER BY group_key').all(fixture.databaseId),
    uniqueSequences: sqlite.prepare('SELECT unique_sequence FROM db_rows WHERE database_id=? ORDER BY unique_sequence').all(fixture.databaseId).map((row) => row.unique_sequence),
  });
  assert.equal(report.metrics.quickCheck, 'ok');
  assert.equal(report.metrics.foreignKeyViolations, 0);
  assert.ok(report.metrics.jsonCells >= 10);
  assert.deepEqual(report.metrics.uniqueSequences, [1, 2, 3]);
  sqlite.close();

  const jsonExport = JSON.parse(await readFile(fixture.exported.json.path, 'utf8'));
  assert.equal(jsonExport.rows.length, 3);
  assert.equal(jsonExport.rows[0].Clave, 'TASK-00001');
  assert.equal((await readFile(fixture.exported.xlsx.path)).subarray(0, 2).toString(), 'PK');
  assert.match(await readFile(fixture.exported.csv.path, 'utf8'), /Ada Lovelace/);
  report.databaseAudit = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(report.databaseAudit.length > 0);
  assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []);
  assert.deepEqual(report.console.errors.filter((message) => !/favicon|Autofill/i.test(message)), []);
  gate('Integridad, exportación, aislamiento y consola', 'passed', `${report.databaseAudit.length} aperturas QA; quick_check=ok; FK=0; tres exportaciones; consola limpia.`);
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
  console.log(`Loop 7 report: ${paths.htmlPath}`);
  await profile.cleanup();
}
