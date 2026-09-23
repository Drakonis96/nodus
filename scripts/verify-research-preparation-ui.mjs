import assert from 'node:assert/strict';
import path from 'node:path';

/** Real renderer/preload/campaign queue with synthetic metadata, no provider calls. */
export async function verifyResearchPreparationUi(page, root) {
  const dialog = page.getByTestId('research-preparation-welcome');
  await dialog.getByText(/Embeddings: openai/).waitFor({ timeout: 45000 });
  assert.equal(await dialog.locator('section').count(), 3);
  assert.equal(await dialog.getByRole('checkbox', { name: 'Preparar nuevas incorporaciones', exact: true }).isChecked(), false);
  const layouts = [];
  for (const theme of ['light', 'dark']) for (const width of [1280, 800]) {
    await page.evaluate(theme => window.nodus.updateSettings({ theme }), theme);
    await page.setViewportSize({ width, height: 800 });
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.height <= 801);
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).focus();
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
    }
    await page.screenshot({ path: path.join(root, 'artifacts', `preparation-${theme}-${width}.png`) });
    layouts.push({ theme, width, box, keyboardFocusContained: true });
  }
  await dialog.getByRole('button', { name: 'Preparar solo texto local', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  let campaign;
  const deadline = Date.now() + 45000;
  do {
    const progress = await page.evaluate(() => window.nodus.getResearchPreparationProgress());
    campaign = progress.campaigns.find(campaign => campaign.embedding === null && campaign.jobs.length === 3);
    if (campaign?.jobs.every(job => job.state === 'complete')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.ok(campaign?.jobs.every(job => job.state === 'complete'), JSON.stringify(campaign));
  const inventory = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
  assert.equal(inventory.documents.filter(document => document.workId && document.preparation.lexical === 'ready').length, 3);
  assert.ok(inventory.documents.filter(document => document.workId).every(document => document.preparation.text === 'abstract'), 'metadata fixtures never pretend to be full documents');
  const panel = page.getByTestId('header-queue-panel');
  await panel.waitFor();
  assert.match(await panel.innerText(), /Preparar fuentes/);
  await page.keyboard.press('Escape');
  const policy = await page.evaluate(() => window.nodus.getResearchPreparationPolicy());
  assert.equal(policy.decision, 'accepted'); assert.equal(policy.futureAdditions, false);
  await page.reload();
  await page.getByRole('button', { name: 'Research chat', exact: true }).first().waitFor();
  assert.equal(await dialog.count(), 0, 'the accepted version does not reappear after restart');
  return { passed: true, mode: 'real Electron/preload/queue, synthetic abstract-only sources, no inference or Zotero calls', works: 3, campaignId: campaign.id, layouts, policy };
}
