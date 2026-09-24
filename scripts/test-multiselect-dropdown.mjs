// The Global Library's filter dropdowns: styled, several values at once, each a checkbox.
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
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
test('a dropdown selects several values, stays open while choosing, searches long lists and clears', { timeout: 120000 }, async t => {
  if (!chrome) { t.skip('An isolated test browser is required'); return; }
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-multiselect-'));
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const bundle = await build({ entryPoints: [path.join(repo, 'scripts/fixtures/multiselect-dropdown/renderer.tsx')], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
    const css = path.join(root, 'style.css');
    execFileSync(path.join(repo, 'node_modules/.bin/tailwindcss'), ['-i', 'src/index.css', '-o', css, '--minify'], { cwd: repo, stdio: 'pipe' });
    for (const theme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport: { width: 560, height: 420 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.setContent(`<html class="${theme}"><body style="background:${theme === 'dark' ? '#0a0a0a' : '#fff'}"><div id="root"></div></body></html>`);
      await page.addStyleTag({ content: await readFile(css, 'utf8') });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const types = page.getByTestId('types');
      await types.getByRole('button', { name: /Todos/ }).click();
      const list = types.getByRole('listbox');
      await list.getByRole('option', { name: /Libro/ }).click();
      await list.getByRole('option', { name: /Tesis/ }).click();
      assert.equal(await list.count(), 1, 'choosing does not close the dropdown');
      assert.equal(await list.getByRole('option', { selected: true }).count(), 2);
      assert.deepEqual(await page.evaluate(() => window.changes.at(-1)), ['book', 'thesis']);
      assert.match(await types.getByRole('button').first().innerText(), /Libro, Tesis[\s\S]*2/, 'the trigger names the choices and counts them');
      if (process.env.NODUS_MULTISELECT_SHOTS) await page.screenshot({ path: path.join(process.env.NODUS_MULTISELECT_SHOTS, `multiselect-${theme}.png`) });
      await list.getByRole('button', { name: 'Limpiar', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.changes.at(-1)), []);
      await page.mouse.click(540, 400);
      assert.equal(await list.count(), 0, 'clicking elsewhere closes it');
      const tags = page.getByTestId('tags');
      await tags.getByRole('button', { name: /Todos/ }).click();
      await tags.getByRole('textbox').fill('Etiqueta 1');
      assert.equal(await tags.getByRole('option').count(), 4, 'a long list is searchable (1, 10, 11, 12)');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); await rm(root, { recursive: true, force: true }); }
});
