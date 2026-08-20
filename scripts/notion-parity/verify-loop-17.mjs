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
const marker = '--electron-loop-17';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker, ...process.argv.slice(2)], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  process.exit(0);
}
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const option = (name) => {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
};
const retain = process.argv.includes('--retain');
const skipBuild = process.argv.includes('--skip-build');
const runId = `loop-17-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(option('output') ?? path.join(repoRoot, 'reports', 'notion-parity', runId));
await mkdir(outputDir, { recursive: true });
const profile = await prepareQaProfile({ repoRoot, requestedPath: option('profile'), retain });
const replicaProfile = path.join(profile.profilePath, 'replica-test-profiles');
const auditFile = path.join(profile.profilePath, 'qa-database-audit.jsonl');
const appAuditFile = path.join(replicaProfile, 'qa-database-audit.jsonl');
const report = {
  format: 'nodus.notion-parity.qa', formatVersion: 1, loop: 17, capability: 'convergent-collaboration', runId,
  startedAt: new Date().toISOString(), finishedAt: null, outcome: 'running',
  profile: { path: profile.profilePath, qaRoot: profile.qaRoot, retained: profile.retained },
  gates: [], metrics: {}, screenshots: [], accessibility: [], console: { errors: [], pageErrors: [] },
  databaseAudit: [], failure: null,
};
const gate = (name, status, detail = '') => report.gates.push({ name, status, detail });
const env = {
  ...process.env, NODUS_USERDATA: profile.profilePath, NODUS_QA_ROOT: profile.qaRoot,
  NODUS_QA_DATABASE_AUDIT_LOG: auditFile, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available',
};
let app = null;

async function closeApp() {
  if (!app) return;
  const child = app.process();
  const closed = await Promise.race([app.close().then(() => true, () => false), new Promise((resolve) => setTimeout(() => resolve(false), 5_000))]);
  if (!closed && child.exitCode === null && !child.killed) child.kill('SIGKILL');
  app = null;
}

try {
  for (const script of [
    'test-sync-hlc.mjs', 'test-sync-convergence.mjs', 'test-nodus-server-mutations.mjs',
    'test-connected-vault-replica.mjs', 'test-connected-vaults-panel.mjs', 'test-ipc-contract.mjs',
  ]) execFileSync(process.execPath, [path.join(repoRoot, 'scripts', script)], { cwd: repoRoot, env, stdio: 'inherit' });
  gate('SQLite, relay y multicliente reales', 'passed', 'HLC, conflictos, SSE, dos writers offline, owner offline, reader, revocación, Yjs, presencia y adjuntos reanudables.');
  execFileSync('npm', ['run', 'typecheck'], { cwd: repoRoot, env, stdio: 'inherit' });
  if (!skipBuild || !fs.existsSync(path.join(repoRoot, 'dist-electron', 'main.js'))) execFileSync('npm', ['run', 'build'], { cwd: repoRoot, env, stdio: 'inherit' });
  gate('Typecheck y build', 'passed', skipBuild ? 'Build de esta revisión reutilizado.' : 'Build completo de producción.');

  const appEnv = {
    ...env,
    NODUS_USERDATA: replicaProfile,
    // The database-audit guard intentionally requires its log to live inside
    // the exact userData profile of the process that opens the databases.
    NODUS_QA_DATABASE_AUDIT_LOG: appAuditFile,
  };
  delete appEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: appEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.addInitScript({ path: require.resolve('axe-core/axe.min.js') });
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
    await window.nodus.updateSettings({
      onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1, firstVaultVersion: 1,
      tourComplete: true, advancedTourComplete: true, databasesTourComplete: true, mascotEnabled: false,
      uiLanguage: 'es', theme: 'light',
    });
  }, appVersion);
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await page.locator('[data-tour="nav-settings"]').click();
  await page.getByRole('button', { name: 'Servidor', exact: true }).click();
  await page.getByTestId('nodus-server-mode-advanced').scrollIntoViewIfNeeded();
  await page.getByTestId('nodus-server-mode-advanced').click();
  const panel = page.getByTestId('connected-vault-panel');
  await panel.waitFor();

  for (const [theme, width, height] of [['light', 1440, 1000], ['dark', 1024, 768]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((value) => window.nodus.updateSettings({ theme: value }), theme);
    await page.waitForFunction((value) => document.documentElement.classList.contains('dark') === (value === 'dark'), theme);
    await panel.scrollIntoViewIfNeeded();
    const file = path.join(outputDir, `connected-vaults-${theme}-${width}x${height}.png`);
    await page.screenshot({ path: file });
    const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `connected vaults overflows at ${width}px`);
    report.screenshots.push({ label: 'connected-vaults', theme, viewport: `${width}x${height}`, path: file, layout });
  }
  const violations = await page.evaluate(async () => (await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
  })).violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.slice(0, 12).map((node) => node.target) })));
  report.accessibility.push({ label: 'connected-vaults', violations });
  assert.deepEqual(violations.filter((item) => item.impact === 'critical' || item.impact === 'serious'), []);
  gate('UI real claro/oscuro y accesibilidad', 'passed', 'Panel de reader, writer, error y revocación sin desbordamiento ni infracciones WCAG AA graves.');
  await closeApp();

  const databaseFiles = fs.existsSync(replicaProfile)
    ? fs.readdirSync(replicaProfile, { recursive: true }).filter((entry) => String(entry).endsWith('.sqlite')).map((entry) => path.join(replicaProfile, String(entry)))
    : [];
  const Database = require('better-sqlite3');
  let conflicts = 0; let receipts = 0; let foreignKeyViolations = 0;
  for (const file of databaseFiles) {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
    foreignKeyViolations += db.pragma('foreign_key_check').length;
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_conflicts'").get()) conflicts += db.prepare('SELECT COUNT(*) AS n FROM sync_conflicts').get().n;
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='page_document_update_receipts'").get()) receipts += db.prepare('SELECT COUNT(*) AS n FROM page_document_update_receipts').get().n;
    db.close();
  }
  Object.assign(report.metrics, { databases: databaseFiles.length, conflicts, yjsReceipts: receipts, foreignKeyViolations });
  assert.ok(databaseFiles.length >= 3); assert.equal(foreignKeyViolations, 0); assert.ok(receipts >= 2);
  report.databaseAudit = [auditFile, appAuditFile].flatMap((file) => (
    fs.existsSync(file)
      ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : []
  ));
  assert.ok(report.databaseAudit.length > 0);
  assert.ok(report.databaseAudit.every((entry) => path.resolve(entry.path).startsWith(path.resolve(profile.profilePath) + path.sep)));
  assert.deepEqual(report.console.pageErrors, []);
  assert.deepEqual(report.console.errors.filter((message) => !/favicon|Autofill|ERR_CONNECTION_REFUSED/i.test(message)), []);
  gate('Integridad, aislamiento y consola', 'passed', `${databaseFiles.length} SQLite QA; FK=0; ${report.databaseAudit.length} aperturas confinadas al perfil QA.`);
  report.outcome = 'passed';
} catch (error) {
  report.outcome = 'failed'; report.failure = String(error?.stack ?? error); gate('Resultado', 'failed', report.failure); throw error;
} finally {
  await closeApp(); report.finishedAt = new Date().toISOString();
  const paths = await writeNotionParityReport(outputDir, report);
  console.log(`Loop 17 report: ${paths.htmlPath}`);
  await profile.cleanup();
}
