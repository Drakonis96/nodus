// The processing-log modal in a real browser: filters, ordering, the language of the lines,
// the colours in both themes, the right-click menu and the retention controls.
//
// Modelled on scripts/test-queue-panel.mjs: the component is bundled with esbuild, the real
// Tailwind stylesheet is compiled, and the page is driven through test ids and roles. The
// assertions about colour read the compiled class list off the rendered node, so a refactor that
// silently drops `font-semibold` from an error or the `dark:` variant from a success fails here
// rather than in a user's screenshot.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean).find(existsSync);

test('the log modal filters, sorts, copies, downloads and manages retention', { timeout: 240_000 }, async (t) => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-pipeline-logs-modal-'));
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  let page;
  try {
    const bundle = await build({
      entryPoints: [path.join(root, 'scripts/fixtures/pipeline-logs/renderer.tsx')],
      bundle: true,
      write: false,
      platform: 'browser',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    const css = path.join(dir, 'style.css');
    execFileSync(path.join(root, 'node_modules/.bin/tailwindcss'), ['-i', 'src/index.css', '-o', css, '--minify'], { cwd: root, stdio: 'pipe' });
    const stylesheet = await readFile(css, 'utf8');
    const errors = [];

    async function fresh(theme = 'dark') {
      if (page) await page.close();
      page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      page.setDefaultTimeout(15000);
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('http://logs.test/', (route) => route.fulfill({
        contentType: 'text/html',
        body: `<html class="${theme}"><body><div id="root"></div><div id="standalone"></div></body></html>`,
      }));
      await page.goto('http://logs.test/');
      await page.addStyleTag({ content: stylesheet });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.getByTestId('trigger').waitFor();
    }

    const openPanel = async () => { await page.evaluate(() => window.openPanel()); await page.getByTestId('header-queue-panel').waitFor(); };
    const openLogs = async () => {
      await openPanel();
      await page.getByTestId('header-queue-logs').click();
      await page.getByTestId('pipeline-logs-modal').waitFor();
      await settled(4);
    };
    const rows = () => page.getByTestId('pipeline-log-row');
    const settled = async (expected) => {
      await page.waitForFunction((count) => document.querySelectorAll('[data-testid="pipeline-log-row"]').length === count, expected);
    };
    const messages = () => page.getByTestId('pipeline-log-message').allInnerTexts();

    await t.test('the Logs button opens the modal and every line renders', async () => {
      await fresh();
      await openPanel();
      assert.equal(await page.getByTestId('header-queue-logs').count(), 1, 'the queue panel must offer the Logs button');
      await page.getByTestId('header-queue-logs').click();
      await page.getByTestId('pipeline-logs-modal').waitFor();
      assert.equal(await rows().count(), 4);
      // Newest first by default.
      const times = await page.getByTestId('pipeline-log-row').locator('span').first().allInnerTexts();
      assert.ok(times.length >= 1);
      assert.match(await page.getByTestId('pipeline-logs-count').innerText(), /4 entries/);
      // The English default makes the modal readable for a GitHub issue.
      assert.equal(await page.getByTestId('pipeline-logs-title').innerText(), 'Processing logs');
      assert.deepEqual(errors, []);
    });

    await t.test('errors are red and bold, successes green, warnings amber — in both themes', async () => {
      for (const theme of ['dark', 'light']) {
        await fresh(theme);
        await openLogs();
        const errorRow = page.locator('[data-testid="pipeline-log-row"][data-level="error"]').first();
        const successRow = page.locator('[data-testid="pipeline-log-row"][data-level="success"]').first();
        const warningRow = page.locator('[data-testid="pipeline-log-row"][data-level="warning"]').first();
        const classes = async (locator) => await locator.locator('[data-testid="pipeline-log-message"]').getAttribute('class');
        const errorClass = await classes(errorRow);
        const successClass = await classes(successRow);
        const warningClass = await classes(warningRow);
        if (theme === 'dark') {
          assert.match(errorClass, /text-red-400/, 'an error is light red on the dark theme');
          assert.match(errorClass, /font-semibold/, 'an error is bold');
          assert.match(successClass, /text-green-400/, 'a success is light green on the dark theme');
          assert.match(warningClass, /text-amber-400/);
        } else {
          assert.match(errorClass, /text-red-600/, 'an error is dark red on the light theme');
          assert.match(errorClass, /font-semibold/, 'an error is bold');
          assert.match(successClass, /text-green-700/, 'a success is dark green on the light theme');
          assert.match(warningClass, /text-amber-700/);
        }
        // The compiled stylesheet actually carries the utility, not just the class attribute.
        assert.match(stylesheet, /\.text-green-700/, 'the light-theme green must exist in the stylesheet');
        assert.match(stylesheet, /\.dark\\:text-green-400/, 'the dark-theme green must exist in the stylesheet');
        // The level badge and the ×N counter are there for a grouped line.
        assert.equal(await page.getByTestId('pipeline-log-repeat').count(), 1);
        assert.match(await page.getByTestId('pipeline-log-repeat').innerText(), /×12/);
      }
    });

    await t.test('the sort toggle flips the order and defaults to newest first', async () => {
      await fresh();
      await openLogs();
      const first = async () => (await messages())[0];
      assert.match(await first(), /Document indexed/, 'newest first by default');
      await page.getByTestId('pipeline-logs-sort').click();
      await page.waitForFunction(() => /timed out/.test(document.querySelector('[data-testid="pipeline-log-message"]')?.textContent || ''));
      assert.match(await first(), /timed out/, 'oldest first after the toggle');
      await page.getByTestId('pipeline-logs-sort').click();
      await page.waitForFunction(() => /Document indexed/.test(document.querySelector('[data-testid="pipeline-log-message"]')?.textContent || ''));
      assert.match(await first(), /Document indexed/);
    });

    await t.test('the multi-select filters combine, count and clear', async () => {
      await fresh();
      await openLogs();
      // Type filter: two categories selected at once.
      await page.getByTestId('pipeline-logs-types').click();
      const popover = page.getByTestId('pipeline-logs-types-popover');
      await popover.waitFor();
      // The popover must be above the modal, or the filter could not be used at all.
      const [popoverBox, modalBox] = await Promise.all([popover.boundingBox(), page.getByTestId('pipeline-logs-modal').boundingBox()]);
      assert.ok(popoverBox && modalBox);
      const insidePopover = await page.evaluate(([x, y]) => {
        const node = document.elementFromPoint(x, y);
        return Boolean(node && node.closest('[data-testid="pipeline-logs-types-popover"]'));
      }, [popoverBox.x + 20, popoverBox.y + 20]);
      assert.equal(insidePopover, true, 'the popover must be painted above the modal');
      await page.getByTestId('pipeline-logs-types-option-json').click();
      await settled(1);
      assert.match((await messages())[0], /JSON response/, 'only the JSON failure matches');
      await page.getByTestId('pipeline-logs-types-option-connection').click();
      await settled(2);
      await popover.getByRole('button', { name: 'Clear' }).click();
      await settled(4);
      await page.keyboard.press('Escape');
      await popover.waitFor({ state: 'detached' });
      // Escape closed the popover, not the modal.
      await page.getByTestId('pipeline-logs-modal').waitFor();

      // Level filter, then the day filter, then the two together.
      await page.getByTestId('pipeline-logs-levels').click();
      await page.getByTestId('pipeline-logs-levels-option-error').click();
      await settled(2);
      await page.keyboard.press('Escape');
      // The vault filter: every control the query supports must exist, or the filter is dead
      // code that only a reader of the source would know about.
      await page.getByTestId('pipeline-logs-vaults').click();
      await page.getByTestId('pipeline-logs-vaults-option-v1').click();
      // The level filter is still applied, so this narrows the two errors to the one in v1.
      await settled(1);
      assert.match(await page.getByTestId('pipeline-logs-vaults').innerText(), /Tesis/);
      await page.keyboard.press('Escape');
      await page.getByTestId('pipeline-logs-vaults').click();
      await page.getByTestId('pipeline-logs-vaults-popover').getByRole('button', { name: 'Clear' }).click();
      await settled(2);
      await page.keyboard.press('Escape');
      await page.getByTestId('pipeline-logs-days').click();
      await page.getByTestId('pipeline-logs-days-option-2026-09-14').click();
      await settled(1);
      assert.match((await messages())[0], /timed out/, 'one line from the 14th');
      await page.keyboard.press('Escape');
      await page.getByTestId('pipeline-logs-days').click();
      await page.getByTestId('pipeline-logs-days-popover').getByRole('button', { name: 'Clear' }).click();
      await settled(2); // the level filter is still applied: both errors remain
      await page.keyboard.press('Escape');
      // Search only touches language-neutral fields, so a code or a model finds the line.
      await page.getByTestId('pipeline-logs-search').fill('gpt-4o');
      await settled(1);
      assert.match((await messages())[0], /Unexpected token/);
      assert.deepEqual(errors, []);
    });

    await t.test('the language of the lines is chosen in the modal and applies to the export', async () => {
      await fresh();
      await openLogs();
      assert.match((await messages())[0], /Document indexed/);
      await page.getByTestId('pipeline-logs-language').selectOption('es');
      await page.waitForFunction(() => (document.querySelector('[data-testid="pipeline-log-message"]')?.textContent || '').includes('Documento indexado'));
      await page.getByTestId('pipeline-logs-language').selectOption('fr');
      await page.waitForFunction(() => (document.querySelector('[data-testid="pipeline-log-message"]')?.textContent || '').includes('Document indexé'));
      const settings = await page.evaluate(() => window.actions.filter((action) => action[0] === 'updateSettings'));
      assert.deepEqual(settings, [['updateSettings', { pipelineLogLanguage: 'es' }], ['updateSettings', { pipelineLogLanguage: 'fr' }]]);
      // The downloaded text follows the same choice, so the log is shareable as it reads.
      await page.getByTestId('pipeline-logs-download').click();
      await page.waitForFunction(() => Boolean(window.exported));
      const exported = await page.evaluate(() => window.exported);
      assert.match(exported.fileName, /^nodus-logs-\d{4}-\d{2}-\d{2}\.txt$/);
      assert.match(exported.text, /^Nodus processing logs/);
      assert.match(exported.text, /Log language: fr/);
      assert.match(exported.text, /Document indexé/);
      assert.match(exported.text, /\[invalid_json\]/, 'the language-neutral badge survives translation');
    });

    await t.test('right-click copies the line, copies it as JSON, downloads it and deletes it', async () => {
      await fresh();
      await openLogs();
      await page.evaluate(() => {
        window.copied = [];
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async (text) => { window.copied.push(text); } },
        });
      });
      const target = page.locator('[data-testid="pipeline-log-row"][data-level="error"]').first();
      await target.click({ button: 'right' });
      await page.getByTestId('pipeline-log-context-menu').waitFor();
      await page.getByTestId('pipeline-log-context-menu-copy-entry').click();
      const copied = await page.evaluate(() => window.copied);
      assert.equal(copied.length, 1);
      assert.match(copied[0], /ERROR {4}json {2}\[invalid_json\]/);
      assert.match(copied[0], /Model JSON response: error — Unexpected token < in JSON at position 0/);
      assert.match(copied[0], /model=gpt-4o · provider=openai/);

      await target.click({ button: 'right' });
      await page.getByTestId('pipeline-log-context-menu-copy-json').click();
      const json = JSON.parse((await page.evaluate(() => window.copied))[1]);
      assert.equal(json.code, 'invalid_json');
      assert.equal(json.level, 'error');
      assert.match(json.message.text, /Model JSON response: error/);

      await target.click({ button: 'right' });
      await page.getByTestId('pipeline-log-context-menu-download-entry').click();
      await page.waitForFunction(() => Boolean(window.exported));
      assert.match((await page.evaluate(() => window.exported)).fileName, /^nodus-logs-\d{4}-\d{2}-\d{2}-\d+\.txt$/);

      await target.click({ button: 'right' });
      await page.getByTestId('pipeline-log-context-menu-delete-entry').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="pipeline-log-row"]').length === 3);
      assert.deepEqual(
        await page.evaluate(() => window.actions.filter((action) => action[0] === 'deletePipelineLogs')),
        [['deletePipelineLogs', { ids: ['pl-3'] }]],
      );
    });

    await t.test('retention, the entry cap and both deletions are offered and confirmed', async () => {
      await fresh();
      await openLogs();
      await page.getByTestId('pipeline-logs-retention').selectOption('30d');
      await page.waitForFunction(() => window.actions.some((action) => JSON.stringify(action) === JSON.stringify(['updateSettings', { pipelineLogRetention: '30d' }])));
      await page.getByTestId('pipeline-logs-max-entries').selectOption('20000');
      await page.waitForFunction(() => window.actions.some((action) => JSON.stringify(action) === JSON.stringify(['updateSettings', { pipelineLogMaxEntries: 20000 }])));
      // Delete-all names the number of lines it is about to remove.
      await page.getByTestId('pipeline-logs-clear').click();
      const confirm = page.getByTestId('pipeline-logs-confirm');
      await confirm.waitFor();
      assert.match(await confirm.innerText(), /4 entries will be deleted and cannot be recovered/);
      await confirm.getByRole('button', { name: 'Cancel' }).click();
      await confirm.waitFor({ state: 'detached' });
      assert.equal(await rows().count(), 4, 'cancelling must not delete anything');
      await page.getByTestId('pipeline-logs-clear').click();
      await page.getByTestId('pipeline-logs-confirm-delete').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="pipeline-log-row"]').length === 0);
      assert.match(await page.getByTestId('pipeline-logs-list').innerText(), /No logs yet/);
      assert.deepEqual(
        await page.evaluate(() => window.actions.filter((action) => action[0] === 'clearPipelineLogs')),
        [['clearPipelineLogs']],
      );
    });

    await t.test('a new line arrives live and Escape or the backdrop closes the modal', async () => {
      await fresh();
      await openLogs();
      await page.evaluate(() => {
        window.logs = [{
          id: 'pl-live', at: new Date().toISOString(), level: 'error', category: 'provider', scope: 'indexing',
          message: { id: 'logFailed', params: { subject: { id: 'subjectModelCall' }, detail: 'busy right now' } },
          code: 'rate_limit', repeat: 1, firstAt: null, detail: null,
        }, ...window.logs];
        window.emit('onPipelineLogsChanged', { revision: 2, total: 5 });
      });
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="pipeline-log-row"]').length === 5);
      await page.keyboard.press('Escape');
      await page.getByTestId('pipeline-logs-modal').waitFor({ state: 'detached' });
      // The panel behind it is still there, and Escape closed only the modal.
      await page.getByTestId('header-queue-panel').waitFor();
      await page.getByTestId('header-queue-logs').click();
      await page.getByTestId('pipeline-logs-modal').waitFor();
      await page.mouse.click(8, 8);
      await page.getByTestId('pipeline-logs-modal').waitFor({ state: 'detached' });
      assert.deepEqual(errors, []);
    });

    await t.test('the modal stands alone, without the panel behind it', async () => {
      await fresh();
      await page.evaluate(() => window.mountStandalone());
      await page.getByTestId('pipeline-logs-modal').waitFor();
      assert.equal(await rows().count(), 4);
      await page.getByTestId('pipeline-logs-close').click();
      assert.equal(await page.evaluate(() => window.closedByButton), true);
      assert.deepEqual(errors, []);
    });
  } finally {
    if (page) await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true }).catch(() => undefined);
  }
});
