// Scheme blocks of a PDF from the declutter layout classifier: per page, clusters of scheme text
// items with their box in PDF points (origin bottom-left). Prints JSON lines, one per page:
//   node blocks.mjs <file.pdf> [firstPage] [lastPage]
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(repo, 'package.json'));
const tmp = await mkdtemp(path.join(os.tmpdir(), 'scheme-blocks-'));
const bundle = path.join(tmp, 'schemeLayout.mjs');
await build({ entryPoints: [path.join(repo, 'electron/extraction/schemeLayout.ts')], outfile: bundle, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { pageSchemeLayout, typeSizeWeights, bodySizeOf } = await import(pathToFileURL(bundle).href);
const pdfjs = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));

const [file, from, to] = process.argv.slice(2);
const doc = await pdfjs.getDocument({ url: file, verbosity: 0 }).promise;
const weights = new Map();
for (let k = 0; k < 40; k++) {
  const page = await doc.getPage(1 + Math.floor(k * (doc.numPages - 1) / 39));
  typeSizeWeights((await page.getTextContent()).items.filter((i) => typeof i.str === 'string'), weights);
}
const body = bodySizeOf(weights) || 10;
const last = Math.min(+(to ?? doc.numPages), doc.numPages);
for (let p = +(from ?? 1); p <= last; p++) {
  const page = await doc.getPage(p);
  const items = (await page.getTextContent()).items.filter((i) => typeof i.str === 'string' && Array.isArray(i.transform));
  const layout = pageSchemeLayout(items, body);
  const boxes = items.map((i, k) => (layout.scheme[k] && i.str.trim()
    ? { x0: i.transform[4], y0: i.transform[5] - 2, x1: i.transform[4] + i.width, y1: i.transform[5] + Math.abs(i.transform[3] || i.height || body), n: 1 } : null)).filter(Boolean);
  const gap = body * 3;
  const near = (a, b) => a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 && a.y0 - gap <= b.y1 && b.y0 - gap <= a.y1;
  const clusters = [];
  for (const box of boxes) {
    const hit = clusters.filter((c) => near(c, box));
    const merged = [box, ...hit].reduce((m, b) => ({ x0: Math.min(m.x0, b.x0), y0: Math.min(m.y0, b.y0), x1: Math.max(m.x1, b.x1), y1: Math.max(m.y1, b.y1), n: m.n + b.n }));
    for (const c of hit) clusters.splice(clusters.indexOf(c), 1);
    clusters.push(merged);
  }
  const view = page.getViewport({ scale: 1 });
  const textChars = items.reduce((sum, i) => sum + i.str.length, 0);
  process.stdout.write(JSON.stringify({ page: p, width: view.width, height: view.height, body, textChars, blocks: clusters.filter((c) => c.n >= 4) }) + '\n');
  page.cleanup?.();
}
await rm(tmp, { recursive: true, force: true });
