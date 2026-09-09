// Real app/UI + live public GitHub source + deterministic local text-provider fixture.
// All writes use a disposable profile; no production credentials or model charges.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { _electron as electron } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-marketplace-e2e-'));
const artifacts = path.join(root, 'artifacts/skill-marketplace'); fs.mkdirSync(artifacts, { recursive: true });
const checkout = process.env.NODUS_MARKETPLACE_CHECKOUT;
const catalogMode = checkout ? 'local checkout fixture' : 'live GitHub';
if (checkout) {
  const entries = fs.readdirSync(checkout, { withFileTypes: true }).filter(entry => entry.isDirectory() && fs.existsSync(path.join(checkout, entry.name, 'skill.json'))).map(entry => {
    const directory = path.join(checkout, entry.name);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'skill.json'), 'utf8'));
    return { path: entry.name, package: { manifest, files: Object.fromEntries(['SKILL.md', ...manifest.tools.map(tool => tool.entry)].map(file => [file, fs.readFileSync(path.join(directory, file), 'utf8')])) } };
  });
  fs.writeFileSync(path.join(profile, 'skill-marketplace.json'), JSON.stringify({ version: 1, sources: [{ id: 'nodusresearch/nodus-research-skill-marketplace', url: 'https://github.com/NodusResearch/nodus-research-skill-marketplace', commit: execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), updatedAt: new Date().toISOString(), entries, errors: [] }] }));
}
let installedId = '', providerCalls = 0;
const server = createServer(async (request, response) => {
  if (request.method === 'GET') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'marketplace-test', object: 'model' }] })); return; }
  let raw = ''; for await (const chunk of request) raw += chunk;
  const payload = JSON.parse(raw); providerCalls++; console.log("Fixture request", request.url, payload.stream);
  if (request.url.startsWith('/api/')) { response.writeHead(404); response.end(); return; }
  const text = '```nodus-tool\n' + JSON.stringify({ skillId: installedId, toolId: 'summarize', input: { values: [2,4,6,8] } }) + '\n```';
  if (payload.stream) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`);
    response.end(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  } else { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let app;
try {
  const env = { ...process.env, NODUS_USERDATA: profile, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [root], env });
  const runtimeLog = []; app.process().stderr.on("data", chunk => runtimeLog.push(String(chunk)));
  const page = await app.firstWindow(); page.setDefaultTimeout(30000);
  page.on("console", message => { if (message.type() === "error") console.log("Renderer", message.text()); });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.nodus?.getSkillMarketplace);
  await page.evaluate(async ({ version, baseUrl }) => {
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
    localStorage.setItem('nodus.lastSeenVersion', version); localStorage.setItem(`nodus.mobileTeaserSeen.${version}`, '1');
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 99, recoverySetupVersion: 99, tourComplete: true, advancedTourComplete: true, uiLanguage: 'en', theme: 'dark', mascotEnabled: false, chatModel: { provider: 'lmstudio', model: 'marketplace-test' }, nodiModel: { provider: 'lmstudio', model: 'marketplace-test' }, localProviders: { lmstudio: { baseUrl } } });
  }, { version: require('../package.json').version, baseUrl: `http://127.0.0.1:${server.address().port}` });
  await page.reload();
  await page.getByTestId('header-actions').getByRole('button', { name: 'Assistant', exact: true }).click();
  await page.getByTestId('chat-skills-assistant').click();
  await page.getByRole('button', { name: 'Marketplace', exact: true }).click();
  if (!checkout) await page.getByRole('button', { name: 'Update catalog', exact: true }).click();
  await page.waitForFunction(async () => Boolean((await window.nodus.getSkillMarketplace()).sources[0]?.commit), undefined, { timeout: 120000, polling: 300 });
  const catalog = await page.evaluate(() => window.nodus.getSkillMarketplace());
  assert.ok(catalog.sources[0].entries.length >= 15); assert.deepEqual(catalog.sources[0].errors, []);
  await page.screenshot({ path: path.join(artifacts, 'marketplace.png') });
  for (const name of ['AlphaGenome', 'Legalize']) {
    await page.getByRole('searchbox', { name: 'Search marketplace' }).fill(name);
    await page.getByRole('button', { name: 'Review skill', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Install skill', exact: true }).isDisabled(), true);
    await page.getByText(/This build cannot install this skill/).waitFor();
    await page.getByRole('button', { name: '← Back to catalog', exact: true }).click();
  }
  await page.getByRole('searchbox', { name: 'Search marketplace' }).fill('Descriptive Statistics');
  await page.getByRole('button', { name: 'Review skill', exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, 'review.png') });
  await page.getByRole('button', { name: 'Install skill', exact: true }).click();
  await page.getByText('Skill installed. Enable it in My skills.', { exact: true }).waitFor();
  installedId = await page.evaluate(async () => (await window.nodus.listChatSkills()).find(s => s.origin?.packageId === 'descriptive-statistics').id);
  await page.getByRole('button', { name: 'My skills', exact: true }).click();
  await page.getByRole('switch', { name: 'Enable Descriptive Statistics', exact: true }).click();
  await page.getByRole('region', { name: 'Skills', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  console.log('Installed and enabled', installedId);
  const composer = page.locator('textarea').filter({ visible: true }).last();
  await composer.fill('Use Descriptive Statistics to summarize 2, 4, 6, 8.'); await composer.press('Enter');
  await page.screenshot({ path: path.join(artifacts, 'after-send.png') });
  await page.getByText(/Tool result \(summarize\)/).waitFor();
  await page.getByText(/populationStandardDeviation/).waitFor();
  await page.screenshot({ path: path.join(artifacts, 'assistant-tool-result.png') });
  const nodiDisabled = await page.evaluate(() => window.nodus.nodiChatStream({ messages: [{ role: 'user', content: 'Summarize 2, 4, 6, 8.' }], contexts: [] }, { onDelta: () => {} }));
  assert.match(nodiDisabled, /not enabled/);
  await page.evaluate(async id => { const skill = (await window.nodus.listChatSkills()).find(s => s.id === id); await window.nodus.saveChatSkill({ ...skill, enabled: { assistant: true, nodi: true } }); }, installedId);
  const nodiEnabled = await page.evaluate(() => window.nodus.nodiChatStream({ messages: [{ role: 'user', content: 'Summarize 2, 4, 6, 8.' }], contexts: [] }, { onDelta: () => {} }));
  assert.match(nodiEnabled, /"mean":5/); assert.match(nodiEnabled, /"count":4/);
  // Source management through the visible UI, using an empty public repository catalog.
  await page.getByTestId('chat-skills-assistant').click(); await page.getByRole('button', { name: 'Marketplace', exact: true }).click();
  await page.getByRole('textbox', { name: 'Repository URL' }).fill('https://github.com/NodusResearch/nodus-research-skill-marketplace');
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /already added/ }).waitFor();
  await page.getByRole('textbox', { name: 'Repository URL' }).fill('https://github.com/octocat/Hello-World');
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await page.getByRole('combobox', { name: 'Skill repository' }).selectOption('octocat/hello-world');
  await page.getByRole('button', { name: 'Remove source', exact: true }).click();
  await page.getByText('Repository removed. Installed skills remain available.', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.nodus.getSkillMarketplace())).sources.length, 1);
  // Create and export a tool package through the authoring UI and native IPC.
  await page.getByRole('button', { name: 'My skills', exact: true }).click();
  await page.getByRole('button', { name: 'Create skill', exact: true }).click();
  await page.getByLabel('Skill name', { exact: true }).fill('QA Tool');
  await page.getByLabel('When to use it', { exact: true }).fill('Double a number supplied by the user.');
  await page.getByLabel('Instructions', { exact: true }).fill('Call the double tool with the number supplied by the user.');
  await page.getByLabel('Creator username', { exact: true }).fill('researcher');
  await page.getByLabel('Category', { exact: true }).fill('Data analysis');
  await page.getByText('Custom JavaScript tools (0)', { exact: true }).click();
  await page.getByRole('button', { name: 'Add tool', exact: true }).click();
  await page.getByLabel('Tool id', { exact: true }).fill('double');
  await page.getByLabel('Tool description', { exact: true }).fill('Input { value: number }. Return twice the value.');
  await page.getByLabel('JavaScript function', { exact: true }).fill('(input) => ({ value: input.value * 2 })');
  await page.getByRole('button', { name: 'Save skill', exact: true }).click();
  await page.getByRole('button', { name: 'Export QA Tool', exact: true }).waitFor();
  const exportParent = path.join(profile, 'exports'); fs.mkdirSync(exportParent);
  await app.evaluate(({ dialog }, directory) => { globalThis.__marketplaceOriginalDialog = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, exportParent);
  await page.getByRole('button', { name: 'Export QA Tool', exact: true }).click();
  await page.getByText(/Package exported to/).waitFor();
  const authorManifest = JSON.parse(fs.readFileSync(path.join(exportParent, 'qa-tool/skill.json')));
  assert.equal(authorManifest.author, 'researcher'); assert.equal(authorManifest.tools[0].entry, 'tools/double.js');
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, path.join(exportParent, 'qa-tool'));
  await page.getByRole('button', { name: 'Import package directory', exact: true }).click();
  await page.waitForFunction(async () => (await window.nodus.listChatSkills()).filter(s => s.name === 'QA Tool').length === 2);
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.__marketplaceOriginalDialog; delete globalThis.__marketplaceOriginalDialog; });
  // Verify every vault accent in the actual portal, then its light-theme variant.
  const colors = { academic: '#6366f1', estudio: '#0f766e', primary_sources: '#6366f1', genealogy: '#ca8a04', prosopography: '#2563eb', databases: '#b30333', testimonios: '#0891b2', worldbuilding: '#7c3aed', docencia: '#ea580c' };
  const themeChecks = [];
  for (const [type, color] of Object.entries(colors)) {
    await page.evaluate(async type => {
      const created = await window.nodus.createVault({ name: 'Marketplace theme ' + type, type });
      const switched = await window.nodus.switchVault(created.vault.id);
      if (!switched.ok) throw new Error(switched.message);
      await window.nodus.updateSettings({ chatModel: { provider: 'lmstudio', model: 'marketplace-test' }, onboardingComplete: true, basicsTutorialVersion: 99, recoverySetupVersion: 99, tourComplete: true, advancedTourComplete: true, databasesTourComplete: true, testimonyTourComplete: true, studyTourComplete: true, docenciaTourComplete: true, primarySourcesTourComplete: true, genealogyTourComplete: true, theme: 'dark', uiLanguage: 'en' });
    }, type);
    await page.reload();
    await page.waitForFunction(type => document.querySelector('[data-testid="nodus-logo"]')?.getAttribute('data-vault-logo') === type, type);
    // The research modal survives a vault change on some surfaces and closes on others.
    if (!await page.getByTestId('chat-skills-assistant').isVisible()) await page.getByTestId('header-actions').getByRole('button', { name: 'Assistant', exact: true }).click();
    if (!await page.getByRole('region', { name: 'Skills', exact: true }).isVisible()) await page.getByTestId('chat-skills-assistant').click();
    await page.getByRole('button', { name: 'Marketplace', exact: true }).click();
    await page.waitForFunction(color => {
      const tab = document.querySelector('.skill-marketplace-tabs button[aria-pressed="true"]');
      return tab && getComputedStyle(tab).getPropertyValue('--vault-accent').trim() === color;
    }, color);
    const computed = await page.evaluate(() => {
      const tab = document.querySelector('.skill-marketplace-tabs button[aria-pressed="true"]');
      const logo = document.querySelector('[data-testid="marketplace-logo"]');
      return { background: getComputedStyle(tab).backgroundColor, source: decodeURIComponent(logo.src.split(',')[1]) };
    });
    const rgb = color.slice(1).match(/../g).map(c => parseInt(c, 16));
    assert.equal(computed.background, `rgb(${rgb.join(', ')})`);
    assert.ok(computed.source.includes(color)); assert.ok(computed.source.includes('d="M18 48V16L46 48V16"')); assert.ok(computed.source.includes('stroke-width="6.5"'));
    await page.locator('.chat-skills-panel').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: path.join(artifacts, `vault-${type}-dark.png`) });
    themeChecks.push(type);
  }
  await page.evaluate(() => window.nodus.updateSettings({ theme: 'light' }));
  await page.waitForFunction(() => document.documentElement.classList.contains('light'));
  await page.screenshot({ path: path.join(artifacts, 'vault-docencia-light.png') });
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(artifacts, 'verification.json'), JSON.stringify({ catalogMode, sourceCommit: catalog.sources[0].commit, packages: catalog.sources[0].entries.length, provider: 'deterministic local fixture', providerCalls, assistant: 'pass', nodiEnabled: 'pass', nodiDisabled: 'pass', sourceManagement: 'pass', authoringExportImport: 'pass', themeChecks, rendererErrors: errors }, null, 2));
  console.log(`MARKETPLACE E2E PASS (${catalogMode}): review, install, enable, real Assistant/Nodi tool execution, source management, authoring/export/import and nine vault themes.`);
} catch (error) {
  if (app) { const page = await app.firstWindow(); await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {}); console.error((await page.locator('body').innerText()).slice(-6500)); }
  console.error('Provider calls:', providerCalls);
  throw error;
} finally { if (app) await app.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true }); }
