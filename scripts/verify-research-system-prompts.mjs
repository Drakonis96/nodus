import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const base = 'http://127.0.0.1:5198/visual-tests/research-assistant-harness.html';
try {
  for (const view of ['embedded', 'database', 'study', 'teaching', 'world']) {
    console.log(`Checking prompt balloon: ${view}`);
    await page.goto(`${base}?view=${view}`);
    const trigger = page.getByTestId('research-system-prompt-trigger');
    assert.equal((await trigger.innerText()).trim(), 'System prompt', 'the trigger keeps its name');
    await trigger.click();
    const balloon = page.getByTestId('research-system-prompt-panel');
    assert.equal(await balloon.getAttribute('role'), 'dialog');
    assert.equal(await balloon.locator('.header-balloon-title').innerText(), 'System prompts');
    const accent = await trigger.evaluate(el => getComputedStyle(el).getPropertyValue('--vault-accent').trim());
    assert.equal(await balloon.evaluate(el => getComputedStyle(el).getPropertyValue('--vault-accent').trim()), accent);
    const editor = page.getByRole('dialog', { name: 'Nuevo prompt', exact: true });
    for (const [name, instructions] of [['Tutor socrático', 'Haz preguntas breves y explica paso a paso.'], ['Analista crítico', 'Distingue evidencia, inferencias y limitaciones.']]) {
      await balloon.getByRole('button', { name: 'Nuevo prompt', exact: true }).click();
      await editor.getByLabel('Nombre del prompt', { exact: true }).fill(name);
      await editor.getByLabel('Instrucciones personalizadas', { exact: true }).fill(instructions);
      // Cancel and Save stay in view whatever the instructions' length.
      const footer = await editor.locator('footer').boundingBox();
      const frame = await editor.boundingBox();
      assert.ok(footer.y + footer.height <= frame.y + frame.height + 1, 'the editor footer is visible');
      await editor.getByRole('button', { name: 'Guardar', exact: true }).click();
      await editor.waitFor({ state: 'detached' });
      assert.equal(await balloon.isVisible(), true, 'saving keeps the list open');
    }
    const names = await balloon.locator('.research-prompt-row strong').allTextContents();
    assert.deepEqual(names, ['Default', 'Analista crítico', 'Tutor socrático']);
    assert.equal(await balloon.getByRole('button', { name: 'Activo: Default', exact: true }).isDisabled(), true, 'Default starts active');
    await balloon.getByRole('button', { name: 'Activar: Tutor socrático', exact: true }).click();
    await page.locator(`[data-testid="research-system-prompt-trigger"][aria-label="System prompt: ${'Tutor socrático'}"]`).waitFor();
    assert.equal(await balloon.locator('.research-prompt-row.is-active').count(), 1, 'activating one deactivates the rest');
    assert.match(await balloon.locator('.research-prompt-row.is-active').innerText(), /Tutor socrático/);
    assert.equal(await balloon.getByRole('button', { name: 'Eliminar prompt: Tutor socrático', exact: true }).isEnabled(), true, 'the active prompt can be deleted from the list');
    assert.equal(await balloon.getByTestId('research-prompt-default').getByRole('button', { name: /^Eliminar prompt/ }).count(), 0, 'Default cannot be deleted');
    if (view === 'study') await page.screenshot({ animations: 'disabled', path: 'artifacts/research-assistant/system-prompts-light.png' });
    await page.keyboard.press('Escape');
    await balloon.waitFor({ state: 'detached' });
    await page.locator('.research-composer-input').fill(`Consulta ${view}`); await page.locator('.research-composer-input').press('Enter');
    await page.waitForFunction(() => window.saved.length > 0);
    const chosenId = await page.evaluate(() => window.requests[0].systemPromptId);
    assert.ok(chosenId);
    if (await page.getByTestId('research-history-toggle').getAttribute('aria-expanded') !== 'true') await page.getByTestId('research-history-toggle').click();
    await page.getByRole('button', { name: 'Nueva conversación', exact: true }).last().click();
    await page.locator(`[data-testid="research-system-prompt-trigger"][aria-label="System prompt: ${'Default'}"]`).waitFor();
    await page.getByTestId('research-history-sidebar').getByText(view === 'embedded' ? 'Conversación de prueba 1' : `Consulta ${view}`, { exact: true }).click();
    await page.locator(`[data-testid="research-system-prompt-trigger"][aria-label="System prompt: ${'Tutor socrático'}"]`).waitFor();
    await trigger.click();
    await balloon.getByRole('button', { name: 'Activar: Default', exact: true }).click();
    await page.locator(`[data-testid="research-system-prompt-trigger"][aria-label="System prompt: ${'Default'}"]`).waitFor();
    await trigger.click();
    await page.locator('.research-composer-input').fill('Segunda pregunta'); await page.locator('.research-composer-input').press('Enter');
    await page.waitForFunction(() => window.requests.length === 2);
    assert.equal(await page.evaluate(() => window.requests[1].systemPromptId), null);
    assert.equal(await page.evaluate(() => window.requests[1].conversationId), await page.evaluate(() => window.requests[0].conversationId), 'switching prompts keeps the same conversation');
    await trigger.click();
    await balloon.getByRole('button', { name: 'Editar: Tutor socrático', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Editar prompt', exact: true });
    await edit.getByLabel('Instrucciones personalizadas', { exact: true }).fill('Pregunta primero y explica después.');
    await page.keyboard.press('Escape');
    await edit.waitFor({ state: 'detached' });
    assert.equal(await balloon.isVisible(), true, 'Escape closes only the editor');
    await balloon.getByRole('button', { name: 'Editar: Tutor socrático', exact: true }).click();
    assert.equal(await edit.getByLabel('Instrucciones personalizadas', { exact: true }).inputValue(), 'Haz preguntas breves y explica paso a paso.', 'a cancelled edit is not saved');
    await edit.getByLabel('Instrucciones personalizadas', { exact: true }).fill('Pregunta primero y explica después.');
    await edit.getByRole('button', { name: 'Guardar', exact: true }).click();
    await edit.waitFor({ state: 'detached' });
    await balloon.getByRole('button', { name: 'Editar: Tutor socrático', exact: true }).click();
    assert.equal(await edit.getByLabel('Instrucciones personalizadas', { exact: true }).inputValue(), 'Pregunta primero y explica después.');
    if (view === 'study') {
      await page.evaluate(() => document.documentElement.classList.replace('light', 'dark'));
      await page.screenshot({ animations: 'disabled', path: 'artifacts/research-assistant/system-prompts-dark.png' });
      await page.setViewportSize({ width: 600, height: 850 });
      await page.screenshot({ animations: 'disabled', path: 'artifacts/research-assistant/system-prompts-compact.png' });
      assert.equal(await edit.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.setViewportSize({ width: 1440, height: 960 });
    }
    await edit.getByRole('button', { name: 'Eliminar prompt', exact: true }).click();
    const confirmation = page.getByRole('alertdialog', { name: 'Eliminar prompt', exact: true });
    await confirmation.waitFor();
    assert.ok((await confirmation.boundingBox()).height < 400, 'confirmation remains compact');
    assert.equal(await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).evaluate(el => el === document.activeElement), true);
    assert.equal(await confirmation.evaluate(el => getComputedStyle(el).getPropertyValue('--vault-accent').trim()), accent);
    await page.keyboard.press('Escape');
    assert.equal(await confirmation.count(), 0, 'Escape closes only the confirmation');
    assert.equal(await edit.isVisible(), true);
    await edit.getByRole('button', { name: 'Eliminar prompt', exact: true }).click();
    if (view === 'study') await page.screenshot({ animations: 'disabled', path: 'artifacts/research-assistant/system-prompts-delete.png' });
    await confirmation.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await edit.waitFor({ state: 'detached' });
    assert.deepEqual(await balloon.locator('.research-prompt-row strong').allTextContents(), ['Default', 'Analista crítico']);
    // Deleting straight from the list, confirmed first.
    await balloon.getByRole('button', { name: 'Eliminar prompt: Analista crítico', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await confirmation.waitFor({ state: 'detached' });
    assert.deepEqual(await balloon.locator('.research-prompt-row strong').allTextContents(), ['Default']);
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors, []);
  console.log('Five chat variants: prompt balloon list, Activate (one at a time), editor modal with fixed Cancel/Save, create/edit/cancel/delete, Default, per-conversation selection/reload, same conversation, request propagation, vault accent and light/dark/compact passed.');
} catch (error) {
  await page.screenshot({ path: 'artifacts/research-assistant/system-prompts-ui-failure.png' });
  console.error(await page.locator('.research-prompt-edit-modal input, .research-prompt-edit-modal textarea').evaluateAll(elements => elements.map(el => ({ tag: el.tagName, value: el.value }))));
  throw error;
} finally { await browser.close(); }
