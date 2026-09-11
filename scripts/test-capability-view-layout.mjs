// Layout verification for the declarative capability views, against the compiled CSS in
// real Chromium. The renderer is the production component; the data is synthetic.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);

test('capability views render in both themes without overflowing the message column', { timeout: 240_000 }, async (t) => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-capability-view-'));
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const bundle = await build({
      entryPoints: [path.join(root, 'scripts/fixtures/capability-view/renderer.tsx')],
      bundle: true, write: false, platform: 'browser', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      alias: { '@shared': path.join(root, 'shared') },
      // The chat renderer pulls in KaTeX's stylesheet; its font files play no part in
      // what this test measures.
      // Stylesheets are injected separately, compiled the way the app compiles them.
      loader: { '.ttf': 'empty', '.woff': 'empty', '.woff2': 'empty', '.css': 'empty' },
    });
    const cssFile = path.join(dir, 'style.css');
    execFileSync(path.join(root, 'node_modules/.bin/tailwindcss'), ['-i', 'src/index.css', '-o', cssFile, '--minify'], { cwd: root, stdio: 'pipe' });
    // Tailwind for the utilities, plus the component stylesheets the fixture's imports
    // are standing in for.
    const css = [
      await readFile(cssFile, 'utf8'),
      await readFile(path.join(root, 'src/components/chatVisuals.css'), 'utf8'),
      await readFile(path.join(root, 'src/components/capabilityPackages.css'), 'utf8'),
    ].join('\n');

    for (const theme of ['dark', 'light']) {
      for (const width of [520, 900]) {
        const page = await browser.newPage({ viewport: { width, height: 1400 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://capability.test/', route => route.fulfill({
          contentType: 'text/html',
          body: `<html class="${theme}"><body class="${theme === 'light' ? 'light' : ''}" style="margin:0;background:${theme === 'light' ? '#f4f4f5' : '#0b0b0f'};color:${theme === 'light' ? '#27272a' : '#e4e4e7'}"><div id="root"></div></body></html>`,
        }));
        await page.goto('http://capability.test/');
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page.getByTestId('panel').waitFor();
        await page.waitForFunction(() => document.querySelectorAll('.capability-view').length >= 2);

        assert.deepEqual(errors, [], `${theme}/${width}: the fixture rendered without page errors`);

        // Every node kind the contract defines actually reaches the DOM.
        for (const selector of ['.capability-view-badges', '.capability-view-table table', '.capability-view-notice', '.capability-view-details', '.capability-view-download', '.capability-view-status', '.capability-view-code', '.capability-view-links']) {
          assert.ok(await page.locator(selector).count() > 0, `${theme}/${width}: ${selector} is rendered`);
        }

        // The message column never scrolls sideways: wide content scrolls inside its own box.
        const overflow = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          wide: [...document.querySelectorAll('.capability-view')].map(node => node.scrollWidth - node.clientWidth),
          tableScrolls: [...document.querySelectorAll('.capability-view-table')].every(node => getComputedStyle(node).overflowX === 'auto'),
        }));
        assert.equal(overflow.document, 0, `${theme}/${width}: the page does not scroll horizontally`);
        assert.ok(overflow.wide.every(value => value <= 1), `${theme}/${width}: no view overflows its own container`);
        assert.equal(overflow.tableScrolls, true, `${theme}/${width}: wide tables scroll inside themselves`);

        // Text has to be legible against the surface it sits on, in both themes.
        const contrast = await page.evaluate(() => {
          const luminance = (colour) => {
            const [r, g, b] = colour.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(value => {
              const channel = value / 255;
              return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          // Tinted surfaces are translucent, so the colour behind a label is the stack of
          // layers composited down to the first opaque one — not the topmost rgba().
          const parse = (colour) => {
            const parts = (colour.match(/[\d.]+/g) || []).map(Number);
            return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
          };
          const background = (node) => {
            const layers = [];
            for (let current = node; current; current = current.parentElement) {
              const layer = parse(getComputedStyle(current).backgroundColor);
              if (layer.a === 0) continue;
              layers.push(layer);
              if (layer.a === 1) break;
            }
            if (!layers.length || layers[layers.length - 1].a !== 1) layers.push(parse(getComputedStyle(document.body).backgroundColor));
            let composite = layers[layers.length - 1];
            for (let index = layers.length - 2; index >= 0; index--) {
              const top = layers[index];
              composite = {
                r: top.r * top.a + composite.r * (1 - top.a),
                g: top.g * top.a + composite.g * (1 - top.a),
                b: top.b * top.a + composite.b * (1 - top.a),
                a: 1,
              };
            }
            return `rgb(${composite.r}, ${composite.g}, ${composite.b})`;
          };
          return [...document.querySelectorAll('.capability-view p, .capability-view-badge, .capability-view-status b, .capability-packages-facts dd')]
            .filter(node => node.textContent.trim())
            .map(node => {
              const style = getComputedStyle(node);
              const a = luminance(style.color), b = luminance(background(node));
              return { text: node.textContent.trim().slice(0, 40), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
            });
        });
        for (const entry of contrast) {
          assert.ok(entry.ratio >= 3, `${theme}/${width}: "${entry.text}" has ${entry.ratio.toFixed(2)}:1 contrast`);
        }

        // A drawing a package returned goes through the core sanitizer like any other.
        assert.ok(await page.locator('.chat-visual img').count() > 0, `${theme}/${width}: the view's SVG is rendered as a sanitized image`);

        // Set NODUS_CAPABILITY_QA_DIR to keep the rendered pages for a human to look at.
        if (process.env.NODUS_CAPABILITY_QA_DIR) {
          await page.screenshot({ path: path.join(process.env.NODUS_CAPABILITY_QA_DIR, `${theme}-${width}.png`), fullPage: true });
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});
