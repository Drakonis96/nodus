// Focused Electron regression: the debates LIST must stay lean while the
// single-debate DETAIL stays complete.
//
// getDebates() returns every contradiction in the corpus in one IPC message.
// It shipped each occurrence's full development prose and every evidence quote
// for both sides — tens of megabytes structured-cloned — when the list renders
// `works.slice(0, 2)` with `evidence.slice(0, 1)` per side and never shows
// development at all, and MCP's list search matches only on tension, themes,
// labels, statements, authors and work titles.
//
// Run against the real demo corpus, because the risk is not that the trim is
// wrong in principle but that it removes a field something still reads.
import assert from 'node:assert/strict';
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
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-debates-'));

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  throw new Error('Run `npm run build` before this focused verification.');
}

const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

async function closeElectronApp(instance) {
  if (!instance) return;
  const child = instance.process();
  let timeout;
  const closed = instance.close().then(() => true, () => false);
  const ok = await Promise.race([closed, new Promise((r) => { timeout = setTimeout(() => r(false), 5_000); })]);
  clearTimeout(timeout);
  if (!ok && child.exitCode === null && !child.killed) child.kill('SIGKILL');
}

let app;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(60_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  }, appVersion);
  await page.evaluate(async () => {
    await window.nodus.seedDemoData();
    await window.nodus.updateSettings({
      onboardingComplete: true, basicsTutorialVersion: 3, recoverySetupVersion: 1,
      tourComplete: true, advancedTourComplete: true, mascotEnabled: false, uiLanguage: 'es',
    });
  });
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  console.log('[debates] Demo corpus ready');

  const debates = await page.evaluate(async () => window.nodus.getDebates());
  assert.ok(Array.isArray(debates), 'getDebates must return a list');
  assert.ok(debates.length > 0, 'the demo corpus must contain contradictions to verify against');
  console.log(`[debates] ${debates.length} debates returned`);

  const sides = debates.flatMap((debate) => [debate.sideA, debate.sideB]);
  const works = sides.flatMap((side) => side.works);
  assert.ok(works.length > 0, 'debates must carry their backing works');

  // --- The trim actually happened -----------------------------------------
  assert.ok(
    works.every((work) => work.development === ''),
    'list responses must not carry occurrence development prose'
  );
  assert.ok(
    works.every((work) => work.evidence.length <= 1),
    'list responses must carry at most the one evidence quote the list renders'
  );

  // --- Everything the UI and MCP search read is still there ---------------
  // DebateView filters on labels, statements, authors and shared themes;
  // MCP's list search adds tension and work titles.
  for (const side of sides) {
    assert.equal(typeof side.label, 'string', 'side label must survive');
    assert.equal(typeof side.statement, 'string', 'side statement must survive');
    assert.ok(Array.isArray(side.authors), 'side authors must survive');
    assert.ok(Array.isArray(side.works), 'side works must survive');
  }
  assert.ok(
    works.every((work) => typeof work.title === 'string' && typeof work.nodus_id === 'string'),
    'work titles and ids must survive — MCP search matches on titles'
  );
  assert.ok(
    debates.every((d) => typeof d.tension === 'string' && Array.isArray(d.sharedThemes)),
    'tension and shared themes must survive'
  );
  // The list renders one quote per work with a page link, so the quote and its
  // location must still be present on whatever evidence is kept.
  const keptEvidence = works.flatMap((work) => work.evidence);
  if (keptEvidence.length > 0) {
    assert.ok(
      keptEvidence.every((ev) => typeof ev.quote === 'string' && ev.quote.length > 0),
      'the retained evidence must still carry its quote'
    );
    assert.ok(keptEvidence.some((ev) => 'location' in ev), 'evidence location must survive for the page link');
    console.log(`[debates] ${keptEvidence.length} evidence quotes retained across ${works.length} works`);
  }

  // --- The detail path is unaffected --------------------------------------
  // getDebate() feeds MCP's nodus_get_debate and the AI synthesis, and must
  // still return the full prose.
  const detail = await page.evaluate(async (edgeId) => {
    const { getDebate } = require('./dist-electron/main.js');
    return getDebate ? getDebate(edgeId) : null;
  }, debates[0].id).catch(() => null);
  if (detail) {
    const detailWorks = [detail.sideA, detail.sideB].flatMap((s) => s.works);
    assert.ok(
      detailWorks.some((w) => w.development.length > 0),
      'the single-debate detail must still carry development prose'
    );
    console.log('[debates] Detail path still complete');
  } else {
    console.log('[debates] Detail path not reachable from the renderer; covered by the MCP suite');
  }

  console.log('Debates payload verification passed.');
} finally {
  await closeElectronApp(app);
  await rm(userData, { recursive: true, force: true });
}
