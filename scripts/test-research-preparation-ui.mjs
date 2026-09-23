import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const repo = path.resolve(import.meta.dirname, '..');
// Same candidates as the other browser fixtures: CI's macOS runner ships Chrome here.
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
test('preparation welcome fixes selection and supports refusal, local text and independent future consent', { timeout: 120000 }, async t => {
  if (!chrome) { t.skip('An isolated test browser is required'); return; }
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-preparation-ui-'));
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  let page;
  const errors = [];
  try {
    const bundle = await build({ entryPoints: [path.join(repo, 'scripts/fixtures/research-preparation/renderer.tsx')], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
    const css = path.join(root, 'style.css');
    execFileSync(path.join(repo, 'node_modules/.bin/tailwindcss'), ['-i', 'src/index.css', '-o', css, '--minify'], { cwd: repo, stdio: 'pipe' });
    async function mount(initial = {}, width = 1000) {
      await page?.close();
      page = await browser.newPage({ viewport: { width, height: 740 }, reducedMotion: 'reduce' });
      page.on('pageerror', e => errors.push(e.message));
      await page.setContent('<html class="dark"><body><div id="root"></div></body></html>');
      await page.addStyleTag({ content: await readFile(css, 'utf8') });
      await page.evaluate(value => { window.initial = value; }, initial);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.getByTestId('open-preparation').waitFor();
    }
    const dialog = () => page.getByTestId('research-preparation-welcome');
    await mount({ idle: false });
    assert.equal(await dialog().count(), 0, 'active operations are not interrupted');
    await page.evaluate(() => window.setIdle(true));
    await dialog().getByText('baai/bge-m3', { exact: true }).waitFor();
    assert.equal(await dialog().locator('section').count(), 0);
    assert.equal(await dialog().getByRole('checkbox').count(), 0);
    assert.equal((await page.evaluate(() => window.actions)).some(action => action[0] === 'start'), false, 'welcome never silently enqueues');
    await dialog().getByRole('button', { name: 'No', exact: true }).click();
    await dialog().getByRole('button', { name: 'Sí, dejar desactivado', exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.actions)).some(action => action[0] === 'policy' && action[1].decision === 'declined'), false, 'No requires confirmation');
    await dialog().getByRole('button', { name: 'Sí, dejar desactivado', exact: true }).click();
    await dialog().waitFor({ state: 'detached' });
    await page.evaluate(() => window.setIdle(false)); await page.evaluate(() => window.setIdle(true));
    assert.equal(await dialog().count(), 0, 'a recorded refusal is not shown repeatedly');
    await page.getByTestId('open-one').click();
    await dialog().getByRole('checkbox', { name: /Second source/ }).waitFor();
    assert.equal(await dialog().getByRole('checkbox', { name: /First source/ }).count(), 0);
    await dialog().getByRole('button', { name: 'Encolar selección', exact: true }).click();
    await dialog().waitFor({ state: 'detached' });
    assert.ok((await page.evaluate(() => window.actions)).some(action => action[0] === 'start' && action[1].previewId === 'frozen-preview' && JSON.stringify(action[1].documentIds) === '["two"]' && action[1].mode === 'embeddings'));
    await mount({ available: false }, 640);
    await dialog().getByText('baai/bge-m3', { exact: true }).waitFor();
    await dialog().getByRole('button', { name: 'Configurar embeddings', exact: true }).click();
    assert.ok((await page.evaluate(() => window.actions)).some(action => action[0] === 'configure'));
    await page.getByTestId('manage-preparation').click();
    await dialog().getByRole('checkbox', { name: 'Preparar nuevas incorporaciones', exact: true }).uncheck();
    await dialog().getByRole('checkbox', { name: 'Preparar nuevas incorporaciones', exact: true }).check();
    await page.waitForFunction(() => window.actions.some(action => action[0] === 'policy' && action[1].futureAdditions === true));
    await dialog().getByRole('button', { name: 'Elegir obras', exact: true }).click();
    await dialog().getByRole('button', { name: 'Deseleccionar todo', exact: true }).click();
    assert.equal(await dialog().getByRole('button', { name: 'Preparar solo texto local', exact: true }).isDisabled(), true);
    await dialog().getByRole('checkbox', { name: /First source/ }).check();
    const box = await dialog().boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 641, 'narrow windows keep the dialog on screen');
    await dialog().getByRole('button', { name: 'Preparar solo texto local', exact: true }).click();
    await dialog().waitFor({ state: 'detached' });
    assert.ok((await page.evaluate(() => window.actions)).some(action => action[0] === 'start' && action[1].mode === 'text' && JSON.stringify(action[1].documentIds) === '["one"]'));
    await page.getByTestId('open-preparation').click();
    await dialog().getByText('baai/bge-m3', { exact: true }).waitFor();
    await page.keyboard.press('Escape'); await dialog().waitFor({ state: 'detached' });
    assert.equal(await page.getByTestId('open-preparation').evaluate(el => el === document.activeElement), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await rm(root, { recursive: true, force: true }); }
});
