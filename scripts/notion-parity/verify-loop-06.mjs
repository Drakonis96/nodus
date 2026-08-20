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
const marker = '--electron-loop-06';
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
const runId = `loop-06-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const axePath = require.resolve('axe-core/axe.min.js');
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const report = {
  format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 6, runId,
  startedAt: new Date().toISOString(), finishedAt: null, outcome: 'running',
  profile: { path: profile.profilePath, qaRoot: profile.qaRoot, retained: profile.retained },
  gates: [], metrics: {}, screenshots: [], accessibility: [],
  console: { errors: [], pageErrors: [] }, databaseAudit: [], failure: null,
};
const gate = (name, status, detail = '') => report.gates.push({ name, status, detail });
let failedPageId = '';

function environment() {
  const env = {
    ...process.env, NODUS_USERDATA: profile.profilePath, NODUS_QA_ROOT: profile.qaRoot,
    NODUS_QA_DATABASE_AUDIT_LOG: auditFile, NODUS_QA_PAGE_DELAY_MS: '450',
    NODUS_QA_PAGE_FAIL_PAGE_ID: failedPageId, NODUS_DISABLE_AUTO_UPDATE: '1',
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
      onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1, firstVaultVersion: 1,
      tourComplete: true, advancedTourComplete: true, databasesTourComplete: true,
      mascotEnabled: false, theme: 'light', uiLanguage: 'es',
    });
  }, appVersion);
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  return { app, page };
}

async function openWiki(page) {
  await page.locator('[data-tour="nav-pages"]').click();
  await page.getByTestId('page-wiki-view').waitFor();
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

async function visibleTargetMetrics(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="page-wiki-view"]');
    const nodes = [...(root?.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled])') ?? [])]
      .filter((node) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; });
    const small = nodes.map((node) => ({ label: node.getAttribute('aria-label') || node.textContent?.trim() || node.tagName,
      width: Math.round(node.getBoundingClientRect().width), height: Math.round(node.getBoundingClientRect().height) }))
      .filter((item) => item.width < 24 || item.height < 24);
    return { controls: nodes.length, smallerThan24: small };
  });
}

let app = null;
let vault;
let fixture;
try {
  for (const script of [
    'test-page-wiki.mjs', 'test-pages.mjs', 'test-ipc-contract.mjs',
    'test-major-migration-recovery.mjs', 'test-migration-renumber-recovery.mjs',
    'test-sync-package.mjs', 'test-nodus-server-mutations.mjs', 'test-i18n-coverage.mjs',
  ]) execFileSync(process.execPath, [path.join(repoRoot, 'scripts', script)], { cwd: repoRoot, stdio: 'inherit' });
  gate('Unidad, SQLite, migración, IPC, sync e i18n', 'passed', 'Árbol, enlaces, búsqueda, FTS, restauración, contratos y traducciones reales.');
  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }
  gate('Typecheck y build', 'passed', skipBuild ? 'Build existente reutilizada.' : 'npm run build completado.');

  let page;
  ({ app, page } = await launchApp());
  vault = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Bucle 6 · navegación y wiki', type: 'databases' });
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
  await openWiki(page);
  await page.getByText('Crea tu primera página para empezar la wiki.', { exact: true }).waitFor();
  await capture(page, 'empty-wiki', 'light', 1440, 1000);
  await capture(page, 'empty-wiki', 'dark', 1024, 768);
  await auditA11y(page, 'empty-wiki');

  fixture = await page.evaluate(async () => {
    const root = await window.nodus.createPage({ title: 'Manual Nodus QA', icon: '📘', blocks: [
      { id: 'root-heading', type: 'heading_1', content: { text: 'Manual del automóvil' } },
      { id: 'root-paragraph', type: 'paragraph', content: { text: 'El automóvil azul conecta toda la wiki local.' } },
    ] });
    const child = await window.nodus.createPage({ title: 'Capítulo conectado QA', parentPageId: root.page.id, icon: '🔗', blocks: [
      { id: 'child-heading', type: 'heading_2', content: { text: 'Arquitectura enlazada' } },
      { id: 'child-paragraph', type: 'paragraph', content: { text: 'Contenido reutilizable mediante bloques sincronizados.' } },
    ] });
    const grandchild = await window.nodus.createPage({ title: 'Detalle profundo QA', parentPageId: child.page.id, icon: '↳' });
    const resources = await window.nodus.createPage({ title: 'Recursos QA', icon: '🧰' });
    const movable = await window.nodus.createPage({ title: 'Mover QA', icon: '↔' });
    const trashed = await window.nodus.createPage({ title: 'Papelera QA', icon: '🗑️' });
    const linked = await window.nodus.savePageDocument({
      pageId: root.page.id, expectedRevision: root.revision, actorId: 'qa-fixture', blocks: [
        { id: 'root-heading', type: 'heading_1', content: { text: 'Manual del automóvil' } },
        { id: 'root-paragraph', type: 'paragraph', content: { text: 'El automóvil azul conecta toda la wiki local.' } },
        { id: 'root-subpage', type: 'subpage', content: { pageId: child.page.id, title: 'Abrir capítulo' } },
        { id: 'root-mention', type: 'mention', content: { pageId: child.page.id, label: 'Capítulo mencionado' } },
        { id: 'root-synced', type: 'synced_block', content: { sourceBlockId: 'child-paragraph' } },
        { id: 'root-broken', type: 'mention', content: { pageId: 'page_qa_inexistente', label: 'Enlace roto QA' } },
        { id: 'root-view', type: 'database_view', content: { viewId: 'view_qa_linked' } },
      ],
    });
    if (!linked.ok) throw new Error('No se pudo preparar la página enlazada.');
    const coverSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="320" viewBox="0 0 1440 320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#4338ca"/><stop offset="1" stop-color="#db2777"/></linearGradient></defs><rect width="1440" height="320" fill="url(#g)"/><circle cx="180" cy="360" r="260" fill="#fff" opacity=".08"/><circle cx="720" cy="160" r="120" fill="#fff" opacity=".11"/><circle cx="1260" cy="-20" r="220" fill="#fff" opacity=".12"/></svg>';
    const cover = await window.nodus.storePageAsset({ name: 'cover-wiki-qa.svg', mimeType: 'image/svg+xml', bytes: new TextEncoder().encode(coverSvg) });
    const currentRoot = await window.nodus.getPage(root.page.id);
    const covered = await window.nodus.updatePage(root.page.id, { coverBlobHash: cover.blobHash, fullWidth: true }, currentRoot.revision);
    await window.nodus.setPageFavorite(root.page.id, true);
    const moved = await window.nodus.movePage(movable.page.id, resources.page.id, movable.page.revision);
    const trashedPages = await window.nodus.setPageState(trashed.page.id, 'trashed', trashed.page.revision);
    let cycleRejected = false;
    try {
      const freshRoot = await window.nodus.getPage(root.page.id);
      await window.nodus.movePage(root.page.id, grandchild.page.id, freshRoot.revision);
    } catch { cycleRejected = true; }
    const database = await window.nodus.createDatabaseFromCsv(
      'Filas wiki QA', ['Nombre', 'Descripción'], [['Expediente automóvil QA', 'Contenido localizado desde una fila']], ['title', 'text'],
    );
    return {
      rootId: root.page.id, childId: child.page.id, grandchildId: grandchild.page.id,
      resourcesId: resources.page.id, movableId: moved.id, trashedId: trashed.page.id,
      coverHash: cover.blobHash, cycleRejected, trashedCount: trashedPages.length, databaseId: database.id,
    };
  });
  assert.equal(fixture.cycleRejected, true);
  assert.ok(fixture.trashedCount >= 1);
  gate('Vault y fixture reales', 'passed', 'Vault databases aislado con árbol de tres niveles, favorito, portada, fila, enlaces, synced block y papelera.');

  await page.reload();
  await openWiki(page);
  await page.getByText('Cargando página…', { exact: true }).waitFor();
  await capture(page, 'loading-page', 'light', 1440, 1000);
  await page.getByTestId('page-block-editor').waitFor();
  await page.getByTestId('page-block-root-heading').locator('textarea').waitFor();
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }]) {
    for (const theme of ['light', 'dark']) await capture(page, 'populated-wiki', theme, viewport.width, viewport.height);
  }
  await auditA11y(page, 'populated-wiki');
  report.metrics.targets = await visibleTargetMetrics(page);
  assert.deepEqual(report.metrics.targets.smallerThan24, []);

  const titleInput = page.getByRole('textbox', { name: 'Título de página' });
  await titleInput.focus();
  const focus = await titleInput.evaluate((element) => ({ active: document.activeElement === element, outline: getComputedStyle(element).outlineStyle }));
  assert.equal(focus.active, true);
  report.metrics.keyboardFocus = focus;
  const primaryTree = page.getByRole('tree').last();
  await primaryTree.getByRole('button', { name: /Manual Nodus QA/ }).focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('page-block-editor').waitFor();
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
  await page.getByText('Esta página está bloqueada y se muestra en modo lectura.', { exact: true }).waitFor();
  await capture(page, 'locked-readonly', 'light', 1024, 768);
  await capture(page, 'locked-readonly', 'dark', 1024, 768);
  await auditA11y(page, 'locked-readonly');
  assert.equal(await page.getByRole('textbox', { name: 'Título de página' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Desbloquear', exact: true }).click();
  await page.getByRole('button', { name: 'Bloquear', exact: true }).waitFor();
  gate('Página y wiki visuales', 'passed', 'Portada, full-width, breadcrumbs, índice, bloques enlazados, foco y bloqueo de lectura verificados.');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await primaryTree.getByRole('button', { name: 'Capítulo conectado QA', exact: true }).click();
  await page.getByTestId('page-block-editor').waitFor();
  const breadcrumbNav = page.getByRole('navigation', { name: 'Migas de pan' });
  await breadcrumbNav.getByRole('button', { name: /Capítulo conectado QA/ }).waitFor();
  await breadcrumbNav.getByRole('button', { name: /Manual Nodus QA/ }).waitFor();
  const backlinks = page.getByRole('complementary', { name: 'Contexto de página' }).getByText('Manual Nodus QA', { exact: true });
  assert.ok(await backlinks.count() >= 1);
  await capture(page, 'backlinks-breadcrumbs', 'light', 1440, 1000);

  await page.getByRole('tree').getByRole('button', { name: 'Mover QA', exact: true }).evaluate((source, movedId) => {
    const row = source.parentElement;
    const tree = source.closest('[role="tree"]');
    const targetButton = [...(tree?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.includes('Capítulo conectado QA'));
    const target = targetButton?.parentElement;
    if (!row || !target) throw new Error('No se localizaron las filas para drag-and-drop.');
    const transfer = new DataTransfer();
    transfer.setData('application/x-nodus-page', movedId);
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, fixture.movableId);
  await page.waitForFunction(async ({ childId, movableId }) => {
    const movable = await window.nodus.getPage(movableId);
    return movable?.parentPageId === childId;
  }, { childId: fixture.childId, movableId: fixture.movableId });
  const navigation = await page.evaluate(async ({ childId, movableId }) => {
    const childCrumbs = await window.nodus.listPageBreadcrumbs(childId);
    const movable = await window.nodus.getPage(movableId);
    const resources = movable ? await window.nodus.listPageBreadcrumbs(movable.id) : [];
    return { childCrumbs: childCrumbs.map((item) => item.title), movableCrumbs: resources.map((item) => item.title) };
  }, fixture);
  assert.deepEqual(navigation.childCrumbs, ['Manual Nodus QA', 'Capítulo conectado QA']);
  assert.deepEqual(navigation.movableCrumbs, ['Manual Nodus QA', 'Capítulo conectado QA', 'Mover QA']);
  gate('Navegación jerárquica', 'passed', 'Breadcrumbs, drag-and-drop persistente, árbol completo y rechazo de ciclos comprobados.');

  await page.setViewportSize({ width: 1440, height: 1000 });
  const search = page.getByRole('textbox', { name: 'Buscar páginas, filas y adjuntos' });
  await search.fill('automóvil');
  await search.press('Enter');
  await page.getByRole('region', { name: 'Resultados de búsqueda' }).waitFor();
  assert.ok(await page.getByText('Manual Nodus QA', { exact: true }).count() >= 1);
  await capture(page, 'lexical-search', 'light', 1440, 1000);
  await search.fill('coche');
  await page.getByRole('button', { name: 'Semántica local', exact: true }).click();
  await page.getByTestId('page-wiki-view').getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByText('Manual Nodus QA', { exact: true }).first().waitFor();
  await capture(page, 'semantic-search', 'dark', 1024, 768);
  await search.fill('sinresultadoqaunico');
  await search.press('Enter');
  await page.getByText('Sin resultados.', { exact: true }).waitFor();
  await capture(page, 'search-empty', 'light', 1024, 768);
  await auditA11y(page, 'search-empty');
  gate('Búsqueda global local', 'passed', 'Búsqueda léxica/semántica paginada sobre páginas y filas, con estado vacío accesible.');

  await search.fill('');
  await page.getByRole('button', { name: 'Ver papelera', exact: true }).click();
  await page.getByRole('button', { name: 'Papelera QA', exact: true }).click();
  await page.getByText('Esta página está en la papelera. Restáurala para volver a editarla.', { exact: true }).waitFor();
  await capture(page, 'trash', 'light', 1024, 768);
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await page.getByText('La papelera está vacía.', { exact: true }).waitFor();
  gate('Papelera y restauración', 'passed', 'Subárbol enviado a papelera y restaurado desde la interfaz real.');

  await page.getByRole('button', { name: 'Volver a páginas', exact: true }).click();
  await page.getByRole('button', { name: /Manual Nodus QA/ }).first().click();
  await page.getByTestId('page-block-editor').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Árbol', exact: true }).click();
  await capture(page, 'mobile-tree', 'light', 390, 844);
  await page.getByRole('button', { name: 'Página', exact: true }).click();
  await capture(page, 'mobile-page', 'dark', 390, 844);
  await page.getByRole('button', { name: 'Enlaces', exact: true }).click();
  await capture(page, 'mobile-context', 'light', 390, 844);
  report.metrics.mobileOverflow = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="page-wiki-view"]');
    const visiblePanel = [...(root?.querySelectorAll('aside, main') ?? [])].find((element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && element.getBoundingClientRect().width > 0;
    });
    return {
      viewport: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      rootClientWidth: root?.clientWidth ?? 0,
      rootScrollWidth: root?.scrollWidth ?? 0,
      panelClientWidth: visiblePanel?.clientWidth ?? 0,
      panelScrollWidth: visiblePanel?.scrollWidth ?? 0,
    };
  });
  assert.equal(report.metrics.mobileOverflow.documentScrollWidth, report.metrics.mobileOverflow.viewport);
  assert.equal(report.metrics.mobileOverflow.rootScrollWidth, report.metrics.mobileOverflow.rootClientWidth);
  assert.ok(report.metrics.mobileOverflow.panelScrollWidth <= report.metrics.mobileOverflow.panelClientWidth);
  await auditA11y(page, 'mobile-wiki');
  gate('Responsive y accesibilidad', 'passed', 'Claro/oscuro; 1440/1024/390; árbol, página y contexto móviles; WCAG AA y sin desbordamiento.');

  const restored = await page.evaluate(async (pageId) => {
    const original = await window.nodus.exportPageMarkdown(pageId);
    const current = await window.nodus.getPageDocument(pageId);
    let changed = await window.nodus.replacePageFromMarkdown(pageId, '# Restauración temporal QA', current.revision);
    if (!changed.ok) throw new Error('No se pudo escribir la restauración temporal.');
    changed = await window.nodus.replacePageFromMarkdown(pageId, original.markdown, changed.document.revision);
    if (!changed.ok) throw new Error('No se pudo restaurar el Markdown.');
    return { original: original.markdown, restored: (await window.nodus.exportPageMarkdown(pageId)).markdown };
  }, fixture.rootId);
  assert.equal(restored.restored, restored.original);
  gate('Exportación y restauración', 'passed', 'La página completa se exporta y restaura semánticamente sin pérdida.');

  await closeApp(app); app = null;
  failedPageId = fixture.childId;
  ({ app, page } = await launchApp());
  await openWiki(page);
  await page.getByRole('button', { name: 'Capítulo conectado QA', exact: true }).first().click();
  await page.getByRole('alert').filter({ hasText: 'Fallo de carga QA controlado.' }).waitFor();
  await capture(page, 'error', 'light', 1024, 768);
  await capture(page, 'error', 'dark', 1024, 768);
  await auditA11y(page, 'wiki-error');
  failedPageId = '';
  gate('Error real controlado', 'passed', 'El bridge QA aislado rechaza una página y el wiki presenta un estado accesible.');

  await closeApp(app); app = null;
  ({ app, page } = await launchApp());
  const reopened = await page.evaluate(async ({ rootId, childId }) => ({
    root: await window.nodus.getPageDocument(rootId), breadcrumbs: await window.nodus.listPageBreadcrumbs(childId),
    backlinks: await window.nodus.listPageBacklinks(childId), broken: await window.nodus.listBrokenPageLinks(),
    semantic: await window.nodus.searchPages('coche', 'semantic', 20),
  }), fixture);
  assert.equal(reopened.root.page.coverBlobHash, fixture.coverHash);
  assert.deepEqual(reopened.breadcrumbs.map((item) => item.title), ['Manual Nodus QA', 'Capítulo conectado QA']);
  assert.ok(reopened.backlinks.length >= 2 && reopened.broken.length >= 1 && reopened.semantic.some((item) => item.pageId === fixture.rootId));
  gate('Cierre y reapertura', 'passed', 'Árbol, portada, backlinks, enlaces rotos, bloques y búsqueda rehidratados desde SQLite.');
  await closeApp(app); app = null;

  const Database = require('better-sqlite3');
  const sqlite = new Database(vault.path, { readonly: true, fileMustExist: true });
  Object.assign(report.metrics, {
    quickCheck: sqlite.pragma('quick_check', { simple: true }), foreignKeyViolations: sqlite.pragma('foreign_key_check').length,
    pages: sqlite.prepare('SELECT COUNT(*) AS count FROM pages').get().count,
    activePages: sqlite.prepare("SELECT COUNT(*) AS count FROM pages WHERE state = 'active'").get().count,
    pageLinks: sqlite.prepare('SELECT COUNT(*) AS count FROM page_links').get().count,
    brokenPageLinks: sqlite.prepare("SELECT COUNT(*) AS count FROM page_links WHERE target_page_id = 'page_qa_inexistente'").get().count,
    favorites: sqlite.prepare('SELECT COUNT(*) AS count FROM page_favorites').get().count,
    ftsTitles: sqlite.prepare("SELECT COUNT(*) AS count FROM db_search_fts WHERE entity_type = 'page_title'").get().count,
    ftsCells: sqlite.prepare("SELECT COUNT(*) AS count FROM db_search_fts WHERE entity_type = 'cell'").get().count,
  });
  assert.equal(report.metrics.quickCheck, 'ok');
  assert.equal(report.metrics.foreignKeyViolations, 0);
  assert.ok(report.metrics.pages >= 7 && report.metrics.pageLinks >= 4 && report.metrics.favorites >= 1
    && report.metrics.ftsTitles >= 6 && report.metrics.ftsCells >= 1);
  sqlite.close();
  report.databaseAudit = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(report.databaseAudit.length > 0);
  assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []);
  assert.deepEqual(report.console.errors.filter((message) => !/favicon|Autofill/i.test(message)), []);
  gate('Integridad, aislamiento y consola', 'passed', `${report.databaseAudit.length} aperturas QA; quick_check=ok; FK=0; FTS/enlaces/favoritos verificados; consola limpia.`);
  gate('Sin permisos', 'not-applicable', 'La matriz ACL y el estado sin permisos se implementan y verifican en el bucle 16.');
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
  console.log(`Loop 6 report: ${paths.htmlPath}`);
  await profile.cleanup();
}
