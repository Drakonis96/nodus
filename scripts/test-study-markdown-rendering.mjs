// Visual verification for Markdown + LaTeX in questions and flashcards, against the
// compiled CSS in real Chromium. The renderer is the production component; the bridge
// and data are synthetic. Screenshots land in artifacts/markdown-latex by default.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { componentStyles } from './lib/component-test-styles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = process.env.NODUS_STUDY_MARKDOWN_QA_DIR || path.join(root, 'artifacts/markdown-latex');
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);

test('questions and flashcards typeset Markdown and LaTeX in both themes', { timeout: 300_000 }, async (t) => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-markdown-'));
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const bundle = await build({
      entryPoints: [path.join(root, 'scripts/fixtures/study-markdown/renderer.tsx')],
      bundle: true, write: false, platform: 'browser', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      alias: { '@shared': path.join(root, 'shared') },
      loader: { '.ttf': 'empty', '.woff': 'empty', '.woff2': 'empty', '.css': 'empty' },
      logLevel: 'error',
    });
    const cssFile = componentStyles();
    const css = [
      await readFile(cssFile, 'utf8'),
      await readFile(path.join(root, 'node_modules/katex/dist/katex.min.css'), 'utf8'),
    ].join('\n');
    const katexFonts = path.join(root, 'node_modules/katex/dist/fonts');
    mkdirSync(shotsDir, { recursive: true });

    for (const theme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1500 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const html = `<html class="${theme}"><head></head><body class="${theme}" style="margin:0;background:${theme === 'light' ? '#f4f4f5' : '#0b0b0f'};color:${theme === 'light' ? '#27272a' : '#e4e4e7'}"><div id="root" style="height:100vh;display:flex;flex-direction:column"></div></body></html>`;
      await page.route('http://study.test/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
      // KaTeX is injected as an inline stylesheet, so its relative font URLs resolve
      // against the document. Serve them from the installed package or every formula
      // would silently fall back to a system serif. Registered last so it wins over
      // the catch-all above.
      await page.route('http://study.test/fonts/**', async (route) => {
        const name = decodeURIComponent(path.basename(new URL(route.request().url()).pathname));
        const file = path.join(katexFonts, name);
        if (!existsSync(file)) { await route.fulfill({ status: 404 }); return; }
        const contentType = name.endsWith('.woff2') ? 'font/woff2' : name.endsWith('.woff') ? 'font/woff' : 'font/ttf';
        await route.fulfill({ contentType, body: await readFile(file) });
      });
      const mount = async (view) => {
        await page.goto(`http://study.test/?view=${view}`);
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
      };

      // ── Question bank ────────────────────────────────────────────────────────
      await mount('bank');
      await page.getByTestId('study-question-bank').waitFor();
      const detail = page.locator('.study-question-detail');
      await detail.waitFor();
      assert.deepEqual(errors, [], `${theme}: the question bank rendered without page errors`);

      assert.ok(await detail.locator('.katex').count() >= 5, `${theme}: questions typeset their formulas`);
      assert.ok(await detail.locator('table').count() > 0, `${theme}: the GFM table rendered`);
      assert.ok(await detail.locator('pre code').count() > 0, `${theme}: the code block rendered`);
      assert.ok(await detail.locator('ul li, ol li').count() > 0, `${theme}: the lists rendered`);
      assert.ok(await detail.locator('strong').count() > 0, `${theme}: bold rendered`);
      const detailText = await detail.textContent();
      assert.doesNotMatch(detailText, /\*\*|^\s*\|/m, `${theme}: raw Markdown markers do not reach the question detail`);
      assert.doesNotMatch(detailText, /\$C_nH/, `${theme}: raw LaTeX source is not shown as text`);
      assert.match(detailText, /C\s*n\s*H/i, `${theme}: the chemistry formula is visible`);
      await page.screenshot({ path: path.join(shotsDir, `${theme}-question-bank.png`), fullPage: true });
      await detail.screenshot({ path: path.join(shotsDir, `${theme}-question-detail.png`) });

      // ── Flashcard modal ─────────────────────────────────────────────────────
      // Flashcards live in their own bank tab now, so open it before picking a card.
      await page.getByTestId('study-bank-tab-flashcards').click();
      await page.locator('[data-testid^="study-flashcard-"]').first().click();
      const cardModal = page.getByTestId('study-bank-flashcard-modal');
      await cardModal.waitFor();
      assert.ok(await cardModal.locator('.katex').count() >= 2, `${theme}: the flashcard front/back typeset their formulas`);
      assert.ok(await cardModal.locator('ul li').count() > 0, `${theme}: the flashcard back rendered its list`);
      const cardText = await cardModal.textContent();
      assert.doesNotMatch(cardText, /\*\*|\$C_nH/, `${theme}: the flashcard hides its Markdown/LaTeX source`);
      await cardModal.screenshot({ path: path.join(shotsDir, `${theme}-flashcard-modal.png`) });
      await page.keyboard.press('Escape');
      await cardModal.waitFor({ state: 'detached' });
      await page.getByTestId('study-bank-tab-questions').click();
      await page.getByTestId('study-question-edit').click();
      const editor = page.getByTestId('study-question-editor');
      await editor.waitFor();
      await editor.getByRole('button', { name: 'Vista previa' }).first().click();
      assert.ok(await editor.locator('.katex').count() > 0, `${theme}: the editor preview typesets the prompt`);
      await editor.screenshot({ path: path.join(shotsDir, `${theme}-question-editor-preview.png`) });

      // ── Review session ──────────────────────────────────────────────────────
      await mount('review');
      await page.getByTestId('study-review-start').click();
      const session = page.getByTestId('study-review-session');
      await session.waitFor();
      assert.ok(await session.locator('.katex').count() > 0, `${theme}: the review front typesets its formula`);
      const reveal = session.locator('[role="button"][aria-expanded]');
      const before = await session.locator('.katex').count();
      await reveal.click();
      await page.waitForFunction((count) => document.querySelectorAll('[data-testid="study-review-session"] .katex').length > count, before);
      assert.deepEqual(errors, [], `${theme}: the review session rendered without page errors`);
      await session.screenshot({ path: path.join(shotsDir, `${theme}-review-session.png`) });

      // The question bank must not push the window sideways in either theme.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `${theme}: the review surface does not overflow horizontally (${overflow}px)`);
      await page.close();
    }
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});
