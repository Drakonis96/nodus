// End-to-end verification of the video tutorials, driven through the real app.
//
// What only a real run can prove:
//   1. the third gate appears after language and Nodi, in the language just chosen;
//   2. the CSP actually admits the embed — a blocked frame never attaches, it only
//      logs "Refused to frame …", which no static check would catch;
//   3. opening a video records the watched flag app-wide, and the card reflects it;
//   4. the grid also reads correctly inside Settings, in light mode;
//   5. the academic tour opens with three ways in.
//
// Run with: node scripts/verify-tutorial-videos.mjs   (build first: npm run build)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const repoRoot = process.env.NODUS_REPO_ROOT ?? path.resolve(import.meta.dirname, '..');
const shots = process.env.NODUS_VERIFY_SHOTS ?? path.join(os.tmpdir(), 'nodus-tutorial-video-shots');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--child')) {
  execFileSync(require('electron'), [import.meta.filename, '--child'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-tutorial-video-'));
await mkdir(shots, { recursive: true });

// A stand-in for the published catalogue, so the remote path is actually exercised
// instead of only its fallback. It adds a fourth tutorial this build knows nothing
// about — the whole point of the file being remote.
const PUBLISHED = {
  videos: [
    ...JSON.parse(await readFile(path.join(repoRoot, 'docs/tutorials.json'), 'utf8')).videos,
    {
      id: 'worldbuilding', youtubeId: 'dQw4w9WgXcQ', order: 4, icon: 'tree', vaultType: 'worldbuilding',
      copy: {
        es: { title: 'La bóveda de mundos', body: 'Publicada después de esta versión de Nodus.' },
        en: { title: 'The worldbuilding vault', body: 'Published after this Nodus build.' },
      },
    },
  ],
};
const catalogueServer = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(PUBLISHED));
});
await new Promise((resolve) => catalogueServer.listen(0, '127.0.0.1', resolve));
const cataloguePort = catalogueServer.address().port;

const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_TUTORIAL_CATALOGUE_URL: `http://127.0.0.1:${cataloguePort}/tutorials.json`,
};
delete childEnv.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
const step = (msg) => console.log(`\n✓ ${msg}`);

/** The startup update check owns the foreground on every launch into the shell. */
async function dismissStartupUpdate(page) {
  const modal = page.getByTestId('startup-update-modal');
  await modal.waitFor({ timeout: 15_000 }).catch(() => {});
  if (!(await modal.count())) return;
  await modal.locator('.startup-update-primary').click();
  await modal.waitFor({ state: 'detached' });
}

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  const console_ = [];
  page.on('console', (message) => console_.push(message.text()));
  // YouTube's "error 153" card is rendered INSIDE the cross-origin frame, so it cannot
  // be read from here. Its thumbnail can: the real player pulls a poster from ytimg,
  // the error card pulls nothing. This needs the network — it is why this lives in a
  // verify script rather than in the offline e2e smoke.
  const requested = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });
  // A fresh profile has never seen this version's release notes, so the what's-new modal
  // would sit over the app and swallow every later click. The sentinel is an exact
  // match against the app version, so it has to be the real one.
  const appVersion = require(path.join(repoRoot, 'package.json')).version;
  await page.evaluate((version) => localStorage.setItem('nodus.lastSeenVersion', version), appVersion);

  // ── 1. the three gates, in order ──────────────────────────────────────────────
  await page.getByTestId('basics-tutorial-language').waitFor();
  await page.getByTestId('tutorial-language-es').click();
  await page.getByTestId('basics-tutorial-nodi-style').waitFor();
  await page.getByTestId('nodi-style-classic').click();

  const modeScreen = page.getByTestId('basics-tutorial-mode');
  await modeScreen.waitFor();
  await page.getByText('¿Cómo prefieres aprender?', { exact: true }).waitFor();
  await page.getByText('Más tutoriales próximamente.', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(shots, '1-learn-mode-choice.png') });
  step('language → Nodi → "¿Cómo prefieres aprender?", with the video path recommended');

  // ── 2. the grid, and the embed the CSP has to admit ───────────────────────────
  await page.getByTestId('tutorial-mode-video').click();
  await page.getByTestId('basics-tutorial-videos').waitFor();
  // The published catalogue adds a fourth tutorial this build does not contain, so the
  // grid growing from three to four is the proof that the remote path works.
  await page.locator('[data-testid="tutorial-video-card-worldbuilding"]').waitFor({ timeout: 15_000 });
  assert.equal(await page.locator('.tutorial-video-card').count(), 4, 'the grid picks up a tutorial published after this build');
  await page.getByText('La bóveda de mundos', { exact: true }).waitFor();
  const cataloguedIds = await page.evaluate(async () => (await window.nodus.getTutorialCatalogue()).map((video) => video.id));
  assert.deepEqual(cataloguedIds, ['essentials', 'academic', 'nodi', 'worldbuilding']);
  assert.ok(existsSync(path.join(userData, 'tutorial-catalogue.json')), 'the answer is cached for the next offline launch');
  // The catalogue grows over time, so the grid must keep fitting the window instead of
  // pushing the guide sideways.
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    zoom: window.devicePixelRatio,
    gridWidth: document.querySelector('.tutorial-video-grid')?.scrollWidth ?? 0,
    stageWidth: document.querySelector('.tutorial-videos-cinema')?.clientWidth ?? 0,
  }));
  assert.ok(
    layout.scrollWidth <= layout.clientWidth,
    `the video screen does not scroll sideways with a grown catalogue: ${JSON.stringify(layout)}`
  );
  await page.screenshot({ path: path.join(shots, '2-video-grid-cinema.png') });
  step('the video mode renders the published catalogue, including a tutorial newer than the build');

  await page.getByTestId('tutorial-video-play-essentials').click();
  const player = page.getByTestId('tutorial-video-player');
  await player.waitFor();
  const embedSrc = await player.locator('iframe').getAttribute('src');
  assert.match(embedSrc ?? '', /^https:\/\/www\.youtube-nocookie\.com\/embed\/QqSY1_DeDRM\?/);
  // The frame ATTACHING is the proof: the CSP would refuse it outright otherwise.
  await page.waitForFunction(() => {
    const frame = document.querySelector('.tutorial-video-frame iframe');
    return !!frame && !!frame.contentWindow;
  });
  const refusals = console_.filter((text) => /Refused to frame/i.test(text));
  assert.deepEqual(refusals, [], `CSP refused the embed: ${refusals.join(' | ')}`);
  await page.waitForTimeout(4_000); // let the embed fetch its poster and paint
  await page.screenshot({ path: path.join(shots, '3-player.png') });
  assert.ok(
    requested.some((url) => /ytimg\.com/.test(url)),
    'the embed rendered the real player (a rejected embed loads no poster) — check the Referer rewrite in main.ts'
  );
  step(`the in-app player loads the no-cookie embed with no CSP refusal (${embedSrc})`);

  // ── 3. watched, app-wide ──────────────────────────────────────────────────────
  const watched = await page.evaluate(async () => (await window.nodus.getSettings()).tutorialVideosWatched);
  assert.deepEqual(watched, ['essentials'], 'opening the video records it as watched');
  await page.getByTestId('tutorial-video-close').click();
  await player.waitFor({ state: 'detached' });
  assert.equal(await page.getByTestId('tutorial-video-card-essentials').getAttribute('data-watched'), 'true');
  await page.screenshot({ path: path.join(shots, '4-grid-watched.png') });
  step('the flag survives the player closing and the card shows it');

  // Leaving through the video path still completes the guide.
  await page.getByTestId('basics-tutorial-complete').click();
  await page.waitForFunction(async () => (await window.nodus.getSettings()).basicsTutorialVersion > 0);
  step('finishing from the video screen completes the essential guide');

  // ── 4. the same grid in Settings, in light mode ───────────────────────────────
  await page.evaluate(() => window.nodus.updateSettings({
    onboardingComplete: true, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true, theme: 'light',
  }));
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await dismissStartupUpdate(page);
  await page.locator('[data-tour="nav-settings"]').click();
  await page.getByRole('button', { name: 'Tutoriales', exact: true }).click();
  const settingsGrid = page.getByTestId('tutorial-video-grid').first();
  await settingsGrid.waitFor();
  await settingsGrid.scrollIntoViewIfNeeded();
  // Same catalogue here, so Settings also shows the tutorial published after the build.
  assert.equal(await settingsGrid.locator('.tutorial-video-card').count(), 4, 'Settings lists the same catalogue as the guide');
  await page.getByTestId('basics-tutorial-replay').waitFor();
  await page.screenshot({ path: path.join(shots, '5-settings-grid-light.png') });
  step('Settings → Tutoriales leads with the same grid, readable in light mode');

  // ── 5. the academic tour opens with three ways in ─────────────────────────────
  await page.evaluate(() => window.nodus.updateSettings({ theme: 'dark', tourComplete: false }));
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await dismissStartupUpdate(page);
  const tourCard = page.getByTestId('tour-card');
  await tourCard.waitFor();
  await tourCard.getByTestId('tour-watch-video').waitFor();
  for (const label of ['Ahora no', 'Sí, enséñame']) {
    assert.equal(await tourCard.getByRole('button', { name: label, exact: true }).count(), 1, `${label} is still offered`);
  }
  await page.screenshot({ path: path.join(shots, '6-tour-three-options.png') });
  const tourBox = await tourCard.boundingBox();
  for (const label of ['tour-watch-video']) {
    const box = await tourCard.getByTestId(label).boundingBox();
    assert.ok(
      box.x >= tourBox.x && box.x + box.width <= tourBox.x + tourBox.width,
      `${label} stays inside the tour card (${JSON.stringify(box)} vs ${JSON.stringify(tourBox)})`
    );
  }
  step('the academic tour offers video (recommended), in-app walkthrough and "not now"');

  // ── 6. a vault WITHOUT a video keeps a clean two-option card ──────────────────
  await page.evaluate(async () => {
    const vaults = await window.nodus.listVaults();
    await window.nodus.setVaultType(vaults[0].id, 'estudio');
    await window.nodus.updateSettings({ studyTourComplete: false });
  });
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await dismissStartupUpdate(page);
  const studyCard = page.getByTestId('tour-card');
  await studyCard.waitFor();
  assert.equal(await studyCard.getByTestId('tour-watch-video').count(), 0, 'no video is offered where none is published yet');
  await page.screenshot({ path: path.join(shots, '7-tour-without-video.png') });
  step('a vault with no video yet still opens with "Sí, enséñame" / "Ahora no"');

  console.log(`\nScreenshots: ${shots}`);
} finally {
  await app.close();
  catalogueServer.close();
}
