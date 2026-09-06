// Runs the real desktop app against an explicitly supplied COPY of a vault.
// Live calls use the copied profile's configured text and image models.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const profile = process.env.NODUS_SKILLS_PROFILE;
if (!profile || !path.basename(path.dirname(profile)).startsWith('nodus-chat-skills-qa')) throw new Error('Supply NODUS_SKILLS_PROFILE inside a nodus-chat-skills-qa directory containing a copied vault.');
const shots = path.join(root, 'artifacts', 'chat-skills', process.env.NODUS_SKILLS_CAPTURE_SET ?? '');
await fs.mkdir(shots, { recursive: true });
const env = { ...process.env, NODUS_USERDATA: profile, NODUS_QA_ROOT: path.dirname(profile), NODUS_QA_DATABASE_AUDIT_LOG: path.join(profile, 'database-audit.jsonl'), NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: require('electron'), args: [root], env });
await app.firstWindow();
let page;
for (let attempt = 0; attempt < 150 && !page; attempt++) {
  page = app.windows().find(window => window.url().includes('/index.html'));
  if (!page) await new Promise(resolve => setTimeout(resolve, 200));
}
assert.ok(page, 'main application window');
page.setDefaultTimeout(30_000);
const failures = [];
page.on('pageerror', error => { failures.push(error.message); console.error('RENDERER ERROR', error.stack); });
try {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.nodus);
  await page.evaluate(() => window.nodus.updateSettings({ onboardingComplete: true, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true, basicsTutorialVersion: 5, firstVaultVersion: 5, uiLanguage: 'en', promptLanguage: 'en', mascotEnabled: true, mascotAlwaysOnTop: false, mascotStyle: 'orb', reduceMotion: true, theme: 'dark' }));
  await page.evaluate(() => {
    localStorage.setItem('nodus.lastSeenVersion', '5.1.7');
    for (const key of ['nodus.mobileTeaserSeen.3.2.4', 'nodus.platformHighlightsSeen.2026-07', 'nodus.toolkitBetaGuideSeen.2.4.0', 'nodus.tutorialVideosAnnouncementSeen.2026-07']) localStorage.setItem(key, '1');
  });
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await page.setViewportSize({ width: 1512, height: 982 });
  if (await page.locator('.whats-new-backdrop').count()) await page.locator('.whats-new-backdrop').getByRole('button', { name: 'Close', exact: true }).click();
  console.log('READY', await page.title());
  if (process.env.NODUS_SKILLS_PROMPT_LANGUAGE) await page.evaluate(language => window.nodus.updateSettings({ promptLanguage: language }), process.env.NODUS_SKILLS_PROMPT_LANGUAGE);
  if (process.argv.includes('--inspect')) {
    console.log(await page.locator('button[title]').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, title: node.title })).filter(item => /assistant|chat|Nodi|asistente/i.test(item.title))));
    await page.screenshot({ path: path.join(shots, '00-shell.png') });
    process.exitCode = 0;
  } else if (process.argv.includes('--nodi-only')) {
    await page.evaluate(() => window.nodus.updateSettings({ mascotAlwaysOnTop: true }));
    let overlay;
    for (let attempt = 0; attempt < 60 && !overlay; attempt++) { overlay = app.windows().find(window => window.url().includes('mascot')); if (!overlay) await page.waitForTimeout(100); }
    assert.ok(overlay);
    overlay.setDefaultTimeout(30_000);
    overlay.on('pageerror', error => { failures.push(error.message); console.error('RENDERER ERROR', error.stack); });
    await overlay.waitForLoadState('domcontentloaded');
    const native = await app.browserWindow(overlay);
    // Keep the isolated QA overlay open while the user continues using other apps.
    // Native blur dismissal is covered separately by verify-nodi-overlay.
    await native.evaluate(win => { win.removeAllListeners('blur'); win.focus(); });
    for (const skill of await overlay.evaluate(() => window.nodus.listChatSkills())) {
      if (skill.name === 'Executive brief' && !skill.builtin) await overlay.evaluate(id => window.nodus.deleteChatSkill(id), skill.id);
    }
    await overlay.locator('.nodi-figure').click();
    await overlay.locator('[data-nodi-action="chat"]').click();
    await overlay.getByTestId('chat-skills-nodi').click();
    await overlay.locator('.chat-skills-panel').waitFor();
    await overlay.screenshot({ path: path.join(shots, '05-nodi-skills.png') });
    await overlay.getByRole('button', { name: 'Create skill', exact: true }).click();
    await overlay.getByLabel('Skill name', { exact: true }).fill('Executive brief');
    await overlay.getByLabel('When to use it', { exact: true }).fill('Use when the user asks for a concise decision brief.');
    await overlay.getByLabel('Instructions', { exact: true }).fill('Summarize the decision in three sections: recommendation, evidence, and next step. Keep each section under 40 words.');
    await overlay.screenshot({ path: path.join(shots, '05b-custom-skill.png') });
    await overlay.getByRole('button', { name: 'Save skill', exact: true }).click();
    const custom = (await overlay.evaluate(() => window.nodus.listChatSkills())).find(skill => skill.name === 'Executive brief');
    assert.ok(custom);
    await overlay.getByRole('button', { name: 'Edit Executive brief', exact: true }).click();
    await overlay.getByLabel('Instructions', { exact: true }).fill('For a concise decision brief, begin with the exact line Executive brief · Nodus. Use exactly three headings: Recommendation, Evidence, Next step. Give one recommendation, two pieces of evidence, and one concrete next step.');
    await overlay.getByRole('button', { name: 'Save skill', exact: true }).click();
    assert.equal((await overlay.evaluate(() => window.nodus.listChatSkills())).find(skill => skill.id === custom.id).instructions, 'For a concise decision brief, begin with the exact line Executive brief · Nodus. Use exactly three headings: Recommendation, Evidence, Next step. Give one recommendation, two pieces of evidence, and one concrete next step.');
    if (process.argv.includes('--custom-only')) {
      await overlay.getByTestId('chat-skills-nodi').click();
      await overlay.locator('.nodi-chat-input').fill('Give me a concise decision brief on whether a small design studio should pilot a four-day workweek.');
      await overlay.locator('.nodi-chat-input').press('Enter');
      await overlay.waitForFunction(() => !!document.querySelector('[data-testid="chat-skills-nodi"]')?.disabled);
      await overlay.waitForFunction(() => !document.querySelector('[data-testid="chat-skills-nodi"]')?.disabled, null, { timeout: 180_000 });
      const text = await overlay.locator('.nodi-chat-panel').innerText();
      assert.match(text, /Executive brief · Nodus/); assert.match(text, /recommend/i); assert.match(text, /evidence/i); assert.match(text, /next step/i);
      await overlay.screenshot({ path: path.join(shots, '09-custom-skill-answer.png') });
      await overlay.getByTestId('chat-skills-nodi').click();
      console.log('VERIFIED custom skill in a real model reply');
    }
    await overlay.getByRole('switch', { name: /Executive brief/ }).click();
    const updated = (await overlay.evaluate(() => window.nodus.listChatSkills())).find(skill => skill.id === custom.id);
    assert.equal(updated.enabled.nodi, false); assert.equal(updated.enabled.assistant, true);
    await overlay.getByRole('button', { name: 'Delete Executive brief', exact: true }).click();
    await overlay.locator('.chat-skill-confirm').getByRole('button', { name: 'Delete', exact: true }).click();
    await overlay.getByTestId('chat-skills-nodi').click();
    for (const [name, prompt, kind] of [
      ['06-nodi-svg', 'Draw a clean SVG explaining how a heat pump works: outside air, evaporator, compressor, condenser heating a home, and expansion valve. Use clear directional arrows and a readable legend. Create the diagram now.', 'chat-svg'],
      ['07-nodi-image', 'Generate a beautiful illustration of a small sustainable house in a Mediterranean garden at sunrise, with a discreet heat pump next to the house. Architectural watercolor on warm paper, olive trees, terracotta and sage green, no text.', 'chat-image'],
    ].filter(([name]) => !process.argv.includes('--custom-only') && (!process.env.NODUS_SKILLS_SAMPLE || name.includes(process.env.NODUS_SKILLS_SAMPLE)))) {
      await overlay.locator('.nodi-chat-input').fill(prompt);
      await overlay.locator('.nodi-chat-input').press('Enter');
      console.log('GENERATING', name);
      await (typeof overlay !== 'undefined' ? overlay : page).waitForFunction(() => !!document.querySelector('[data-testid^="chat-skills-"]')?.disabled, null, { timeout: 15_000 });
      await overlay.waitForFunction(() => !document.querySelector('[data-testid="chat-skills-nodi"]')?.disabled, null, { timeout: 360_000 });
      const card = overlay.getByTestId(kind).last();
      await card.waitFor(); await card.locator('img').evaluate(image => image.decode());
      await card.scrollIntoViewIfNeeded();
      await overlay.screenshot({ path: path.join(shots, `${name}.png`) });
      await card.getByRole('button', { name: 'Enlarge image', exact: true }).click();
      await overlay.locator('.chat-visual-modal').waitFor();
      await overlay.locator('.chat-visual-modal img').evaluate(image => image.decode());
      await overlay.screenshot({ path: path.join(shots, `${name}-expanded.png`) });
      await overlay.keyboard.press('Escape');
      await overlay.locator('.chat-visual-modal').waitFor({ state: 'detached' });
      await card.getByRole('button', { name: 'Copy image', exact: true }).click();
      await overlay.getByText('Copied', { exact: true }).last().waitFor();
      assert.equal(await app.evaluate(({ clipboard }) => clipboard.readImage().isEmpty()), false);
      if (kind === 'chat-image') {
        const source = await card.locator('img').getAttribute('src');
        const chats = await overlay.evaluate(() => window.nodus.listNodiConversations());
        assert.ok(chats[0].messages.some(message => message.content.includes(source)));
        await overlay.evaluate(id => window.nodus.deleteNodiConversation(id), chats[0].id);
        assert.equal(await overlay.evaluate(source => window.nodus.getChatImageMetadata(source), source), null);
        await assert.rejects(fs.stat(path.join(profile, 'chat-assets', source.split('/')[3])), { code: 'ENOENT' });
      }
      console.log('VERIFIED', name);
    }
    assert.deepEqual(failures, []);
  } else {
    await page.getByTitle('Open research assistant', { exact: true }).click();
    if (process.env.NODUS_SKILLS_TEXT_MODEL) await page.locator('select').filter({ has: page.locator('option', { hasText: 'deepseek-v4-pro' }) }).selectOption({ label: process.env.NODUS_SKILLS_TEXT_MODEL });
    await page.getByTestId('chat-skills-assistant').click();
    await page.screenshot({ path: path.join(shots, '01-skills-library.png') });
    await page.getByTestId('chat-skills-assistant').click();
    if (process.argv.includes('--review-existing')) {
      const conversations = await page.evaluate(() => window.nodus.listConversations());
      for (const [name, match] of [['02-chloroform', 'chloroform'], ['03-systems', 'circular economy']].filter(([name]) => !process.env.NODUS_SKILLS_SAMPLE || name.includes(process.env.NODUS_SKILLS_SAMPLE))) {
        const conversation = conversations.find(item => process.env.NODUS_SKILLS_CONVERSATION_ID ? item.id === process.env.NODUS_SKILLS_CONVERSATION_ID : item.title.toLowerCase().includes(match));
        assert.ok(conversation);
        const saved = await page.evaluate(id => window.nodus.getConversation(id), conversation.id);
        const answer = saved.messages.filter(message => message.role === 'assistant').at(-1).content;
        const expectedTitle = answer.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
        assert.ok(expectedTitle, 'persisted SVG has an accessible title');
        await page.getByText(conversation.title, { exact: true }).click();
        const card = page.getByTestId('chat-svg').last();
        // Loading a chat is asynchronous: an existing card can belong to the
        // previously selected conversation until getConversation resolves.
        await card.getByText(expectedTitle, { exact: true }).waitFor();
        await card.waitFor(); await card.locator('img').evaluate(image => image.decode());
        assert.ok(await page.getByText(saved.messages.filter(message => message.role === 'user').at(-1).content, { exact: true }).isVisible());
        console.log('VERIFIED displayed conversation', conversation.id, expectedTitle);
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(shots, `${name}.png`) });
        await card.getByRole('button', { name: 'Enlarge image', exact: true }).click();
        await page.locator('.chat-visual-modal').waitFor();
        await page.locator('.chat-visual-modal img').evaluate(image => image.decode());
        assert.equal(await page.locator('.chat-visual-modal img').getAttribute('src'), await card.locator('img').getAttribute('src'));
        await page.screenshot({ path: path.join(shots, `${name}-expanded.png`) });
        await page.keyboard.press('Escape'); await page.locator('.chat-visual-modal').waitFor({ state: 'detached' });
        await app.evaluate(({ BrowserWindow }, destination) => {
          const main = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/index.html'));
          globalThis.__svgDownload = new Promise(resolve => {
            main.webContents.session.once('will-download', (_event, item) => {
              item.setSavePath(destination);
              item.once('done', (_event, state) => resolve(state));
            });
          });
        }, path.join(shots, `${name}.svg`));
        await card.getByRole('button', { name: 'Download', exact: true }).click();
        const downloaded = await app.evaluate(() => Promise.race([globalThis.__svgDownload, new Promise(resolve => setTimeout(() => resolve('timeout'), 15000))]));
        assert.equal(downloaded, 'completed');
        assert.match(await fs.readFile(path.join(shots, `${name}.svg`), 'utf8'), /<svg/);
        console.log('VERIFIED persisted SVG and download', name);
      }
      await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'es', theme: 'light' }));
      await page.getByTestId('chat-skills-assistant').click();
      await page.getByText('De la idea a la creación', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(shots, '08-skills-spanish-light.png') });
    }
    const samples = [
      ['02-chloroform', 'Draw a molecule of chloroform, CHCl3, using solid, wedged, and dashed lines to show its tetrahedral geometry. Use classical organic chemistry notation, with an elegant readable legend. Draw it now as SVG.'],
      ['03-systems', 'Create a clear SVG diagram explaining a circular economy for a small furniture company: design, responsibly sourced materials, manufacture, use, repair and reuse, then recovery. Show the return loops, keep every label readable, and distinguish product life extension from material recycling.'],
      ['04-image', 'Generate an editorial illustration for an essay about collective memory: an archive reading room where fragments of letters, maps and photographs form a luminous tree above a research table. A thoughtful paper-cut illustration with tactile layers, warm amber and midnight blue, beautifully composed, no visible text.'],
    ];
    for (const [name, prompt] of samples.filter(([name]) => !process.argv.includes('--review-existing') && (!process.env.NODUS_SKILLS_SAMPLE || name.includes(process.env.NODUS_SKILLS_SAMPLE)))) {
      await page.getByRole('button', { name: 'New conversation', exact: true }).click();
      const input = page.locator('textarea').first();
      await input.fill(prompt);
      await input.press('Enter');
      console.log('GENERATING', name);
      await (typeof overlay !== 'undefined' ? overlay : page).waitForFunction(() => !!document.querySelector('[data-testid^="chat-skills-"]')?.disabled, null, { timeout: 15_000 });
      const card = page.getByTestId(name === '04-image' ? 'chat-image' : 'chat-svg').last();
      await page.waitForFunction(() => { const button = document.querySelector('[data-testid="chat-skills-assistant"]'); return button && !button.disabled; }, null, { timeout: 360_000 });
      const latest = (await page.evaluate(() => window.nodus.listConversations()))[0];
      const saved = await page.evaluate(id => window.nodus.getConversation(id), latest.id);
      assert.equal(saved.messages.filter(message => message.role === 'user').at(-1).content, prompt);
      // Reopen the exact saved conversation before captures, then wait for its
      // own content instead of accepting a card left on screen by another chat.
      await page.getByText(saved.title, { exact: true }).click();
      if (name !== '04-image') {
        const title = saved.messages.filter(message => message.role === 'assistant').at(-1).content.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
        assert.ok(title);
        await card.getByText(title, { exact: true }).waitFor();
      } else {
        const source = saved.messages.filter(message => message.role === 'assistant').at(-1).content.match(/nodus-image:\/\/chat\/[^)\s]+/)?.[0];
        assert.ok(source);
        await card.locator(`img[src="${source}"]`).waitFor();
      }
      await card.waitFor();
      await card.locator('img').evaluate(async image => { await image.decode(); });
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(shots, `${name}.png`) });
      await card.getByRole('button', { name: /Enlarge image|Ampliar imagen/ }).click();
      await page.locator('.chat-visual-modal').waitFor();
      await page.locator('.chat-visual-modal img').evaluate(image => image.decode());
      assert.equal(await page.locator('.chat-visual-modal img').getAttribute('src'), await card.locator('img').getAttribute('src'));
      await page.screenshot({ path: path.join(shots, `${name}-expanded.png`) });
      await page.keyboard.press('Escape');
      await page.locator('.chat-visual-modal').waitFor({ state: 'detached' });
      console.log('CAPTURED', name);
      await card.getByRole('button', { name: 'Copy image', exact: true }).click();
      await page.getByText('Copied', { exact: true }).last().waitFor();
      assert.equal(await app.evaluate(({ clipboard }) => clipboard.readImage().isEmpty()), false);
      if (name === '04-image') {
        const source = await card.locator('img').getAttribute('src');
        const metadata = await page.evaluate(source => window.nodus.getChatImageMetadata(source), source);
        assert.ok(metadata.prompt.length > 100);
        await fs.writeFile(path.join(shots, 'image-brief.json'), JSON.stringify(metadata, null, 2));
        const extension = metadata.mimeType === 'image/png' ? 'png' : metadata.mimeType === 'image/webp' ? 'webp' : 'jpg';
        const destination = path.join(shots, `generated-original.${extension}`);
        await app.evaluate(({ dialog }, filePath) => { globalThis.__skillsSaveDialog = dialog.showSaveDialog; dialog.showSaveDialog = async (...args) => { globalThis.__skillsSaveOptions = args.at(-1); return { canceled: false, filePath }; }; }, destination);
        await card.getByRole('button', { name: 'Download', exact: true }).click();
        await page.waitForTimeout(250);
        await app.evaluate(({ dialog }) => { dialog.showSaveDialog = globalThis.__skillsSaveDialog; });
        assert.ok((await fs.stat(destination)).size > 1000);
        assert.equal(await app.evaluate(() => globalThis.__skillsSaveOptions.title), 'Download original image');
        const chats = await page.evaluate(() => window.nodus.listConversations());
        const chat = await page.evaluate(id => window.nodus.getConversation(id), chats[0].id);
        assert.ok(chat.messages.some(message => message.content.includes(source)));
        await page.reload();
        await page.getByTitle('Open research assistant', { exact: true }).click();
        await page.getByText(chat.title, { exact: true }).click();
        await card.waitFor(); await card.locator('img').evaluate(image => image.decode());
        assert.equal(await card.locator('img').getAttribute('src'), source);
        await page.evaluate(id => window.nodus.deleteConversation(id), chat.id);
        assert.equal(await page.evaluate(source => window.nodus.getChatImageMetadata(source), source), null);
        const owner = source.split('/')[3];
        await assert.rejects(fs.stat(path.join(profile, 'chat-assets', owner)), { code: 'ENOENT' });
        console.log('VERIFIED image prompt, native clipboard, original download, conversation deletion and file removal');
      }
    }
    assert.deepEqual(failures, []);
  }
} catch (error) {
  console.error('ORIGINAL FAILURE', error);
  await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {});
  for (const window of app.windows().filter(window => window.url().includes('mascot'))) {
    console.error('NODI UI', (await window.locator('body').innerText()).slice(-5000));
    await window.screenshot({ path: path.join(shots, 'nodi-failure.png') }).catch(() => {});
  }
  console.error('UI', (await page.locator('body').innerText().catch(() => '')).slice(-7000));
  throw error;
} finally {
  await app.close();
}
