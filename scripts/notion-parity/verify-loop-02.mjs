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
const marker = '--electron-loop-02';

if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker, ...process.argv.slice(2)], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
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
const runId = `loop-02-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const exportDir = path.join(profile.profilePath, 'exports');
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const axePath = require.resolve('axe-core/axe.min.js');

const report = {
  format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 2, runId,
  startedAt: new Date().toISOString(), finishedAt: null, outcome: 'running',
  profile: { path: profile.profilePath, qaRoot: profile.qaRoot, retained: profile.retained },
  gates: [], metrics: {}, screenshots: [], accessibility: [],
  console: { errors: [], pageErrors: [] }, databaseAudit: [], failure: null,
};
const gate = (name, status, detail = '') => report.gates.push({ name, status, detail });
const elapsed = (start) => Math.round((performance.now() - start) * 100) / 100;

function environment() {
  const env = {
    ...process.env,
    NODUS_USERDATA: profile.profilePath,
    NODUS_QA_ROOT: profile.qaRoot,
    NODUS_QA_DATABASE_AUDIT_LOG: auditFile,
    NODUS_QA_EXPORT_DIR: exportDir,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available',
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
  let firstWindowTimer;
  const page = await Promise.race([
    app.firstWindow(),
    new Promise((_, reject) => { firstWindowTimer = setTimeout(() => reject(new Error('Electron no abrió una ventana QA en 30 s.')), 30_000); }),
  ]).finally(() => clearTimeout(firstWindowTimer));
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
  await page.waitForTimeout(150);
  const file = path.join(outputDir, `${label}-${theme}-${width}x${height}.png`);
  await page.screenshot({ path: file });
  const layout = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    modals: [...document.querySelectorAll('[role="dialog"]')].map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    }),
  }));
  assert.ok(layout.documentWidth <= width + 1, `${label} desborda el documento a ${width}px/${theme}`);
  for (const modal of layout.modals) {
    assert.ok(modal.left >= -1 && modal.right <= width + 1, `${label} desborda un modal a ${width}px/${theme}`);
    assert.ok(modal.scrollWidth <= modal.clientWidth + 1, `${label} tiene scroll horizontal interno a ${width}px/${theme}`);
  }
  report.screenshots.push({ label, theme, viewport: `${width}x${height}`, path: file, layout });
}

async function auditA11y(page, label) {
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document.querySelector('main') ?? document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    });
    return result.violations.map((item) => ({
      id: item.id, impact: item.impact,
      nodes: item.nodes.slice(0, 10).map((node) => ({ target: node.target, summary: node.failureSummary })),
    }));
  });
  report.accessibility.push({ label, violations });
  assert.deepEqual(violations.filter((item) => item.impact === 'critical' || item.impact === 'serious'), []);
}

let app = null;
let vault;
let ids;
let exportedPath;
const databaseName = `Almacén tipado ${runId}`;

try {
  const testStart = performance.now();
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/test-database-typed-storage.mjs')], { cwd: repoRoot, stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/test-sync-package.mjs')], { cwd: repoRoot, stdio: 'inherit' });
  report.metrics.storageAndSyncTestsMs = elapsed(testStart);
  gate('SQLite real, migración, restricciones y sincronización', 'passed', 'Tipos, reversibilidad, cuarentena, blobs, FK y paquetes v1/v2.');

  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }
  gate('Build y typecheck', 'passed', skipBuild ? 'Build existente reutilizada.' : 'npm run build completado.');

  let page;
  ({ app, page } = await launchApp());
  vault = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Bucle 2 · almacenamiento', type: 'databases' });
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
  gate('Vault real aislado y estado vacío', 'passed', vault.path);

  ids = await page.evaluate(async (name) => {
    const database = await window.nodus.createDatabase(name);
    const other = await window.nodus.createDatabase('Aislamiento entre bases');
    const title = await window.nodus.createDatabaseColumn(database.id, 'Nombre', 'title');
    const number = await window.nodus.createDatabaseColumn(database.id, 'Importe', 'number');
    const checkbox = await window.nodus.createDatabaseColumn(database.id, 'Revisado', 'checkbox');
    const date = await window.nodus.createDatabaseColumn(database.id, 'Fecha', 'date');
    const select = await window.nodus.createDatabaseColumn(database.id, 'Estado', 'select');
    const multi = await window.nodus.createDatabaseColumn(database.id, 'Etiquetas', 'multi_select');
    const option = await window.nodus.addDatabaseOption(select.id, 'Listo', '#16a34a');
    const tagA = await window.nodus.addDatabaseOption(multi.id, 'Local', '#6366f1');
    const tagB = await window.nodus.addDatabaseOption(multi.id, 'Verificado', '#0d9488');
    const otherTitle = await window.nodus.createDatabaseColumn(other.id, 'Nombre', 'title');
    const rowIds = [];
    for (let index = 0; index < 24; index += 1) {
      const row = await window.nodus.createDatabaseRow(database.id);
      rowIds.push(row.id);
      await window.nodus.setDatabaseCell(row.id, title.id, `Registro ${String(index + 1).padStart(2, '0')}`);
      await window.nodus.setDatabaseCell(row.id, number.id, String((index + 1) * 1.25));
      await window.nodus.setDatabaseCell(row.id, checkbox.id, index % 2 ? '0' : '1');
      await window.nodus.setDatabaseCell(row.id, date.id, `2026-08-${String((index % 14) + 1).padStart(2, '0')}`);
      await window.nodus.setDatabaseCell(row.id, select.id, option.id);
      await window.nodus.setDatabaseCell(row.id, multi.id, JSON.stringify(index % 2 ? [tagA.id] : [tagA.id, tagB.id]));
    }
    const foreignRow = await window.nodus.createDatabaseRow(other.id);
    let crossDatabaseError = '';
    try {
      await window.nodus.setDatabaseCell(foreignRow.id, title.id, 'inválido');
    } catch (error) {
      crossDatabaseError = String(error);
    }
    const exported = await window.nodus.exportDatabase(database.id, 'json');
    return {
      databaseId: database.id, otherId: other.id, titleId: title.id, numberId: number.id,
      checkboxId: checkbox.id, dateId: date.id, selectId: select.id, multiId: multi.id,
      firstRowId: rowIds[0], crossDatabaseError, exported,
    };
  }, databaseName);
  assert.match(ids.crossDatabaseError, /bases de datos distintas/);
  assert.equal(ids.exported.canceled, false);
  exportedPath = ids.exported.path;
  assert.ok(exportedPath.startsWith(exportDir));
  const exported = JSON.parse(await readFile(exportedPath, 'utf8'));
  assert.equal(exported.rows.length, 24);
  gate('IPC real, tipos, rechazo de cruces y exportación', 'passed', '24 filas tipadas; cruce rechazado; JSON reconstruible generado.');

  await page.reload();
  await page.getByRole('button', { name: databaseName, exact: true }).first().click();
  await page.getByRole('main').waitFor();
  await page.getByText('Registro 01', { exact: true }).first().waitFor();
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }]) {
    for (const theme of ['light', 'dark']) await capture(page, 'populated', theme, viewport.width, viewport.height);
  }
  await auditA11y(page, 'typed-grid');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement !== document.body), true, 'keyboard reaches a visible control');

  const openRecord = page.getByTitle('Abrir ficha').first();
  await openRecord.click({ force: true });
  await page.getByTestId('database-record-modal').waitFor();
  for (const theme of ['light', 'dark']) await capture(page, 'record', theme, 390, 844);
  await auditA11y(page, 'typed-record-mobile');
  gate('Visual, responsive y accesibilidad', 'passed', 'Vacío/poblado/ficha; claro/oscuro; 1440×1000, 1024×768, 390×844; axe AA y teclado.');
  gate('Estados ajenos al almacenamiento', 'not-applicable', 'loading/error/sin permiso/conflicto se cubren al introducir sus capacidades verticales.');

  await closeApp(app);
  app = null;
  ({ app, page } = await launchApp());
  const persisted = await page.evaluate(async (value) => {
    const row = await window.nodus.getDatabaseRow(value.firstRowId);
    return {
      title: row?.cells[value.titleId], number: row?.cells[value.numberId],
      checkbox: row?.cells[value.checkboxId], date: row?.cells[value.dateId],
      count: (await window.nodus.listDatabaseRows(value.databaseId, { sort: 'position' })).length,
    };
  }, ids);
  assert.deepEqual(persisted, { title: 'Registro 01', number: '1.25', checkbox: '1', date: '2026-08-01', count: 24 });
  gate('Cierre, reapertura y compatibilidad', 'passed', 'Los valores tipados reaparecen en la API pública heredada sin pérdida.');
  await closeApp(app);
  app = null;

  const Database = require('better-sqlite3');
  const sqlite = new Database(vault.path, { readonly: true, fileMustExist: true });
  report.metrics.schemaVersion = sqlite.pragma('user_version', { simple: true });
  report.metrics.quickCheck = sqlite.pragma('quick_check', { simple: true });
  report.metrics.foreignKeyViolations = sqlite.pragma('foreign_key_check').length;
  report.metrics.typedCells = sqlite.prepare(
    `SELECT value_type, COUNT(*) AS count FROM db_cells WHERE database_id = ? GROUP BY value_type ORDER BY value_type`,
  ).all(ids.databaseId);
  report.metrics.titleCounts = sqlite.prepare(
    `SELECT database_id, COUNT(*) AS count FROM db_columns WHERE type = 'title' GROUP BY database_id ORDER BY database_id`,
  ).all();
  report.metrics.legacyValueCompatibility = sqlite.prepare(
    'SELECT COUNT(*) AS count FROM db_cells WHERE database_id = ? AND value_text IS NOT NULL',
  ).get(ids.databaseId).count;
  assert.equal(report.metrics.quickCheck, 'ok');
  assert.equal(report.metrics.foreignKeyViolations, 0);
  assert.ok(report.metrics.typedCells.some((item) => item.value_type === 'number' && item.count === 24));
  assert.ok(report.metrics.typedCells.some((item) => item.value_type === 'integer' && item.count === 24));
  assert.ok(report.metrics.titleCounts.every((item) => item.count === 1));
  sqlite.close();
  gate('Inspección SQLite posterior', 'passed', JSON.stringify(report.metrics.typedCells));

  report.databaseAudit = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(report.databaseAudit.length >= 3);
  assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  const consoleErrors = report.console.errors.filter((message) => !/favicon|Autofill/i.test(message));
  assert.deepEqual(report.console.pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  gate('Aislamiento y consola', 'passed', `${report.databaseAudit.length} aperturas auditadas; ningún vault de usuario; consola limpia.`);
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
  console.log(`Loop 2 report: ${paths.htmlPath}`);
  await profile.cleanup();
}
