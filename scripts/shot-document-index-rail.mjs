// Screenshot the Documentary Index rail, from the real component and the real compiled
// stylesheets, without booting Electron or a vault.
//
// The point of the capture is the standalone-job fix: a per-work job has no campaign,
// so it used to have no row here at all and a retry looked like it was never enqueued.
// The harness seeds one failed standalone job (whose row now carries the retry icon
// button) and one queued one, and the third capture clicks the real retry button to
// show the same row flipping to queued.
//
// Output goes to $OUT (default /tmp).
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const OUT = process.env.OUT ?? '/tmp';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-document-rail-'));

// Vite resolves `import x from 'pkg/file?url'` to an asset URL. Nothing in these
// harnesses uses the worker it points at, so an empty string is the honest stub.
const viteUrlImports = {
  name: 'vite-url-imports',
  setup(builder) {
    builder.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: 'vite-url' }));
    builder.onLoad({ filter: /.*/, namespace: 'vite-url' }, () => ({ contents: 'export default "";', loader: 'js' }));
  },
};

execFileSync(path.join(repoRoot, 'node_modules/.bin/tailwindcss'),
  ['-i', 'src/index.css', '-o', path.join(tmp, 'app.css'), '--minify'],
  { cwd: repoRoot, stdio: 'inherit' });
const appCss = await readFile(path.join(tmp, 'app.css'), 'utf8');

const outfile = path.join(tmp, 'rail.js');
await build({
  entryPoints: [path.join(repoRoot, 'visual-tests/document-index-queue-harness.tsx')],
  outfile,
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@shared': path.join(repoRoot, 'shared') },
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl', '.ttf': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
  plugins: [viteUrlImports],
  logLevel: 'error',
});
const js = await readFile(outfile, 'utf8');
const page = path.join(tmp, 'rail.html');
await writeFile(page, `<!doctype html>
<html lang="es" class="dark"><head><meta charset="UTF-8" /><title>Document index rail</title>
<style>${appCss}</style><style>html, body { margin: 0; }</style>
</head><body><div id="root"></div><script type="module">${js}</script></body></html>`);

const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: CHROME });
const tab = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });

const theme = (mode) => tab.evaluate((value) => {
  document.documentElement.classList.toggle('light', value === 'light');
  document.documentElement.classList.toggle('dark', value === 'dark');
  document.body.style.background = value === 'light' ? '#e7eaf1' : '#08080b';
}, mode);

const openRail = async (mode) => {
  await tab.goto(`file://${page}`, { waitUntil: 'load' });
  await theme(mode);
  const bar = tab.locator('[data-testid="document-index-progress-bar"]');
  await bar.waitFor();
  await bar.locator('button.btn-ghost').first().click();
  await tab.waitForTimeout(500);
  // The failed row sorts last and the list is capped, so bring it into view.
  await tab.evaluate(() => {
    const list = document.querySelector('[data-testid="document-index-rail-list"]');
    if (list) list.scrollTop = list.scrollHeight;
  });
  await tab.waitForTimeout(300);
  return bar;
};

const shot = async (file) => {
  await tab.locator('[data-testid="document-index-progress-bar"]').screenshot({ path: path.join(OUT, file) });
  console.log('[shot]', path.join(OUT, file));
};

await openRail('dark');
// The failed standalone job must be visible with a retry control: before the fix its
// row did not exist at all, which is why a retry looked like it was never enqueued.
if (await tab.locator('[data-testid="document-index-rail-job-solo-failed"]').count() !== 1) {
  throw new Error('the failed standalone job has no rail row');
}
if (await tab.locator('[data-testid="document-index-rail-retry-solo-failed"]').count() !== 1) {
  throw new Error('the failed standalone job has no retry button');
}
await shot('indice-documental-cola-oscuro.png');

await openRail('light');
await shot('indice-documental-cola-claro.png');

// Click the real retry button on the failed standalone row: the backend stub resets it
// to queued and re-emits, exactly as `enqueueDocumentProfile` does.
await tab.locator('[data-testid="document-index-rail-retry-solo-failed"]').click();
await tab.waitForTimeout(600);
if (await tab.locator('[data-testid="document-index-rail-retry-solo-failed"]').count() !== 0) {
  throw new Error('the retry button survived the retry');
}
if (await tab.locator('[data-testid="document-index-rail-cancel-solo-failed"]').count() !== 1) {
  throw new Error('the retried job did not come back as a live queued row');
}
await shot('indice-documental-cola-reintentada.png');

await browser.close();
await rm(tmp, { recursive: true, force: true });
