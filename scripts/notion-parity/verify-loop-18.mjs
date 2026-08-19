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
const marker = '--electron-loop-18';
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
const runId = `loop-18-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const exportDir = path.join(profile.profilePath, 'exports');
const fixturePath = path.join(profile.profilePath, 'notion-fixture.zip');
const axePath = require.resolve('axe-core/axe.min.js');
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const report = {
  format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 18, capability: 'notion-import-platform', runId,
  startedAt: new Date().toISOString(), finishedAt: null, outcome: 'running',
  profile: { path: profile.profilePath, qaRoot: profile.qaRoot, retained: profile.retained },
  gates: [], metrics: {}, screenshots: [], accessibility: [], console: { errors: [], pageErrors: [] }, databaseAudit: [], failure: null,
};
const gate = (name, status, detail = '') => report.gates.push({ name, status, detail });
let app = null;

function makeFixture() {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  const id = (char) => char.repeat(32);
  const database = `Workspace/Projects ${id('a')}`;
  zip.addFile(`${database}.csv`, Buffer.from('Name,Status,Due,Done,Tags\nAlpha,In progress,2026-08-20,false,"research, urgent"\nBeta,Done,2026-08-21,true,research'));
  zip.addFile(`${database}/Alpha ${id('b')}.md`, Buffer.from('# Alpha details\n\n![Evidence](assets/evidence.png)\n\n- [x] Verified'));
  zip.addFile(`${database}/Beta ${id('c')}.md`, Buffer.from('## Beta details\n\nA durable row page.'));
  const image = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
  zip.addFile(`${database}/assets/evidence.png`, image);
  zip.addFile(`Workspace/Home ${id('d')}.md`, Buffer.from('# Home\n\nWorkspace root.'));
  zip.addFile(`Workspace/Home ${id('d')}/Child ${id('e')}.md`, Buffer.from('## Child\n\n![Same bytes](assets/copy.png)'));
  zip.addFile(`Workspace/Home ${id('d')}/assets/copy.png`, image);
  zip.writeZip(fixturePath);
}

function environment() {
  const env = {
    ...process.env, NODUS_USERDATA: profile.profilePath, NODUS_QA_ROOT: profile.qaRoot,
    NODUS_QA_DATABASE_AUDIT_LOG: auditFile, NODUS_QA_NOTION_ZIP: fixturePath, NODUS_QA_EXPORT_DIR: exportDir,
    NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function closeApp() {
  if (!app) return;
  const child = app.process();
  const closed = await Promise.race([app.close().then(() => true, () => false), new Promise((resolve) => setTimeout(() => resolve(false), 5_000))]);
  if (!closed && child.exitCode === null && !child.killed) child.kill('SIGKILL');
  app = null;
}

async function launch() {
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: environment() });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.addInitScript({ path: axePath });
  page.on('pageerror', (error) => report.console.pageErrors.push(String(error?.stack ?? error)));
  page.on('console', (message) => { if (message.type() === 'error') report.console.errors.push(message.text()); });
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate(async (version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1, firstVaultVersion: 1,
      tourComplete: true, advancedTourComplete: true, databasesTourComplete: true, mascotEnabled: false, theme: 'light', uiLanguage: 'es' });
  }, appVersion);
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  return page;
}

async function capture(page, theme, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate((value) => window.nodus.updateSettings({ theme: value }), theme);
  await page.waitForFunction((value) => document.documentElement.classList.contains('dark') === (value === 'dark'), theme);
  const modal = page.getByTestId('notion-import-report');
  await modal.waitFor();
  const file = path.join(outputDir, `notion-import-${theme}-${width}x${height}.png`);
  await page.screenshot({ path: file });
  const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `Notion import overflows at ${width}px`);
  report.screenshots.push({ label: 'notion-import-report', theme, viewport: `${width}x${height}`, path: file, layout });
}

async function auditA11y(page) {
  const violations = await page.evaluate(async () => (await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
  })).violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.slice(0, 12).map((node) => node.target) })));
  report.accessibility.push({ label: 'notion-import-report', violations });
  assert.deepEqual(violations.filter((item) => item.impact === 'critical' || item.impact === 'serious'), []);
}

try {
  makeFixture();
  const testEnv = { ...environment(), ELECTRON_RUN_AS_NODE: '1' };
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/test-notion-zip-import.mjs')], { cwd: repoRoot, env: testEnv, stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/test-ipc-contract.mjs')], { cwd: repoRoot, env: testEnv, stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/test-mcp.mjs')], { cwd: repoRoot, env: testEnv, stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/test-i18n-coverage.mjs')], { cwd: repoRoot, env: testEnv, stdio: 'inherit' });
  gate('Importador, rollback, IPC, MCP e i18n', 'passed', 'ZIP real, propiedades tipadas, páginas de fila, árbol, blobs deduplicados, fallo transaccional y MCP para páginas, comentarios, vistas, plantillas, automatizaciones y formularios con ACL y conflictos.');
  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) execFileSync('npm', ['run', 'build'], { cwd: repoRoot, env: environment(), stdio: 'inherit' });
  gate('Typecheck y build', 'passed', skipBuild ? 'Build de esta revisión reutilizado.' : 'Build completo de producción.');

  let page = await launch();
  const vault = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Bucle 18 · Notion', type: 'databases' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    return created.vault;
  });
  assert.ok(path.resolve(vault.path).startsWith(path.resolve(profile.profilePath) + path.sep));
  await closeApp();
  page = await launch();
  await page.locator('[data-tour="nav-home"]').click();
  await page.getByTestId('import-notion-zip').click();
  const modal = page.getByTestId('notion-import-report');
  await modal.waitFor();
  await modal.getByTestId('notion-import-metric-databases').getByText('1', { exact: true }).waitFor();
  await modal.getByTestId('notion-import-metric-rows').getByText('2', { exact: true }).waitFor();
  await capture(page, 'light', 1440, 1000);
  await capture(page, 'dark', 1024, 768);
  await capture(page, 'light', 390, 844);
  await auditA11y(page);
  gate('Electron y visual real', 'passed', 'Importación desde botón real; informe claro, oscuro y móvil sin desbordamiento ni infracciones WCAG graves.');

  const imported = await page.evaluate(async () => {
    const databases = await window.nodus.listDatabases();
    const database = databases.find((entry) => entry.name === 'Projects');
    if (!database) throw new Error('Projects no se importó.');
    const detail = await window.nodus.getDatabaseDetail(database.id);
    const rows = await window.nodus.queryDatabaseRows({ databaseId: database.id, rowSort: 'position', limit: 200 });
    const firstPage = await window.nodus.getPageForDatabaseRow(rows.rows[0].id);
    const exported = await window.nodus.exportDatabase(database.id, 'json');
    const pages = await window.nodus.listPages('active');
    return { databaseId: database.id, columns: detail.columns.map((column) => column.type), rowCount: rows.rows.length,
      firstMarkdown: firstPage.markdown, exportPath: exported.path, pageTitles: pages.map((entry) => entry.title) };
  });
  assert.deepEqual(imported.columns, ['title', 'status', 'date', 'checkbox', 'multi_select']);
  assert.equal(imported.rowCount, 2);
  assert.match(imported.firstMarkdown, /Alpha details/);
  assert.ok(imported.pageTitles.includes('Home') && imported.pageTitles.includes('Child'));
  assert.ok(imported.exportPath && path.resolve(imported.exportPath).startsWith(path.resolve(exportDir) + path.sep));
  const semantic = JSON.parse(fs.readFileSync(imported.exportPath, 'utf8'));
  assert.equal(semantic.rows.length, 2);
  assert.match(semantic.rows[0]._page.markdown, /Alpha details/);
  await modal.getByRole('button', { name: 'Continuar', exact: true }).click();
  await closeApp();

  page = await launch();
  const reopened = await page.evaluate(async (databaseId) => {
    const detail = await window.nodus.getDatabaseDetail(databaseId);
    const rows = await window.nodus.queryDatabaseRows({ databaseId, rowSort: 'position', limit: 200 });
    return { name: detail?.database.name, rows: rows.rows.length };
  }, imported.databaseId);
  assert.deepEqual(reopened, { name: 'Projects', rows: 2 });
  await closeApp();
  gate('Reapertura y round-trip', 'passed', 'Base, propiedades, filas, páginas y archivos sobreviven reinicio; JSON reconstruye semánticamente las páginas de fila.');

  const Database = require('better-sqlite3');
  const db = new Database(vault.path, { readonly: true, fileMustExist: true });
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  Object.assign(report.metrics, {
    databases: db.prepare('SELECT COUNT(*) AS n FROM db_databases').get().n,
    rows: db.prepare('SELECT COUNT(*) AS n FROM db_rows').get().n,
    pages: db.prepare('SELECT COUNT(*) AS n FROM pages').get().n,
    blobs: db.prepare('SELECT COUNT(*) AS n FROM db_blobs').get().n,
    exportBytes: fs.statSync(imported.exportPath).size,
  });
  db.close();
  report.databaseAudit = fs.existsSync(auditFile) ? fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  assert.ok(report.databaseAudit.length > 0);
  assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []);
  assert.deepEqual(report.console.errors.filter((message) => !/favicon|Autofill|ERR_CONNECTION_REFUSED/i.test(message)), []);
  gate('Integridad y aislamiento', 'passed', `${report.databaseAudit.length} aperturas SQLite confinadas al perfil QA; quick_check=ok; FK=0.`);
  report.outcome = 'passed';
} catch (error) {
  report.outcome = 'failed'; report.failure = String(error?.stack ?? error); gate('Resultado', 'failed', report.failure); throw error;
} finally {
  await closeApp(); report.finishedAt = new Date().toISOString();
  const paths = await writeNotionParityReport(outputDir, report);
  console.log(`Loop 18 report: ${paths.htmlPath}`);
  await profile.cleanup();
}
