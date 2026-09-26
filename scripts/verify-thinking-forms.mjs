// The Deep Research and Immersion forms offer the model's thinking levels, open on the
// middle one (medium, or the level nearest to it), remember what the user picks per
// provider+model — Standard included — and send it with the request. And a skill with tools
// looks like any other skill in the picker: only its tag tells it apart.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
const output = 'artifacts/thinking-forms';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = `${process.env.NODUS_VISUAL_URL ?? 'http://127.0.0.1:5198'}/visual-tests/thinking-forms-harness.html`;
const open = async (query, fresh = false) => {
  if (fresh) { await page.goto(`${base}?view=deep`); await page.evaluate(() => sessionStorage.clear()); }
  await page.goto(`${base}?${query}`);
};
const label = async testId => (await page.getByTestId(testId).innerText()).trim();
try {
  for (const [view, testId, submit] of [['deep', 'deep-research-thinking', 'Añadir a la cola'], ['immersion', 'immersion-thinking', 'Explorar el territorio']]) {
    // A model never set opens on its middle level.
    await open(`view=${view}&model=openai:gpt-5.4`, true);
    await page.getByTestId(testId).waitFor();
    assert.equal(await label(testId), 'Medio', `${view}: GPT-5.4 (none … xhigh) opens on Medium`);
    // The balloon offers the model's own ladder.
    await page.getByTestId(testId).click();
    const slider = page.getByRole('slider', { name: 'Esfuerzo de thinking' });
    await slider.waitFor();
    assert.equal(await slider.getAttribute('max'), '4', `${view}: five stops, Standard to Very high`);
    const panel = await page.getByRole('dialog', { name: 'Esfuerzo de thinking' }).boundingBox();
    assert.ok(panel.y >= 0 && panel.y + panel.height <= 900, `${view}: the balloon stays in the window`);
    await page.screenshot({ path: `${output}/${view}-open.png` });
    await slider.press('End');
    assert.equal(await label(testId), 'Muy alto');
    assert.deepEqual(await page.evaluate(() => window.updates.at(-1)), { researchEffortByModel: { 'openai:gpt-5.4': 'xhigh' } }, `${view}: the pick is remembered per provider+model`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: submit }).click();
    assert.deepEqual(await page.evaluate(() => window.sent.at(-1)?.thinkingEffort), 'xhigh', `${view}: the request carries the level`);
    // Reopening the form restores it; Standard, once picked, is remembered too.
    await open(`view=${view}&model=openai:gpt-5.4`);
    await page.getByTestId(testId).waitFor();
    await page.waitForFunction(id => document.querySelector(`[data-testid="${id}"]`)?.textContent?.includes('Muy alto'), testId);
    await page.getByTestId(testId).click();
    await page.getByRole('slider', { name: 'Esfuerzo de thinking' }).press('Home');
    await page.keyboard.press('Escape');
    await open(`view=${view}&model=openai:gpt-5.4`);
    await page.waitForFunction(id => document.querySelector(`[data-testid="${id}"]`)?.textContent?.includes('Estándar'), testId);
    assert.equal(await label(testId), 'Estándar', `${view}: Standard, once chosen, stays chosen`);
    // Other ladders: the level nearest to medium, the lighter one on a tie.
    for (const [model, expected] of [['deepseek:deepseek-flash', 'Bajo'], ['gemini:gemini-3-pro-preview', 'Estándar'], ['anthropic:claude-opus-4-7', 'Medio'], ['codex:gpt-5.5', 'Medio']]) {
      await open(`view=${view}&model=${model}`, true);
      await page.getByTestId(testId).waitFor();
      await page.waitForFunction(([id, text]) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.includes(text), [testId, expected]);
      assert.equal(await label(testId), expected, `${view}: ${model} opens on ${expected}`);
    }
    await open(`view=${view}&model=openai:gpt-5.4&theme=dark`, true);
    await page.getByTestId(testId).waitFor();
    await page.screenshot({ path: `${output}/${view}-dark.png` });
  }

  // Skills: a skill with tools has the same card as any other; the tag is the difference.
  await open('view=skills');
  const card = id => page.getByTestId(`skill-${id}`).locator('.chat-skill-item');
  await card('tool-on').waitFor();
  const look = locator => locator.evaluate(element => { const style = getComputedStyle(element); return [style.backgroundColor, style.backgroundImage, style.borderColor]; });
  assert.deepEqual(await look(card('tool-on')), await look(card('prompt-on')), 'an active skill with tools looks like any active skill');
  assert.deepEqual(await look(card('tool-off')), await look(card('prompt-off')), 'an inactive one like any inactive one');
  assert.equal(await card('tool-on').getByText('Con herramientas', { exact: true }).count(), 1, 'the tag still says it has tools');
  assert.equal(await card('prompt-on').getByText('Con herramientas', { exact: true }).count(), 0);
  await page.screenshot({ path: `${output}/skills.png` });
  assert.deepEqual(errors, []);
  console.log('Thinking forms: Deep Research and Immersion open on the middle level of each ladder, remember picks per model (Standard included) and send them; tool skills share the ordinary card. No paid calls.');
} finally { await browser.close(); }
