import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
const output = 'artifacts/research-assistant';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:5198/visual-tests/research-assistant-harness.html?accent=%238951ef');
  const input = page.locator('.research-composer-input');
  await input.fill('Ejemplo');
  await page.getByRole('button', { name: 'Esfuerzo de thinking: Estándar', exact: true }).click();
  const slider = page.getByRole('slider', { name: 'Esfuerzo de thinking' });
  await slider.focus();
  await slider.press('ArrowRight'); await slider.press('ArrowRight'); await slider.press('ArrowRight');
  assert.equal(await slider.getAttribute('aria-valuetext'), 'Alto');
  assert.equal(await page.locator('.research-effort-panel').evaluate(el => getComputedStyle(el).getPropertyValue('--vault-accent').trim()), '#8951ef');
  await page.screenshot({ path: `${output}/light-high.png` });
  await slider.press('Escape');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.waitForFunction(() => window.requests.length === 1);
  assert.equal(await page.evaluate(() => window.requests[0].thinkingEffort), 'high');
  assert.equal(await page.evaluate(() => window.updates.some(x => 'chatReasoning' in x || 'nodiModel' in x)), false);
  assert.deepEqual(
    await page.evaluate(() => window.updates.filter(patch => 'researchEffortByModel' in patch).at(-1).researchEffortByModel),
    { 'openai:gpt-5.4': 'high' },
    'the level is saved for this model as soon as it is picked, and Standard is never stored'
  );
  const models = page.locator('select').first();
  // A level belongs to the model it was picked for.
  await models.selectOption('deepseek::deepseek-flash');
  assert.equal(await page.getByRole('button', { name: 'Esfuerzo de thinking: Estándar', exact: true }).count(), 1, 'a model that was never used opens on Standard');
  await models.selectOption('openai::gpt-5.4');
  assert.equal(await page.getByRole('button', { name: 'Esfuerzo de thinking: Alto', exact: true }).count(), 1, 'reopening a model restores the level picked for it');
  await models.selectOption('gemini::gemini-3-pro-preview');
  await page.getByRole('button', { name: 'Esfuerzo de thinking: Estándar', exact: true }).click();
  assert.equal(await slider.getAttribute('max'), '1');
  await slider.press('Escape');
  await models.selectOption('codex::gpt-6-astra');
  await page.getByRole('button', { name: 'Esfuerzo de thinking: Estándar', exact: true }).click();
  await slider.press('End');
  assert.equal(await slider.getAttribute('aria-valuetext'), 'Ultra');
  await slider.press('Escape');
  // A subscription model's ladder arrives with its catalogue: the restored level waits for it.
  await models.selectOption('deepseek::deepseek-flash');
  await models.selectOption('codex::gpt-6-astra');
  assert.equal(await page.getByRole('button', { name: 'Esfuerzo de thinking: Ultra', exact: true }).count(), 1, 'a catalogue-driven model restores its level too');
  await models.selectOption('openai::gpt-4.1');
  await page.getByRole('button', { name: 'Esfuerzo de thinking: Estándar', exact: true }).click();
  assert.equal(await slider.count(), 0);
  await page.keyboard.press('Escape');
  await input.fill('Pregunta estándar'); await input.press('Enter');
  await page.waitForFunction(() => window.requests.length === 2);
  assert.equal(await page.evaluate(() => window.requests[1].thinkingEffort), 'standard');
  await page.goto('http://127.0.0.1:5198/visual-tests/research-assistant-harness.html?theme=dark&accent=%2310b981');
  await input.fill('Compara las fuentes y explica las diferencias.');
  await page.getByRole('button', { name: 'Esfuerzo de thinking: Estándar', exact: true }).click();
  await slider.press('End');
  await page.screenshot({ path: `${output}/dark-high.png` });
  await slider.press('Escape');
  assert.equal(await page.locator('.research-composer-tool, .research-dictation').count(), 0);
  await page.getByTestId('research-context-trigger').click();
  assert.equal(await page.locator('.research-context-panel').isVisible(), true);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 600, height: 800 });
  await input.fill('Una pregunta larga\ncon varias líneas\npara revisar el compositor.');
  await page.getByRole('button', { name: /Esfuerzo de thinking:/ }).click();
  await page.screenshot({ path: `${output}/compact.png` });
  const bounds = await page.locator('.research-composer').boundingBox();
  const inputBounds = await input.boundingBox();
  assert.ok(inputBounds.x >= bounds.x && inputBounds.x + inputBounds.width <= bounds.x + bounds.width);
  // A relaunch: the page starts from the map the previous session left on disk, so the
  // composer opens on the remembered level and that is the level the request carries.
  await page.goto(`http://127.0.0.1:5198/visual-tests/research-assistant-harness.html?memory=${encodeURIComponent(JSON.stringify({ 'openai:gpt-5.4': 'xhigh', 'deepseek:deepseek-flash': 'max' }))}`);
  await page.getByRole('button', { name: 'Esfuerzo de thinking: Muy alto', exact: true }).click();
  await page.screenshot({ path: `${output}/memory-restored.png` });
  await slider.press('Escape');
  await input.fill('Pregunta con memoria'); await input.press('Enter');
  await page.waitForFunction(() => window.requests.length === 1);
  assert.equal(await page.evaluate(() => window.requests[0].thinkingEffort), 'xhigh', 'the remembered level is restored on open and sent');
  const restoredModels = page.locator('select').first();
  await restoredModels.selectOption('deepseek::deepseek-flash');
  assert.equal(await page.getByRole('button', { name: 'Esfuerzo de thinking: Máximo', exact: true }).count(), 1, 'every model keeps its own remembered level');
  await restoredModels.selectOption('gemini::gemini-3-pro-preview');
  assert.equal(await page.getByRole('button', { name: 'Esfuerzo de thinking: Estándar', exact: true }).count(), 1, 'and a model with no memory still opens on Standard');
  assert.deepEqual(errors, []);
  console.log('Research Assistant UI: keyboard, slider, remembered effort per model, exact request, theme/accent, context and compact layout passed.');
} finally { await browser.close(); }
