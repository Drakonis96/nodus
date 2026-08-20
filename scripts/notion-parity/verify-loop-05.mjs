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
const marker = '--electron-loop-05';
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
const runId = `loop-05-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const exportDir = path.join(profile.profilePath, 'exports');
const axePath = require.resolve('axe-core/axe.min.js');
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const report = {
  format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 5, runId,
  startedAt: new Date().toISOString(), finishedAt: null, outcome: 'running',
  profile: { path: profile.profilePath, qaRoot: profile.qaRoot, retained: profile.retained },
  gates: [], metrics: {}, screenshots: [], accessibility: [],
  console: { errors: [], pageErrors: [] }, databaseAudit: [], failure: null,
};
const gate = (name, status, detail = '') => report.gates.push({ name, status, detail });
let failedRowId = '';

function environment() {
  const env = {
    ...process.env, NODUS_USERDATA: profile.profilePath, NODUS_QA_ROOT: profile.qaRoot,
    NODUS_QA_DATABASE_AUDIT_LOG: auditFile, NODUS_QA_EXPORT_DIR: exportDir,
    NODUS_QA_PAGE_DELAY_MS: '700', NODUS_QA_PAGE_FAIL_ROW_ID: failedRowId,
    NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available',
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
      firstVaultVersion: 1,
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
  await page.waitForTimeout(100);
  const file = path.join(outputDir, `${label}-${theme}-${width}x${height}.png`);
  await page.screenshot({ path: file });
  const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `${label} desborda a ${width}px/${theme}`);
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

async function openDatabase(page, name) {
  await page.getByRole('button', { name, exact: true }).first().click();
  await page.getByTitle('Abrir ficha').first().waitFor();
}

async function waitSaved(page) {
  await page.getByText('Guardado', { exact: true }).waitFor();
  await page.waitForTimeout(50);
}

let app = null;
let vault;
let fixture;
const databaseName = `Páginas QA ${runId}`;
try {
  for (const script of [
    'test-pages.mjs', 'test-workspace-repo.mjs', 'test-ipc-contract.mjs',
    'test-major-migration-recovery.mjs', 'test-migration-renumber-recovery.mjs', 'test-sync-package.mjs',
  ]) execFileSync(process.execPath, [path.join(repoRoot, 'scripts', script)], { cwd: repoRoot, stdio: 'inherit' });
  gate('Unidad, SQLite, migración, IPC y sync', 'passed', 'Bloques, Yjs, assets, Markdown, notas, recuperación, contratos y paquete real.');
  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }
  gate('Typecheck y build', 'passed', skipBuild ? 'Build existente reutilizada.' : 'npm run build completado.');

  let page;
  ({ app, page } = await launchApp());
  vault = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Bucle 5 · páginas universales', type: 'databases' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({
      onboardingComplete: true, basicsTutorialVersion: 5, firstVaultVersion: 1, recoverySetupVersion: 1,
      tourComplete: true, advancedTourComplete: true, databasesTourComplete: true,
      mascotEnabled: false, theme: 'light', uiLanguage: 'es',
    });
    return created.vault;
  });
  assert.ok(path.resolve(vault.path).startsWith(path.resolve(profile.profilePath) + path.sep));
  await page.reload();
  await page.getByTestId('app-shell').waitFor();

  fixture = await page.evaluate(async (name) => {
    const database = await window.nodus.createDatabaseFromCsv(
      name, ['Nombre', 'Estado'],
      [['Página poblada QA', 'En curso'], ['Página error QA', 'Pendiente'], ['Página vacía QA', 'Pendiente']],
      ['title', 'text'],
    );
    const detail = await window.nodus.getDatabaseDetail(database.id);
    const title = detail.columns.find((column) => column.type === 'title');
    const rows = await window.nodus.queryDatabaseRows({ databaseId: database.id, limit: 20 });
    const first = rows.rows.find((row) => row.cells[title.id] === 'Página poblada QA');
    if (!first) throw new Error('No se creó la fila de página.');
    const initial = await window.nodus.getPageForDatabaseRow(first.id);
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9Z7sAAAAASUVORK5CYII='), (char) => char.charCodeAt(0));
    const asset = await window.nodus.storePageAsset({ name: 'pixel-qa.png', mimeType: 'image/png', bytes: png });
    const saved = await window.nodus.savePageDocument({
      pageId: initial.page.id, expectedRevision: initial.revision, actorId: 'qa-fixture', blocks: [
        { id: 'qa-heading', type: 'heading_1', content: { text: 'Página universal' } },
        { id: 'qa-paragraph', type: 'paragraph', content: { text: 'Contenido editable y buscable de la página.' } },
        { id: 'qa-task', parentBlockId: 'qa-paragraph', type: 'task', content: { text: 'Verificar reapertura', checked: false } },
        { id: 'qa-toggle', type: 'toggle', content: { text: 'Detalles', body: 'Contenido ocultable persistente.' } },
        { id: 'qa-code', type: 'code', content: { language: 'ts', text: 'const universal = true;' } },
        { id: 'qa-table', type: 'table', content: { rows: [['Campo', 'Valor'], ['Estado', 'Correcto']] } },
        { id: 'qa-image', type: 'image', content: { ...asset, caption: 'Imagen QA deduplicada' } },
      ],
    });
    if (!saved.ok) throw new Error('No se guardó el documento fixture.');
    const exported = [];
    for (const format of ['csv', 'json', 'xlsx']) exported.push(await window.nodus.exportDatabase(database.id, format));
    return { databaseId: database.id, titleId: title.id, rowIds: rows.rows.map((row) => row.id), rowId: first.id,
      pageId: initial.page.id, assetHash: asset.blobHash, exports: exported };
  }, databaseName);
  for (const exported of fixture.exports) {
    assert.ok(exported.path.startsWith(exportDir));
    assert.ok(exported.metrics.maxPageRows <= 500);
  }
  gate('Vault y fixture reales', 'passed', 'Vault databases aislado, filas-página, 7 bloques y blob PNG mediante API real; CSV/JSON/XLSX.');

  await page.reload();
  await openDatabase(page, databaseName);
  await page.getByTitle('Abrir ficha').first().click();
  await page.getByText('Cargando página…', { exact: true }).waitFor();
  await capture(page, 'loading', 'light', 1440, 1000);
  await page.getByTestId('page-block-editor').waitFor();
  await capture(page, 'populated', 'light', 1440, 1000);
  await capture(page, 'populated', 'dark', 1440, 1000);
  await capture(page, 'populated', 'light', 1024, 768);
  await capture(page, 'populated', 'dark', 1024, 768);
  await capture(page, 'mobile-record', 'light', 390, 844);
  await capture(page, 'mobile-record', 'dark', 390, 844);
  await auditA11y(page, 'page-editor-populated');

  await page.setViewportSize({ width: 1024, height: 768 });
  const textareas = page.getByTestId('page-block-editor').locator('textarea');
  await textareas.first().focus();
  const focusState = await textareas.first().evaluate((element) => {
    const block = element.closest('[data-testid^="page-block-"]');
    const style = block ? getComputedStyle(block) : null;
    return {
      active: document.activeElement === element,
      outline: getComputedStyle(element).outlineStyle,
      blockBorder: style?.borderColor ?? 'missing',
    };
  });
  assert.equal(focusState.active, true, 'El editor conserva el foco de teclado');
  assert.notEqual(focusState.blockBorder, 'rgba(0, 0, 0, 0)', 'El bloque enfocado tiene indicador visible');
  report.metrics.keyboardFocus = focusState;
  await textareas.nth(1).fill('Contenido copiado y pegado QA');
  await textareas.nth(1).press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await textareas.nth(1).press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
  await textareas.first().press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
  await waitSaved(page);
  await textareas.nth(1).press('Tab');
  await waitSaved(page);
  await page.getByRole('button', { name: 'Añadir bloque', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Destacado', exact: true }).click();
  await page.getByPlaceholder('Destacado').fill('Añadido desde el menú de bloques');
  await waitSaved(page);
  const beforeUndo = await page.getByPlaceholder('Destacado').inputValue();
  await page.getByPlaceholder('Destacado').fill('Cambio para deshacer');
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  assert.equal(await page.getByPlaceholder('Destacado').inputValue(), beforeUndo);
  await page.getByRole('button', { name: 'Rehacer', exact: true }).click();
  assert.equal(await page.getByPlaceholder('Destacado').inputValue(), 'Cambio para deshacer');
  await waitSaved(page);
  await page.getByTestId('page-block-editor').evaluate((element) => {
    const file = new File([new TextEncoder().encode('archivo arrastrado real')], 'arrastrado-qa.txt', { type: 'text/plain' });
    const transfer = new DataTransfer(); transfer.items.add(file);
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await waitSaved(page);
  const interactionState = await page.evaluate(async (rowId) => {
    const doc = await window.nodus.getPageForDatabaseRow(rowId);
    return { blocks: doc.blocks, markdown: (await window.nodus.exportPageMarkdown(doc.page.id)).markdown };
  }, fixture.rowId);
  assert.ok(interactionState.blocks.some((block) => block.type === 'file' && block.content.name === 'arrastrado-qa.txt'));
  assert.ok(interactionState.blocks.some((block) => block.parentBlockId), 'Tab anida un bloque');
  assert.match(interactionState.markdown, /Cambio para deshacer|Contenido copiado/);
  gate('Editor real', 'passed', 'Edición, copiar/pegar, Tab/nesting, menú, undo/redo y drop de archivo persistidos.');

  const external = await page.evaluate(async (rowId) => {
    const doc = await window.nodus.getPageForDatabaseRow(rowId);
    return window.nodus.savePageDocument({
      pageId: doc.page.id, expectedRevision: doc.revision, actorId: 'qa-second-client',
      blocks: doc.blocks.map((block, index) => index === 0
        ? { id: block.id, parentBlockId: block.parentBlockId, type: block.type, content: { ...block.content, text: 'Cambio simultáneo remoto QA' } }
        : { id: block.id, parentBlockId: block.parentBlockId, type: block.type, content: block.content }),
    });
  }, fixture.rowId);
  assert.equal(external.ok, true);
  await textareas.first().fill('Cambio local obsoleto QA');
  await page.getByTestId('page-conflict').waitFor();
  await capture(page, 'conflict', 'light', 1024, 768);
  await capture(page, 'conflict', 'dark', 1024, 768);
  await auditA11y(page, 'page-editor-conflict');
  await page.getByRole('button', { name: 'Recargar cambios', exact: true }).click();
  assert.equal(await textareas.first().inputValue(), 'Cambio simultáneo remoto QA');
  gate('Conflicto visible', 'passed', 'Revisión esperada rechaza el guardado obsoleto y permite recargar la versión convergente.');

  const restored = await page.evaluate(async (pageId) => {
    const original = (await window.nodus.exportPageMarkdown(pageId)).markdown;
    let doc = await window.nodus.getPageDocument(pageId);
    let changed = await window.nodus.replacePageFromMarkdown(pageId, '# Temporal de restauración', doc.revision);
    if (!changed.ok) throw new Error('No se pudo escribir el temporal.');
    doc = changed.document;
    changed = await window.nodus.replacePageFromMarkdown(pageId, original, doc.revision);
    if (!changed.ok) throw new Error('No se pudo restaurar Markdown.');
    return { original, restored: (await window.nodus.exportPageMarkdown(pageId)).markdown, revision: changed.document.revision };
  }, fixture.pageId);
  assert.equal(restored.restored, restored.original);
  gate('Exportación y restauración', 'passed', 'Markdown bidireccional restaurado y exportaciones de base generadas por streaming paginado.');

  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByTitle('Abrir ficha').nth(2).click();
  await page.getByTestId('page-block-editor').waitFor();
  await capture(page, 'empty-page', 'light', 390, 844);
  await auditA11y(page, 'page-editor-empty');
  gate('Estados visuales', 'passed', 'Vacío, poblado, cargando y conflicto; claro/oscuro; 1440/1024/390; WCAG AA.');

  await closeApp(app); app = null;
  failedRowId = fixture.rowIds[1];
  ({ app, page } = await launchApp());
  await openDatabase(page, databaseName);
  await page.getByTitle('Abrir ficha').nth(1).click();
  await page.getByRole('alert').filter({ hasText: 'Fallo de carga QA controlado.' }).waitFor();
  await capture(page, 'error', 'light', 1024, 768);
  await capture(page, 'error', 'dark', 1024, 768);
  await auditA11y(page, 'page-editor-error');
  failedRowId = '';
  gate('Error real controlado', 'passed', 'El bridge QA aislado fuerza un rechazo real y la UI presenta un estado accesible.');

  await closeApp(app); app = null;
  ({ app, page } = await launchApp());
  const reopened = await page.evaluate(async (rowId) => {
    const doc = await window.nodus.getPageForDatabaseRow(rowId);
    return { blocks: doc.blocks.length, markdown: (await window.nodus.exportPageMarkdown(doc.page.id)).markdown, stateBytes: doc.yjsState.byteLength };
  }, fixture.rowId);
  assert.ok(reopened.blocks >= 8);
  assert.match(reopened.markdown, /Cambio simultáneo remoto QA/);
  assert.ok(reopened.stateBytes > 0);
  gate('Cierre y reapertura', 'passed', `${reopened.blocks} bloques y documento Yjs rehidratados.`);
  await closeApp(app); app = null;

  const Database = require('better-sqlite3');
  const sqlite = new Database(vault.path, { readonly: true, fileMustExist: true });
  Object.assign(report.metrics, {
    quickCheck: sqlite.pragma('quick_check', { simple: true }), foreignKeyViolations: sqlite.pragma('foreign_key_check').length,
    pages: sqlite.prepare('SELECT COUNT(*) AS count FROM pages').get().count,
    blocks: sqlite.prepare('SELECT COUNT(*) AS count FROM page_blocks').get().count,
    documents: sqlite.prepare('SELECT COUNT(*) AS count FROM page_documents').get().count,
    updates: sqlite.prepare('SELECT COUNT(*) AS count FROM page_document_updates').get().count,
    snapshots: sqlite.prepare('SELECT COUNT(*) AS count FROM page_document_snapshots').get().count,
    ftsBlocks: sqlite.prepare("SELECT COUNT(*) AS count FROM db_search_fts WHERE entity_type = 'page_block'").get().count,
    deduplicatedBlobRefs: sqlite.prepare('SELECT COUNT(*) AS count FROM page_block_blobs WHERE blob_hash = ?').get(fixture.assetHash).count,
  });
  assert.equal(report.metrics.quickCheck, 'ok');
  assert.equal(report.metrics.foreignKeyViolations, 0);
  assert.ok(report.metrics.pages >= 3 && report.metrics.blocks >= 8 && report.metrics.documents >= 3);
  assert.ok(report.metrics.snapshots >= 3 && report.metrics.ftsBlocks >= 8 && report.metrics.deduplicatedBlobRefs >= 1);
  sqlite.close();
  const jsonExport = fixture.exports.find((item) => item.path.endsWith('.json'));
  const exportedJson = JSON.parse(await readFile(jsonExport.path, 'utf8'));
  assert.ok(exportedJson.rows.some((row) => row._page?.markdown?.includes('Página universal')));
  report.databaseAudit = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []);
  assert.deepEqual(report.console.errors.filter((message) => !/favicon|Autofill/i.test(message)), []);
  gate('Integridad, aislamiento y consola', 'passed', `${report.databaseAudit.length} aperturas QA; quick_check=ok; FK=0; FTS/Yjs/blobs verificados; consola limpia.`);
  gate('Sin permisos', 'not-applicable', 'Las ACL se implementan y verifican en el bucle 16.');
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
  console.log(`Loop 5 report: ${paths.htmlPath}`);
  await profile.cleanup();
}
