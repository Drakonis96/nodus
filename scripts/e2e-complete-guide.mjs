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
    // Prose first: only the example, the AI analogy, the warning and the questions are boxes.
    assert.equal(await page.locator('aside.guide-callout').count(), 4);
    assert.equal(await page.locator('aside.guide-callout-ai-analogy').count(), 1);
    assert.equal(await page.locator('aside.guide-callout-definition, aside.guide-callout-formula, aside.guide-callout-rule, aside.guide-callout-memorize').count(), 0, 'definitions and formulas are prose');
    assert.match(await page.locator('aside.guide-callout-ai-analogy .guide-callout-title').innerText(), /\(IA\)/u, 'the AI mark is in the title');
    assert.ok(await page.locator('.katex').count() >= 6, 'KaTeX rendered the formulas');
    assert.equal(await page.locator('.katex-error').count(), 0, 'no formula failed, including \\ce{}');
    assert.match(await page.getByTestId('complete-guide-coverage').innerText(), /A1[\s\S]*G1/u);
    assert.deepEqual(errors.map(String), []);
    await page.screenshot({ path: path.join(shotDir, `complete-guide-${theme}.png`), fullPage: true });
    await page.close();
  }
  // The exported PDF: the professional report design with the guide's callouts and
  // MathML formulas, printed by Chromium with JavaScript off (as htmlToPdf.ts does).
  const reportModule = await build({
    stdin: { contents: `export { completeGuideReportInput, completeGuideReviewSheetHtml } from './shared/completeGuide/reportInput'; export { renderProfessionalReportHtml } from './shared/professionalReport';`, resolveDir: repoRoot, loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  });
  const report = { exports: {} };
  new Function('module', 'exports', 'require', reportModule.outputFiles[0].text)(report, report.exports, (await import('node:module')).createRequire(import.meta.url));
  const sample = (await readFile(path.join(repoRoot, 'visual-tests/complete-guide-harness.tsx'), 'utf8')).match(/const SAMPLE = `([\s\S]*?)`;/)[1].replace(/\\\\/g, '\\');
  const draft = {
    title: 'Guía de estudio: Tema 1 · Gases', abstract: 'Los gases ideales, sus variables de estado y la ecuación que las relaciona.',
    generatedAt: '2026-09-28T10:00:00.000Z', draftMarkdown: `## Cómo usar esta guía\n\nCada capítulo corresponde a una unidad.\n\n${sample}\n\n## Ficha de repaso\n\n### Tema 1 · Gases\n\n- $PV = nRT$ (A1 · p. 2)`,
    brief: { kind: 'deep_research', objective: 'Guía', language: 'es' }, outline: [{ id: 't1' }], stats: { selectedWorks: 2 },
    completeGuide: { sources: [{}, {}], config: { instructions: '' }, cheatSheetMarkdown: '# Ficha de repaso\n\n### Tema 1 · Gases\n\n- $PV = nRT$ (A1 · p. 2)\n- $\\ce{2H2 + O2 -> 2H2O}$' },
  };
  const reportHtml = report.exports.renderProfessionalReportHtml(report.exports.completeGuideReportInput(draft));
  await writeFile(path.join(tmp, 'report.html'), reportHtml, 'utf8');
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 794, height: 1123 } });
  const printPage = await context.newPage();
  await printPage.goto(pathToFileURL(path.join(tmp, 'report.html')).href);
  assert.ok(await printPage.locator('math').count() >= 5, 'formulas are MathML in the printed document');
  assert.equal(await printPage.locator('aside.gc').count(), 4, 'the four callouts are cards in the printed document');
  const pdf = await printPage.pdf({ format: 'A4', printBackground: true });
  assert.ok(pdf.length > 20_000, 'a real PDF was printed');
  await printPage.locator('#part-2').screenshot({ path: path.join(shotDir, 'complete-guide-pdf-chapter.png') });
  await writeFile(path.join(tmp, 'sheet.html'), report.exports.completeGuideReviewSheetHtml(draft), 'utf8');
  await printPage.goto(pathToFileURL(path.join(tmp, 'sheet.html')).href);
  assert.ok((await printPage.pdf({ format: 'A4', printBackground: true })).length > 5_000, 'the review sheet prints on its own');
  await context.close();
  console.log(`[complete guide e2e] passed; screenshots in ${path.relative(repoRoot, shotDir)}`);
} finally {
  await browser?.close();
  await rm(tmp, { recursive: true, force: true });
}
