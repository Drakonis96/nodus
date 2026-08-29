// Screenshot the Library guide and the header that reopens it — from the real
// components and the real compiled stylesheets, without booting Electron or a vault.
//
// Two stylesheets go into the page and both matter: Tailwind's build of src/index.css,
// and the plain CSS the components import themselves (nodi.css, nodiOrb.css…). Leaving
// the second one out is what once drew Nodi's orb as a black disc here.
//
// Each page is assembled as ONE self-contained file, bundle and CSS inlined, because
// Chrome refuses module scripts loaded over file:// — and a static page needs no server.
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

const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-guide-'));

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

/** Bundle one harness and write it out as a single self-contained HTML file. */
async function page(entry, name) {
  const outfile = path.join(tmp, `${name}.js`);
  await build({
    entryPoints: [path.join(repoRoot, 'visual-tests', entry)],
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
  const [js, componentCss] = await Promise.all([
    readFile(outfile, 'utf8'),
    readFile(path.join(tmp, `${name}.css`), 'utf8').catch(() => ''),
  ]);
  const file = path.join(tmp, `${name}.html`);
  await writeFile(file, `<!doctype html>
<html lang="es" class="dark"><head><meta charset="UTF-8" /><title>${name}</title>
<style>${appCss}</style><style>${componentCss}</style><style>html, body { margin: 0; }</style>
</head><body><div id="root"></div><script type="module">${js}</script></body></html>`);
  return file;
}

const guidePage = await page('library-tutorial-harness.tsx', 'guide');
const headerPage = await page('library-header-harness.tsx', 'header');

const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: CHROME });
const tab = await browser.newPage({ viewport: { width: 1320, height: 1040 }, deviceScaleFactor: 2 });

const theme = (mode) => tab.evaluate((value) => {
  document.documentElement.classList.toggle('light', value === 'light');
  document.documentElement.classList.toggle('dark', value === 'dark');
  document.body.style.background = value === 'light' ? '#e7eaf1' : '#08080b';
}, mode);

const guide = async (which, mode, file, { scrollToEnd = false, nodi = 'classic' } = {}) => {
  await tab.goto(`file://${guidePage}?tab=${which}&nodi=${nodi}`, { waitUntil: 'load' });
  await theme(mode);
  await tab.locator('[data-testid="library-tutorial-modal"]').waitFor();
  // framer-motion fades the shell in; wait for it to settle before capturing.
  await tab.waitForFunction(() => getComputedStyle(document.querySelector('.toolkit-guide-backdrop')).opacity === '1');
  await tab.waitForTimeout(600);
  if (scrollToEnd) {
    await tab.evaluate(() => { const stage = document.querySelector('.toolkit-guide-stage'); stage.scrollTop = stage.scrollHeight; });
    await tab.waitForTimeout(400);
  }
  await tab.screenshot({ path: path.join(OUT, file) });
  console.log('[shot]', path.join(OUT, file));
};

/** The header row, cropped to itself: the «?» has to be findable among the others. */
const header = async (vaultType, mode, file) => {
  await tab.goto(`file://${headerPage}?vault=${vaultType}&guide=0`, { waitUntil: 'load' });
  await theme(mode);
  const bar = tab.locator('[data-testid="library-vault-header"]');
  await bar.waitFor();
  await tab.locator('[data-testid="library-open-tutorial"]').waitFor();
  await tab.waitForTimeout(400);
  await bar.screenshot({ path: path.join(OUT, file) });
  console.log('[shot]', path.join(OUT, file));
};

await guide('analysis', 'dark', 'guia-biblioteca-1-este-vault.png');
await guide('manager', 'dark', 'guia-biblioteca-2-global.png');
await guide('analysis', 'dark', 'guia-biblioteca-3-este-vault-final.png', { scrollToEnd: true });
await guide('analysis', 'light', 'guia-biblioteca-4-modo-claro.png');
// Both Nodi styles: the orb's colour layers live in nodiOrb.css, so this capture is
// also the check that the component stylesheets really made it into the page.
await guide('analysis', 'dark', 'guia-biblioteca-8-nodi-orbe.png', { nodi: 'orb' });
await header('academic', 'dark', 'guia-biblioteca-5-cabecera-academic.png');
await header('genealogy', 'dark', 'guia-biblioteca-6-cabecera-genealogy.png');
await header('academic', 'light', 'guia-biblioteca-7-cabecera-claro.png');

await browser.close();
await rm(tmp, { recursive: true, force: true });
