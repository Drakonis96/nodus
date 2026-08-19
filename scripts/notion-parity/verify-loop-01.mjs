#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const marker = '--electron-loop-01';

if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker, ...process.argv.slice(2)], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  process.exit(0);
}

function option(name) {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const retain = process.argv.includes('--retain');
const skipBuild = process.argv.includes('--skip-build');
const runId = `loop-01-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const exportDir = path.join(profile.profilePath, 'exports');
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const axePath = require.resolve('axe-core/axe.min.js');

installRuntimeHooks();
const Database = require('better-sqlite3');
const { migrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

const report = {
  format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 1, runId,
  startedAt: new Date().toISOString(), finishedAt: null, outcome: 'running',
  profile: { path: profile.profilePath, qaRoot: profile.qaRoot, retained: profile.retained },
  gates: [], metrics: {}, screenshots: [], accessibility: [],
  console: { errors: [], pageErrors: [] }, databaseAudit: [], failure: null,
};
const gate = (name, status, detail = '') => report.gates.push({ name, status, detail });
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function historicalFixture() {
  const file = path.join(profile.profilePath, 'nodus.sqlite');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const migration of migrations.filter((item) => item.version <= 133).sort((a, b) => a.version - b.version)) {
    db.transaction(() => {
      db.exec(migration.up);
      migration.after?.(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
  const now = '2026-08-14T00:00:00.000Z';
  db.prepare('INSERT INTO db_databases (id, short_id, name, position, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
    .run('historical-db', 'DB-HIST1', 'Migración histórica QA', now, now);
  for (const column of [
    ['historical-title', 'Nombre', 'title', 0, null],
    ['historical-file', 'Archivo', 'attachment', 1, null],
    ['historical-relation', 'Relacionado', 'relation', 2, JSON.stringify({ relationTargetKind: 'db_row', relationTargetDatabaseId: 'historical-db' })],
  ]) {
    db.prepare('INSERT INTO db_columns (id, database_id, name, type, position, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(column[0], 'historical-db', column[1], column[2], column[3], column[4], now);
  }
  db.prepare('INSERT INTO db_rows (id, database_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('historical-row-1', 'historical-db', 0, now, now);
  db.prepare('INSERT INTO db_rows (id, database_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('historical-row-2', 'historical-db', 1, now, now);
  db.prepare('INSERT INTO db_cells (row_id, column_id, value_text) VALUES (?, ?, ?)').run('historical-row-1', 'historical-title', 'La fila debe sobrevivir');
  db.prepare('INSERT INTO db_attachments (id, row_id, column_id, file_name, bytes, blob, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('historical-attachment', 'historical-row-1', 'historical-file', 'evidencia.txt', 17, Buffer.from('EVIDENCIA-HISTORICA'), 'fixture-hash', now);
  db.prepare('INSERT INTO db_relations (id, row_id, column_id, target_kind, target_id, position, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .run('historical-relation-link', 'historical-row-1', 'historical-relation', 'db_row', 'historical-row-2', now);
  db.prepare('INSERT INTO db_views (id, database_id, name, layout, position, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    .run('historical-view', 'historical-db', 'Histórica', 'table', now);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  fs.writeFileSync(path.join(profile.profilePath, 'vaults.json'), JSON.stringify({
    formatVersion: 1,
    activeVaultId: 'default',
    vaults: [{
      id: 'default', name: 'Histórico QA', path: file, createdAt: now, lastOpenedAt: now,
      legacy: true, type: 'databases', origin: 'local',
    }],
  }, null, 2));
  return file;
}

function launchEnvironment() {
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
  const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: launchEnvironment() });
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
  await page.evaluate(async ({ version }) => {
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
  }, { version: appVersion });
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  return { app, page };
}

async function openRecoverySettings(page) {
  await page.getByTestId('header-actions').getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('heading', { name: 'Ajustes', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Backup / copia de seguridad', exact: true }).click();
  const card = page.getByTestId('migration-recovery-snapshots');
  await card.waitFor();
  await card.scrollIntoViewIfNeeded();
  return card;
}

async function capture(page, card, label, theme, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate((value) => window.nodus.updateSettings({ theme: value }), theme);
  await page.waitForFunction((value) => document.documentElement.classList.contains('dark') === (value === 'dark'), theme);
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const file = path.join(outputDir, `${label}-${theme}-${width}x${height}.png`);
  await page.screenshot({ path: file });
  const layout = await card.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
  });
  assert.ok(layout.left >= -1 && layout.right <= width + 1, `recovery card overflows at ${width}px/${theme}`);
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `recovery card has horizontal overflow at ${width}px/${theme}`);
  report.screenshots.push({ label, theme, viewport: `${width}x${height}`, path: file, layout });
}

async function auditA11y(page, card, label) {
  const violations = await page.evaluate(async (selector) => {
    const result = await window.axe.run(document.querySelector(selector), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    });
    return result.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.map((node) => node.target) }));
  }, '[data-testid="migration-recovery-snapshots"]');
  report.accessibility.push({ label, violations });
  assert.deepEqual(violations.filter((item) => item.impact === 'critical' || item.impact === 'serious'), []);
  const button = card.getByRole('button', { name: 'Abrir como vault separado' });
  await button.focus();
  assert.equal(await button.evaluate((element) => document.activeElement === element), true);
}

let app = null;
const historicalFile = historicalFixture();
const historicalHash = sha256(historicalFile);

try {
  if (!skipBuild) execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  gate('Build y typecheck', 'passed', skipBuild ? 'Build existente reutilizada.' : 'npm run build completado.');

  let page;
  ({ app, page } = await launchApp());
  const snapshots = await page.evaluate(() => window.nodus.listMigrationRecoverySnapshots());
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].fromVersion, 133);
  assert.equal(snapshots[0].targetVersion, SCHEMA_VERSION);
  assert.equal(snapshots[0].sha256, historicalHash);
  assert.equal(snapshots[0].quickCheck, 'ok');
  gate('Migración real y copia inmutable', 'passed', `v133 → v${SCHEMA_VERSION} · ${snapshots[0].sha256}`);

  const createdVault = await page.evaluate(() => window.nodus.createVault({ name: 'Vault nuevo del Bucle 1', type: 'databases' }));
  assert.ok(createdVault.vault.path.startsWith(profile.profilePath));
  gate('Vault nuevo creado por la aplicación real', 'passed', createdVault.vault.path);

  const card = await openRecoverySettings(page);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    for (const theme of ['light', 'dark']) await capture(page, card, 'migration-recovery', theme, viewport.width, viewport.height);
  }
  await auditA11y(page, card, 'migration-recovery');
  gate('QA visual y accesibilidad', 'passed', 'Claro/oscuro; 1440×1000, 1024×768 y 390×844; axe WCAG AA y foco.');

  await page.setViewportSize({ width: 1440, height: 1000 });
  const originalActive = await page.evaluate(() => window.nodus.getActiveVault());
  await card.getByRole('button', { name: 'Abrir como vault separado' }).click();
  await page.waitForFunction((id) => window.nodus.getActiveVault().then((vault) => vault.id !== id), originalActive.id);
  const recoveredActive = await page.evaluate(() => window.nodus.getActiveVault());
  assert.notEqual(recoveredActive.id, originalActive.id);
  assert.match(recoveredActive.name, new RegExp(`antes de v${SCHEMA_VERSION}`));
  const preserved = await page.evaluate(async () => {
    const database = await window.nodus.getDatabaseDetail('historical-db');
    const rows = await window.nodus.listDatabaseRows('historical-db', { sort: 'position' });
    const exported = await window.nodus.exportDatabase('historical-db', 'json');
    return { database, rows, exported };
  });
  assert.equal(preserved.database.database.name, 'Migración histórica QA');
  assert.equal(preserved.rows[0].cells['historical-title'], 'La fila debe sobrevivir');
  assert.ok(preserved.exported.path.startsWith(exportDir));
  const exported = JSON.parse(await readFile(preserved.exported.path, 'utf8'));
  assert.equal(exported.rows.length, 2);
  gate('Apertura separada, edición legible y exportación', 'passed', recoveredActive.path);

  await closeApp(app);
  app = null;
  ({ app, page } = await launchApp());
  const reopened = await page.evaluate(async () => ({ active: await window.nodus.getActiveVault(), rows: await window.nodus.listDatabaseRows('historical-db', { sort: 'position' }) }));
  assert.equal(reopened.active.id, recoveredActive.id);
  assert.equal(reopened.rows[0].cells['historical-title'], 'La fila debe sobrevivir');
  gate('Cierre y reapertura real', 'passed', 'La copia se mantiene como vault independiente y activo.');

  await closeApp(app);
  app = null;
  const originalDb = new Database(historicalFile, { readonly: true, fileMustExist: true });
  assert.equal(originalDb.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(originalDb.pragma('quick_check', { simple: true }), 'ok');
  assert.deepEqual(originalDb.pragma('foreign_key_check'), []);
  originalDb.close();
  const reopenedDb = new Database(recoveredActive.path, { readonly: true, fileMustExist: true });
  assert.equal(reopenedDb.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(reopenedDb.pragma('quick_check', { simple: true }), 'ok');
  assert.deepEqual(reopenedDb.pragma('foreign_key_check'), []);
  reopenedDb.close();
  gate('Integridad SQLite', 'passed', 'quick_check=ok y foreign_key_check limpio en original y copia abierta.');

  report.databaseAudit = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(report.databaseAudit.length >= 4);
  assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []);
  assert.deepEqual(report.console.errors, []);
  gate('Aislamiento y consola', 'passed', `${report.databaseAudit.length} aperturas auditadas dentro del perfil QA; consola limpia.`);
  report.metrics = { snapshots: snapshots.length, auditOpens: report.databaseAudit.length, exportedRows: exported.rows.length };
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
  console.log(`Loop 1 report: ${paths.htmlPath}`);
  await profile.cleanup();
}

function installRuntimeHooks() {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}
