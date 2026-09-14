// Capture the real PDF Presenter announcement and verify its one-time lifecycle.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createServer } from 'node:http';

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
    builder.onLoad({ filter: /TutorialVideos\.tsx$/ }, async (args) => ({
      contents: (await readFile(args.path, 'utf8')).replace(/import\.meta\.glob<string>\([^)]*\)/g, '{}'),
      loader: 'tsx',
    }));
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
    loader: { '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl', '.ttf': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
    plugins: [viteUrlImports],
    logLevel: 'error',
  });
  const [js, componentCss] = await Promise.all([
    readFile(outfile, 'utf8'),
    readFile(path.join(tmp, `${name}.css`), 'utf8').catch(() => ''),
  ]);
  const file = path.join(tmp, `${name}.html`);
  await writeFile(file, `<!doctype html>
<html lang="en" class="dark"><head><meta charset="UTF-8" /><title>${name}</title>
<style>${appCss}</style><style>${componentCss}</style><style>html, body { margin: 0; }</style>
</head><body><div id="root"></div><script type="module">${js}</script></body></html>`);
  return file;
}

const guidePage = await page('pdf-presenter-tutorial-harness.tsx', 'pdf-presenter');
const server = createServer(async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await readFile(guidePage)); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: CHROME });
const tab = await browser.newPage({ viewport: { width: 1100, height: 880 }, deviceScaleFactor: 2 });
const errors = [];
tab.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
await tab.goto(`${baseUrl}?lang=en`);
const modal = tab.getByTestId('pdf-presenter-tutorial-announcement');
await modal.waitFor();
if (!(await modal.locator('iframe').getAttribute('src')).includes('e2js_u-05OA')) throw new Error('Wrong tutorial');
await tab.waitForTimeout(3500);
await tab.screenshot({ path: path.join(OUT, 'pdf-presenter-tutorial-en.png') });
await tab.getByRole('button', { name: 'Close', exact: true }).click();
await tab.getByTestId('settled').waitFor({ state: 'attached' });
await tab.reload();
await tab.getByTestId('settled').waitFor({ state: 'attached' });
if (await modal.count()) throw new Error('Announcement repeated after reload');
for (const lang of ['es','en','fr','tr','de','it','pt','pt-BR','zh','ja','ru','uk']) {
  await tab.evaluate(() => localStorage.clear());
  await tab.goto(`${baseUrl}?lang=${lang}`);
  await modal.waitFor();
  if ((await modal.innerText()).includes('undefined')) throw new Error(`Missing copy: ${lang}`);
}
await tab.setViewportSize({ width: 390, height: 844 });
await tab.evaluate(() => { localStorage.clear(); });
await tab.goto(`${baseUrl}?lang=en`);
await modal.waitFor();
const size = await modal.evaluate(el => ({ scroll: el.scrollWidth, width: el.clientWidth }));
if (size.scroll > size.width) throw new Error('Horizontal overflow on mobile');
if (errors.length) throw new Error(errors.join('\n'));
console.log('PASS: embedded video, dismissal persistence, 12 languages, mobile width.');
console.log(path.join(OUT, 'pdf-presenter-tutorial-en.png'));
await browser.close();
server.close();
await rm(tmp, { recursive: true, force: true });
