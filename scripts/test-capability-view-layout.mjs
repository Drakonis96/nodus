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
      await readFile(path.join(root, 'src/components/chatModelViewer.css'), 'utf8'),
      // The map and the tiled image are Leaflet, and Leaflet without its stylesheet is a
      // pile of absolutely positioned tiles: measuring one would mean nothing.
      await readFile(path.join(root, 'node_modules/leaflet/dist/leaflet.css'), 'utf8'),
      await readFile(path.join(root, 'node_modules/katex/dist/katex.min.css'), 'utf8'),
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

        // A result a discipline wrote before it was a package renders as the finished
        // answer it is. The failure this guards against is the opposite: the reply shows
        // "the generation was interrupted" for something that finished months ago.
        const legacy = page.getByTestId('legacy');
        await legacy.locator('.capability-view').waitFor();
        assert.equal(await legacy.locator('.chat-visual-pending').count(), 0, `${theme}/${width}: a finished legacy result was shown as work in progress`);
        assert.ok((await legacy.textContent()).includes('Etanol'), `${theme}/${width}: the legacy block rendered its package's view`);

        // A 3D result is a viewer, not a blob of data: it names itself, says how large it
        // is, and offers to open — without starting a WebGL context nobody asked for.
        const model = page.getByTestId('artifact').locator('.capability-view-model');
        await model.waitFor();
        assert.equal(await page.locator('.capability-view-model-stage').count(), 0, `${theme}/${width}: a model opened a canvas before anyone asked`);
        assert.ok((await model.textContent()).includes('objeto.glb'), `${theme}/${width}: the model names its file`);
        assert.equal(await model.locator('.capability-view-model-open').count(), 1, `${theme}/${width}: the model offers to open`);

        // Every node kind the contract defines actually reaches the DOM.
        for (const selector of ['.capability-view-badges', '.capability-view-table table', '.capability-view-notice', '.capability-view-details', '.capability-view-download', '.capability-view-status', '.capability-view-code', '.capability-view-links', '.capability-view-model',
          '.capability-view-math', '.capability-view-chart svg', '.capability-view-tree', '.capability-view-passage', '.capability-view-comparison', '.capability-view-map', '.capability-view-image', '.capability-view-audio', '.capability-view-tiles']) {
          assert.ok(await page.locator(selector).count() > 0, `${theme}/${width}: ${selector} is rendered`);
        }

        const results = page.getByTestId('results');

        // The formula is typeset rather than shown as source: if KaTeX refused it, the
        // component falls back to the TeX, and that fallback is what this would catch.
        assert.ok(await results.locator('.capability-view-math .katex').count() > 0, `${theme}/${width}: the formula is typeset`);
        assert.equal(await results.locator('.capability-view-math-error').count(), 0, `${theme}/${width}: the formula typeset without falling back`);

        // The chart is drawn from the values, so the series have to be on screen and
        // named — a chart with no legend is two anonymous lines.
        assert.equal(await results.locator('.capability-view-chart-legend li').count(), 2, `${theme}/${width}: both series are named`);
        assert.ok(await results.locator('.capability-view-chart svg path, .capability-view-chart svg polyline').count() > 0, `${theme}/${width}: the chart drew its series`);
        // The scale covers every series: a domain taken from one of them would put the
        // other off the top of the plot, drawn but unreadable.
        const yTicks = (await results.locator('.capability-view-chart-grid text').allTextContents()).map(Number);
        assert.ok(Math.max(...yTicks) >= 169, `${theme}/${width}: the chart's scale reaches its largest value (${yTicks.join(', ')})`);
        assert.ok(await results.locator('.capability-view-chart svg path').evaluateAll(paths => paths.every(path => {
          const box = path.getBBox(), svg = path.ownerSVGElement.viewBox.baseVal;
          return box.y >= -1 && box.y + box.height <= svg.height + 1;
        })), `${theme}/${width}: every series is drawn inside the plot`);

        // The passage keeps its text intact and marks three spans inside it. Each mark
        // carries its label as a superscript, so the label spans come off before the text
        // is compared: what must survive is the passage, not the annotation.
        const passage = results.locator('.capability-view-passage p');
        const passageText = await passage.evaluate(node => {
          const copy = node.cloneNode(true);
          for (const label of copy.querySelectorAll('.capability-view-passage-label')) label.remove();
          return copy.textContent;
        });
        assert.equal(passageText, 'El ferroceno fue descrito en 1951 por Kealy y Pauson, y su estructura de sándwich se resolvió al año siguiente.', `${theme}/${width}: the passage text is whole`);
        assert.equal(await passage.locator('mark').count(), 3, `${theme}/${width}: every mark is shown`);
        // And each one covers what it says it covers, not a span shifted by a character.
        assert.deepEqual(
          await passage.locator('mark').evaluateAll(marks => marks.map(mark => {
            const copy = mark.cloneNode(true);
            for (const label of copy.querySelectorAll('.capability-view-passage-label')) label.remove();
            return copy.textContent;
          })),
          ['ferroceno', '1951', 'Kealy y Pauson'],
          `${theme}/${width}: the marks land on the words they name`,
        );

        // The comparison found its own differences: neither side may be reported whole.
        const changed = await results.locator('.capability-view-comparison-body span[data-change="added"], .capability-view-comparison-body span[data-change="removed"]').count();
        assert.ok(changed > 0, `${theme}/${width}: the comparison marked what changed`);
        assert.equal(await results.locator('.capability-view-comparison-identical').count(), 0, `${theme}/${width}: two different texts are not called identical`);

        // The map drew its features, and did so without a basemap: this view did not ask
        // for one, and a tile request to a third party is not something to add quietly.
        await results.locator('.capability-view-map-canvas.leaflet-container').waitFor();
        assert.ok(await results.locator('.capability-view-map-canvas path').count() >= 3, `${theme}/${width}: the map drew its features`);
        assert.equal(await results.locator('.capability-view-map-canvas img.leaflet-tile').count(), 0, `${theme}/${width}: a map without a basemap requests no tiles`);

        // The image decoded: a broken one reports zero natural width, which is exactly
        // what a mismatched type or a mangled blob would produce.
        const image = results.locator('.capability-view-image img');
        await image.waitFor();
        await image.scrollIntoViewIfNeeded();
        // Scrolled to first: the image is lazily loaded, so far enough down the page it is
        // correctly never decoded at all. Polled rather than awaited on the element handle,
        // because decoding finishes on its own schedule.
        await page.waitForFunction(() => {
          const node = document.querySelector('.capability-view-image img');
          return node && node.complete;
        }, null, { timeout: 10_000 });
        assert.deepEqual(await image.evaluate(node => [node.naturalWidth, node.naturalHeight]), [320, 180], `${theme}/${width}: the image decoded`);
        assert.ok((await image.getAttribute('alt')).length > 0, `${theme}/${width}: the image carries its alt text`);

        // The sound file loaded far enough to know how long it is.
        const audio = results.locator('.capability-view-audio audio');
        await audio.waitFor();
        await page.waitForFunction(() => {
          const element = document.querySelector('.capability-view-audio audio');
          return element && element.readyState >= 1;
        }, null, { timeout: 10_000 });
        assert.ok(await audio.evaluate(node => node.duration > 0), `${theme}/${width}: the audio loaded its metadata`);

        // A tiled image is the only kind that would reach the network, so it stays closed
        // until a reader asks — and nothing is fetched before then.
        const tiles = results.locator('.capability-view-tiles');
        assert.equal(await tiles.locator('.capability-view-tiles-canvas').count(), 0, `${theme}/${width}: a tiled image opened itself`);
        assert.ok((await tiles.textContent()).includes('8000'), `${theme}/${width}: the tiled image says how large it is`);

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
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: path.join(process.env.NODUS_CAPABILITY_QA_DIR, `${theme}-${width}.png`), fullPage: true });
          await results.screenshot({ path: path.join(process.env.NODUS_CAPABILITY_QA_DIR, `results-${theme}-${width}.png`) });
          // Per-kind captures too: a tall page reviewed as one image hides exactly the
          // detail — a clipped axis, a formula that fell back to source — worth looking at.
          for (const kind of ['math', 'chart', 'tree', 'passage', 'comparison', 'map', 'image', 'audio', 'tiles']) {
            await results.locator(`.capability-view-${kind}`).screenshot({ path: path.join(process.env.NODUS_CAPABILITY_QA_DIR, `${kind}-${theme}-${width}.png`) });
          }
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});
