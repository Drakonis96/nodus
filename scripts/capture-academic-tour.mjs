import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const outputRoot = path.resolve(process.argv[2] || path.join(repoRoot, 'artifacts', 'academic-tour'));
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-academic-tour-'));

const languages = [
  ['es', 'Español'],
  ['en', 'English'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['pt', 'Português'],
  ['pt-BR', 'Português (Brasil)'],
  ['it', 'Italiano'],
  ['tr', 'Türkçe'],
];

const expectedTargets = [null, 'vault-badge', 'nav-library', 'library-scope', null, 'nav-ideas', 'nav-graph', 'nav-workspace', null];
const viewport = { width: 1440, height: 900 };
const thumb = { width: 456, height: 285 };
const captionHeight = 46;

async function makeContactSheet(language, files, titles) {
  const width = thumb.width * 3;
  const height = (thumb.height + captionHeight) * 3;
  const composites = [];
  for (let index = 0; index < files.length; index += 1) {
    const left = (index % 3) * thumb.width;
    const top = Math.floor(index / 3) * (thumb.height + captionHeight);
    const image = await sharp(files[index]).resize(thumb.width, thumb.height, { fit: 'cover' }).png().toBuffer();
    const safeTitle = titles[index].replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
    const caption = Buffer.from(`<svg width="${thumb.width}" height="${captionHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#111827"/>
      <text x="14" y="18" fill="#818cf8" font-family="Inter, Arial, sans-serif" font-size="11" font-weight="700">${language.toUpperCase()} · ${index + 1}/9</text>
      <text x="14" y="36" fill="#f3f4f6" font-family="Inter, Arial, sans-serif" font-size="13">${safeTitle}</text>
    </svg>`);
    composites.push({ input: image, left, top }, { input: caption, left, top: top + thumb.height });
  }
  const destination = path.join(outputRoot, `${language}-contact-sheet.png`);
  await sharp({ create: { width, height, channels: 4, background: '#030712' } }).composite(composites).png().toFile(destination);
  return destination;
}

let app;
try {
  assert.ok(existsSync(path.join(repoRoot, 'dist', 'index.html')), 'Run the production build before capturing');
  await mkdir(outputRoot, { recursive: true });
  const childEnv = {
    ...process.env,
    NODUS_USERDATA: userData,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available',
    NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.setViewportSize(viewport);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.waitForFunction(() => Boolean(window.nodus));
  await page.evaluate(async ({ version }) => {
    localStorage.setItem('nodus.libraryTutorialSeen.v1', '1');
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem(`nodus.mobileTeaserSeen.${version}`, '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    const vaults = await window.nodus.listVaults();
    if (vaults[0]) await window.nodus.setVaultType(vaults[0].id, 'academic');
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 999,
      firstVaultVersion: 999,
      recoverySetupVersion: 999,
      tourComplete: false,
      advancedTourComplete: true,
      mascotEnabled: false,
      mascotStyleChosen: true,
      theme: 'dark',
      libraryGlobalEnabled: false,
      libraryScope: 'vault',
      sidebarCustomized: false,
    });
  }, { version: appVersion });

  const contactSheets = [];
  for (const [language, label] of languages) {
    await page.evaluate(async (uiLanguage) => {
      await window.nodus.updateSettings({ uiLanguage, promptLanguage: uiLanguage, tourComplete: false, advancedTourComplete: true });
    }, language);
    await page.reload();
    await page.getByTestId('app-shell').waitFor();
    const card = page.getByTestId('tour-card');
    await card.waitFor();

    const languageDir = path.join(outputRoot, language);
    await mkdir(languageDir, { recursive: true });
    const files = [];
    const titles = [];
    for (let index = 0; index < 9; index += 1) {
      if (index === 1) await card.getByTestId('tour-start-walkthrough').click();
      else if (index > 1) await card.getByTestId('tour-next').click();

      await page.waitForFunction((expected) => {
        const eyebrow = document.querySelector('[data-testid="tour-card"] [aria-live="polite"]');
        return eyebrow?.textContent?.includes(expected);
      }, `${index + 1}/9`);

      const target = expectedTargets[index];
      if (target) {
        await page.locator(`[data-tour="${target}"]`).first().waitFor({ state: 'visible' });
        await page.getByTestId('tour-spotlight').waitFor({ state: 'visible' });
      }
      await page.waitForTimeout(260);
      const title = (await card.locator('h3').innerText()).trim();
      titles.push(title);
      const box = await card.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
        `${language} step ${index + 1} card must stay inside the viewport: ${JSON.stringify(box)}`);
      const file = path.join(languageDir, `${String(index + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file });
      files.push(file);
    }
    contactSheets.push(await makeContactSheet(language, files, titles));
    process.stdout.write(`[academic-tour] ${label}: 9/9 steps captured\n`);
  }

  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.stack || error.message).join('\n'));
  process.stdout.write(`${JSON.stringify({ outputRoot, contactSheets }, null, 2)}\n`);
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
