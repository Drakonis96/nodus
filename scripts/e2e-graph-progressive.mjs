// Focused real-Electron smoke for the progressive graph path. It intentionally
// avoids unrelated product tours so graph IPC/rendering can be verified even
// when the broader E2E suite is being changed elsewhere.
// Run after a build with: node scripts/e2e-graph-progressive.mjs
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

if (!process.argv.includes('--electron-graph-progressive-e2e')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/e2e-graph-progressive.mjs'), '--electron-graph-progressive-e2e'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

assert.ok(
  existsSync(path.join(repoRoot, 'dist-electron/main.js')) && existsSync(path.join(repoRoot, 'dist/index.html')),
  'production build exists'
);

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-graph-e2e-'));
let app = null;
try {
  const childEnv = {
    ...process.env,
    NODUS_USERDATA: userData,
    NODUS_DISABLE_AUTO_UPDATE: '1',
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: require('electron'),
    args: [repoRoot],
    env: childEnv,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message ?? error)));
  await page.waitForFunction(() => typeof window.nodus?.getGraphOverview === 'function');

  assert.equal(await page.evaluate(() => window.nodus.seedDemoData()), true, 'demo corpus seeded');
  const result = await page.evaluate(async () => {
    const overview = await window.nodus.getGraphOverview();
    const firstTheme = overview.nodes.find((node) => node.type === 'theme');
    const theme = firstTheme
      ? await window.nodus.getGraphTheme(firstTheme.themes[0] ?? firstTheme.label, 90)
      : { nodes: [], edges: [] };
    return { overview, theme };
  });

  assert.ok(result.overview.nodes.length > 0, 'overview has theme hubs');
  assert.ok(result.overview.nodes.every((node) => node.type === 'theme'), 'overview contains only theme hubs');
  const ideaNodes = result.theme.nodes.filter((node) => node.type !== 'theme');
  assert.ok(ideaNodes.length <= 150, 'theme scene is bounded to core plus bridges');
  const themeIds = new Set(result.theme.nodes.map((node) => node.id));
  assert.ok(
    result.theme.edges.every((edge) => themeIds.has(edge.source) && themeIds.has(edge.target)),
    'theme edges have present endpoints'
  );

  await page.evaluate(async (version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem(`nodus.mobileTeaserSeen.${version}`, '1');
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 5,
      recoverySetupVersion: 1,
      tourComplete: true,
      advancedTourComplete: true,
    });
  }, appVersion);
  await page.reload();
  await page.locator('[data-tour="nav-graph"]').click();
  await page.locator('canvas').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
  assert.deepEqual(pageErrors, [], 'progressive graph renders without uncaught renderer errors');

  // Regression: opening Graph from an idea tab used to leave the new renderer
  // on the whole corpus because the deep-link still targeted the removed engine.
  await page.locator('[data-tour="nav-ideas"]').click();
  await page.getByTestId('ideas-catalog-table').waitFor({ state: 'visible' });
  const firstIdea = page.locator('[data-testid^="idea-row-"]').first();
  await firstIdea.waitFor({ state: 'visible' });
  await firstIdea.click();
  const ideaDetail = page.getByTestId('idea-detail-tab');
  await ideaDetail.waitFor({ state: 'visible' });
  const ideaLabel = (await ideaDetail.locator('h2').innerText()).trim();
  assert.ok(ideaLabel, 'idea detail tab exposes its label');
  await ideaDetail.getByRole('button', { name: /Graph|Grafo/, exact: true }).click();

  await page.getByTestId('sigma-graph-engine').waitFor({ state: 'visible' });
  const focusedPanel = page.locator('.graph-detail-panel');
  await focusedPanel.waitFor({ state: 'visible' });
  await focusedPanel.locator('h3').filter({ hasText: ideaLabel }).waitFor({ state: 'visible' });
  assert.equal(
    await page.getByTestId('knowledge-atlas-hud').getAttribute('data-preset'),
    'overview',
    'idea deep-link stays on the overview preset',
  );
  assert.deepEqual(pageErrors, [], 'idea-to-graph deep-link renders without uncaught renderer errors');

  console.log(
    `[e2e:graph] passed (${result.overview.nodes.length} overview themes, `
      + `${ideaNodes.length} bounded theme ideas; idea deep-link focused by Sigma)`
  );
  await app.close();
  app = null;
} finally {
  if (app) await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true });
}
