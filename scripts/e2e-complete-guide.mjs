// Operate the complete-study-guide composer and look at its reader pieces in a real
// browser: tick a unit, see the estimate and the multi-subject warning, and check
// that callouts, KaTeX (including \ce{}) and the coverage panel render in light and
// dark themes. Writes screenshots to docs/verification/.
//
//   node scripts/e2e-complete-guide.mjs [--lang es]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const language = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'es';
const shotDir = path.join(repoRoot, 'docs/verification');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-complete-guide-e2e-'));
let browser;
try {
  const css = path.join(tmp, 'harness.css');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/tailwindcss'), ['-c', path.join(repoRoot, 'tailwind.config.js'), '-i', path.join(repoRoot, 'src/index.css'), '-o', css, '--minify'], { cwd: repoRoot, stdio: 'ignore' });
  const katexCss = await readFile(path.join(repoRoot, 'node_modules/katex/dist/katex.min.css'), 'utf8');
  const fontsDir = pathToFileURL(path.join(repoRoot, 'node_modules/katex/dist/fonts/')).href;
  const bundled = await build({
    entryPoints: [path.join(repoRoot, 'visual-tests/complete-guide-harness.tsx')],
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@shared': path.join(repoRoot, 'shared') },
    loader: { '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.json': 'json', '.woff2': 'empty', '.woff': 'empty', '.ttf': 'empty' },
    logLevel: 'silent',
  });
  await writeFile(path.join(tmp, 'index.html'), [
    '<!doctype html>', `<html lang="${language}"><head><meta charset="utf-8" />`,
    `<style>${katexCss.replace(/url\(fonts\//g, `url(${fontsDir}`)}</style>`,
    `<style>${await readFile(css, 'utf8')}</style>`,
    '<title>Guía de estudio completa</title></head><body><div id="root"></div>',
    `<script>${bundled.outputFiles[0].text}</script>`, '</body></html>',
  ].join('\n'), 'utf8');

  browser = await chromium.launch({ executablePath: process.env.NODUS_CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--force-color-profile=srgb'] });
  await mkdir(shotDir, { recursive: true });
  for (const theme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: 1360, height: 1500 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));
    await page.goto(`${pathToFileURL(path.join(tmp, 'index.html')).href}?lang=${language}&theme=${theme}`);
    await page.waitForSelector('[data-testid="complete-guide-tree"] li');

    // Tick "Tema 2" (a unit): its sources are selected and the estimate appears.
    await page.getByRole('checkbox', { name: 'Tema 2 · Ácidos y bases' }).check();
    await page.waitForSelector('[data-testid="composer"][data-ready="yes"]');
    const estimate = await page.getByTestId('complete-guide-estimate').innerText();
    assert.match(estimate, /USD/u, 'a DeepSeek Flash estimate is priced');
    await page.getByRole('checkbox', { name: 'Tema 2 · Ácidos y bases' }).locator('..').getByRole('button').click();
    assert.equal(await page.getByRole('checkbox', { name: 'Clase 3 · pH' }).isChecked(), true, 'ticking a unit ticks its sources');
    assert.equal(await page.getByRole('checkbox', { name: 'Examen escaneado.pdf' }).isDisabled(), true, 'unreadable sources cannot be ticked');
    // Adding a second subject warns.
    await page.getByRole('checkbox', { name: 'Historia' }).check();
    await page.waitForFunction(() => /asignaturas/.test(document.querySelector('[data-testid="complete-guide-estimate"]')?.textContent ?? ''));

    // Reader: callouts are cards, math renders, \ce{} renders, AI boxes are labelled.
    assert.equal(await page.locator('aside.guide-callout').count(), 7);
    assert.equal(await page.locator('aside.guide-callout-ai-analogy').count(), 1);
    assert.ok(await page.locator('.katex').count() >= 6, 'KaTeX rendered the formulas');
    assert.equal(await page.locator('.katex-error').count(), 0, 'no formula failed, including \\ce{}');
    assert.match(await page.getByTestId('complete-guide-coverage').innerText(), /A1[\s\S]*G1/u);
    assert.deepEqual(errors.map(String), []);
    await page.screenshot({ path: path.join(shotDir, `complete-guide-${theme}.png`), fullPage: true });
    await page.close();
  }
  console.log(`[complete guide e2e] passed; screenshots in ${path.relative(repoRoot, shotDir)}`);
} finally {
  await browser?.close();
  await rm(tmp, { recursive: true, force: true });
}
