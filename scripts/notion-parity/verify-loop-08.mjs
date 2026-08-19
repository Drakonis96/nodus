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
const marker = '--electron-loop-08';
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
const runId = `loop-08-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const exportDir = path.join(profile.profilePath, 'exports');
const axePath = require.resolve('axe-core/axe.min.js');
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const report = {
  format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 8, runId,
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
    NODUS_QA_DATABASE_QUERY_DELAY_MS: '700', NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
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

function recordRow(page, label) {
  return page.getByTestId('database-record-modal').locator('.database-record-row').filter({ hasText: label });
}

async function openColumn(page, name) {
  await page.getByRole('main').getByRole('button', { name, exact: true }).click();
}

async function closeColumnPopover(page) {
  const backdrop = page.locator('div.fixed.inset-0.z-20').last();
  if (await backdrop.count()) await backdrop.click({ position: { x: 4, y: 4 } });
}

let app = null;
let vault;
let fixture;
const projectsName = `Proyectos relacionales ${runId}`;
const tasksName = `Tareas calculadas ${runId}`;
try {
  for (const script of [
    'test-database-relations-formulas.mjs', 'test-database-typed-storage.mjs', 'test-database-row-query.mjs',
    'test-databases.mjs', 'test-databases-theme.mjs', 'test-ipc-contract.mjs', 'test-i18n-coverage.mjs',
  ]) execFileSync(process.execPath, [path.join(repoRoot, 'scripts', script)], { cwd: repoRoot, stdio: 'inherit' });
  gate('Unidad, SQLite, migración, dominio, IPC e i18n', 'passed', 'Relaciones/inversas, rollups tipados, AST, ciclos, v141 y siete idiomas.');
  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  gate('Typecheck y build', 'passed', skipBuild ? 'Build de esta revisión reutilizado.' : 'npm run build completado.');

  let page;
  ({ app, page } = await launchApp());
  vault = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Bucle 8 · relaciones y fórmulas', type: 'databases' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1,
      firstVaultVersion: 1, tourComplete: true, advancedTourComplete: true, databasesTourComplete: true,
      mascotEnabled: false, theme: 'light', uiLanguage: 'es' });
    return created.vault;
  });
  assert.ok(path.resolve(vault.path).startsWith(path.resolve(profile.profilePath) + path.sep));
  await page.reload(); await page.getByTestId('app-shell').waitFor();
  await capture(page, 'empty-relations', 'light', 1440, 1000);
  await capture(page, 'empty-relations', 'dark', 1024, 768);

  fixture = await page.evaluate(async ({ projectsName, tasksName }) => {
    const projects = await window.nodus.createDatabase(projectsName, 'table');
    const projectTitle = await window.nodus.createDatabaseColumn(projects.id, 'Proyecto', 'title');
    const tasks = await window.nodus.createDatabase(tasksName, 'table');
    const taskTitle = await window.nodus.createDatabaseColumn(tasks.id, 'Tarea', 'title');
    const effort = await window.nodus.createDatabaseColumn(tasks.id, 'Esfuerzo', 'number', { numberDecimals: 0 });
    const taskProject = await window.nodus.createDatabaseColumn(tasks.id, 'Proyecto relacionado', 'relation', {
      relationTargetKind: 'db_row', relationTargetDatabaseId: projects.id, relationCardinality: 'one',
    });
    const projectTasks = await window.nodus.createDatabaseColumn(projects.id, 'Tareas inversas', 'relation', {
      relationTargetKind: 'db_row', relationTargetDatabaseId: tasks.id, relationCardinality: 'many', relationInverseColumnId: taskProject.id,
    });
    await window.nodus.updateDatabaseColumn(taskProject.id, { config: { ...taskProject.config,
      relationTargetKind: 'db_row', relationTargetDatabaseId: projects.id, relationCardinality: 'one', relationInverseColumnId: projectTasks.id } });
    const doubled = await window.nodus.createDatabaseColumn(tasks.id, 'Esfuerzo doble', 'formula', {
      formula: { kind: 'arithmetic', op: 'multiply', operands: [{ kind: 'column', columnId: effort.id }, { kind: 'number', value: 2 }] },
      formulaDecimals: 0,
    });
    const advancedSource = `if(property("${effort.id}") >= 5, upper("prioridad"), "normal")`;
    const advanced = await window.nodus.createDatabaseColumn(tasks.id, 'Prioridad AST', 'formula', {
      formula: { kind: 'expression', source: advancedSource, resultKind: 'text', ast: { type: 'call', name: 'if', args: [
        { type: 'binary', op: 'gte', left: { type: 'property', columnId: effort.id }, right: { type: 'literal', value: 5 } },
        { type: 'call', name: 'upper', args: [{ type: 'literal', value: 'prioridad' }] }, { type: 'literal', value: 'normal' },
      ] } },
    });
    const p1 = await window.nodus.createDatabaseRow(projects.id); const p2 = await window.nodus.createDatabaseRow(projects.id);
    await window.nodus.setDatabaseCell(p1.id, projectTitle.id, 'Atlas'); await window.nodus.setDatabaseCell(p2.id, projectTitle.id, 'Bóreas');
    const taskRows = [];
    for (const [title, value, project] of [['Diseñar modelo', '8', p1], ['Migrar datos', '5', p1], ['Validar índices', '3', p2]]) {
      const row = await window.nodus.createDatabaseRow(tasks.id); taskRows.push(row);
      await window.nodus.setDatabaseCell(row.id, taskTitle.id, title); await window.nodus.setDatabaseCell(row.id, effort.id, value);
      await window.nodus.addDatabaseRelation(row.id, taskProject.id, 'db_row', project.id, null);
    }
    const total = await window.nodus.createDatabaseColumn(projects.id, 'Esfuerzo total', 'rollup', {
      rollupRelationColumnId: projectTasks.id, rollupTargetColumnId: effort.id, rollupFunction: 'sum',
    });
    const completion = await window.nodus.createDatabaseColumn(projects.id, 'Mediana esfuerzo', 'rollup', {
      rollupRelationColumnId: projectTasks.id, rollupTargetColumnId: effort.id, rollupFunction: 'median',
    });
    const exportResult = await window.nodus.exportDatabase(tasks.id, 'json');
    const rowCheck = await window.nodus.getDatabaseRow(taskRows[0].id);
    const projectCheck = await window.nodus.getDatabaseRow(p1.id);
    return { projects, tasks, projectTitle, taskTitle, effort, taskProject, projectTasks, doubled, advanced, total, completion,
      p1, p2, taskRows, exportResult, checks: { doubled: rowCheck.cells[doubled.id], advanced: rowCheck.cells[advanced.id],
        total: projectCheck.rollups[total.id], median: projectCheck.rollups[completion.id] } };
  }, { projectsName, tasksName });
  assert.deepEqual(fixture.checks, { doubled: '16', advanced: 'PRIORIDAD', total: '13', median: '6.5' });
  assert.ok(path.resolve(fixture.exportResult.path).startsWith(path.resolve(exportDir) + path.sep));
  gate('Vault, IPC y fixture reales', 'passed', 'Dos bases, relaciones inversas, 5 filas, rollups, fórmulas visual/AST y exportación dentro de QA.');

  await page.reload();
  const loading = page.getByText('Cargando…', { exact: true }).waitFor();
  await page.getByRole('button', { name: tasksName, exact: true }).first().click(); await loading;
  await page.getByText('Diseñar modelo', { exact: true }).first().waitFor();
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }]) {
    for (const theme of ['light', 'dark']) await capture(page, 'relation-grid', theme, viewport.width, viewport.height);
  }
  await auditA11y(page, 'relation-grid');

  await openColumn(page, 'Proyecto relacionado');
  await page.getByLabel('Cardinalidad').waitFor();
  await capture(page, 'relation-configuration', 'light', 1024, 768);
  await capture(page, 'relation-configuration', 'dark', 1024, 768);
  await closeColumnPopover(page);

  await page.getByTitle('Abrir ficha').first().click();
  const modal = page.getByTestId('database-record-modal'); await modal.waitFor();
  await capture(page, 'relation-record', 'light', 1440, 1000);
  await capture(page, 'relation-record-mobile', 'dark', 390, 844);
  await auditA11y(page, 'relation-record-mobile');
  await page.setViewportSize({ width: 1024, height: 768 });
  await recordRow(page, 'Proyecto relacionado').getByRole('button').first().click();
  await page.getByPlaceholder('Buscar…').waitFor();
  await capture(page, 'relation-picker', 'dark', 1024, 768);
  await page.locator('div.fixed.inset-0.z-40').last().click({ position: { x: 4, y: 4 } });
  await modal.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await openColumn(page, 'Esfuerzo doble');
  await page.getByRole('button', { name: 'Editar fórmula', exact: true }).click();
  await page.getByRole('heading', { name: /Fórmula: Esfuerzo doble/ }).waitFor();
  await capture(page, 'visual-formula', 'light', 1440, 1000);
  await capture(page, 'visual-formula', 'dark', 1024, 768);
  await auditA11y(page, 'visual-formula');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await closeColumnPopover(page);

  await openColumn(page, 'Prioridad AST');
  await page.getByRole('button', { name: 'Editar fórmula', exact: true }).click();
  const editor = page.getByTestId('formula-expression-editor'); await editor.waitFor();
  await capture(page, 'advanced-formula', 'light', 1440, 1000);
  await capture(page, 'advanced-formula-mobile', 'dark', 390, 844);
  await editor.fill('globalThis.process.exit()');
  await page.getByRole('alert').waitFor();
  await capture(page, 'formula-validation-error', 'light', 1024, 768);
  await auditA11y(page, 'formula-validation-error');
  assert.equal(await page.getByRole('button', { name: 'Guardar', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await closeColumnPopover(page);
  gate('Relaciones y fórmulas visuales', 'passed', 'Configuración, picker, ficha móvil, receta visual, AST, autocompletado y error seguro comprobados.');

  await page.getByRole('button', { name: projectsName, exact: true }).first().click();
  await page.getByText('Atlas', { exact: true }).first().waitFor();
  await capture(page, 'rollup-grid', 'light', 1440, 1000);
  await openColumn(page, 'Esfuerzo total');
  await page.getByText('Resultado materializado como Número').waitFor();
  await capture(page, 'rollup-configuration', 'dark', 1024, 768);
  await closeColumnPopover(page);
  gate('Rollups tipados', 'passed', 'Suma y mediana visibles, configuración y tipo materializado comprobados.');

  // Make one imported-style dangling link inside the isolated vault, then verify repair UI.
  await closeApp(app); app = null;
  const Database = require('better-sqlite3');
  let sqlite = new Database(vault.path);
  sqlite.prepare('UPDATE db_relations SET target_id=?, last_known_label=? WHERE row_id=? AND column_id=?')
    .run('missing-loop-08', 'Atlas (eliminado)', fixture.taskRows[0].id, fixture.taskProject.id);
  sqlite.close();
  ({ app, page } = await launchApp());
  await page.getByRole('button', { name: tasksName, exact: true }).first().click();
  await page.getByText('Diseñar modelo', { exact: true }).first().waitFor();
  await page.getByTitle('Abrir ficha').first().click();
  await recordRow(page, 'Proyecto relacionado').getByRole('button').first().click();
  await page.getByRole('button', { name: 'Reparar relación', exact: true }).click();
  await page.getByText('Selecciona el destino correcto para reparar el enlace.').waitFor();
  await capture(page, 'broken-relation-repair', 'light', 1024, 768);
  await page.getByPlaceholder('Buscar destino de sustitución…').fill('Atlas');
  await page.getByRole('button', { name: /Atlas/ }).last().click();
  await page.waitForTimeout(200);
  const repaired = await page.evaluate(async ({ rowId, columnId }) => (await window.nodus.listDatabaseRelations(rowId, columnId))[0],
    { rowId: fixture.taskRows[0].id, columnId: fixture.taskProject.id });
  assert.equal(repaired.targetId, fixture.p1.id); assert.equal(repaired.broken, false);
  gate('Rotura y reparación asistida', 'passed', 'Etiqueta histórica, estado roto, búsqueda y reparación persistente recorridos en Electron.');

  await closeApp(app); app = null;
  ({ app, page } = await launchApp());
  const reopened = await page.evaluate(async ({ fixture }) => ({
    relation: (await window.nodus.listDatabaseRelations(fixture.taskRows[0].id, fixture.taskProject.id))[0],
    task: await window.nodus.getDatabaseRow(fixture.taskRows[0].id), project: await window.nodus.getDatabaseRow(fixture.p1.id),
  }), { fixture });
  assert.equal(reopened.relation.targetId, fixture.p1.id);
  assert.equal(reopened.task.cells[fixture.doubled.id], '16');
  assert.equal(reopened.project.rollups[fixture.total.id], '13');
  gate('Cierre y reapertura', 'passed', 'Relación reparada, inversa y valores materializados rehidratados desde SQLite.');
  await closeApp(app); app = null;

  sqlite = new Database(vault.path, { readonly: true, fileMustExist: true });
  Object.assign(report.metrics, {
    quickCheck: sqlite.pragma('quick_check', { simple: true }), foreignKeyViolations: sqlite.pragma('foreign_key_check').length,
    relationCount: sqlite.prepare('SELECT COUNT(*) AS count FROM db_relations').get().count,
    inverseCount: sqlite.prepare('SELECT COUNT(*) AS count FROM db_relations WHERE inverse_relation_id IS NOT NULL').get().count,
    repairCount: sqlite.prepare("SELECT COUNT(*) AS count FROM db_relation_repairs WHERE action='repair'").get().count,
    dependencyKinds: sqlite.prepare('SELECT dependency_kind, COUNT(*) AS count FROM db_column_dependencies GROUP BY dependency_kind ORDER BY dependency_kind').all(),
    computedTypes: sqlite.prepare('SELECT value_type, COUNT(*) AS count FROM db_computed_cells GROUP BY value_type ORDER BY value_type').all(),
  });
  assert.equal(report.metrics.quickCheck, 'ok'); assert.equal(report.metrics.foreignKeyViolations, 0);
  assert.ok(report.metrics.relationCount >= 6); assert.ok(report.metrics.inverseCount >= 6); assert.equal(report.metrics.repairCount, 1);
  sqlite.close();
  const exported = JSON.parse(await readFile(fixture.exportResult.path, 'utf8'));
  assert.equal(exported.rows.length, 3);
  report.databaseAudit = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(report.databaseAudit.length > 0);
  assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []);
  assert.deepEqual(report.console.errors.filter((message) => !/favicon|Autofill/i.test(message)), []);
  gate('Integridad, exportación, aislamiento y consola', 'passed', `${report.databaseAudit.length} aperturas QA; quick_check=ok; FK=0; consola limpia.`);
  gate('Permisos y conflicto', 'not-applicable', 'La matriz ACL y el conflicto multicliente se validan obligatoriamente en los bucles 16 y 17.');
  report.outcome = 'passed';
} catch (error) {
  report.outcome = 'failed'; report.failure = String(error?.stack ?? error); gate('Resultado', 'failed', report.failure); throw error;
} finally {
  await closeApp(app); report.finishedAt = new Date().toISOString();
  const paths = await writeNotionParityReport(outputDir, report); console.log(`Loop 8 report: ${paths.htmlPath}`);
  await profile.cleanup();
}
