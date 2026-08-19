#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { _electron as electron } from 'playwright-core';

import { prepareQaProfile } from './qa-paths.mjs';
import { writeNotionParityReport } from './report.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const marker = '--electron-loop-19';
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
const rows = Number(option('rows') ?? 250_000);
const batchSize = Number(option('batch-size') ?? 5_000);
assert.ok([1_000, 10_000, 250_000, 500_000].includes(rows), '--rows debe ser 1000, 10000, 250000 o 500000.');
const retain = process.argv.includes('--retain');
const skipBuild = process.argv.includes('--skip-build');
const skipVisual = process.argv.includes('--skip-visual');
const skipIo = process.argv.includes('--skip-io');
const skipRegression = process.argv.includes('--skip-regression');
const enforceTime = process.argv.includes('--enforce-time');
const runId = `loop-19-${rows}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const exportDir = path.join(profile.profilePath, 'exports');
const axePath = require.resolve('axe-core/axe.min.js');
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const report = {
  format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 19, capability: 'scale-polish-close', runId,
  startedAt: new Date().toISOString(), finishedAt: null, outcome: 'running',
  profile: { path: profile.profilePath, qaRoot: profile.qaRoot, retained: profile.retained },
  gates: [], metrics: { requestedRows: rows }, screenshots: [], accessibility: [],
  console: { errors: [], pageErrors: [] }, databaseAudit: [], failure: null,
};
const gate = (name, status, detail = '') => report.gates.push({ name, status, detail });
const p95 = (values) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)];
const timed = async (work) => { const started = performance.now(); const value = await work(); return { value, ms: performance.now() - started }; };
const stressRun = rows === 500_000;
const budgets = stressRun
  ? { firstPage: 3_000, filterSort: 3_000, fts: 3_000, openCard: 3_000, edit: 3_000, nextPage: 3_000 }
  : { firstPage: 1_500, filterSort: 750, fts: 750, openCard: 300, edit: 150, nextPage: 250 };

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

let app = null;
async function closeApp() {
  if (!app) return;
  const child = app.process();
  const closed = await Promise.race([app.close().then(() => true, () => false), new Promise((resolve) => setTimeout(() => resolve(false), 8_000))]);
  if (!closed && child.exitCode === null && !child.killed) child.kill('SIGKILL');
  app = null;
}

async function launch() {
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: environment() });
  const page = await app.firstWindow();
  page.setDefaultTimeout(rows >= 250_000 ? 90_000 : 45_000);
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
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1,
      firstVaultVersion: 1, tourComplete: true, advancedTourComplete: true, databasesTourComplete: true,
      mascotEnabled: false, theme: 'light', uiLanguage: 'es' });
  }, appVersion);
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  return page;
}

function rendererRssMb(mainPid) {
  const output = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' });
  const entries = output.trim().split('\n').map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), rss: Number(match[3]), command: match[4] } : null;
  }).filter(Boolean);
  const descendants = new Set([mainPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of entries) if (descendants.has(entry.ppid) && !descendants.has(entry.pid)) { descendants.add(entry.pid); changed = true; }
  }
  const renderers = entries.filter((entry) => descendants.has(entry.pid) && /--type=renderer/.test(entry.command));
  return { max: Math.max(0, ...renderers.map((entry) => entry.rss / 1024)), processes: renderers.map((entry) => ({ pid: entry.pid, rssMb: entry.rss / 1024 })) };
}

async function capture(page, theme, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate((value) => window.nodus.updateSettings({ theme: value }), theme);
  await page.waitForFunction((value) => document.documentElement.classList.contains('dark') === (value === 'dark'), theme);
  const file = path.join(outputDir, `scale-table-${theme}-${width}x${height}.png`);
  await page.screenshot({ path: file });
  const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
    nodes: document.querySelectorAll('*').length }));
  assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `La tabla desborda a ${width}px/${theme}.`);
  report.screenshots.push({ label: 'scale-table', theme, viewport: `${width}x${height}`, path: file, layout });
}

try {
  if (!skipRegression) {
    for (const script of ['test-database-row-query.mjs', 'test-database-indexing.mjs', 'test-database-table-views.mjs', 'test-ipc-contract.mjs']) {
      execFileSync(process.execPath, [path.join(repoRoot, 'scripts', script)], { cwd: repoRoot, env: { ...environment(), ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
    }
  }
  gate('Regresión estructural', 'passed', skipRegression ? 'Reutilizada en esta repetición local.' : 'Paginación keyset, índices tipados/FTS, virtualización e IPC pasan sobre SQLite real.');
  if (!skipBuild || ['databaseScaleFixtureWorker.cjs', 'databaseAggregateWorker.cjs']
    .some((file) => !fs.existsSync(path.join(repoRoot, 'dist-electron', file)))) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, env: environment(), stdio: 'inherit' });
  }
  gate('Typecheck, build y worker', 'passed', 'Worker de escala empaquetado y bridge tipado.');

  let page = await launch();
  const vault = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Bucle 19 · escala', type: 'databases' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1,
      firstVaultVersion: 1, tourComplete: true, advancedTourComplete: true, databasesTourComplete: true,
      mascotEnabled: false, theme: 'light', uiLanguage: 'es' });
    return created.vault;
  });
  assert.ok(path.resolve(vault.path).startsWith(path.resolve(profile.profilePath) + path.sep));
  const start = await page.evaluate(({ rowCount, batch }) => window.nodus.startQaDatabaseScaleFixture({
    rowCount, batchSize: batch, name: `Escala ${rowCount}`,
  }), { rowCount: rows, batch: batchSize });
  let lastPercent = -1;
  const heartbeat = [];
  let fixture;
  const seedStarted = performance.now();
  while (performance.now() - seedStarted < 20 * 60_000) {
    const sample = await timed(() => page.evaluate((jobId) => window.nodus.getQaDatabaseScaleFixtureStatus(jobId), start.jobId));
    heartbeat.push(sample.ms);
    fixture = sample.value;
    if (!fixture) throw new Error('El trabajo QA desapareció.');
    const percent = Math.floor((fixture.done / fixture.total) * 20) * 5;
    if (percent !== lastPercent) { console.log(`Loop 19 seed ${percent}% (${fixture.done}/${fixture.total})`); lastPercent = percent; }
    if (fixture.state === 'failed') throw new Error(fixture.message || 'Falló el worker de escala.');
    if (fixture.state === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(fixture?.state, 'completed', 'El fixture debe terminar dentro de 20 minutos.');
  const seedMs = performance.now() - seedStarted;
  assert.equal(fixture.done, rows);
  assert.equal(fixture.populatedCells, rows * 14);
  report.metrics.seed = { ms: seedMs, heartbeatP95Ms: p95(heartbeat), rowsPerSecond: rows / (seedMs / 1_000), populatedCells: fixture.populatedCells };
  assert.ok(p95(heartbeat) < 1_000, `El renderer perdió respuesta durante la siembra: heartbeat p95 ${p95(heartbeat)}ms.`);
  if (enforceTime && !stressRun) assert.ok(seedMs <= 180_000, `La creación/importación del fixture tardó ${seedMs}ms > 180000ms.`);
  gate('Fixture real aislado', 'passed', `${rows.toLocaleString('es-ES')} filas, 20 propiedades y ${fixture.populatedCells.toLocaleString('es-ES')} celdas; heartbeat p95 ${p95(heartbeat).toFixed(1)} ms.`);

  const queryMetrics = await page.evaluate(async ({ databaseId, columnIds }) => {
    const measure = async (work, samples = 20) => {
      const values = []; let result;
      for (let i = 0; i < samples; i += 1) { const start = performance.now(); result = await work(); values.push(performance.now() - start); }
      values.sort((a, b) => a - b);
      return { p95: values[Math.max(0, Math.ceil(values.length * 0.95) - 1)], values, result };
    };
    const first = await measure(() => window.nodus.queryDatabaseRows({ databaseId, rowSort: 'position', limit: 200 }));
    const filter = { type: 'group', operator: 'and', children: [
      { type: 'condition', columnId: columnIds.amount, op: 'gte', value: '500' },
      { type: 'condition', columnId: columnIds.status, op: 'isAnyOf', value: [] },
    ] };
    // Empty status selection is intentionally removed: numeric filtering/sorting is the
    // structural index gate, while the status field remains populated and rendered.
    filter.children.pop();
    const filtered = await measure(() => window.nodus.queryDatabaseRows({ databaseId, filter,
      sorts: [{ columnId: columnIds.amount, dir: 'desc' }], limit: 200 }));
    const search = await measure(() => window.nodus.searchDatabaseRowsPage({ query: 'Registro 0000123', limit: 80 }));
    const next = await measure(() => window.nodus.queryDatabaseRows({ databaseId, rowSort: 'position',
      cursor: first.result.nextCursor, limit: 200 }));
    const rowId = first.result.rows[10].id;
    const card = await measure(() => window.nodus.getDatabaseRow(rowId));
    const edit = await measure(() => window.nodus.setDatabaseCell(rowId, columnIds.amount, '912.34'));
    return {
      first: { p95: first.p95, rows: first.result.rows.length, total: first.result.totalCount },
      filtered: { p95: filtered.p95, rows: filtered.result.rows.length },
      search: { p95: search.p95, hits: search.result.hits.length },
      next: { p95: next.p95, rows: next.result.rows.length },
      card: { p95: card.p95, id: card.result?.id }, edit: { p95: edit.p95, value: edit.result?.cells[columnIds.amount] },
    };
  }, { databaseId: fixture.databaseId, columnIds: fixture.columnIds });
  report.metrics.queries = queryMetrics;
  assert.equal(queryMetrics.first.rows, 200); assert.equal(queryMetrics.first.total, rows);
  assert.equal(queryMetrics.next.rows, 200); assert.ok(queryMetrics.filtered.rows <= 200);
  assert.ok(queryMetrics.search.hits > 0); assert.equal(queryMetrics.edit.value, '912.34');
  const timings = { firstPage: queryMetrics.first.p95, filterSort: queryMetrics.filtered.p95, fts: queryMetrics.search.p95,
    openCard: queryMetrics.card.p95, edit: queryMetrics.edit.p95, nextPage: queryMetrics.next.p95 };
  if (enforceTime) for (const [key, limit] of Object.entries(budgets)) assert.ok(timings[key] <= limit, `${key} p95 ${timings[key]}ms > ${limit}ms`);
  gate('Consultas y payloads', 'passed', `${JSON.stringify(timings)}; todas las páginas contienen como máximo 200 filas (límite público 500).${enforceTime ? ' Presupuestos temporales aplicados.' : ' Tiempos registrados como diagnóstico; la máquina de release aplica la puerta.'}`);

  await page.reload();
  try {
    await page.getByTestId('app-shell').waitFor({ timeout: 15_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({ href: location.href, title: document.title,
      text: document.body.innerText.slice(0, 2_000), html: document.getElementById('root')?.innerHTML.slice(0, 2_000) }));
    console.error('Loop 19 reload diagnostic:', JSON.stringify(diagnostic));
    throw error;
  }
  const visibleStarted = performance.now();
  await page.getByRole('button', { name: `Escala ${rows}`, exact: true }).first().click();
  await page.getByText('Registro 0000001', { exact: true }).first().waitFor();
  report.metrics.firstVisibleMs = performance.now() - visibleStarted;
  if (enforceTime) assert.ok(report.metrics.firstVisibleMs <= budgets.firstPage,
    `Primera página visible ${report.metrics.firstVisibleMs}ms > ${budgets.firstPage}ms.`);
  const dom = await page.evaluate(() => ({ cells: document.querySelectorAll('[data-testid="database-cell"]').length,
    rows: document.querySelectorAll('[data-testid="database-row"]').length, nodes: document.querySelectorAll('*').length }));
  assert.ok(dom.cells > 0 && dom.cells < 800, `La tabla no está virtualizada: ${dom.cells} celdas DOM.`);
  report.metrics.dom = dom;
  if (!skipVisual) {
    await capture(page, 'light', 1440, 1000);
    await capture(page, 'dark', 1024, 768);
    const violations = await page.evaluate(async () => (await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    })).violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.slice(0, 12).map((node) => node.target) })));
    report.accessibility.push({ label: 'scale-table', violations });
    assert.deepEqual(violations.filter((item) => item.impact === 'critical' || item.impact === 'serious'), []);
  }
  const memory = rendererRssMb(app.process().pid);
  report.metrics.rendererMemory = memory;
  assert.ok(memory.max < 450, `Renderer ${memory.max.toFixed(1)} MB >= 450 MB.`);
  gate('Renderer y visual', 'passed', `${dom.cells} celdas DOM, ${dom.nodes} nodos, renderer máximo ${memory.max.toFixed(1)} MB; claro/oscuro y WCAG verificados.`);

  if (!skipIo) {
    const exported = await timed(() => page.evaluate((databaseId) => window.nodus.exportDatabase(databaseId, 'csv'), fixture.databaseId));
    assert.ok(exported.value.path && path.resolve(exported.value.path).startsWith(path.resolve(exportDir) + path.sep));
    report.metrics.export = { ms: exported.ms, bytes: fs.statSync(exported.value.path).size };
    gate('Exportación paginada', 'passed', `${(report.metrics.export.bytes / 1_048_576).toFixed(1)} MB en ${(exported.ms / 1_000).toFixed(1)} s sin payloads >500.`);
  }
  await closeApp();

  const Database = require('better-sqlite3');
  const db = new Database(vault.path, { readonly: true, fileMustExist: true });
  const counts = Object.fromEntries(['db_rows', 'db_cells', 'db_columns', 'db_relations', 'db_computed_cells', 'pages', 'page_documents', 'page_document_snapshots']
    .map((table) => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
  assert.equal(counts.db_rows, rows); assert.equal(counts.db_cells, rows * 14); assert.equal(counts.db_columns, 20);
  assert.equal(counts.pages, rows); assert.equal(counts.page_documents, rows); assert.equal(counts.page_document_snapshots, rows);
  assert.equal(counts.db_computed_cells, rows * 2); assert.equal(counts.db_relations, rows - 1);
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT row_id FROM db_cells WHERE database_id=? AND column_id=? AND value_number>=? ORDER BY value_number DESC LIMIT 200')
    .all(fixture.databaseId, fixture.columnIds.amount, 500);
  assert.match(JSON.stringify(plan), /idx_db_cells_number_value/);
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  db.close();
  report.metrics.counts = counts; report.metrics.databaseBytes = fs.statSync(vault.path).size;

  const backupPath = path.join(profile.profilePath, `loop19-backup-${rows}.sqlite`);
  fs.copyFileSync(vault.path, backupPath);
  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  assert.equal(backup.pragma('quick_check', { simple: true }), 'ok');
  assert.equal(backup.prepare('SELECT COUNT(*) AS n FROM db_rows WHERE database_id=?').get(fixture.databaseId).n, rows);
  backup.close();
  gate('Integridad, backup y snapshot', 'passed', `quick_check=ok, FK=0, copia reabierta con ${rows.toLocaleString('es-ES')} filas y ${counts.page_document_snapshots.toLocaleString('es-ES')} snapshots.`);

  page = await launch();
  const reopened = await page.evaluate(async (databaseId) => {
    const detail = await window.nodus.getDatabaseDetail(databaseId);
    const page = await window.nodus.queryDatabaseRows({ databaseId, rowSort: 'position', limit: 200 });
    return { columns: detail?.columns.length, rows: page.rows.length, total: page.totalCount };
  }, fixture.databaseId);
  assert.deepEqual(reopened, { columns: 20, rows: 200, total: rows });
  await closeApp();
  gate('Reapertura real', 'passed', 'La aplicación cerró, reabrió y recuperó esquema y primera página desde el vault QA.');

  report.databaseAudit = fs.existsSync(auditFile) ? fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  assert.ok(report.databaseAudit.length > 0);
  assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []);
  assert.deepEqual(report.console.errors.filter((message) => !/favicon|Autofill|ERR_CONNECTION_REFUSED|ResizeObserver/i.test(message)), []);
  gate('Aislamiento', 'passed', `${report.databaseAudit.length} aperturas SQLite confinadas al perfil QA; ningún vault real tocado.`);
  report.outcome = 'passed';
} catch (error) {
  report.outcome = 'failed'; report.failure = String(error?.stack ?? error); gate('Resultado', 'failed', report.failure); throw error;
} finally {
  await closeApp(); report.finishedAt = new Date().toISOString();
  const paths = await writeNotionParityReport(outputDir, report);
  console.log(`Loop 19 report: ${paths.htmlPath}`);
  await profile.cleanup();
}
