/** Screenshot only: real isolated renderer, synthetic metadata, no indexing or inference. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron } from 'playwright-core';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..');
const root = createResearchTestRoot();
const sandbox = macResearchSandbox(root);
const proof = verifyResearchSandbox(root, sandbox);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const policyPath = path.join(root, 'isolation.sb');
const wrapper = path.join(root, 'electron-isolated');
fs.writeFileSync(policyPath, sandbox);
fs.writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(policyPath)} ${quote(require('electron'))} "$@"\n`, { mode: 0o700 });
let app;
try {
  app = await _electron.launch({ executablePath: wrapper, args: ['--no-sandbox', '--disable-gpu', repoRoot], cwd: root,
    env: researchTestEnvironment(root), timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 60000 });
  await page.evaluate(async ({ root, version }) => {
    await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1, decision: 'pending' });
    await window.nodus.updateSettings({ autoLightScan: false, autoDeepScanOnReadTag: false, autoSummaryAfterDeep: false,
      autoBridgeAfterQueue: false, autoBackupFolder: `${root}/library`, onboardingComplete: true,
      basicsTutorialVersion: 99, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true,
      uiLanguage: 'es', theme: 'dark', mascotStyle: 'orb', mascotStyleChosen: true, mascotEnabled: false, reduceMotion: true,
      embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3' });
    // A non-secret fixture key makes the configured state visible. Network is denied by Seatbelt.
    await window.nodus.setApiKey('openrouter', 'synthetic-screenshot-only-never-call');
    const items = [];
    for (const title of ['Memoria y aprendizaje', 'Lenguaje y conocimiento', 'Perspectivas de investigación']) {
      items.push(await window.nodus.createGlobalLibraryItem({ title, itemType: 'report', creators: [], abstract: 'Synthetic screenshot fixture. No document indexing is authorized.' }, []));
    }
    const vault = await window.nodus.getActiveVault();
    await window.nodus.linkGlobalLibraryItemsToVault(items.map(item => item.id), vault.id);
    localStorage.setItem('nodus.lastSeenVersion', version);
    for (const key of ['nodus.mobileTeaserSeen.3.2.4', 'nodus.platformHighlightsSeen.2026-07', 'nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA', 'nodus.toolkitBetaGuideSeen.2.4.0']) localStorage.setItem(key, '1');
    await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 0, decision: 'pending' });
  }, { root, version: JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  const modal = page.getByTestId('research-preparation-welcome');
  await modal.getByText('baai/bge-m3', { exact: true }).waitFor({ timeout: 60000 });
  await page.screenshot({ path: path.join(root, 'artifacts/welcome-cinematic.png') });
  await modal.getByRole('button', { name: 'No', exact: true }).click();
  await modal.getByText('¿Dejar la indexación desactivada?', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, 'artifacts/welcome-confirmation.png') });
  fs.writeFileSync(path.join(root, 'artifacts/screenshot.json'), JSON.stringify({ root, proof, mode: 'screenshot-only', synthetic: true, modelCalls: 0 }, null, 2));
  console.log(JSON.stringify({ root, screenshots: ['welcome-cinematic.png', 'welcome-confirmation.png'] }));
} finally { await app?.close(); }
