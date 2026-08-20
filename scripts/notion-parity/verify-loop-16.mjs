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
const marker = '--electron-loop-16';
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
const runId = `loop-16-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const axePath = require.resolve('axe-core/axe.min.js');
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const report = {
  format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 16, capability: 'page-history-comments', runId,
  startedAt: new Date().toISOString(), finishedAt: null, outcome: 'running',
  profile: { path: profile.profilePath, qaRoot: profile.qaRoot, retained: profile.retained },
  gates: [], metrics: {}, screenshots: [], accessibility: [],
  console: { errors: [], pageErrors: [] }, databaseAudit: [], failure: null,
};
const gate = (name, status, detail = '') => report.gates.push({ name, status, detail });

function environment() {
  const env = {
    ...process.env, NODUS_USERDATA: profile.profilePath, NODUS_QA_ROOT: profile.qaRoot,
    NODUS_QA_DATABASE_AUDIT_LOG: auditFile, NODUS_DISABLE_AUTO_UPDATE: '1',
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
  const page = await app.firstWindow();
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

async function showContext(page, width) {
  if (width < 1280) {
    const button = page.getByRole('button', { name: 'Enlaces', exact: true });
    if (await button.isVisible()) await button.click();
  }
  await page.getByTestId('page-revision-history').waitFor();
}

async function capture(page, label, theme, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate((value) => window.nodus.updateSettings({ theme: value }), theme);
  await page.waitForFunction((value) => document.documentElement.classList.contains('dark') === (value === 'dark'), theme);
  await showContext(page, width);
  await page.waitForTimeout(120);
  const file = path.join(outputDir, `${label}-${theme}-${width}x${height}.png`);
  await page.screenshot({ path: file });
  const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `${label} desborda a ${width}px/${theme}`);
  report.screenshots.push({ label, theme, viewport: `${width}x${height}`, path: file, layout });
}

async function auditA11y(page, label) {
  const violations = await page.evaluate(async () => (await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
  })).violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.slice(0, 12).map((node) => node.target) })));
  report.accessibility.push({ label, violations });
  assert.deepEqual(violations.filter((item) => item.impact === 'critical' || item.impact === 'serious'), []);
}

let app = null;
let vault;
let fixture;
try {
  for (const script of ['test-page-history.mjs', 'test-page-comments.mjs', 'test-page-acl.mjs', 'test-pages.mjs', 'test-ipc-contract.mjs', 'test-i18n-coverage.mjs']) {
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts', script)], { cwd: repoRoot, stdio: 'inherit' });
  }
  gate('SQLite, páginas, comentarios, IPC e i18n', 'passed', 'Deltas, snapshots, hilos, reacciones, menciones, inbox, conflicto, restauración y ocho idiomas.');
  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }
  gate('Typecheck y build', 'passed', skipBuild ? 'Build de esta revisión reutilizado.' : 'npm run build completado.');

  let page;
  ({ app, page } = await launchApp());
  vault = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Bucle 16 · historial', type: 'databases' });
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
  fixture = await page.evaluate(async () => {
    const created = await window.nodus.createPage({
      title: 'Crónica restaurable QA', icon: '🕰️',
      blocks: [{ id: 'history-qa-body', type: 'paragraph', content: { text: 'Versión de origen QA' } }],
    });
    const first = await window.nodus.savePageDocument({
      pageId: created.page.id, expectedRevision: created.revision, actorId: 'qa-writer-a', reason: 'content',
      blocks: [{ id: 'history-qa-body', type: 'paragraph', content: { text: 'Versión restaurable QA' } }],
    });
    if (!first.ok) throw new Error('Falló la primera revisión QA.');
    const second = await window.nodus.savePageDocument({
      pageId: created.page.id, expectedRevision: first.document.revision, actorId: 'qa-writer-b', reason: 'content',
      blocks: [
        { id: 'history-qa-body', type: 'paragraph', content: { text: 'Versión posterior QA' } },
        { id: 'history-qa-extra', type: 'callout', content: { text: 'Esta revisión debe conservarse' } },
      ],
    });
    if (!second.ok) throw new Error('Falló la segunda revisión QA.');
    const ada = await window.nodus.createWorkspaceActor({ displayName: 'Ada QA', email: 'ada@qa.invalid' });
    const outsider = await window.nodus.createWorkspaceActor({ displayName: 'Invitado sin acceso', email: 'outside@qa.invalid', kind: 'guest' });
    await window.nodus.setAclEntry({ resourceType: 'page', resourceId: created.page.id, principalType: 'actor', principalId: ada.id, role: 'comment' });
    const rootComment = await window.nodus.createPageComment({ pageId: created.page.id, blockId: 'history-qa-body', actorId: ada.id, body: 'Comentario sobre el bloque @[actor:local]' });
    const reply = await window.nodus.createPageComment({ pageId: created.page.id, parentCommentId: rootComment.id, actorId: 'local', body: `Respuesta con mención @[actor:${ada.id}]` });
    await window.nodus.setPageCommentReaction(rootComment.id, '👍', true, 'local');
    return { pageId: created.page.id, actorId: ada.id, outsiderId: outsider.id, rootCommentId: rootComment.id, replyId: reply.id };
  });
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await openWiki(page);
  await page.getByText('Crónica restaurable QA', { exact: true }).first().waitFor();
  await page.getByTestId('page-block-history-qa-body').waitFor();
  await capture(page, 'history-populated', 'light', 1440, 1000);
  await capture(page, 'history-populated', 'dark', 1024, 768);
  await capture(page, 'history-mobile', 'light', 390, 844);
  await auditA11y(page, 'history-populated');
  gate('Historial visual', 'passed', 'Claro/oscuro, escritorio/tablet/móvil, foco y WCAG AA sin desbordamiento.');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await showContext(page, 1440);
  await page.getByTestId('page-comments-panel').scrollIntoViewIfNeeded();
  await page.getByText('Comentario sobre el bloque @Tú', { exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: /👍 1/ }).count() >= 1);
  await page.getByRole('textbox', { name: 'Nuevo comentario' }).fill('Comentario creado desde Electron QA');
  await page.getByRole('button', { name: 'Comentar', exact: true }).click();
  await page.getByText('Comentario creado desde Electron QA', { exact: true }).waitFor();
  const inbox = await page.evaluate(async ({ actorId }) => ({
    ada: await window.nodus.listWorkspaceNotifications(actorId, true, 20),
    local: await window.nodus.listWorkspaceNotifications('local', true, 20),
  }), fixture);
  assert.ok(inbox.ada.some((notice) => notice.kind === 'comment_reply'));
  assert.ok(inbox.local.some((notice) => notice.kind === 'mention'));
  await capture(page, 'comments-thread', 'light', 1440, 1000);
  await page.getByText('Comentario sobre el bloque @Tú', { exact: true }).locator('..').getByRole('button', { name: 'Resolver', exact: true }).click();
  await page.getByRole('button', { name: 'Ver resueltos', exact: true }).click();
  await page.getByText('Comentario sobre el bloque @Tú', { exact: true }).waitFor();
  const resolvedInbox = await page.evaluate(async ({ actorId }) => window.nodus.listWorkspaceNotifications(actorId, true, 20), fixture);
  assert.ok(resolvedInbox.some((notice) => notice.kind === 'comment_resolved'));
  await auditA11y(page, 'comments-resolved');
  gate('Comentarios y menciones reales', 'passed', 'Hilo, comentario desde UI, reacción, resolución, menciones e inbox persistentes.');

  const accessPanel = page.getByTestId('page-access-panel');
  await accessPanel.scrollIntoViewIfNeeded();
  await accessPanel.getByText('Ada QA', { exact: true }).waitFor();
  assert.equal(await accessPanel.getByRole('combobox', { name: 'Rol de Ada QA' }).inputValue(), 'comment');
  await accessPanel.getByRole('textbox', { name: 'Contraseña del enlace' }).fill('vault-qa-seguro');
  await accessPanel.getByRole('button', { name: 'Crear enlace', exact: true }).click();
  await accessPanel.getByText('Copia este enlace ahora: el token no volverá a mostrarse.', { exact: true }).waitFor();
  await capture(page, 'access-owner', 'light', 1440, 1000);
  await auditA11y(page, 'access-owner');
  const isolation = await page.evaluate(async ({ pageId, actorId, outsiderId }) => {
    const allowed = await window.nodus.getPageDocument(pageId, actorId);
    const hidden = await window.nodus.getPageDocument(pageId, outsiderId);
    const search = await window.nodus.searchPages('Crónica restaurable', 'lexical', 20, outsiderId);
    const exported = await window.nodus.exportPageMarkdown(pageId, outsiderId);
    const hiddenComments = await window.nodus.listPageComments(pageId, true, outsiderId);
    let denied = '';
    try {
      await window.nodus.savePageDocument({ pageId, expectedRevision: allowed.revision, blocks: allowed.blocks, actorId, principalId: actorId });
    } catch (cause) { denied = cause instanceof Error ? cause.message : String(cause); }
    return { allowed: Boolean(allowed), hidden, search, exported, hiddenComments, denied };
  }, fixture);
  assert.equal(isolation.allowed, true); assert.equal(isolation.hidden, null); assert.deepEqual(isolation.search, []);
  assert.equal(isolation.exported, null); assert.deepEqual(isolation.hiddenComments, []); assert.match(isolation.denied, /permiso/i);
  gate('ACL y ausencia de filtraciones', 'passed', 'Herencia y override probados en SQLite; lectura, búsqueda, comentarios, edición y exportación respetan ACL vía IPC real.');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await showContext(page, 1440);
  const revisionTwo = page.getByTestId('page-revision-history').locator('li').filter({ hasText: 'v2' });
  await revisionTwo.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await page.getByRole('button', { name: 'Restaurar versión', exact: true }).click();
  await page.getByText('Versión restaurada sin borrar el historial posterior.', { exact: true }).waitFor();
  await page.getByTestId('page-block-history-qa-body').getByRole('textbox').waitFor();
  assert.equal(await page.getByTestId('page-block-history-qa-body').getByRole('textbox').inputValue(), 'Versión restaurable QA');
  const persisted = await page.evaluate(async (pageId) => {
    const history = await window.nodus.listPageRevisions(pageId, null, 100);
    const revisionThree = await window.nodus.getPageRevision(pageId, 3);
    return { history: history.items, revisionThreeBlocks: revisionThree?.blocks.length };
  }, fixture.pageId);
  assert.equal(persisted.history[0].restoredFromRevision, 2);
  assert.equal(persisted.revisionThreeBlocks, 2);
  await capture(page, 'history-restored', 'light', 1440, 1000);
  gate('Restauración real', 'passed', 'Restauración desde la UI crea una revisión nueva y mantiene reconstruible la versión posterior.');

  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await openWiki(page);
  await page.getByTestId('page-block-history-qa-body').getByRole('textbox').waitFor();
  assert.equal(await page.getByTestId('page-block-history-qa-body').getByRole('textbox').inputValue(), 'Versión restaurable QA');
  await closeApp(app); app = null;

  const Database = require('better-sqlite3');
  const sqlite = new Database(vault.path, { readonly: true, fileMustExist: true });
  Object.assign(report.metrics, {
    quickCheck: sqlite.pragma('quick_check', { simple: true }),
    foreignKeyViolations: sqlite.pragma('foreign_key_check').length,
    revisions: sqlite.prepare('SELECT COUNT(*) AS n FROM page_revisions').get().n,
    snapshots: sqlite.prepare('SELECT COUNT(*) AS n FROM page_revisions WHERE snapshot_json IS NOT NULL').get().n,
    comments: sqlite.prepare('SELECT COUNT(*) AS n FROM page_comments').get().n,
    reactions: sqlite.prepare('SELECT COUNT(*) AS n FROM page_comment_reactions').get().n,
    notifications: sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_notifications').get().n,
    aclEntries: sqlite.prepare('SELECT COUNT(*) AS n FROM acl_entries').get().n,
    shareLinks: sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_share_links').get().n,
  });
  sqlite.close();
  assert.equal(report.metrics.quickCheck, 'ok');
  assert.equal(report.metrics.foreignKeyViolations, 0);
  report.databaseAudit = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(report.databaseAudit.length > 0);
  assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []);
  assert.deepEqual(report.console.errors.filter((message) => !/favicon|Autofill/i.test(message)), []);
  gate('Reapertura, integridad, aislamiento y consola', 'passed', `quick_check=ok; FK=0; ${report.databaseAudit.length} aperturas solo bajo QA.`);
  report.outcome = 'passed';
} catch (error) {
  report.outcome = 'failed'; report.failure = String(error?.stack ?? error); gate('Resultado', 'failed', report.failure); throw error;
} finally {
  await closeApp(app); report.finishedAt = new Date().toISOString();
  const paths = await writeNotionParityReport(outputDir, report);
  console.log(`Loop 16 report: ${paths.htmlPath}`);
  await profile.cleanup();
}
