// Explicit, paid smoke test. Only the three allowlisted models may be called.
// Copies only encrypted credentials into a temporary profile; never opens the source database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, repoRoot } from './lib/tsRuntimeHooks.mjs';
const flag = '--concilium-live-electron';
const source = process.argv.find(arg => arg.startsWith('--source-profile='))?.slice(17);
assert.ok(source, 'Pass --source-profile=/path/to/nodus; this explicitly enables paid API calls.');
if (!process.argv.includes(flag)) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), flag, `--source-profile=${source}`], { cwd: repoRoot, env, stdio: 'inherit' });
  process.exit(0);
}
const { app, safeStorage } = await import('electron');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-concilium-live-'));
fs.mkdirSync(path.join(profile, 'secrets'));
for (const provider of ['deepseek', 'gemini', 'openrouter']) fs.copyFileSync(path.join(source, 'secrets', `ai_key_${provider}.bin`), path.join(profile, 'secrets', `ai_key_${provider}.bin`));
app.setName('Nodus'); app.setPath('userData', profile);
const output = path.join(repoRoot, 'artifacts/research-concilium');
fs.mkdirSync(output, { recursive: true });
async function run() {
installRuntimeHooks(profile, { app, safeStorage });
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const models = [{ provider: 'deepseek', model: 'deepseek-flash' }, { provider: 'gemini', model: 'gemini-2.5-flash-lite' }, { provider: 'openrouter', model: 'xiaomi/mimo-v2.5' }];
let browser;
const calls = [], snapshots = [];
try {
  load('electron/db/settingsRepo.ts').updateSettings({ synthesisModel: models[0], chatModel: models[0], promptLanguage: 'en', uiLanguage: 'en' });
  for (const model of models) assert.ok(load('electron/secrets/secretStore.ts').getApiKey(model.provider), `Credential unavailable: ${model.provider}`);
  const registry = load('electron/chatSkills.ts');
  for (const skill of registry.restoreChatSkills()) registry.saveChatSkill({ ...skill, enabled: { assistant: skill.builtin === 'svg', nodi: false } });
  const ai = load('electron/ai/aiClient.ts');
  ai.embed = async () => null;
  for (const name of ['completeText', 'completeTextStream']) {
    const native = ai[name];
    ai[name] = async (options, ...args) => {
      const model = name === 'completeTextStream' ? args[1] : args[0];
      assert.ok(models.some(m => m.provider === model?.provider && m.model === model?.model), 'Unapproved model blocked');
      assert.ok(calls.length < 8, 'Call limit exceeded');
      calls.push({ model, synthesis: options.system.includes('You are the Concilium chairman.'), member: options.system.includes('independent Concilium council member') });
      console.log(`Authorized call ${calls.length}: ${model.provider}/${model.model}`);
      return native({ ...options, maxTokens: 2400, noRetry: true }, ...args);
    };
  }
  const { chromium } = require('playwright-core');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let liveResponse;
  let delivery = Promise.resolve();
  await page.exposeFunction('conciliumLiveRequest', async request => {
    // The harness conversation id is not a real vault owner. Keep the real research
    // pipeline and original question, while using an empty synthetic evidence scope.
    const { conversationId, ...input } = request;
    input.selection = { ideas: false, themes: false, contradictions: false, gaps: false, readingPath: false, authors: false, documents: false, passages: false, graph: false, graphParts: {} };
    const deliver = (name, payload) => { delivery = delivery.then(() => page.evaluate(({ name, payload }) => window.conciliumHandlers[name]?.(payload), { name, payload })); };
    liveResponse = await load('electron/ai/researchAssistant.ts').streamResearchChat(input, (delta, kind) => deliver(kind === 'reasoning' ? 'onReasoning' : 'onDelta', delta), AbortSignal.timeout(180000), result => { snapshots.push(result); deliver('onConcilium', result); });
    await delivery;
    return liveResponse;
  });
  await page.goto('http://127.0.0.1:5198/visual-tests/research-assistant-harness.html?concilium=1&view=embedded&lang=en');
  await page.getByRole('button', { name: 'Concilium', exact: true }).waitFor();
  await page.locator('.research-assistant-header').screenshot({ path: path.join(output, '01-concilium-button.png') });
  await page.getByRole('button', { name: 'Concilium', exact: true }).click();
  await page.getByRole('button', { name: 'Add member', exact: false }).click();
  await page.getByRole('switch', { name: 'Enable Concilium' }).click();
  await page.getByTestId('concilium-model-1-trigger').click();
  await page.getByTestId('concilium-model-1-search').fill('gemini');
  assert.equal(await page.locator('.model-picker-options [role=option]').count(), 1);
  await page.locator('.model-picker-options [role=option]').click();
  await page.locator('.concilium-panel').screenshot({ path: path.join(output, '02-concilium-configuration.png') });
  await page.getByRole('button', { name: 'Concilium', exact: true }).click();
  const question = 'A pilot study found that 8 of 10 students passed with weekly practice, versus 6 of 10 without it. Assignment was not random. What can we conclude, and how should we improve the next study? Keep the final answer under 180 words. Chairman only: use the SVG skill to add a small, simple two-bar comparison. Do not invent sources.';
  await page.locator('.research-composer-input').fill(question);
  await page.locator('.research-composer-input').press('Enter');
  await page.locator('.concilium-responses').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.concilium-member.is-complete').length >= 1, null, { timeout: 180000 });
  await page.screenshot({ path: path.join(output, '03-concilium-streaming.png') });
  await page.waitForFunction(() => window.saved.some(record => record.messages?.some(message => message.concilium?.status === 'complete')), null, { timeout: 180000 });
  assert.equal(liveResponse.concilium.status, 'complete');
  assert.equal(liveResponse.concilium.members.filter(m => m.status === 'complete').length, 3);
  assert.equal(calls.filter(call => call.member).length, 3);
  assert.equal(calls.filter(call => call.synthesis).length, 1);
  assert.ok(liveResponse.answer.length > 100);
  assert.ok(load('shared/chatSkills.ts').splitChatVisuals(liveResponse.answer).some(part => part.kind === 'svg'), 'Chairman uses the enabled SVG skill');
  await page.setViewportSize({ width: 1500, height: 1400 });
  await page.waitForTimeout(800); // Allow the chat's entrance transition to finish before capture.
  await page.screenshot({ path: path.join(output, '04-concilium-conversation.png') });
  await page.locator('.concilium-member').nth(1).getByRole('button').first().click();
  await page.locator('.concilium-member .concilium-panel').screenshot({ path: path.join(output, '05-concilium-member-response.png') });
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'live-result.json'), JSON.stringify({ passed: true, models, calls, question, response: liveResponse, streamedUpdates: snapshots.length, stages: [...new Set(snapshots.map(s => s.status))], screenshots: 'Real model responses shown in the research chat component through its visual harness.' }, null, 2));
  console.log(`Live Concilium passed: ${calls.length} authorized calls; 3 independent replies, chairman consensus and SVG. Screenshots: ${output}`);
} catch (error) {
  fs.writeFileSync(path.join(output, 'live-failure.json'), JSON.stringify({ error: String(error), calls, lastState: snapshots.at(-1) }, null, 2));
  console.error(error); process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  load('electron/db/database.ts').closeDb();
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(process.exitCode ?? 0);
}

}
void app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
