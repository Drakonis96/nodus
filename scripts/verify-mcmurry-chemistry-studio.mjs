import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const profile = process.env.NODUS_SKILLS_PROFILE;
if (!profile || !path.basename(path.dirname(profile)).startsWith('nodus-chat-skills-qa')) {
  throw new Error('Supply an isolated nodus-chat-skills-qa profile.');
}
const shots = path.join(root, 'artifacts/chat-skills/mcmurry-chemistry-studio');
await fs.mkdir(shots, { recursive: true });

const allExercises = [
  { id: '1.1', slug: 'electron-configurations', route: ['none', 'svg'], prompt: 'Give the ground-state electron configuration for each of the following elements: (a) Oxygen (b) Nitrogen (c) Sulfur.' },
  { id: '1.2', slug: 'outermost-electrons', route: ['none'], prompt: 'How many electrons does each of the following elements have in its outermost electron shell? (a) Magnesium (b) Cobalt (c) Selenium.' },
  { id: '1.3', slug: 'chloroform', route: ['chemfig'], expectedSource: String.raw`\chemfig{C(-[2]H)(-[4]Cl)(<[:-30]Cl)(<:[:-150]Cl)}`, prompt: 'Draw a molecule of chloroform, CHCl3, using solid, wedged, and dashed lines to show its tetrahedral geometry.' },
  { id: '1.4', slug: 'ethane', route: ['chemfig'], expectedSource: String.raw`\chemfig{H-[0]C(<[2]H)(<:[6]H)-[0]C(<:[2]H)(<[6]H)-[0]H}`, prompt: 'Convert ethane, C2H6, into a conventional drawing that uses solid, wedged, and dashed lines to indicate tetrahedral geometry around each carbon. Show a staggered conformation with the in and out bonds on adjacent carbons rotated to avoid eclipsing.' },
  { id: '1.5', slug: 'likely-formulas', route: ['none'], prompt: 'What are likely formulas for the following substances? (a) CCl? (b) AlH? (c) CH?Cl2 (d) SiF? (e) CH3NH?' },
  { id: '1.6', slug: 'line-bonds-lone-pairs', route: ['lewis'], expectedLewis: ['ClC(Cl)Cl', 'S', 'CN', '[Li]C'], prompt: 'Write line-bond structures for the following substances, showing all nonbonding electrons: (a) CHCl3, chloroform (b) H2S, hydrogen sulfide (c) CH3NH2, methylamine (d) CH3Li, methyllithium.' },
  { id: '1.7', slug: 'c2h7-impossible', route: ['none'], prompt: "Why can't an organic molecule have the formula C2H7?" },
  { id: '1.8', slug: 'propane', route: ['smiles'], expectedSource: 'CCC', prompt: 'Draw a line-bond structure for propane, CH3CH2CH3. Predict the value of each bond angle, and indicate the overall shape of the molecule.' },
];
const selected = process.env.NODUS_SKILLS_SAMPLE;
const selectors = selected?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
const exercises = selectors.length ? allExercises.filter(exercise => selectors.some(value => exercise.id === value || exercise.slug.includes(value))) : allExercises;
assert.ok(exercises.length, `No McMurry exercise matched ${selected}`);

const env = {
  ...process.env,
  NODUS_USERDATA: profile,
  NODUS_QA_ROOT: path.dirname(profile),
  NODUS_QA_DATABASE_AUDIT_LOG: path.join(profile, 'database-audit.jsonl'),
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: require('electron'), args: [root], env });
await app.firstWindow();
let page;
for (let attempt = 0; attempt < 150 && !page; attempt++) {
  page = app.windows().find(window => window.url().includes('/index.html'));
  if (!page) await new Promise(resolve => setTimeout(resolve, 200));
}
assert.ok(page);
page.setDefaultTimeout(30_000);
const rendererErrors = [];
page.on('pageerror', error => rendererErrors.push(error.message));
const results = [];

try {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.nodus);
  await page.evaluate(() => window.nodus.updateSettings({ onboardingComplete: true, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true, basicsTutorialVersion: 5, firstVaultVersion: 5, uiLanguage: 'en', promptLanguage: 'en', reduceMotion: true, theme: 'dark' }));
  await page.evaluate(() => {
    localStorage.setItem('nodus.lastSeenVersion', '5.3.1');
    for (const key of ['nodus.mobileTeaserSeen.3.2.4', 'nodus.platformHighlightsSeen.2026-07', 'nodus.toolkitBetaGuideSeen.2.4.0', 'nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA']) localStorage.setItem(key, '1');
  });
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await page.setViewportSize({ width: 1512, height: 982 });
  if (await page.locator('.whats-new-backdrop').count()) await page.locator('.whats-new-backdrop').getByRole('button', { name: 'Close', exact: true }).click();
  if (await page.locator('.startup-update-backdrop').count()) await page.locator('.startup-update-backdrop').getByRole('button', { name: 'Got it', exact: true }).click();
  await page.getByTitle('Open research assistant', { exact: true }).click();

  const modelLabel = process.env.NODUS_SKILLS_TEXT_MODEL ?? 'DeepSeek · deepseek-v4-flash';
  const modelSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'deepseek-v4-flash' }) });
  await modelSelect.selectOption({ label: modelLabel });
  // The QA copy may have persisted an earlier draft of this built-in while the
  // implementation was being refined. Explicit restore is safe in this isolated
  // profile and ensures the live test uses the current shipping defaults.
  await page.evaluate(() => window.nodus.restoreChatSkills());
  const chemistrySkill = (await page.evaluate(() => window.nodus.listChatSkills())).find(skill => skill.builtin === 'chemistry');
  assert.ok(chemistrySkill?.enabled.assistant, 'Chemistry Studio must be enabled in the isolated profile');

  for (const exercise of exercises) {
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    const input = page.locator('textarea').first();
    await input.fill(exercise.prompt);
    await input.press('Enter');
    console.log('GENERATING', exercise.id, exercise.slug);
    await page.waitForFunction(() => !!document.querySelector('[data-testid="chat-skills-assistant"]')?.disabled, null, { timeout: 15_000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="chat-skills-assistant"]')?.disabled, null, { timeout: 360_000 });

    const latest = (await page.evaluate(() => window.nodus.listConversations()))[0];
    const saved = await page.evaluate(id => window.nodus.getConversation(id), latest.id);
    const answer = saved.messages.filter(message => message.role === 'assistant').at(-1).content;
    const fenced = answer.match(/```(smiles|lewis|chemfig|svg)\b[^\n]*\n([\s\S]*?)```/i);
    const route = fenced?.[1].toLowerCase() ?? 'none';
    assert.ok(exercise.route.includes(route), `${exercise.id} expected ${exercise.route.join('/')} but received ${route}`);
    if (exercise.expectedSource) assert.equal(fenced?.[2].trim(), exercise.expectedSource, `${exercise.id} emitted unexpected molecular notation`);
    if (exercise.expectedLewis) {
      const structures = JSON.parse(fenced?.[2] ?? '{}').structures;
      assert.deepEqual(structures?.map(item => item.smiles), exercise.expectedLewis, `${exercise.id} emitted unexpected Lewis connectivity`);
    }
    await page.getByText(saved.title, { exact: true }).first().click();
    await page.getByText(exercise.prompt, { exact: true }).waitFor();

    const base = `${exercise.id}-${exercise.slug}`;
    const visual = route !== 'none';
    let expanded = null;
    if (visual) {
      const card = page.getByTestId('chat-svg').last();
      await card.waitFor();
      await card.locator('img').evaluate(image => image.decode());
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(shots, `${base}.png`) });
      await card.getByRole('button', { name: 'Enlarge image', exact: true }).click();
      await page.locator('.chat-visual-modal').waitFor();
      await page.locator('.chat-visual-modal img').evaluate(image => image.decode());
      expanded = path.join(shots, `${base}-expanded.png`);
      await page.screenshot({ path: expanded });
      await page.keyboard.press('Escape');
      await page.locator('.chat-visual-modal').waitFor({ state: 'detached' });
    } else {
      await page.locator('.assistant-chat-messages, .research-chat-messages').last().scrollIntoViewIfNeeded().catch(() => undefined);
      await page.screenshot({ path: path.join(shots, `${base}.png`) });
    }
    results.push({ ...exercise, route, conversationId: latest.id, title: saved.title, answer, screenshot: path.join(shots, `${base}.png`), expanded });
    console.log('VERIFIED', exercise.id, route);
  }
  assert.deepEqual(rendererErrors, []);
  await fs.writeFile(path.join(shots, 'results.json'), JSON.stringify({ model: modelLabel, createdAt: new Date().toISOString(), results }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => undefined);
  throw error;
} finally {
  await app.close();
}
