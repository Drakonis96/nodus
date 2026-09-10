// Operate the "Extensión orientativa de cada sección" control in a real browser.
//
// Rendering the component (scripts/test-deep-research-section-length-field.mjs)
// proves the markup; only a browser proves the BEHAVIOUR the user actually meets:
// choosing "Custom" reveals the number field, a decimal or an out-of-range value
// raises an accessible error and blocks the submit button, and a valid value clears
// it and reaches the request. It also produces the verification screenshot in
// docs/verification/.
//
// The harness mounts the production component inside the production composer markup
// and the production Tailwind build — a mock would prove nothing about the control.
//
//   node scripts/e2e-deep-research-section-length.mjs [--lang es] [--screenshot-only]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const language = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'es';
const screenshotOnly = args.includes('--screenshot-only');
const shotDir = path.join(repoRoot, 'docs/verification');
const shotPath = path.join(shotDir, 'deep-research-section-length-composer.png');

const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-section-length-e2e-'));
let browser;
try {
  // The production Tailwind build, so the screenshot shows the real composer and a
  // layout regression cannot hide behind unstyled markup.
  const css = path.join(tmp, 'harness.css');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/tailwindcss'), [
    '-c', path.join(repoRoot, 'tailwind.config.js'),
    '-i', path.join(repoRoot, 'src/index.css'),
    '-o', css,
    '--minify',
  ], { cwd: repoRoot, stdio: 'ignore' });

  // An IIFE bundle inlined into the page: a `file://` document may not load an ES
  // module (CORS blocks it), and inlining keeps this test free of a dev server.
  const bundled = await build({
    entryPoints: [path.join(repoRoot, 'visual-tests/deep-research-section-length-harness.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@shared': path.join(repoRoot, 'shared') },
    loader: { '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.json': 'json' },
    logLevel: 'silent',
  });

  await writeFile(path.join(tmp, 'index.html'), [
    '<!doctype html>',
    `<html lang="${language}"><head><meta charset="utf-8" />`,
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<style>${await readFile(css, 'utf8')}</style>`,
    '<title>Deep Research — extensión orientativa de cada sección</title>',
    '</head><body class="light"><div id="root"></div>',
    `<script>${bundled.outputFiles[0].text}</script>`,
    '</body></html>',
  ].join('\n'), 'utf8');

  browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    args: ['--force-color-profile=srgb'],
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 720 }, deviceScaleFactor: 2 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.goto(`${pathToFileURL(path.join(tmp, 'index.html')).href}?lang=${language}`);
  await page.waitForSelector('[data-testid="deep-research-section-length"]');

  const select = page.getByTestId('deep-research-section-length');
  const state = () => page.getByTestId('harness-state').innerText();
  const custom = page.getByTestId('deep-research-section-length-custom');
  const error = page.getByTestId('deep-research-section-length-error');
  const submit = page.getByTestId('harness-submit');

  if (!screenshotOnly) {
    // Auto is the default and reveals nothing extra.
    assert.equal(await select.inputValue(), 'auto', 'the control opens on Auto');
    assert.equal(await custom.count(), 0, 'Auto shows no number field');
    assert.match(await state(), /sectionLength=auto/u);
    assert.equal(await submit.isDisabled(), false, 'Auto never blocks the composer');

    // A preset reaches the request as a number, still without the number field.
    await select.selectOption('10000');
    assert.equal(await custom.count(), 0, 'a preset shows no number field');
    assert.match(await state(), /sectionLength=10000/u, 'the preset reaches the request');

    // Custom reveals the number field.
    await select.selectOption('custom');
    await custom.waitFor();
    assert.equal(await custom.getAttribute('type'), 'number', 'Custom reveals a numeric field');

    // Every rejected shape raises a visible, accessible error and blocks submit.
    for (const [value, expectation] of [['', /\S/u], ['0', /\S/u], ['-500', /\S/u], ['2500.5', /\S/u], ['999999', /\S/u]]) {
      await custom.fill(value);
      await error.waitFor();
      assert.match(await error.innerText(), expectation, `"${value}" must explain itself`);
      assert.equal(await custom.getAttribute('aria-invalid'), 'true', `"${value}" marks the field invalid`);
      assert.equal(
        await custom.getAttribute('aria-describedby'),
        await error.getAttribute('id'),
        `"${value}" points the field at its own error for screen readers`,
      );
      assert.equal(await error.getAttribute('role'), 'alert', 'the error is announced, not just drawn');
      // The composer learns about the invalid value through an effect, one commit
      // after the error is painted: wait for the button rather than for a lucky tick.
      await page.waitForFunction(
        () => document.querySelector('[data-testid="harness-submit"]')?.hasAttribute('disabled') === true,
        undefined,
        { timeout: 5_000 },
      );
      assert.equal(await submit.isDisabled(), true, `"${value}" must block generating a report`);
    }

    // Below the minimum and above the maximum say WHICH bound, with the number.
    await custom.fill('10');
    await error.waitFor();
    assert.match(await error.innerText(), /250/u, 'the minimum is named, with its value interpolated');
    await custom.fill('999999');
    await error.waitFor();
    assert.match(await error.innerText(), /40[.,\s]?000/u, 'the maximum is named, with its value interpolated');

    // A valid value clears the error and reaches the request unchanged.
    await custom.fill('7300');
    await page.waitForFunction(() => !document.querySelector('[data-testid="deep-research-section-length-error"]'));
    assert.equal(await custom.getAttribute('aria-invalid'), null, 'a valid value is no longer marked invalid');
    assert.match(await state(), /sectionLength=7300/u, 'the custom word count reaches the request');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="harness-submit"]')?.hasAttribute('disabled') === false,
      undefined,
      { timeout: 5_000 },
    );
    assert.equal(await submit.isDisabled(), false, 'and the composer can generate again');

    // Going back to Auto closes the field and restores the default behaviour.
    await select.selectOption('auto');
    assert.equal(await custom.count(), 0);
    assert.match(await state(), /sectionLength=auto/u);

    // Every language the engine can write in is actually selectable here. Italian was
    // supported by every prompt pack and by the MCP schema, but missing from this
    // dropdown, so an Italian report was reachable over MCP and not from the app.
    const languages = page.getByTestId('deep-research-language');
    const offered = await languages.locator('option').evaluateAll((nodes) => nodes.map((node) => node.value));
    assert.deepEqual(offered, ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'], 'the picker offers every supported language');
    await languages.selectOption('it');
    assert.match(await state(), /language=it/u, 'choosing Italian reaches the request');
    assert.equal(
      await languages.locator('option[value="it"]').innerText(),
      'Italiano',
      'a language is named in itself, never translated into the interface language',
    );
    await languages.selectOption('es');
  }

  // The verification screenshot: the composer with the new dropdown on "Custom"
  // and the number field filled in, exactly as the task asks to see it.
  await select.selectOption('custom');
  await custom.waitFor();
  await custom.fill('7500');
  await page.waitForFunction(() => !document.querySelector('[data-testid="deep-research-section-length-error"]'));
  await mkdir(shotDir, { recursive: true });
  await page.locator('[role="dialog"]').screenshot({ path: shotPath });

  assert.deepEqual(pageErrors.map((error) => error.message), [], 'the composer must not throw');
  console.log(`deep research section length e2e passed · screenshot: ${shotPath}`);
} finally {
  await browser?.close();
  await rm(tmp, { recursive: true, force: true });
}
