/** Render pages of a complete study guide PDF to PNG, to look at them.
 *
 *   node scripts/render-complete-guide-pages.mjs <guide.pdf> <out-dir> [pages] [--scale=1.4]
 *
 * `pages` is a list such as `1,3,10-12`; without it every page is rendered. Also prints, per
 * page, the first line of text so the pages of a chapter can be found without opening them.
 * pdfjs (legacy build, no DOM) and @napi-rs/canvas are the repository's own dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createCanvas } from '@napi-rs/canvas';

const require_ = createRequire(import.meta.url);
const args = process.argv.slice(2).filter((value) => !value.startsWith('--'));
const scale = Number(process.argv.find((value) => value.startsWith('--scale='))?.slice(8) ?? 1.4);
const [pdfFile, outDir, pageList] = args;
if (!pdfFile || !outDir) {
  console.error('Usage: node scripts/render-complete-guide-pages.mjs <guide.pdf> <out-dir> [pages] [--scale=1.4]');
  process.exit(2);
}

const pdfjs = await import(pathToFileURL(require_.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const root = path.dirname(require_.resolve('pdfjs-dist/package.json'));
const document = await pdfjs.getDocument({
  data: new Uint8Array(fs.readFileSync(pdfFile)),
  standardFontDataUrl: pathToFileURL(path.join(root, 'standard_fonts') + path.sep).href,
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
}).promise;

const wanted = new Set();
for (const part of (pageList ?? `1-${document.numPages}`).split(',')) {
  const [from, to] = part.split('-').map(Number);
  for (let page = from; page <= (to || from); page += 1) if (page >= 1 && page <= document.numPages) wanted.add(page);
}

fs.mkdirSync(outDir, { recursive: true });
console.log(`${pdfFile}: ${document.numPages} pages`);
for (const number of [...wanted].sort((a, b) => a - b)) {
  const page = await document.getPage(number);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const file = path.join(outDir, `page-${String(number).padStart(3, '0')}.png`);
  fs.writeFileSync(file, canvas.toBuffer('image/png'));
  const text = (await page.getTextContent()).items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim();
  console.log(`  ${String(number).padStart(3)}  ${file}  ${text.slice(0, 90)}`);
  page.cleanup();
}
await document.destroy();
