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
const require = createRequire(import.meta.url); const marker = '--electron-loop-12';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker, ...process.argv.slice(2)], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  }); process.exit(0);
}
const option = (name) => { const inline = process.argv.find((value) => value.startsWith(`--${name}=`)); if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : null; };
const retain = process.argv.includes('--retain'); const skipBuild = process.argv.includes('--skip-build');
const runId = `loop-12-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId)); await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl'); const exportDir = path.join(profile.profilePath, 'exports');
const axePath = require.resolve('axe-core/axe.min.js'); const appVersion = require(path.join(repoRoot, 'package.json')).version;
const report = { format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 12, runId, startedAt: new Date().toISOString(), finishedAt: null,
  outcome: 'running', profile: { path: profile.profilePath, qaRoot: profile.qaRoot, retained: profile.retained }, gates: [], metrics: {}, screenshots: [],
  accessibility: [], console: { errors: [], pageErrors: [] }, databaseAudit: [], failure: null };
const gate = (name, status, detail = '') => report.gates.push({ name, status, detail });
const emptyFilter = { conjunction: 'and', conditions: [] }; let app = null; let vault; let fixture;
function environment() { const env = { ...process.env, NODUS_USERDATA: profile.profilePath, NODUS_QA_ROOT: profile.qaRoot,
  NODUS_QA_DATABASE_AUDIT_LOG: auditFile, NODUS_QA_EXPORT_DIR: exportDir, NODUS_QA_DATABASE_QUERY_DELAY_MS: '350', NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' }; delete env.ELECTRON_RUN_AS_NODE; return env; }
async function closeApp(target) { if (!target) return; const child = target.process(); let timer; const closed = await Promise.race([
  target.close().then(() => true, () => false), new Promise((resolve) => { timer = setTimeout(() => resolve(false), 5_000); })]);
  clearTimeout(timer); if (!closed && child.exitCode === null && !child.killed) child.kill('SIGKILL'); }
async function launchApp() { const target = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: environment() });
  const page = await target.firstWindow(); page.setDefaultTimeout(45_000); await page.addInitScript({ path: axePath });
  page.on('pageerror', (error) => report.console.pageErrors.push(String(error?.stack ?? error)));
  page.on('console', (message) => { if (message.type() === 'error') report.console.errors.push(message.text()); });
  await page.waitForLoadState('domcontentloaded'); await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate(async (version) => { localStorage.setItem('nodus.lastSeenVersion', version); localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1'); localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1'); sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1, firstVaultVersion: 1,
      tourComplete: true, advancedTourComplete: true, databasesTourComplete: true, mascotEnabled: false, theme: 'light', uiLanguage: 'es' }); }, appVersion);
  await page.reload(); await page.getByTestId('app-shell').waitFor(); return { app: target, page }; }
async function capture(page, label, theme, width, height) { await page.setViewportSize({ width, height });
  await page.evaluate((value) => window.nodus.updateSettings({ theme: value }), theme);
  await page.waitForFunction((value) => document.documentElement.classList.contains('dark') === (value === 'dark'), theme); await page.waitForTimeout(180);
  const file = path.join(outputDir, `${label}-${theme}-${width}x${height}.png`); await page.screenshot({ path: file });
  const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `${label} desborda a ${width}px/${theme}`);
  report.screenshots.push({ label, theme, viewport: `${width}x${height}`, path: file, layout }); }
async function auditA11y(page, label) { const violations = await page.evaluate(async () => (await window.axe.run(document, {
  runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } })).violations.map((item) => ({ id: item.id, impact: item.impact,
  nodes: item.nodes.slice(0, 12).map((node) => node.target) }))); report.accessibility.push({ label, violations });
  assert.deepEqual(violations.filter((item) => item.impact === 'critical' || item.impact === 'serious'), []); }
try {
  for (const script of ['test-database-visualizations.mjs','test-database-row-query.mjs','test-database-views-v2.mjs','test-ipc-contract.mjs','test-i18n-coverage.mjs']) {
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts', script)], { cwd: repoRoot, stdio: 'inherit' });
  }
  gate('Unidad, SQLite, contratos e i18n', 'passed', 'Cinco gráficos, nulos/cardinalidad, drilldown, clustering, feed, configuración, IPC y ocho idiomas.');
  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  gate('Typecheck y build', 'passed', skipBuild ? 'Build de esta revisión reutilizado.' : 'npm run build completado.');

  let page; ({ app, page } = await launchApp());
  vault = await page.evaluate(async () => { const created = await window.nodus.createVault({ name: 'Bucle 12 · visualizaciones', type: 'databases' });
    const switched = await window.nodus.switchVault(created.vault.id); if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1, firstVaultVersion: 1,
      tourComplete: true, advancedTourComplete: true, databasesTourComplete: true, mascotEnabled: false, theme: 'light', uiLanguage: 'es' });
    return created.vault; });
  assert.ok(path.resolve(vault.path).startsWith(path.resolve(profile.profilePath) + path.sep)); await page.reload(); await page.getByTestId('app-shell').waitFor();
  fixture = await page.evaluate(async ({ runId, emptyFilter }) => {
    const rows = Array.from({ length: 1000 }, (_, index) => [`Elemento ${String(index).padStart(4, '0')}`,
      ['Pendiente','En curso','Completo'][index % 3], String(index % 101), `2026-08-${String(index % 28 + 1).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00`]);
    const database = await window.nodus.createDatabaseFromCsv(`Panel ejecutivo ${runId}`, ['Nombre','Estado','Puntuación','Fecha'], rows,
      ['title','status','number','date']); const detail = await window.nodus.getDatabaseDetail(database.id);
    const byName = Object.fromEntries(detail.columns.map((column) => [column.name, column]));
    const location = await window.nodus.createDatabaseColumn(database.id, 'Ubicación', 'location');
    let cursor = null; const rowIds = []; do { const result = await window.nodus.queryDatabaseRows({ databaseId: database.id, cursor, limit: 500 });
      rowIds.push(...result.rows.map((row) => row.id)); cursor = result.nextCursor; } while (cursor);
    const changes = rowIds.slice(0, 240).map((rowId, index) => ({ rowId, columnId: location.id, raw: JSON.stringify({ name: `Sede ${index}`,
      address: `Dirección ${index}`, latitude: -55 + (index % 20) * 5, longitude: -160 + Math.floor(index / 20) * 28 }) }));
    await window.nodus.setDatabaseCellsBulk({ databaseId: database.id, changes });
    const createView = (name, layout, config, extras = {}) => window.nodus.createDatabaseView(database.id,
      { name, layout, filter: emptyFilter, sorts: [], config: { layout, ...config }, ...extras });
    const bars = await createView('Barras por estado', 'chart', { chart: { type: 'bar', xColumnId: byName.Estado.id, yColumnId: null, aggregation: 'count', seriesColumnId: null } });
    const line = await createView('Línea de puntuación', 'chart', { chart: { type: 'line', xColumnId: byName.Fecha.id, yColumnId: byName.Puntuación.id, aggregation: 'average', seriesColumnId: byName.Estado.id } });
    const area = await createView('Área por fecha', 'chart', { chart: { type: 'area', xColumnId: byName.Fecha.id, yColumnId: byName.Puntuación.id, aggregation: 'sum', seriesColumnId: null } });
    const donut = await createView('Donut de estados', 'chart', { chart: { type: 'donut', xColumnId: byName.Estado.id, yColumnId: null, aggregation: 'count', seriesColumnId: null } });
    const scatter = await createView('Dispersión', 'chart', { chart: { type: 'scatter', xColumnId: byName.Puntuación.id, yColumnId: byName.Puntuación.id, aggregation: 'average', seriesColumnId: null } });
    const map = await createView('Mapa de sedes', 'map', { locationColumnId: location.id, cluster: true, cardPropertyIds: [byName.Estado.id] });
    const feed = await createView('Feed cronológico', 'feed', { dateColumnId: byName.Fecha.id, includePageChanges: true, cardPropertyIds: [byName.Estado.id] });
    const dashboard = await createView('Dashboard global', 'dashboard', { filter: { type: 'condition', columnId: byName.Estado.id, op: 'isAnyOf', value: [detail.columns.find((column) => column.name === 'Estado').options[1].id] },
      widgets: [bars, line, map, feed].map((view, index) => ({ id: `widget-${view.id}`, viewId: view.id, x: index % 2 * 6, y: Math.floor(index / 2) * 4, width: 6, height: 4 })) });
    const locked = await createView('Dashboard bloqueado', 'dashboard', { widgets: [{ id: `widget-${bars.id}`, viewId: bars.id, x: 0, y: 0, width: 12, height: 4 }] },
      { scope: 'shared', ownerActorId: 'remote-owner', editPermission: 'owner' });
    const invalid = await createView('Gráfico con error', 'chart', { chart: { type: 'bar', xColumnId: 'missing-column', yColumnId: null, aggregation: 'count', seriesColumnId: null } });
    const empty = await window.nodus.createDatabase('Visualización vacía', 'chart'); const emptyTitle = await window.nodus.createDatabaseColumn(empty.id, 'Nombre', 'title');
    await window.nodus.createDatabaseView(empty.id, { name: 'Gráfico vacío', layout: 'chart', filter: emptyFilter, sorts: [], config: { layout: 'chart', chart: { type: 'bar', xColumnId: emptyTitle.id, aggregation: 'count' } } });
    return { database, columns: { ...byName, Ubicación: location }, rowIds, bars, line, area, donut, scatter, map, feed, dashboard, locked, invalid, empty };
  }, { runId, emptyFilter });
  gate('Vault y fixture por APIs reales', 'passed', 'Vault aislado, 1.000 filas/páginas, 240 ubicaciones y nueve vistas versionadas.');

  await page.reload(); await page.getByTestId('app-shell').waitFor(); await page.getByRole('button', { name: fixture.database.name, exact: true }).first().click();
  await page.getByRole('button', { name: 'Barras por estado', exact: true }).click(); await page.getByTestId('database-visualization-loading').waitFor();
  await capture(page, 'chart-loading', 'light', 1024, 768); await page.getByTestId('database-visualization-loading').waitFor({ state: 'detached' });
  await page.getByTestId('database-chart-svg').waitFor(); assert.equal(await page.getByTestId('chart-point').count(), 3);
  await page.getByTestId('chart-point').first().focus(); await page.keyboard.press('Enter'); await page.getByTestId('database-chart-drilldown').waitFor();
  assert.equal(await page.getByTestId('database-chart-drilldown').locator('div.flex-1 button').count(), 50);
  await page.getByTestId('database-chart-drilldown').getByRole('button', { name: 'Cargar más' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="database-chart-drilldown"] div.flex-1 button').length >= 100);
  await capture(page, 'chart-drilldown', 'light', 1440, 1000); await auditA11y(page, 'chart-drilldown');
  await page.getByTestId('database-chart-drilldown').getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: 'SVG', exact: true }).click(); await page.getByText('Gráfico exportado a SVG.', { exact: true }).waitFor();
  const svgFile = fs.readdirSync(exportDir).find((file) => file.endsWith('.svg')); assert.ok(svgFile);
  const pngExport = await page.evaluate(({ databaseId, svg }) => window.nodus.exportDatabaseChart({ databaseId, title: 'Gráfico QA PNG', format: 'png', svg }),
    { databaseId: fixture.database.id, svg: fs.readFileSync(path.join(exportDir, svgFile), 'utf8') });
  assert.equal(pngExport.canceled, false); assert.ok(path.resolve(pngExport.path).startsWith(path.resolve(exportDir) + path.sep)); assert.ok(fs.existsSync(pngExport.path));
  for (const name of ['Línea de puntuación','Área por fecha','Donut de estados','Dispersión']) { await page.getByRole('button', { name, exact: true }).click();
    await page.getByTestId('database-visualization-loading').waitFor({ state: 'detached' }); await page.getByTestId('database-chart-view').waitFor(); }
  await capture(page, 'chart-scatter', 'dark', 1024, 768); gate('Gráficos y drilldown', 'passed', 'Barra, línea, área, donut y dispersión; 100 filas paginadas; SVG y PNG reales.');

  await page.getByRole('button', { name: 'Mapa de sedes', exact: true }).click(); await page.getByTestId('database-visualization-loading').waitFor();
  await page.getByTestId('database-visualization-loading').waitFor({ state: 'detached' }); await page.getByTestId('database-map-canvas').waitFor();
  const clustered = await page.getByTestId('map-marker').count(); assert.ok(clustered < 240); await page.getByRole('button', { name: 'Separar marcadores' }).click();
  await page.waitForFunction((before) => document.querySelectorAll('[data-testid="map-marker"]').length > before, clustered);
  await page.getByTestId('map-marker').filter({ hasText: /^1$/ }).last().click(); await page.getByTestId('database-record-modal').waitFor();
  await page.getByTestId('database-record-modal').getByRole('button', { name: 'Cerrar' }).click(); await capture(page, 'map-unclustered', 'light', 1440, 1000);
  await page.getByRole('button', { name: 'Feed cronológico', exact: true }).click(); await page.getByTestId('database-visualization-loading').waitFor();
  await page.getByTestId('database-visualization-loading').waitFor({ state: 'detached' });
  assert.equal(await page.getByTestId('feed-item').count(), 200); await capture(page, 'feed-dark', 'dark', 1024, 768); await auditA11y(page, 'feed-dark');
  gate('Mapa y feed', 'passed', 'Clustering/separación y apertura de ficha; feed cronológico acotado a 200 elementos.');

  await page.getByRole('button', { name: 'Dashboard global', exact: true }).click(); await page.getByTestId('database-dashboard-view').waitFor();
  assert.equal(await page.getByTestId('dashboard-widget').count(), 4); await page.getByTestId('database-visualization-loading').first().waitFor({ state: 'detached' });
  const shared = await page.evaluate(({ databaseId, statusId, statusOptionId }) => Promise.all([
    window.nodus.queryDatabaseChart({ databaseId, xColumnId: statusId, aggregation: 'count', type: 'bar', filter: { type: 'condition', columnId: statusId, op: 'isAnyOf', value: [statusOptionId] } }),
    window.nodus.queryDatabaseRows({ databaseId, filter: { type: 'condition', columnId: statusId, op: 'isAnyOf', value: [statusOptionId] }, limit: 1 }),
  ]), { databaseId: fixture.database.id, statusId: fixture.columns.Estado.id, statusOptionId: fixture.columns.Estado.options[1].id });
  assert.equal(shared[0].points.reduce((sum, point) => sum + point.rowCount, 0), shared[1].totalCount);
  await capture(page, 'dashboard-wide', 'light', 1440, 1000); await capture(page, 'dashboard-responsive', 'dark', 1024, 768); await auditA11y(page, 'dashboard-responsive');
  gate('Dashboard y filtros globales', 'passed', `Cuatro widgets responsive comparten un filtro de ${shared[1].totalCount} filas.`);

  await page.getByRole('button', { name: 'Gráfico con error', exact: true }).click(); await page.getByTestId('database-visualization-error').waitFor();
  await capture(page, 'visualization-error', 'light', 1024, 768);
  await page.getByRole('button', { name: 'Dashboard bloqueado', exact: true }).click(); await page.getByTestId('database-view-settings-button').click();
  await page.getByTestId('view-no-permission').waitFor(); await capture(page, 'dashboard-no-permission', 'dark', 1024, 768);
  await page.getByTestId('database-view-settings').getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: fixture.empty.name, exact: true }).first().click(); await page.getByRole('button', { name: 'Gráfico vacío', exact: true }).click();
  await page.getByTestId('database-chart-empty').waitFor(); await capture(page, 'chart-empty', 'light', 1024, 768);
  const dbExport = await page.evaluate((databaseId) => window.nodus.exportDatabase(databaseId, 'json'), fixture.database.id);
  assert.equal(dbExport.canceled, false); assert.ok(path.resolve(dbExport.path).startsWith(path.resolve(exportDir) + path.sep));
  const restored = await page.evaluate(async ({ databaseId, viewId }) => { const current = (await window.nodus.listDatabaseViews(databaseId)).find((view) => view.id === viewId);
    const changed = await window.nodus.updateDatabaseView(viewId, { config: { ...current.config, chart: { ...current.config.chart, type: 'donut' } }, expectedRevision: current.revision });
    return window.nodus.restoreDatabaseViewRevision(viewId, 1, changed.revision); }, { databaseId: fixture.database.id, viewId: fixture.bars.id });
  assert.equal(restored.config.chart.type, 'bar'); gate('Estados, exportación y restauración', 'passed', 'Cargando, vacío, error, sin permisos, export JSON y restauración verificados.');

  await closeApp(app); app = null; ({ app, page } = await launchApp()); const reopened = await page.evaluate(async ({ databaseId, xColumnId, locationColumnId, dateColumnId }) => ({
    rows: (await window.nodus.queryDatabaseRows({ databaseId, limit: 1 })).totalCount,
    chart: await window.nodus.queryDatabaseChart({ databaseId, xColumnId, aggregation: 'count', type: 'bar' }),
    map: await window.nodus.queryDatabaseMap({ databaseId, locationColumnId, limit: 500 }), feed: await window.nodus.queryDatabaseFeed({ databaseId, dateColumnId, limit: 200 }),
    views: await window.nodus.listDatabaseViews(databaseId),
  }), { databaseId: fixture.database.id, xColumnId: fixture.columns.Estado.id, locationColumnId: fixture.columns.Ubicación.id, dateColumnId: fixture.columns.Fecha.id });
  assert.equal(reopened.rows, 1000); assert.equal(reopened.chart.points.length, 3); assert.equal(reopened.map.totalCount, 240); assert.equal(reopened.feed.items.length, 200);
  assert.ok(reopened.views.some((view) => view.layout === 'dashboard')); gate('Cierre y reapertura', 'passed', '1.000 filas y todas las proyecciones rehidratadas desde SQLite real.');
  await closeApp(app); app = null;

  const Database = require('better-sqlite3'); const sqlite = new Database(vault.path, { readonly: true, fileMustExist: true });
  Object.assign(report.metrics, { quickCheck: sqlite.pragma('quick_check', { simple: true }), foreignKeyViolations: sqlite.pragma('foreign_key_check').length,
    rows: sqlite.prepare('SELECT COUNT(*) AS n FROM db_rows WHERE database_id=?').get(fixture.database.id).n,
    pages: sqlite.prepare('SELECT COUNT(*) AS n FROM pages page JOIN db_rows row ON row.id=page.row_id WHERE row.database_id=?').get(fixture.database.id).n,
    cells: sqlite.prepare('SELECT COUNT(*) AS n FROM db_cells WHERE database_id=?').get(fixture.database.id).n,
    chartPoints: reopened.chart.points.length, mapMarkers: reopened.map.markers.length, feedItems: reopened.feed.items.length, maxInteractivePayload: 500 }); sqlite.close();
  assert.equal(report.metrics.quickCheck, 'ok'); assert.equal(report.metrics.foreignKeyViolations, 0); assert.equal(report.metrics.pages, 1000);
  report.databaseAudit = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(report.databaseAudit.length > 0); assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []); assert.deepEqual(report.console.errors.filter((message) => !/favicon|Autofill/i.test(message)), []);
  gate('Integridad, aislamiento y consola', 'passed', `${report.databaseAudit.length} aperturas QA; quick_check=ok; FK=0; consola limpia.`); report.outcome = 'passed';
} catch (error) { report.outcome = 'failed'; report.failure = String(error?.stack ?? error); gate('Resultado', 'failed', report.failure); throw error; }
finally { await closeApp(app); report.finishedAt = new Date().toISOString(); const paths = await writeNotionParityReport(outputDir, report);
  console.log(`Loop 12 report: ${paths.htmlPath}`); await profile.cleanup(); }
