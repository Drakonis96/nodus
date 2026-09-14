import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const base = 'http://127.0.0.1:5198/visual-tests/research-assistant-harness.html';
try {
  for (const view of ['embedded', 'database', 'study', 'teaching', 'world']) {
    console.log(`Checking prompt modal: ${view}`);
    await page.goto(`${base}?view=${view}`);
    const trigger = page.getByTestId('research-system-prompt-trigger');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'System prompts', exact: true });
    assert.equal(await dialog.isVisible(), true);
    const accent = await trigger.evaluate(el => getComputedStyle(el).getPropertyValue('--vault-accent').trim());
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).getPropertyValue('--vault-accent').trim()), accent);
    for (const [name, instructions] of [['Tutor socrático', 'Haz preguntas breves y explica paso a paso.'], ['Analista crítico', 'Distingue evidencia, inferencias y limitaciones.']]) {
      await dialog.getByRole('button', { name: 'Nuevo prompt', exact: true }).click();
      await dialog.getByLabel('Nombre del prompt', { exact: true }).fill(name);
      await dialog.getByLabel('Instrucciones personalizadas', { exact: true }).fill(instructions);
      await dialog.getByRole('button', { name: 'Guardar y usar', exact: true }).click();
      await trigger.getByText(name, { exact: true }).waitFor();
      await trigger.click();
    }
    const names = await dialog.locator('.research-prompt-item strong').allTextContents();
    assert.deepEqual(names, ['Default', 'Analista crítico', 'Tutor socrático']);
    await dialog.getByRole('textbox', { name: 'Buscar prompts', exact: true }).fill('tutor');
    assert.deepEqual(await dialog.locator('.research-prompt-item strong').allTextContents(), ['Default', 'Tutor socrático']);
    await dialog.getByRole('textbox', { name: 'Buscar prompts', exact: true }).fill('');
    await dialog.getByRole('listitem').filter({ hasText: 'Tutor socrático' }).click();
    if (view === 'study') await page.screenshot({ animations: 'disabled', path: 'artifacts/research-assistant/system-prompts-light.png' });
    await dialog.getByRole('button', { name: 'Usar prompt', exact: true }).click();
    await page.locator('.research-composer-input').fill(`Consulta ${view}`); await page.locator('.research-composer-input').press('Enter');
    await page.waitForFunction(() => window.saved.length > 0);
    const chosenId = await page.evaluate(() => window.requests[0].systemPromptId);
    assert.ok(chosenId);
    if (await page.getByTestId('research-history-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('research-history-toggle').click();
    await page.getByRole('button', { name: 'Nueva conversación', exact: true }).last().click();
    await trigger.getByText('Default', { exact: true }).waitFor();
    await page.getByTestId('research-history-sidebar').getByText(view === 'embedded' ? 'Conversación de prueba 1' : `Consulta ${view}`, { exact: true }).click();
    await trigger.getByText('Tutor socrático', { exact: true }).waitFor();
    await trigger.click();
    await dialog.getByRole('listitem').filter({ hasText: 'Default' }).click();
    await dialog.getByRole('button', { name: 'Usar Default', exact: true }).click();
    await page.locator('.research-composer-input').fill('Segunda pregunta'); await page.locator('.research-composer-input').press('Enter');
    await page.waitForFunction(() => window.requests.length === 2);
    assert.equal(await page.evaluate(() => window.requests[1].systemPromptId), null);
    assert.equal(await page.evaluate(() => window.requests[1].conversationId), await page.evaluate(() => window.requests[0].conversationId), 'switching prompts keeps the same conversation');
    await trigger.click();
    await dialog.getByRole('listitem').filter({ hasText: 'Tutor socrático' }).click();
    await dialog.getByLabel('Instrucciones personalizadas', { exact: true }).fill('Pregunta primero y explica después.');
    await dialog.getByRole('button', { name: 'Guardar y usar', exact: true }).click();
    await trigger.click();
    assert.equal(await dialog.getByLabel('Instrucciones personalizadas', { exact: true }).inputValue(), 'Pregunta primero y explica después.');
    if (view === 'study') {
      await page.evaluate(() => document.documentElement.classList.replace('light', 'dark'));
      await page.screenshot({ animations: 'disabled', path: 'artifacts/research-assistant/system-prompts-dark.png' });
      await page.setViewportSize({ width: 600, height: 850 });
      await page.screenshot({ animations: 'disabled', path: 'artifacts/research-assistant/system-prompts-compact.png' });
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.setViewportSize({ width: 1440, height: 960 });
    }
    await dialog.getByRole('button', { name: 'Eliminar prompt', exact: true }).click();
    const confirmation = page.getByRole('alertdialog', { name: 'Eliminar prompt', exact: true });
    await confirmation.waitFor();
    assert.ok((await confirmation.boundingBox()).height < 400, 'confirmation remains compact');
    assert.equal(await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).evaluate(el => el === document.activeElement), true);
    assert.equal(await confirmation.evaluate(el => getComputedStyle(el).getPropertyValue('--vault-accent').trim()), accent);
    await page.keyboard.press('Escape');
    assert.equal(await confirmation.count(), 0, 'Escape closes only the confirmation');
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await dialog.getByLabel('Instrucciones personalizadas', { exact: true }).inputValue(), 'Pregunta primero y explica después.');
    await dialog.getByRole('button', { name: 'Eliminar prompt', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal(await dialog.locator('.research-prompt-item strong').filter({ hasText: 'Tutor socrático' }).count(), 1);
    await dialog.getByRole('button', { name: 'Eliminar prompt', exact: true }).click();
    if (view === 'study') await page.screenshot({ animations: 'disabled', path: 'artifacts/research-assistant/system-prompts-delete.png' });
    await confirmation.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await confirmation.waitFor({ state: 'detached' });
    await dialog.getByRole('button', { name: 'Usar Default', exact: true }).click();
    await trigger.getByText('Default', { exact: true }).waitFor();
  }
  assert.deepEqual(errors, []);
  console.log('Five chat variants: create/edit/delete, alphabetical search, Default, per-conversation selection/reload, same conversation, request propagation, vault accent and light/dark/compact prompt modal passed.');
} catch (error) {
  await page.screenshot({ path: 'artifacts/research-assistant/system-prompts-ui-failure.png' });
  console.error(await page.locator('.research-prompt-editor input, .research-prompt-editor textarea').evaluateAll(elements => elements.map(el => ({ tag: el.tagName, value: el.value }))));
  throw error;
} finally { await browser.close(); }
