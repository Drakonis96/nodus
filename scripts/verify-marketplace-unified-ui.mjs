import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
if (!chrome) throw new Error('Chrome or Chromium is required for the marketplace UI verification.');

const temporary = await mkdtemp(path.join(os.tmpdir(), 'nodus-marketplace-unified-'));
const artifacts = path.join(root, 'artifacts', 'interface-fixes');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: chrome, headless: true });

try {
  const bundle = await build({
    entryPoints: [path.join(root, 'scripts/fixtures/marketplace-unified/renderer.tsx')],
    bundle: true, write: false, platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@shared': path.join(root, 'shared') },
    loader: { '.ttf': 'empty', '.woff': 'empty', '.woff2': 'empty', '.css': 'empty' },
  });
  const tailwind = path.join(temporary, 'tailwind.css');
  execFileSync(path.join(root, 'node_modules/.bin/tailwindcss'), ['-i', 'src/index.css', '-o', tailwind, '--minify'], { cwd: root, stdio: 'pipe' });
  const css = [
    await readFile(tailwind, 'utf8'),
    await readFile(path.join(root, 'src/components/chatSkills.css'), 'utf8'),
    await readFile(path.join(root, 'src/components/headerBalloon.css'), 'utf8'),
    await readFile(path.join(root, 'src/components/capabilityPackages.css'), 'utf8'),
    await readFile(path.join(root, 'src/components/chatVisuals.css'), 'utf8'),
  ].join('\n');

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://marketplace.test/', route => route.fulfill({
    contentType: 'text/html',
    body: '<html class="dark"><body style="margin:0;background:#0b0b0f;color:#e4e4e7"><div id="root"></div></body></html>',
  }));
  await page.goto('http://marketplace.test/');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  const modal = page.getByTestId('skill-marketplace-modal');
  await modal.waitFor();
  const libraryBox = await modal.boundingBox();
  assert.ok(libraryBox);
  // Four tabs that show their title only once chosen.
  const tabs = modal.getByRole('tab');
  assert.deepEqual(await tabs.evaluateAll(items => items.map(item => item.getAttribute('aria-label'))), ['My skills', 'Marketplace', 'Repositories', 'Create']);
  assert.deepEqual(await tabs.evaluateAll(items => items.map(item => item.innerText.trim())), ['My skills', '', '', ''], 'only the selected tab shows its title');
  const importBox = await modal.getByRole('button', { name: 'Import .md', exact: true }).boundingBox();
  assert.ok(importBox && importBox.height <= 40, 'Import .md expanded into an oversized button');
  // One switch per skill: on or off for every chat at once.
  const alpha = modal.locator('.chat-skill-item').filter({ hasText: 'Alpha Method' });
  assert.equal(await alpha.getByRole('switch').count(), 1, 'a single switch, not one per surface');
  assert.equal(await modal.getByText(/^(Assistant|Nodi)$/).count(), 0, 'no surface labels in the library');
  await alpha.getByRole('switch').click();
  await page.waitForFunction(() => window.__marketplaceQa.saved.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__marketplaceQa.saved[0].enabled), { assistant: false, nodi: false }, 'the switch sets every surface together');
  await page.screenshot({ path: path.join(artifacts, '01-my-skills-fixed-size.png') });

  // Repositories: managed here, not in the Marketplace.
  await modal.getByRole('tab', { name: 'Repositories', exact: true }).click();
  assert.equal((await modal.getByRole('tab', { name: 'Repositories', exact: true }).innerText()).trim(), 'Repositories');
  await modal.getByTestId('skills-repo-nodusresearch/nodus-research-skill-marketplace').waitFor();
  assert.equal(await modal.getByTestId('skills-repo-nodusresearch/nodus-research-skill-marketplace').getByRole('button', { name: /^Remove source/ }).count(), 0, 'the official repository cannot be removed');
  await modal.getByRole('textbox', { name: 'Repository URL', exact: true }).fill('https://github.com/labtools/skills');
  await modal.getByRole('button', { name: 'Add', exact: true }).click();
  const communityRow = modal.getByTestId('skills-repo-labtools/skills');
  await communityRow.waitFor();
  await communityRow.getByRole('button', { name: 'Edit: labtools/skills', exact: true }).click();
  await communityRow.getByRole('textbox', { name: 'Repository URL', exact: true }).fill('https://github.com/labtools/skills-v2');
  await communityRow.getByRole('button', { name: 'Save', exact: true }).click();
  await modal.getByTestId('skills-repo-labtools/skills-v2').waitFor();
  assert.equal(await modal.getByTestId('skills-repo-labtools/skills').count(), 0, 'editing replaces the address');
  await modal.getByTestId('skills-repo-labtools/skills-v2').getByRole('button', { name: 'Remove source: labtools/skills-v2', exact: true }).click();
  await modal.getByRole('button', { name: 'Remove', exact: true }).click();
  await modal.getByTestId('skills-repo-labtools/skills-v2').waitFor({ state: 'detached' });
  await page.screenshot({ path: path.join(artifacts, '01b-repositories-tab.png') });

  // Create: no choice between assistant and Nodi; a new skill is on everywhere.
  await modal.getByRole('tab', { name: 'Create', exact: true }).click();
  const editor = modal.getByTestId('skills-hub-editor');
  await editor.waitFor();
  assert.equal(await editor.getByRole('checkbox', { name: /^(Assistant|Nodi)$/ }).count(), 0, 'no surface choice when creating');
  await editor.getByLabel('Skill name', { exact: true }).fill('Field Notes');
  await editor.getByLabel('When to use it', { exact: true }).fill('Use when the user shares field observations.');
  await editor.getByLabel('Instructions', { exact: true }).fill('Turn observations into dated notes.');
  await editor.getByRole('button', { name: 'Create skill', exact: true }).click();
  await page.waitForFunction(() => window.__marketplaceQa.saved.length === 2);
  assert.deepEqual(await page.evaluate(() => window.__marketplaceQa.saved[1].enabled), { assistant: true, nodi: true });
  assert.equal(await modal.getByRole('tab', { name: 'My skills', exact: true }).getAttribute('aria-selected'), 'true', 'saving returns to the library');

  await modal.getByRole('tab', { name: 'Marketplace', exact: true }).click();
  await page.getByRole('button', { name: 'Show details of Anatomy Atlas', exact: true }).waitFor();
  const marketplaceBox = await modal.boundingBox();
  assert.ok(marketplaceBox);
  assert.ok(Math.abs(libraryBox.width - marketplaceBox.width) <= 1, `modal width changed: ${libraryBox.width} -> ${marketplaceBox.width}`);
  assert.ok(Math.abs(libraryBox.height - marketplaceBox.height) <= 1, `modal height changed: ${libraryBox.height} -> ${marketplaceBox.height}`);

  const names = await modal.locator('.chat-skills-list > .chat-skill-item .chat-skill-heading b').allTextContents();
  assert.deepEqual(names, ['Alpha Method', 'Anatomy Atlas', 'Beta Toolkit', 'Chemistry Studio', 'Zeta Review']);
  assert.equal(await modal.getByText('Plugins', { exact: true }).count(), 0, 'plugins still have a separate section');
  assert.equal(await modal.getByText(/Official packages|Paquetes oficiales/i).count(), 0, 'official packages still have a separate section');
  assert.equal(await modal.locator('.capability-packages').count(), 0, 'the legacy official-package panel is still mounted');
  assert.equal(await modal.getByRole('button', { name: 'Installed 2', exact: true }).count(), 1, 'the installed filter does not count every card kind');
  assert.equal(await modal.getByRole('button', { name: 'Available 3', exact: true }).count(), 1, 'the available filter does not count every card kind');
  for (const name of ['Review skill', 'Install']) {
    const button = modal.getByRole('button', { name, exact: true });
    const box = await button.boundingBox();
    const sizing = await button.evaluate(element => { const style = getComputedStyle(element); return { padding: style.padding, lineHeight: style.lineHeight, alignSelf: style.alignSelf, height: style.height }; });
    assert.ok(box && box.width <= 180 && box.height <= 40, `${name} expanded into an oversized card action: ${JSON.stringify({ box, sizing })}`);
  }

  await modal.getByRole('combobox', { name: 'Marketplace category' }).selectOption('Extensions');
  assert.deepEqual(await modal.locator('.chat-skills-list > .chat-skill-item .chat-skill-heading b').allTextContents(), ['Anatomy Atlas', 'Beta Toolkit', 'Chemistry Studio']);
  await modal.getByRole('combobox', { name: 'Marketplace category' }).selectOption('');
  await modal.getByRole('searchbox', { name: 'Search marketplace' }).fill('chemistry');
  assert.deepEqual(await modal.locator('.chat-skills-list > .chat-skill-item .chat-skill-heading b').allTextContents(), ['Chemistry Studio']);
  await modal.getByRole('button', { name: 'Clear marketplace search' }).click();
  const headingBox = await modal.locator('.chat-skills-heading').boundingBox();
  assert.ok(headingBox && headingBox.y >= marketplaceBox.y && headingBox.y < marketplaceBox.y + 120, 'the fixed modal header moved outside the viewport');
  await page.screenshot({ path: path.join(artifacts, '02-unified-alphabetical-marketplace.png') });

  const anatomyCard = modal.locator('.chat-skill-item').filter({ hasText: 'Anatomy Atlas' });
  await anatomyCard.getByRole('button', { name: 'Review skill', exact: true }).click();
  const pluginPermission = page.getByRole('dialog', { name: 'Permissions for Anatomy Atlas' });
  await pluginPermission.waitFor();
  assert.equal(await page.evaluate(() => window.__marketplaceQa.marketplaceApprovals), 0, 'the base marketplace approved permissions');
  await page.screenshot({ path: path.join(artifacts, '03-plugin-permission-modal.png') });
  await pluginPermission.getByRole('button', { name: 'Allow and install', exact: true }).click();
  await pluginPermission.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__marketplaceQa.marketplaceApprovals), 1, 'the permission modal did not approve the plugin');

  const chemistryCard = modal.locator('.chat-skill-item').filter({ hasText: 'Chemistry Studio' });
  await chemistryCard.getByRole('button', { name: 'Install', exact: true }).click();
  const packagePermission = page.getByRole('dialog', { name: 'Chemistry Studio' });
  await packagePermission.waitFor();
  assert.equal(await page.evaluate(() => window.__marketplaceQa.capabilityApprovals), 0, 'the base marketplace approved the signed package');
  await page.screenshot({ path: path.join(artifacts, '03b-official-package-permission-modal.png') });
  await packagePermission.getByRole('button', { name: /Allow and install|Permitir e instalar/ }).click();
  await packagePermission.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__marketplaceQa.capabilityApprovals), 1, 'the permission modal did not approve the signed package');

  assert.equal(await modal.locator('.skill-marketplace-sources').count(), 0, 'repository management left the Marketplace');
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await modal.waitFor({ state: 'detached' });

  // The chat's Skills button opens the same four tabs in the shared header balloon.
  await page.getByTestId('chat-skills-assistant').click();
  const balloon = page.getByTestId('chat-skills-panel-assistant');
  await balloon.waitFor();
  assert.equal(await balloon.locator('.header-balloon-title').innerText(), 'Skills');
  assert.equal(await balloon.getByRole('tab').count(), 4);
  await page.screenshot({ path: path.join(artifacts, '05-skills-header-balloon.png') });
  await page.keyboard.press('Escape');
  await balloon.waitFor({ state: 'detached' });
  const demo = page.getByTestId('capability-demo');
  await demo.waitFor();
  assert.deepEqual(await demo.locator('.chat-visual-pending b').allTextContents(), ['Chemistry', 'Anatomy']);
  assert.equal(await demo.getByText('Capability', { exact: true }).count(), 0);
  await page.screenshot({ path: path.join(artifacts, '04-named-capability-activity.png') });

  assert.deepEqual(errors, [], `renderer errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({
    modal: { library: libraryBox, marketplace: marketplaceBox, heading: headingBox },
    alphabeticalNames: names,
    approvals: await page.evaluate(() => window.__marketplaceQa),
    screenshots: artifacts,
  }, null, 2));
} finally {
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}
