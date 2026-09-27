// End-to-end test for deleting works from a vault through the real UI.
//
// The unit suite (test-work-deletion.mjs) proves the storage rules on a migrated
// database. This proves the path the reader actually takes: select rows in the Library,
// click the red delete action, read the confirmation, confirm it, and end up with the
// works gone — through the real preload bridge, the real IPC handler and a real SQLite
// file, with the surviving work's rows inspected from a second connection afterwards.
//
// Requires a build (dist/ + dist-electron/); run via `node scripts/e2e-library-delete-works.mjs`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;

if (!process.argv.includes('--electron-library-delete')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), '--electron-library-delete'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}
if (!existsSync(path.join(repoRoot, 'dist-electron/main.js'))) {
  console.log('[e2e] no build found — running npm run build first…');
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-e2e-delete-'));
const GONE_A = 'e2e-work-a';
const GONE_C = 'e2e-work-c';
const KEPT_B = 'e2e-work-b';

async function waitForCondition(label, probe, { timeout = 30_000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
      lastError = null;
    } catch (cause) { lastError = cause; }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Tiempo agotado esperando: ${label}.${lastError instanceof Error ? ` Último error: ${lastError.message}` : ''}`);
}

const Database = require('better-sqlite3');
let app = null;
let external = null;
try {
  const childEnv = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });

  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem(`nodus.mobileTeaserSeen.${version}`, '1');
    // Two announcements introduce themselves over the shell on a profile that has not
    // seen them (keys live in PdfPresenterTutorialAnnouncement / TutorialVideosGuide).
    // This test is about the Library, not about dismissing those.
    localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    // The Library presents its own guide the first time it is opened.
    localStorage.setItem('nodus.libraryTutorialSeen.v1', '1');
  }, appVersion);

  // ── A vault with three works and overlapping analysis ───────────────────────
  const { vault } = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'E2E delete', type: 'academic' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    return created;
  });
  assert.ok(vault?.path, 'the vault reports the database it lives in');
  const stamp = new Date().toISOString();
  external = new Database(vault.path);
  external.pragma('foreign_keys = ON');
  const work = external.prepare(`INSERT INTO works(
    nodus_id,zotero_key,title,authors_json,year,item_type,source_type,archived,
    light_status,deep_status,summary_status
  ) VALUES(?,?,?,?,?,?,?,0,'done','done','done')`);
  work.run(GONE_A, 'Z-A', 'Obra A (se borra)', '[]', 2024, 'book', 'pdf');
  work.run(KEPT_B, 'Z-B', 'Obra B (sobrevive)', '[]', 2024, 'book', 'pdf');
  work.run(GONE_C, 'Z-C', 'Obra C (se borra)', '[]', 2025, 'book', 'pdf');
  const idea = external.prepare('INSERT INTO ideas(global_id,type,label,statement,embedding,created_at) VALUES(?,?,?,?,?,?)');
  idea.run('e2e-shared', 'claim', 'Idea compartida', 's', Buffer.from([9, 9, 9]), stamp);
  idea.run('e2e-a-only', 'claim', 'Idea solo de A', 's', Buffer.from([1, 1, 1]), stamp);
  idea.run('e2e-c-only', 'claim', 'Idea solo de C', 's', Buffer.from([3, 3, 3]), stamp);
  const occurrence = external.prepare('INSERT INTO idea_occurrences(global_id,nodus_id,role,development,confidence) VALUES(?,?,?,?,?)');
  occurrence.run('e2e-shared', GONE_A, 'principal', 'd', 1);
  occurrence.run('e2e-shared', KEPT_B, 'principal', 'd', 1);
  occurrence.run('e2e-a-only', GONE_A, 'principal', 'd', 1);
  occurrence.run('e2e-c-only', GONE_C, 'principal', 'd', 1);
  const passage = external.prepare(`INSERT INTO passages(
    passage_id,nodus_id,chunk_index,text,char_len,content_hash,embedding,created_at
  ) VALUES(?,?,?,?,?,?,?,?)`);
  passage.run(`${GONE_A}#0`, GONE_A, 0, 'pasaje A', 8, 'h-a', Buffer.from([1]), stamp);
  passage.run(`${KEPT_B}#0`, KEPT_B, 0, 'pasaje B', 8, 'h-b', Buffer.from([2]), stamp);
  passage.run(`${GONE_C}#0`, GONE_C, 0, 'pasaje C', 8, 'h-c', Buffer.from([3]), stamp);
  external.prepare('INSERT INTO edges(id,from_id,to_id,type,basis,confidence,source_work) VALUES(?,?,?,?,?,?,?)')
    .run('e2e-edge-b', 'e2e-shared', 'e2e-shared', 'relates', 'b', 1, KEPT_B);
  external.close();
  external = null;

  // Mark the app as set up and reload: StartupGate then renders the shell instead of the
  // onboarding wizard a brand-new vault opens on. This is about the Library, not about
  // walking a first-run guide.
  await page.evaluate(() => window.nodus.updateSettings({
    onboardingComplete: true, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true,
    basicsTutorialVersion: 5, mascotStyle: 'classic', mascotStyleChosen: true, uiLanguage: 'es',
  }));
  await page.reload();
  await page.getByTestId('app-shell').waitFor({ timeout: 30_000 });
  // The startup update check reports "you are up to date" over the shell; dismiss it so
  // the Library is clickable (the e2e profile answers that check deterministically).
  const startupUpdate = page.getByTestId('startup-update-modal');
  await startupUpdate.waitFor({ timeout: 30_000 }).catch(() => undefined);
  if (await startupUpdate.count()) {
    await startupUpdate.getByRole('button', { name: 'Entendido', exact: false }).click();
    await startupUpdate.waitFor({ state: 'detached' });
  }

  // ── The Library lists them, and the delete action is offered once rows are chosen ──
  await page.locator('[data-tour="nav-library"]').click();
  await page.getByTestId(`vault-library-item-${GONE_A}`).waitFor({ timeout: 30_000 });
  for (const id of [KEPT_B, GONE_C]) await page.getByTestId(`vault-library-item-${id}`).waitFor();

  assert.equal(await page.getByTestId('library-delete-selected').count(), 0,
    'with nothing selected there is no delete action to click by mistake');
  for (const id of [GONE_A, GONE_C]) {
    await page.locator(`[data-testid="vault-library-item-${id}"] input[type="checkbox"]`).click();
  }
  const deleteButton = page.getByTestId('library-delete-selected');
  await deleteButton.waitFor({ timeout: 10_000 });
  assert.equal((await deleteButton.innerText()).trim(), 'Eliminar', 'the action is named in the reader\'s language');

  // Red in the running theme, not just in a class name.
  const buttonColor = await deleteButton.evaluate((node) => getComputedStyle(node).backgroundColor);
  assert.equal(buttonColor, 'rgb(220, 38, 38)', `the destructive action is painted red, got ${buttonColor}`);

  // ── Confirm, then the works are actually gone ───────────────────────────────
  await deleteButton.click();
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await dialog.waitFor({ timeout: 10_000 });
  const dialogText = await dialog.innerText();
  assert.match(dialogText, /Eliminar las 2 obras seleccionadas/);
  assert.match(dialogText, /ideas extraídas, sus pasajes, sus embeddings/);
  assert.match(dialogText, /que compartan con otras obras se conservan/);
  assert.match(dialogText, /no se puede deshacer/);

  await dialog.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await waitForCondition('las obras borradas desaparecen de la lista', async () =>
    (await page.getByTestId(`vault-library-item-${GONE_A}`).count()) === 0
    && (await page.getByTestId(`vault-library-item-${GONE_C}`).count()) === 0);
  assert.equal(await page.getByTestId(`vault-library-item-${KEPT_B}`).count(), 1, 'the work that was not selected stays');

  const remaining = await page.evaluate(async () => (await window.nodus.listWorks()).map((entry) => entry.nodus_id));
  assert.deepEqual(remaining, [KEPT_B], 'the vault now holds exactly the surviving work');

  // ── The surviving work's analysis, read straight from the database file ─────
  external = new Database(vault.path);
  const rows = (sql, ...params) => external.prepare(sql).all(...params);
  assert.deepEqual(
    rows('SELECT nodus_id FROM idea_occurrences WHERE global_id=? ORDER BY nodus_id', 'e2e-shared').map((row) => row.nodus_id),
    [KEPT_B],
    'the shared idea keeps the surviving work\'s occurrence and loses the deleted one'
  );
  const shared = rows('SELECT orphaned_at, embedding FROM ideas WHERE global_id=?', 'e2e-shared')[0];
  assert.ok(shared, 'the shared idea itself is never deleted');
  assert.equal(shared.orphaned_at, null);
  assert.deepEqual(Buffer.from(shared.embedding), Buffer.from([9, 9, 9]), 'its embedding is untouched');
  for (const [globalId, bytes] of [['e2e-a-only', [1, 1, 1]], ['e2e-c-only', [3, 3, 3]]]) {
    const dormant = rows('SELECT orphaned_at, embedding FROM ideas WHERE global_id=?', globalId)[0];
    assert.ok(dormant, `${globalId} is kept rather than deleted`);
    assert.ok(dormant.orphaned_at, `${globalId} is marked dormant`);
    assert.deepEqual(Buffer.from(dormant.embedding), Buffer.from(bytes), `${globalId} keeps its embedding`);
  }
  assert.deepEqual(rows('SELECT passage_id FROM passages ORDER BY passage_id').map((row) => row.passage_id), [`${KEPT_B}#0`],
    'only the surviving work keeps its passages, and the passage index went with the others');
  assert.equal(rows('SELECT COUNT(*) AS n FROM passages_fts').length, 1);
  assert.equal(rows('SELECT COUNT(*) AS n FROM passages_fts')[0].n, 1, 'the passage search index no longer answers for deleted works');
  assert.equal(rows('SELECT COUNT(*) AS n FROM edges WHERE id=?', 'e2e-edge-b')[0].n, 1, 'the surviving work keeps its relations');
  assert.equal(rows('SELECT COUNT(*) AS n FROM works')[0].n, 1);
  external.close();
  external = null;

  assert.deepEqual(pageErrors, [], `the renderer logged no page errors: ${pageErrors.map((error) => error.message).join(' | ')}`);
  console.log('e2e library delete works passed');
} finally {
  try { external?.close(); } catch { /* already closed */ }
  if (app) await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
