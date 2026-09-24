// The three-position filter switch: left keeps the items without the property, the
// centre switches the filter off, right keeps the items with it.
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
test('each third of the switch is a radio, clickable and reachable with the arrow keys', { timeout: 120000 }, async t => {
  if (!chrome) { t.skip('An isolated test browser is required'); return; }
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-tri-switch-'));
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const bundle = await build({ entryPoints: [path.join(repo, 'scripts/fixtures/tri-state-switch/renderer.tsx')], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
    const css = path.join(root, 'style.css');
    execFileSync(path.join(repo, 'node_modules/.bin/tailwindcss'), ['-i', 'src/index.css', '-o', css, '--minify'], { cwd: repo, stdio: 'pipe' });
    for (const theme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport: { width: 320, height: 90 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.setContent(`<html class="${theme}"><body style="background:${theme === 'dark' ? '#111' : '#fff'};color:${theme === 'dark' ? '#eee' : '#222'}"><div id="root"></div></body></html>`);
      await page.addStyleTag({ content: await readFile(css, 'utf8') });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const control = page.getByTestId('switch');
      await control.waitFor();
      assert.equal(await control.getAttribute('role'), 'radiogroup');
      assert.equal(await control.getAttribute('data-state'), 'off');
      await control.getByRole('radio', { name: 'Ideas extraídas', exact: true }).click();
      assert.equal(await control.getAttribute('data-state'), 'pos');
      if (process.env.NODUS_TRI_SWITCH_SHOTS) await page.screenshot({ path: path.join(process.env.NODUS_TRI_SWITCH_SHOTS, `switch-${theme}-pos.png`) });
      await control.getByRole('radio', { name: 'Sin ideas extraídas', exact: true }).click();
      assert.equal(await control.getAttribute('data-state'), 'neg');
      if (process.env.NODUS_TRI_SWITCH_SHOTS) await page.screenshot({ path: path.join(process.env.NODUS_TRI_SWITCH_SHOTS, `switch-${theme}-neg.png`) });
      await page.keyboard.press('ArrowRight');
      assert.equal(await control.getAttribute('data-state'), 'off', 'the arrow keys move one position');
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
      assert.equal(await control.getAttribute('data-state'), 'pos', 'and stop at the end');
      assert.equal(await control.getByRole('radio', { checked: true }).count(), 1);
      assert.deepEqual(await page.evaluate(() => window.changes), ['pos', 'neg', 'off', 'pos']);
      const thumb = await page.locator('.tri-switch-thumb').boundingBox(), track = await control.boundingBox();
      assert.ok(thumb.x + thumb.width > track.x + track.width * 0.66, 'the thumb sits on the right when including');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); await rm(root, { recursive: true, force: true }); }
});
