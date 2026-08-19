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
const require = createRequire(import.meta.url); const marker = '--electron-loop-14';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker, ...process.argv.slice(2)], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  }); process.exit(0);
}
const option = (name) => { const inline = process.argv.find((value) => value.startsWith(`--${name}=`)); if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : null; };
const retain = process.argv.includes('--retain'); const skipBuild = process.argv.includes('--skip-build');
const runId = `loop-14-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId)); await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl'); const exportDir = path.join(profile.profilePath, 'exports');
const axePath = require.resolve('axe-core/axe.min.js'); const appVersion = require(path.join(repoRoot, 'package.json')).version;
const report = { format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 14, runId, startedAt: new Date().toISOString(), finishedAt: null,
  outcome: 'running', profile: { path: profile.profilePath, qaRoot: profile.qaRoot, retained: profile.retained }, gates: [], metrics: {}, screenshots: [],
  accessibility: [], console: { errors: [], pageErrors: [] }, databaseAudit: [], failure: null };
const gate = (name, status, detail = '') => report.gates.push({ name, status, detail }); let app = null; let vault; let fixture; let restoredVault;
function environment() { const env = { ...process.env, NODUS_USERDATA: profile.profilePath, NODUS_QA_ROOT: profile.qaRoot,
  NODUS_QA_DATABASE_AUDIT_LOG: auditFile, NODUS_QA_EXPORT_DIR: exportDir, NODUS_QA_DATABASE_TASK_DELAY_MS: '900',
  NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' };
  delete env.ELECTRON_RUN_AS_NODE; return env; }
async function closeApp(target) { if (!target) return; const child = target.process(); let timer; const closed = await Promise.race([
  target.close().then(() => true, () => false), new Promise((resolve) => { timer = setTimeout(() => resolve(false), 5_000); })]); clearTimeout(timer);
  if (!closed && child.exitCode === null && !child.killed) child.kill('SIGKILL'); }
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
async function capture(page, label, theme, width, height) { await page.setViewportSize({ width, height }); await page.evaluate((value) => window.nodus.updateSettings({ theme: value }), theme);
  await page.waitForFunction((value) => document.documentElement.classList.contains('dark') === (value === 'dark'), theme); await page.waitForTimeout(180);
  const file = path.join(outputDir, `${label}-${theme}-${width}x${height}.png`); await page.screenshot({ path: file });
  const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `${label} desborda a ${width}px/${theme}`);
  report.screenshots.push({ label, theme, viewport: `${width}x${height}`, path: file, layout }); }
async function auditA11y(page, label) { const violations = await page.evaluate(async () => (await window.axe.run(document, {
  runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } })).violations.map((item) => ({ id: item.id, impact: item.impact,
  nodes: item.nodes.slice(0, 12).map((node) => node.target) }))); report.accessibility.push({ label, violations });
  assert.deepEqual(violations.filter((item) => item.impact === 'critical' || item.impact === 'serious'), []); }
async function openDatabase(page, name) { await page.getByRole('button', { name, exact: true }).first().click(); await page.getByText('Proyecto raíz', { exact: true }).first().waitFor(); }
async function openWorkspace(page) { await page.getByTestId('database-task-workspace-button').click(); await page.getByTestId('database-task-workspace').waitFor(); }

try {
  for (const script of ['test-database-tasks.mjs','test-database-row-query.mjs','test-pages.mjs','test-sync-package.mjs','test-ipc-contract.mjs','test-i18n-coverage.mjs'])
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts', script)], { cwd: repoRoot, stdio: 'inherit' });
  gate('Unidad, SQLite, sync, contratos e i18n', 'passed', 'Migración v144, recurrencias, jerarquías, ciclos, duplicado, sprints, snapshot, IPC y ocho idiomas.');
  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  gate('Typecheck y build', 'passed', skipBuild ? 'Build de esta revisión reutilizado.' : 'npm run build completado.');

  let page; ({ app, page } = await launchApp());
  vault = await page.evaluate(async () => { const created = await window.nodus.createVault({ name: 'Bucle 14 · proyectos', type: 'databases' });
    const switched = await window.nodus.switchVault(created.vault.id); if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1, firstVaultVersion: 1,
      tourComplete: true, advancedTourComplete: true, databasesTourComplete: true, mascotEnabled: false, theme: 'light', uiLanguage: 'es' }); return created.vault; });
  assert.ok(path.resolve(vault.path).startsWith(path.resolve(profile.profilePath) + path.sep)); await page.reload(); await page.getByTestId('app-shell').waitFor();
  fixture = await page.evaluate(async () => {
    const database = await window.nodus.createDatabase('Proyecto editorial QA', 'table');
    const title = await window.nodus.createDatabaseColumn(database.id, 'Nombre', 'title');
    const status = await window.nodus.createDatabaseColumn(database.id, 'Estado', 'status');
    const pending = await window.nodus.addDatabaseOption(status.id, 'Pendiente', '#64748b', 'pending');
    const active = await window.nodus.addDatabaseOption(status.id, 'En curso', '#0f766e', 'in_progress');
    const date = await window.nodus.createDatabaseColumn(database.id, 'Fecha', 'date');
    const relation = await window.nodus.createDatabaseColumn(database.id, 'Relacionado', 'relation', {
      relationTargetKind: 'db_row', relationTargetDatabaseId: database.id, relationCardinality: 'many',
    });
    const rows = [];
    for (const [name, day] of [['Proyecto raíz','2026-08-14'],['Capítulo uno','2026-08-14'],['Revisión final','2026-08-14']]) {
      const row = await window.nodus.createDatabaseRow(database.id); rows.push(row.id); await window.nodus.setDatabaseCell(row.id, title.id, name);
      await window.nodus.setDatabaseCell(row.id, status.id, pending.id); await window.nodus.setDatabaseCell(row.id, date.id, day);
    }
    const document = await window.nodus.getPageForDatabaseRow(rows[1]); const saved = await window.nodus.savePageDocument({ pageId: document.page.id,
      expectedRevision: document.revision, actorId: 'qa-loop-14', blocks: [{ type: 'heading_2', content: { text: 'Guion del capítulo' } },
        { type: 'task', content: { text: 'Revisar estructura', checked: false } }], reason: 'fixture-loop-14' });
    if (!saved.ok) throw new Error('No se guardó la página de la tarea.');
    return { database, title, status, pending, active, date, relation, rows };
  });
  gate('Vault y fixture por APIs reales', 'passed', 'Vault databases aislado con tres filas/páginas, Status, fecha, relación y bloques.');

  await page.reload(); await openDatabase(page, fixture.database.name); await openWorkspace(page);
  await page.getByTestId('database-task-loading').waitFor(); await capture(page, 'tasks-loading', 'light', 1024, 768);
  await page.getByTestId('database-task-loading').waitFor({ state: 'detached' }); await page.getByTestId('database-template-empty').waitFor();
  await capture(page, 'templates-empty', 'dark', 1024, 768);
  await page.getByLabel('Nombre de la plantilla').fill('Entrega editorial semanal'); await page.getByLabel('Icono').fill('🗓️');
  await page.getByLabel('Título predeterminado').fill('Nueva entrega'); await page.getByLabel('Estado predeterminado').selectOption(fixture.pending.id);
  await page.getByLabel('Contenido inicial de la página').fill('Lista de comprobación de publicación.');
  await page.getByLabel('Relación predeterminada').selectOption(fixture.relation.id); await page.getByLabel('Fila relacionada').selectOption(fixture.rows[0]);
  await page.getByLabel('Recurrencia').selectOption('weekly'); await page.getByLabel('Próxima ejecución').fill('2035-01-31T10:00');
  await page.getByTestId('create-database-template').click(); await page.getByTestId('database-task-loading').waitFor({ state: 'detached' });
  const card = page.getByTestId('database-template-card').filter({ hasText: 'Entrega editorial semanal' }); await card.waitFor();
  await capture(page, 'templates-populated', 'light', 1440, 1000); await auditA11y(page, 'templates-populated');
  await card.getByRole('button', { name: 'Crear página ahora' }).click(); await page.getByTestId('database-task-loading').waitFor({ state: 'detached' });
  const templateState = await page.evaluate(async ({ databaseId, templateName, relationId }) => {
    const template = (await window.nodus.listDatabaseRowTemplates(databaseId)).find((item) => item.name === templateName);
    const once = await window.nodus.instantiateDatabaseRowTemplate(template.id, `${template.id}:qa-idempotent`);
    const twice = await window.nodus.instantiateDatabaseRowTemplate(template.id, `${template.id}:qa-idempotent`);
    const row = await window.nodus.getDatabaseRow(once.rowId); const page = await window.nodus.getPageForDatabaseRow(once.rowId);
    return { template, once, twice, row, page, relations: await window.nodus.listDatabaseRelations(once.rowId, relationId) };
  }, { databaseId: fixture.database.id, templateName: 'Entrega editorial semanal', relationId: fixture.relation.id });
  assert.equal(templateState.once.created, true); assert.equal(templateState.twice.created, false); assert.equal(templateState.once.rowId, templateState.twice.rowId);
  assert.equal(templateState.page.page.icon, '🗓️'); assert.match(templateState.page.blocks[0].normalizedText, /Lista de comprobación/); assert.equal(templateState.relations.length, 1);
  gate('Plantillas y recurrencia', 'passed', 'Creación UI, propiedades/bloques/icono/relación, instancia manual y occurrence key idempotente.');

  await page.getByRole('tab', { name: 'Subtareas' }).click(); let hierarchyForm = page.getByTestId('database-subitems-panel').locator('section').first();
  await hierarchyForm.locator('select').nth(0).selectOption(fixture.rows[1]); await hierarchyForm.locator('select').nth(1).selectOption(fixture.rows[0]);
  await page.getByRole('button', { name: 'Guardar jerarquía' }).click();
  await page.getByTestId('database-task-loading').waitFor({ state: 'detached' });
  await page.evaluate(({ child, parent }) => window.nodus.setDatabaseSubitemParent(child, parent), { child: fixture.rows[2], parent: fixture.rows[1] });
  await page.getByRole('tab', { name: 'Plantillas' }).click(); await page.getByRole('tab', { name: 'Subtareas' }).click();
  hierarchyForm = page.getByTestId('database-subitems-panel').locator('section').first(); await hierarchyForm.locator('select').nth(0).selectOption(fixture.rows[0]);
  await hierarchyForm.locator('select').nth(1).selectOption(fixture.rows[2]);
  await page.getByRole('button', { name: 'Guardar jerarquía' }).click(); await page.getByTestId('database-task-error').waitFor();
  assert.match(await page.getByTestId('database-task-error').innerText(), /ciclo/i); await capture(page, 'subitems-cycle-error', 'dark', 1024, 768);
  await hierarchyForm.locator('select').nth(0).selectOption(fixture.rows[0]); await hierarchyForm.locator('select').nth(1).selectOption('');
  await page.getByRole('button', { name: 'Guardar jerarquía' }).click();
  await page.getByTestId('database-task-loading').waitFor({ state: 'detached' }); await page.getByLabel('Fila original').selectOption(fixture.rows[1]);
  await page.getByLabel('Duplicar también las subtareas').check(); await page.getByTestId('duplicate-database-row').click(); await page.getByTestId('database-task-loading').waitFor({ state: 'detached' });
  const hierarchyState = await page.evaluate(async ({ databaseId, original }) => { const hierarchy = await window.nodus.listDatabaseRowHierarchy(databaseId, 500);
    const originalPage = await window.nodus.getPageForDatabaseRow(original); const copies = hierarchy.filter((row) => row.title === 'Capítulo uno');
    const deep = copies.find((row) => row.rowId !== original); return { hierarchy, copies, deepPage: deep ? await window.nodus.getPageForDatabaseRow(deep.rowId) : null }; },
    { databaseId: fixture.database.id, original: fixture.rows[1] });
  assert.ok(hierarchyState.copies.length >= 2); assert.match(hierarchyState.deepPage.blocks[0].normalizedText, /Guion del capítulo/);
  await page.getByLabel('Plana').check(); await page.getByTestId('database-task-loading').waitFor({ state: 'detached' });
  await capture(page, 'subitems-flat-deep-copy', 'light', 390, 844); await auditA11y(page, 'subitems-mobile');
  gate('Subitems y duplicado profundo', 'passed', 'Árbol de dos niveles, ciclo rechazado, modo plano persistente y página/subtarea duplicadas.');

  await page.getByRole('tab', { name: 'Dependencias' }).click(); await page.getByLabel('Propiedad de fecha').selectOption(fixture.date.id);
  await page.getByTestId('database-task-loading').waitFor({ state: 'detached' }); await page.getByLabel('Propiedad de estado').selectOption(fixture.status.id);
  await page.getByTestId('database-task-loading').waitFor({ state: 'detached' }); await page.getByLabel('Evitar fines de semana').check();
  await page.getByTestId('database-task-loading').waitFor({ state: 'detached' }); await page.getByLabel('Predecesora').selectOption(fixture.rows[0]);
  await page.getByLabel('Sucesora').selectOption(fixture.rows[1]); await page.getByTestId('add-database-dependency').click();
  await page.getByTestId('database-task-loading').waitFor({ state: 'detached' });
  await page.evaluate(({ first, second }) => window.nodus.addDatabaseRowDependency(first, second), { first: fixture.rows[1], second: fixture.rows[2] });
  const reversible = await page.evaluate(async ({ root, dateId }) => { const read = async () => (await window.nodus.getDatabaseRow(root)).cells[dateId]; const before = await read();
    const forward = await window.nodus.shiftDatabaseTaskDates(root, 1); const shifted = await read(); const backward = await window.nodus.shiftDatabaseTaskDates(root, -1);
    return { before, shifted, restored: await read(), forward, backward }; }, { root: fixture.rows[0], dateId: fixture.date.id });
  const dateStart = (value) => { try { return JSON.parse(value).start; } catch { return value; } };
  assert.match(reversible.shifted, /2026-08-17/); assert.equal(dateStart(reversible.restored), dateStart(reversible.before)); assert.equal(reversible.forward.length, 3);
  await page.getByRole('tab', { name: 'Subtareas' }).click(); await page.getByRole('tab', { name: 'Dependencias' }).click();
  await page.getByLabel('Predecesora').selectOption(fixture.rows[2]); await page.getByLabel('Sucesora').selectOption(fixture.rows[0]);
  await page.getByTestId('add-database-dependency').click(); await page.getByTestId('database-task-error').waitFor(); assert.match(await page.getByTestId('database-task-error').innerText(), /ciclo/i);
  await capture(page, 'dependencies-cycle-and-config', 'dark', 1440, 1000);
  gate('Dependencias y fechas', 'passed', 'DAG persistente, ciclo rechazado, viernes→lunes, tres dependientes desplazados y fecha semántica restaurada.');

  await page.getByRole('tab', { name: 'Sprints' }).click(); await capture(page, 'sprints-empty', 'light', 1024, 768);
  await page.getByLabel('Propiedad de sprint').selectOption(fixture.status.id); await page.getByTestId('database-task-loading').waitFor({ state: 'detached' });
  await page.getByLabel('Nombre del sprint').fill('Sprint editorial 01'); await page.getByRole('textbox', { name: 'Inicio', exact: true }).fill('2026-08-17');
  await page.getByRole('textbox', { name: 'Fin', exact: true }).fill('2026-08-28');
  await page.getByTestId('create-database-sprint').click(); await page.getByTestId('database-task-loading').waitFor({ state: 'detached' });
  await page.getByLabel('Sprint', { exact: true }).selectOption({ label: 'Sprint editorial 01' }); await page.getByLabel('Tarea', { exact: true }).selectOption(fixture.rows[0]);
  await page.getByRole('button', { name: 'Asignar', exact: true }).click(); await page.getByTestId('database-task-loading').waitFor({ state: 'detached' });
  const sprintCard = page.getByTestId('database-sprints-panel').locator('article').filter({ hasText: 'Sprint editorial 01' });
  await sprintCard.getByRole('button', { name: 'Activo', exact: true }).click();
  await page.getByTestId('database-task-loading').waitFor({ state: 'detached' }); await capture(page, 'sprints-populated', 'dark', 1024, 768); await auditA11y(page, 'sprints-populated');
  const sprintState = await page.evaluate((databaseId) => window.nodus.listDatabaseSprints(databaseId), fixture.database.id);
  assert.equal(sprintState[0].state, 'active'); assert.equal(sprintState[0].rowCount, 1);
  gate('Sprints', 'passed', 'Propiedad configurada, intervalo real, asignación de tarea y transición planned→active persistentes.');

  const saved = await page.evaluate(async (databaseId) => ({ exported: await window.nodus.exportDatabase(databaseId, 'json'), backup: await window.nodus.backupDatabase(),
    restoredVault: await window.nodus.createVault({ name: 'Bucle 14 · restaurado', type: 'databases' }) }), fixture.database.id);
  assert.equal(saved.exported.canceled, false); assert.ok(path.resolve(saved.exported.path).startsWith(path.resolve(exportDir) + path.sep));
  const exported = JSON.parse(fs.readFileSync(saved.exported.path, 'utf8')); assert.ok(exported.rows.some((row) => row.Nombre === 'Nueva entrega' && row._page.markdown.includes('Lista de comprobación')));
  assert.ok(path.resolve(saved.backup).startsWith(path.resolve(profile.profilePath) + path.sep)); restoredVault = saved.restoredVault.vault;
  assert.ok(path.resolve(restoredVault.path).startsWith(path.resolve(profile.profilePath) + path.sep));
  await closeApp(app); app = null; for (const suffix of ['-wal','-shm']) fs.rmSync(`${restoredVault.path}${suffix}`, { force: true }); fs.copyFileSync(saved.backup, restoredVault.path);
  ({ app, page } = await launchApp()); const switched = await page.evaluate((id) => window.nodus.switchVault(id), restoredVault.id); assert.equal(switched.ok, true);
  const restored = await page.evaluate(async (databaseId) => ({ templates: await window.nodus.listDatabaseRowTemplates(databaseId), hierarchy: await window.nodus.listDatabaseRowHierarchy(databaseId, 500),
    dependencies: await window.nodus.listDatabaseRowDependencies(databaseId), sprints: await window.nodus.listDatabaseSprints(databaseId), config: await window.nodus.getDatabaseTaskConfig(databaseId) }), fixture.database.id);
  assert.equal(restored.templates.length, 1); assert.ok(restored.hierarchy.length >= 7); assert.equal(restored.dependencies.length, 2); assert.equal(restored.sprints[0].state, 'active');
  assert.equal(restored.config.sprintColumnId, fixture.status.id); gate('Exportación, backup y restauración', 'passed', 'JSON contiene página instanciada y copia SQLite se abrió como vault separado con todo el modelo de proyectos.');

  await page.reload(); await openDatabase(page, fixture.database.name); await openWorkspace(page); await page.getByTestId('database-task-loading').waitFor({ state: 'detached' });
  await capture(page, 'restored-reopened-wide', 'light', 1440, 1000); await closeApp(app); app = null;
  const Database = require('better-sqlite3'); const sqlite = new Database(restoredVault.path, { readonly: true, fileMustExist: true });
  Object.assign(report.metrics, { quickCheck: sqlite.pragma('quick_check', { simple: true }), foreignKeyViolations: sqlite.pragma('foreign_key_check').length,
    templates: sqlite.prepare('SELECT COUNT(*) AS n FROM db_row_templates').get().n, templateRuns: sqlite.prepare('SELECT COUNT(*) AS n FROM db_template_runs').get().n,
    hierarchy: sqlite.prepare('SELECT COUNT(*) AS n FROM db_row_hierarchy').get().n, dependencies: sqlite.prepare('SELECT COUNT(*) AS n FROM db_row_dependencies').get().n,
    sprints: sqlite.prepare('SELECT COUNT(*) AS n FROM db_sprints').get().n, sprintRows: sqlite.prepare('SELECT COUNT(*) AS n FROM db_sprint_rows').get().n }); sqlite.close();
  assert.equal(report.metrics.quickCheck, 'ok'); assert.equal(report.metrics.foreignKeyViolations, 0);
  report.databaseAudit = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(report.databaseAudit.length > 0); assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []); assert.deepEqual(report.console.errors.filter((message) => !/favicon|Autofill/i.test(message)), []);
  gate('Reapertura, integridad, aislamiento y consola', 'passed', `${report.databaseAudit.length} aperturas QA; quick_check=ok; FK=0; consola limpia.`); report.outcome = 'passed';
} catch (error) { report.outcome = 'failed'; report.failure = String(error?.stack ?? error); gate('Resultado', 'failed', report.failure); throw error; }
finally { await closeApp(app); report.finishedAt = new Date().toISOString(); const paths = await writeNotionParityReport(outputDir, report);
  console.log(`Loop 14 report: ${paths.htmlPath}`); await profile.cleanup(); }
