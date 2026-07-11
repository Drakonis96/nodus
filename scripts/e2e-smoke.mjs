// End-to-end smoke test: launches the REAL Electron app (dist-electron build)
// against a throwaway user-data profile and verifies the vital signs no unit
// test can see — the window opens, the renderer mounts, the preload bridge is
// live, graph:get answers over real IPC (compute worker included), the DB
// migrates to the current schema, and the renderer logs no uncaught errors.
//
// Requires a build (dist/ + dist-electron/); run via `npm run test:e2e`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Re-exec under Electron-as-Node so the final better-sqlite3 check matches the
// app ABI (same pattern as every other script in this suite). Playwright then
// spawns the real Electron GUI as a child of this process.
if (!process.argv.includes('--electron-e2e-smoke')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/e2e-smoke.mjs'), '--electron-e2e-smoke'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  console.log('[e2e] no build found — running npm run build first…');
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-e2e-'));
let app = null;
try {
  // The child must run as a real GUI app: strip the runner's as-Node flag.
  const childEnv = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: require('electron'),
    args: [repoRoot],
    env: childEnv,
  });

  // ── Window + renderer mount ─────────────────────────────────────────────────
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return !!root && root.children.length > 0;
  }, { timeout: 30_000 });
  console.log('[e2e] renderer mounted');

  // Suppress the "what's new" modal: a fresh profile has no last-seen version, so it
  // would otherwise overlay the app and intercept later clicks. localStorage persists
  // across the reloads below (same origin).
  await page.evaluate(() => localStorage.setItem('nodus.lastSeenVersion', '9999.0.0'));

  // ── Preload bridge ──────────────────────────────────────────────────────────
  const bridge = await page.evaluate(() => ({
    hasNodus: typeof window.nodus === 'object' && window.nodus !== null,
    hasGetGraph: typeof window.nodus?.getGraph === 'function',
    hasEdgeFeedback: typeof window.nodus?.setEdgeFeedback === 'function',
    hasImageModels: typeof window.nodus?.listImageModels === 'function',
    hasImageQueue: typeof window.nodus?.queueDecorativeImage === 'function',
    hasSearchDetail: typeof window.nodus?.getSearchResultDetail === 'function',
  }));
  assert.equal(bridge.hasNodus, true, 'window.nodus bridge exposed');
  assert.equal(bridge.hasGetGraph, true, 'getGraph available');
  assert.equal(bridge.hasEdgeFeedback, true, 'setEdgeFeedback available');
  assert.equal(bridge.hasImageModels, true, 'image model catalog available');
  assert.equal(bridge.hasImageQueue, true, 'decorative image queue available');
  assert.equal(bridge.hasSearchDetail, true, 'search detail modal bridge available');
  console.log('[e2e] preload bridge ok');

  // ── Main header: model selection belongs to Settings/features, never global ─
  const smokeModel = { provider: 'openai', model: 'smoke-model' };
  const chatModel = { provider: 'openrouter', model: 'smoke-chat-model' };
  const migrated = await page.evaluate((model) =>
    window.nodus.updateSettings({
      defaultModel: model,
      extractionModel: null,
      synthesisModel: null,
      summaryModel: null,
      fusionModel: null,
    }), smokeModel);
  assert.equal(migrated.defaultModel, null, 'legacy global choice retired after migration');
  for (const key of ['extractionModel', 'synthesisModel', 'summaryModel', 'fusionModel']) {
    assert.deepEqual(migrated[key], smokeModel, `legacy model migrated into ${key}`);
  }
  const independent = await page.evaluate(({ model, chat }) =>
    window.nodus.updateSettings({
      onboardingComplete: true,
      tourComplete: true,
      advancedTourComplete: true,
      favorites: [model, chat],
      extractionModel: model,
      synthesisModel: model,
      summaryModel: chat,
      fusionModel: chat,
      chatModel: chat,
      deepResearchModel: model,
      immersionModel: chat,
      imageProvider: 'google',
      imageModel: 'gemini-3.1-flash-lite-image',
      imageStyle: 'antique_book',
    }), { model: smokeModel, chat: chatModel });
  assert.deepEqual(independent.chatModel, chatModel, 'chat model persists independently');
  assert.deepEqual(independent.deepResearchModel, smokeModel, 'Deep Research model persists independently');
  assert.deepEqual(independent.immersionModel, chatModel, 'immersion model persists independently');
  assert.equal(independent.imageModel, 'gemini-3.1-flash-lite-image', 'image model persists independently');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('header'));
  assert.equal(await page.locator('header select[data-tour="model"]').count(), 0, 'global header model selector removed');
  await page.locator('[data-tour="nav-settings"]').click();
  await page.getByText('Generación de imágenes', { exact: true }).waitFor({ timeout: 30_000 });
  assert.equal(await page.getByText('gemini-3.1-flash-lite-image', { exact: false }).count() > 0, true, 'image settings render selected verified model');
  console.log('[e2e] image provider settings rendered');
  await page.getByRole('button', { name: 'Asistente', exact: true }).click();
  assert.equal(await page.locator('select[title="Modelo del chat"]').inputValue(), 'openrouter::smoke-chat-model');
  await page.locator('button[title="Cerrar"]').click();
  console.log('[e2e] header has no global model selector');

  // ── Search result: an idea reuses the Ideas section's detail modal ─────────
  assert.equal(await page.evaluate(() => window.nodus.seedDemoData()), true, 'demo corpus seeded for search smoke');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-tour="nav-search"]'));
  await page.locator('[data-tour="nav-search"]').click();
  const searchInput = page.getByPlaceholder('Busca en notas, ideas, obras, huecos, temas y autores…');
  await searchInput.fill('recuperación');
  await page.getByText('Práctica de recuperación y retención a largo plazo', { exact: true }).waitFor({ timeout: 10_000 });
  await page.getByText('Práctica de recuperación y retención a largo plazo', { exact: true }).click();
  const detailDialog = page.locator('[role="dialog"]');
  await detailDialog.waitFor();
  // The idea opens the shared IdeaDetailModal, whose graph jump is the secondary
  // "Ver en el grafo" action — not an immediate navigation away from Search.
  const graphAction = detailDialog.getByRole('button', { name: 'Ver en el grafo', exact: true });
  await graphAction.waitFor({ timeout: 10_000 });
  assert.equal(await graphAction.count(), 1, 'idea detail modal opened with its secondary graph action');
  assert.equal(await searchInput.isVisible(), true, 'search remains the active primary surface');
  await detailDialog.locator('button[title="Cerrar"]').first().click();
  console.log('[e2e] search idea result opens the shared idea detail modal');

  // ── Optional-image controls exist and can be toggled without generation ───
  // The immersion image option now lives in the "New immersion" composer modal.
  await page.locator('[data-tour="nav-immersion"]').click();
  await page.getByRole('button', { name: 'Nueva inmersión', exact: true }).first().click();
  const immersionImageToggle = page.getByRole('button', { name: 'Imagen decorativa', exact: true });
  await immersionImageToggle.waitFor();
  assert.equal(await page.getByRole('option', { name: 'Acuarela', exact: true }).count(), 0, 'immersion style hidden while disabled');
  await immersionImageToggle.click();
  assert.equal(await page.getByRole('option', { name: 'Acuarela', exact: true }).count(), 1, 'immersion style shown when enabled');
  await immersionImageToggle.click();
  assert.equal(await page.getByRole('option', { name: 'Acuarela', exact: true }).count(), 0, 'immersion image option disables cleanly');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await page.locator('[data-tour="nav-deepResearch"]').click();
  // The Deep Research image option now lives in the "New report" composer modal.
  await page.getByRole('button', { name: 'Nuevo informe', exact: true }).first().click();
  const reportImageToggle = page.getByRole('button', { name: 'Imagen decorativa', exact: true });
  await reportImageToggle.waitFor();
  await reportImageToggle.click();
  assert.equal(await page.getByRole('option', { name: 'Acuarela', exact: true }).count(), 1, 'Deep Research style shown when enabled');
  await reportImageToggle.click();
  assert.equal(await page.getByRole('option', { name: 'Acuarela', exact: true }).count(), 0, 'Deep Research image option disables cleanly');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  console.log('[e2e] optional image controls toggle in both owner flows');

  // ── Real IPC round-trip: the async graph build (compute worker path) ────────
  const graph = await page.evaluate(() => window.nodus.getGraph('ideas'));
  assert.ok(graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges), 'graph:get returns {nodes, edges}');
  console.log(`[e2e] graph:get ok (${graph.nodes.length} nodes, ${graph.edges.length} edges on a fresh profile)`);

  const authorsGraph = await page.evaluate(() => window.nodus.getGraph('authors'));
  assert.ok(Array.isArray(authorsGraph.nodes), 'authors lens answers too');

  // ── No uncaught renderer errors during startup ──────────────────────────────
  assert.deepEqual(
    pageErrors.map((e) => String(e?.message ?? e)),
    [],
    'renderer produced uncaught errors'
  );
  console.log('[e2e] no renderer page errors');

  await app.close();
  app = null;

  // ── DB migrated to the current schema ───────────────────────────────────────
  const dbFile = await findSqlite(userData);
  assert.ok(dbFile, 'app created a SQLite database');
  const Database = require('better-sqlite3');
  const db = new Database(dbFile, { readonly: true });
  const version = db.pragma('user_version', { simple: true });
  const imageTable = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'decorative_images'").get();
  db.close();
  const source = await readFile(path.join(repoRoot, 'electron/db/migrations.ts'), 'utf8');
  const expected = Number(source.match(/export const SCHEMA_VERSION = (\d+);/)?.[1]);
  assert.equal(version, expected, `DB migrated to schema v${expected}`);
  assert.equal(imageTable?.ok, 1, 'decorative_images table exists');
  console.log(`[e2e] database at schema v${version}`);

  console.log('e2e smoke test passed');
} finally {
  if (app) await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true });
}

/** First .sqlite file under the profile dir (vault registry decides the layout). */
async function findSqlite(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.sqlite')) return path.join(e.parentPath ?? e.path, e.name);
  }
  return null;
}
