#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

import { DATABASE_FIXTURE_SCHEMA, materializeDatabaseFixture } from './fixtures.mjs';
import { prepareQaProfile } from './qa-paths.mjs';
import { writeNotionParityReport } from './report.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const marker = '--electron-notion-parity-runner';

if (!process.argv.includes(marker)) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [fileURLToPath(import.meta.url), marker, ...process.argv.slice(2)],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  process.exit(0);
}

function option(name) {
  const prefixed = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (prefixed) return prefixed.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const retain = process.argv.includes('--retain');
const skipBuild = process.argv.includes('--skip-build');
const rowCount = Number(option('rows') ?? 1_000);
if (!Number.isSafeInteger(rowCount) || rowCount < 1 || rowCount > 10_000) {
  throw new Error('--rows debe ser un entero entre 1 y 10000 en el Bucle 0; las escalas mayores se consumen por lotes.');
}

const runId = `loop-00-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });

const profile = await prepareQaProfile({
  repoRoot,
  requestedPath: option('profile'),
  retain,
});
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const exportDir = path.join(profile.profilePath, 'exports');
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const axePath = require.resolve('axe-core/axe.min.js');

const report = {
  format: 'nodus.notion-parity.qa',
  formatVersion: 1,
  loop: 0,
  runId,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  outcome: 'running',
  profile: { path: profile.profilePath, qaRoot: profile.qaRoot, retained: profile.retained },
  fixture: { rows: rowCount, columns: DATABASE_FIXTURE_SCHEMA.headers.length },
  gates: [],
  metrics: {},
  screenshots: [],
  accessibility: [],
  console: { errors: [], pageErrors: [] },
  databaseAudit: [],
  failure: null,
};

function gate(name, status, detail = '') {
  report.gates.push({ name, status, detail });
}

function elapsed(start) {
  return Math.round((performance.now() - start) * 100) / 100;
}

async function closeElectronApp(instance) {
  if (!instance) return;
  const child = instance.process();
  let timeout;
  const closed = instance.close().then(() => true, () => false);
  const clean = await Promise.race([
    closed,
    new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 5_000); }),
  ]);
  clearTimeout(timeout);
  if (!clean && child.exitCode === null && !child.killed) child.kill('SIGKILL');
}

function launchEnvironment() {
  const childEnv = {
    ...process.env,
    NODUS_USERDATA: profile.profilePath,
    NODUS_QA_ROOT: profile.qaRoot,
    NODUS_QA_DATABASE_AUDIT_LOG: auditFile,
    NODUS_QA_EXPORT_DIR: exportDir,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available',
    NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  return childEnv;
}

async function launchApp() {
  const launched = await electron.launch({
    executablePath: require('electron'),
    args: [repoRoot],
    env: launchEnvironment(),
  });
  let firstWindowTimer;
  const page = await Promise.race([
    launched.firstWindow(),
    new Promise((_, reject) => { firstWindowTimer = setTimeout(() => reject(new Error('Electron no abrió una ventana QA en 30 s.')), 30_000); }),
  ]).finally(() => clearTimeout(firstWindowTimer));
  page.setDefaultTimeout(30_000);
  // Init scripts are installed through the automation world before navigation, so the
  // production CSP remains unchanged and axe does not require unsafe-inline/unsafe-eval.
  await page.addInitScript({ path: axePath });
  page.on('pageerror', (error) => report.console.pageErrors.push(String(error?.stack ?? error)));
  page.on('console', (message) => {
    if (message.type() === 'error') report.console.errors.push(message.text());
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  }, appVersion);
  const startupModal = page.getByTestId('startup-update-modal');
  if (await startupModal.isVisible().catch(() => false)) {
    await startupModal.locator('.startup-update-primary').click();
    await startupModal.waitFor({ state: 'detached' });
  }
  return { launched, page };
}

async function openFixtureDatabase(page, name) {
  await page.getByTestId('app-shell').waitFor();
  const entry = page.getByRole('button', { name, exact: true }).first();
  await entry.waitFor();
  await entry.click();
  await page.getByRole('main').waitFor();
}

async function auditAccessibility(page, label) {
  assert.equal(await page.evaluate(() => typeof window.axe), 'object', 'axe-core init script is available');
  const result = await page.evaluate(async () => {
    const context = document.querySelector('main') ?? document;
    const audit = await window.axe.run(context, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    });
    return audit.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      nodes: violation.nodes.slice(0, 10).map((node) => ({ target: node.target, summary: node.failureSummary })),
    }));
  });
  report.accessibility.push({ label, violations: result });
  return result.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
}

async function capture(page, { label, theme, width, height }) {
  await page.setViewportSize({ width, height });
  await page.evaluate((nextTheme) => window.nodus.updateSettings({ theme: nextTheme }), theme);
  await page.waitForFunction((nextTheme) => document.documentElement.classList.contains('dark') === (nextTheme === 'dark'), theme);
  await page.waitForTimeout(150);
  const fileName = `${label}-${theme}-${width}x${height}.png`;
  const shotPath = path.join(outputDir, fileName);
  await page.screenshot({ path: shotPath, fullPage: false });
  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    activeTag: document.activeElement?.tagName ?? null,
    backupBannerOverlapPairs: (() => {
      const banner = document.querySelector('[data-testid="backup-health-banner"]');
      if (!banner) return [];
      const children = [...banner.children].map((element, index) => ({ index, rect: element.getBoundingClientRect() }));
      const overlaps = [];
      for (let left = 0; left < children.length; left += 1) {
        for (let right = left + 1; right < children.length; right += 1) {
          const a = children[left].rect;
          const b = children[right].rect;
          const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (width > 1 && height > 1) overlaps.push([children[left].index, children[right].index]);
        }
      }
      return overlaps;
    })(),
  }));
  report.screenshots.push({ label, theme, viewport: `${width}x${height}`, path: shotPath, layout });
  return layout;
}

async function readRssKb(pid) {
  try {
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) || null;
  } catch {
    return null;
  }
}

let app = null;
let createdVault = null;
let databaseId = null;
let titleColumnId = null;
let firstRowId = null;
let exportedPath = null;
const fixtureName = `QA Notion Parity ${runId}`;

try {
  if (!skipBuild || !existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) {
    const start = performance.now();
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
    report.metrics.buildMs = elapsed(start);
  }
  gate('Build y typecheck', 'passed', skipBuild ? 'Build existente reutilizada por petición.' : 'npm run build completado.');

  const startupStart = performance.now();
  ({ launched: app, page: report._page } = await launchApp());
  let page = report._page;
  delete report._page;
  report.metrics.firstRendererMountMs = elapsed(startupStart);

  createdVault = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Notion parity QA', type: 'databases' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 5,
      recoverySetupVersion: 1,
      tourComplete: true,
      advancedTourComplete: true,
      databasesTourComplete: true,
      mascotEnabled: false,
      theme: 'light',
      uiLanguage: 'es',
    });
    return created.vault;
  });
  assert.ok(createdVault.path.startsWith(profile.profilePath), 'the real vault lives under the isolated profile');
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await capture(page, { label: 'empty', theme: 'light', width: 1440, height: 1000 });
  gate('Vault real aislado', 'passed', createdVault.path);

  const fixtureRows = materializeDatabaseFixture(rowCount);
  const importStart = performance.now();
  const created = await page.evaluate(async ({ name, headers, rows, types }) => {
    const database = await window.nodus.createDatabaseFromCsv(name, headers, rows, types);
    const detail = await window.nodus.getDatabaseDetail(database.id);
    const allRows = await window.nodus.listDatabaseRows(database.id, { sort: 'position' });
    const title = detail.columns.find((column) => column.type === 'title');
    if (!title || !allRows[0]) throw new Error('Fixture incompleto.');
    await window.nodus.setDatabaseCell(allRows[0].id, title.id, 'Registro editado y persistido');
    const exported = await window.nodus.exportDatabase(database.id, 'json');
    return {
      databaseId: database.id,
      titleColumnId: title.id,
      firstRowId: allRows[0].id,
      rowsTransferred: allRows.length,
      exported,
    };
  }, {
    name: fixtureName,
    headers: DATABASE_FIXTURE_SCHEMA.headers,
    rows: fixtureRows,
    types: DATABASE_FIXTURE_SCHEMA.types,
  });
  report.metrics.importMs = elapsed(importStart);
  report.metrics.rowsTransferredByLegacyList = created.rowsTransferred;
  ({ databaseId, titleColumnId, firstRowId } = created);
  exportedPath = created.exported.path;
  assert.equal(created.exported.canceled, false);
  assert.ok(exportedPath?.startsWith(exportDir));
  const exported = JSON.parse(await readFile(exportedPath, 'utf8'));
  assert.equal(exported.rows.length, rowCount);
  gate('Creación, edición y exportación por IPC real', 'passed', `${rowCount} filas; ${path.basename(exportedPath)}`);

  await page.reload();
  await openFixtureDatabase(page, fixtureName);
  await page.waitForFunction(async ({ rowId, columnId }) => {
    const row = await window.nodus.getDatabaseRow(rowId);
    return row?.cells[columnId] === 'Registro editado y persistido';
  }, { rowId: firstRowId, columnId: titleColumnId });

  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }]) {
    for (const theme of ['light', 'dark']) {
      const layout = await capture(page, { label: 'populated', theme, ...viewport });
      assert.ok(layout.documentWidth <= layout.viewportWidth + 1, `document overflow at ${viewport.width}px/${theme}`);
    }
  }
  const narrowLayout = await capture(page, { label: 'narrow', theme: 'light', width: 390, height: 844 });
  assert.deepEqual(narrowLayout.backupBannerOverlapPairs, [], 'backup banner controls must not overlap at 390px');

  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return { focused: false };
    const rect = active.getBoundingClientRect();
    return { focused: true, tag: active.tagName, visible: rect.width > 0 && rect.height > 0 };
  });
  assert.equal(focus.focused, true);
  assert.equal(focus.visible, true);
  report.metrics.keyboardFocus = focus;

  const seriousA11y = await auditAccessibility(page, 'database-populated-light-narrow');
  gate(
    'Visual, responsive y accesibilidad',
    seriousA11y.length === 0 ? 'passed' : 'failed',
    seriousA11y.length === 0 ? 'Claro/oscuro, 1440/1024/390, foco y WCAG AA.' : `${seriousA11y.length} infracciones serias/críticas.`,
  );
  gate('Estados no pertenecientes al Bucle 0', 'not-applicable', 'loading/error/sin permiso/conflicto se validarán en el bucle que introduzca cada estado.');
  report.metrics.mainProcessRssKb = await readRssKb(app.process().pid);

  await closeElectronApp(app);
  app = null;

  const reopenStart = performance.now();
  const reopened = await launchApp();
  app = reopened.launched;
  page = reopened.page;
  await openFixtureDatabase(page, fixtureName);
  const persisted = await page.evaluate(async ({ rowId, columnId, databaseId: id }) => {
    const row = await window.nodus.getDatabaseRow(rowId);
    const count = (await window.nodus.listDatabaseRows(id, { sort: 'position' })).length;
    return { value: row?.cells[columnId] ?? null, count };
  }, { rowId: firstRowId, columnId: titleColumnId, databaseId });
  report.metrics.reopenMs = elapsed(reopenStart);
  assert.deepEqual(persisted, { value: 'Registro editado y persistido', count: rowCount });
  gate('Cierre y reapertura real', 'passed', `${persisted.count} filas y edición persistida.`);
  await closeElectronApp(app);
  app = null;

  const Database = require('better-sqlite3');
  const sqlite = new Database(createdVault.path, { readonly: true, fileMustExist: true });
  try {
    report.metrics.sqliteQuickCheck = sqlite.pragma('quick_check', { simple: true });
    report.metrics.sqliteCounts = {
      databases: sqlite.prepare('SELECT COUNT(*) AS n FROM db_databases').get().n,
      rows: sqlite.prepare('SELECT COUNT(*) AS n FROM db_rows').get().n,
      cells: sqlite.prepare('SELECT COUNT(*) AS n FROM db_cells').get().n,
    };
    report.metrics.queryPlans = {
      rowsByPosition: sqlite.prepare('EXPLAIN QUERY PLAN SELECT id FROM db_rows WHERE database_id = ? ORDER BY position, id LIMIT 200').all(databaseId),
      cellsByRow: sqlite.prepare('EXPLAIN QUERY PLAN SELECT column_id, value_text FROM db_cells WHERE row_id = ?').all(firstRowId),
    };
    assert.equal(report.metrics.sqliteQuickCheck, 'ok');
    assert.equal(report.metrics.sqliteCounts.rows, rowCount);
  } finally {
    sqlite.close();
  }
  gate('SQLite real, integridad y planes SQL', 'passed', JSON.stringify(report.metrics.sqliteCounts));

  const auditText = await readFile(auditFile, 'utf8');
  report.databaseAudit = auditText.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(report.databaseAudit.length >= 2, 'database open audit contains the default and QA vault');
  for (const event of report.databaseAudit) {
    assert.ok(event.path.startsWith(profile.profilePath), `audited path escaped QA profile: ${event.path}`);
  }
  await copyFile(auditFile, path.join(outputDir, 'database-audit.jsonl'));
  gate('Auditoría de rutas', 'passed', `${report.databaseAudit.length} aperturas; todas bajo ${profile.profilePath}`);

  assert.equal(report.console.pageErrors.length, 0, `renderer page errors: ${report.console.pageErrors.join('\n')}`);
  const unexpectedConsoleErrors = report.console.errors.filter((message) => !/favicon|Autofill/i.test(message));
  assert.equal(unexpectedConsoleErrors.length, 0, `renderer console errors: ${unexpectedConsoleErrors.join('\n')}`);
  gate('Consola del renderer', 'passed', 'Sin pageerror ni console.error inesperados.');

  const failedGates = report.gates.filter((item) => item.status === 'failed');
  assert.equal(failedGates.length, 0, failedGates.map((item) => `${item.name}: ${item.detail}`).join('\n'));
  report.outcome = 'passed';
} catch (error) {
  report.outcome = 'failed';
  report.failure = String(error?.stack ?? error);
  throw error;
} finally {
  await closeElectronApp(app);
  report.finishedAt = new Date().toISOString();
  const paths = await writeNotionParityReport(outputDir, report);
  console.log(`[notion-parity] ${report.outcome}: ${paths.htmlPath}`);
  await profile.cleanup();
}
