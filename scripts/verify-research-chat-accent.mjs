import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'research-accent-'));
await build({ entryPoints: ['shared/vaultColors.ts'], outfile: join(dir, 'colors.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { VAULT_TYPE_COLORS } = await import(pathToFileURL(join(dir, 'colors.mjs')));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const color = locator => locator.evaluate(el => getComputedStyle(el).getPropertyValue('--vault-accent').trim());
try {
  for (const theme of ['light', 'dark']) for (const [vault, accent] of Object.entries(VAULT_TYPE_COLORS)) {
    const view = { estudio: 'study', docencia: 'teaching', databases: 'database', worldbuilding: 'world' }[vault] ?? 'embedded';
    await page.goto(`http://127.0.0.1:5198/visual-tests/research-assistant-harness.html?view=${view}&vault=${vault}&theme=${theme}`);
    await page.locator('.research-composer-input').fill('Revisa estas fuentes');
    assert.equal(await page.locator('.research-composer-tool, .research-dictation').count(), 0);
    assert.equal(await color(page.locator('.research-composer-send')), accent);
    const rgb = `rgb(${[1, 3, 5].map(start => parseInt(accent.slice(start, start + 2), 16)).join(', ')})`;
    assert.equal(await page.locator('.research-composer-send').evaluate(el => getComputedStyle(el).backgroundColor), rgb);
    await page.waitForFunction(expected => getComputedStyle(document.querySelector('.chat-skills-control')).getPropertyValue('--vault-accent').trim() === expected, accent);
    await page.getByRole('button', { name: /Esfuerzo de thinking:/ }).click();
    assert.equal(await color(page.locator('.research-effort-panel')), accent);
    await page.keyboard.press('Escape');
    await page.getByTestId('research-system-prompt-trigger').click();
    assert.equal(await color(page.locator('.research-system-prompt-dialog')), accent);
    assert.equal(await page.locator('.research-system-prompt-dialog .btn-primary').evaluate(el => getComputedStyle(el).backgroundColor), rgb);
    await page.keyboard.press('Escape');
    if (view === 'embedded') {
      await page.getByTestId('research-context-trigger').click();
      assert.equal(await color(page.locator('.research-context-panel')), accent);
      await page.keyboard.press('Escape');
      await page.getByTestId('research-source-filter-trigger').click();
      assert.equal(await color(page.locator('.research-source-filter-dialog')), accent);
      assert.equal(await page.locator('.research-source-filter-dialog input[type=checkbox]').first().evaluate(el => getComputedStyle(el).accentColor), rgb);
      if (vault === 'prosopography') await page.screenshot({ animations: 'disabled', path: `artifacts/research-assistant/filters-vault-${theme}.png` });
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await page.waitForFunction(() => window.saved.length > 0);
    assert.equal(await page.locator('.research-message.research-accent-solid').evaluate(el => getComputedStyle(el).backgroundColor), rgb);
    if (vault === 'estudio') await page.screenshot({ animations: 'disabled', path: `artifacts/research-assistant/study-vault-${theme}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('All nine canonical vault accents passed in light/dark: composer, messages, Skills, thinking and context/filter portals; plus/microphone absent. Mocked responses only.');
} finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
