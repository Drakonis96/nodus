// Markdown → Word, the converter every `.docx` export shares.
//
// The report exporters hand it Markdown whose figures travel as separate assets, so
// what is pinned here is: the text keeps its structure, every `nodus://` citation
// lands in the bibliography (not only the academic kinds), and a figure is embedded
// as an image when the caller can resolve it — while a caller that cannot still gets
// exactly the literal text it always produced.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const tmp = await mkdtemp(path.join(root, 'node_modules', '.nodus-markdown-docx-'));
test.after(async () => { await rm(tmp, { recursive: true, force: true }); });

let stubCount = 0;
const virtual = (filter, contents) => {
  const namespace = `stub-${(stubCount += 1)}`;
  return {
    name: namespace,
    setup(builder) {
      builder.onResolve({ filter }, (args) => ({ path: args.path, namespace }));
      builder.onLoad({ filter: /.*/, namespace }, () => ({ contents, loader: 'js' }));
    },
  };
};

const outfile = path.join(tmp, 'markdownDocx.mjs');
await build({
  entryPoints: [path.join(root, 'electron/export/markdownDocx.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  alias: { '@shared': path.join(root, 'shared') },
  // The converter never prints, but the shared Markdown module it reads citations
  // from imports the Chromium printer at module scope.
  plugins: [virtual(/^electron$/, 'export class BrowserWindow {}')],
  logLevel: 'silent',
});
const { markdownToDocx, pngSize } = await import(pathToFileURL(outfile).href);

/** A 2×2 PNG, small enough to inline and real enough for Word to accept. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEYBxVSF8FANHkAwHsoxvFAAAAAElFTkSuQmCC',
  'base64',
);

const documentXml = (bytes) => new AdmZip(bytes).readAsText('word/document.xml');
const mediaEntries = (bytes) => new AdmZip(bytes)
  .getEntries()
  .filter((entry) => !entry.isDirectory && entry.entryName.startsWith('word/media/'))
  .map((entry) => entry.entryName);
const plainText = (xml) => xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');

test('the document keeps its headings, bullets and paragraphs', async () => {
  const bytes = await markdownToDocx('# Informe\n\n## Sección\n\nUna frase con [una idea](nodus://idea/g-1).\n\n- Primer punto\n- Segundo punto\n');
  const xml = documentXml(bytes);
  const text = plainText(xml);
  assert.match(text, /Informe/);
  assert.match(text, /Sección/);
  assert.match(text, /Una frase con una idea\./, 'the citation keeps its label, not its url');
  assert.match(text, /Primer punto/);
  assert.match(text, /Segundo punto/);
  assert.match(xml, /w:pStyle w:val="Heading1"/, 'the title is a real heading');
});

test('every nodus citation reaches the bibliography, study links included', async () => {
  const bytes = await markdownToDocx(
    'Cita [una idea](nodus://idea/g-1), [otra vez](nodus://idea/g-1) y un material [Diapositivas](nodus://study/material/mat-9).',
  );
  const text = plainText(documentXml(bytes));
  assert.match(text, /Bibliografia Nodus/);
  assert.match(text, /una idea - nodus:\/\/idea\/g-1/);
  assert.match(text, /Diapositivas - nodus:\/\/study\/material\/mat-9/, 'a study citation is a source too');
  assert.equal(text.match(/nodus:\/\/idea\/g-1/g).length, 1, 'a repeated citation is listed once');
});

test('a resolvable figure is embedded, and never left as markup', async () => {
  const bytes = await markdownToDocx('Antes.\n\n![Una figura](informe-assets/figure-f1.png)\n\n*Una figura*\n\nDespués.', {
    resolveImage: (url) => (url.endsWith('figure-f1.png') ? { data: PNG, ...pngSize(PNG) } : null),
  });
  const zip = new AdmZip(bytes);
  const media = mediaEntries(bytes);
  assert.equal(media.length, 1, `expected one embedded image, got ${media.join(', ')}`);
  assert.equal(zip.readFile(media[0]).toString('base64'), PNG.toString('base64'), 'the figure bytes are the ones handed in');
  // Word only opens a document whose package declares it and whose parts are linked.
  assert.match(zip.readAsText('[Content_Types].xml'), /wordprocessingml\.document\.main\+xml/);
  assert.match(zip.readAsText('word/_rels/document.xml.rels'), new RegExp(`Target="media/${path.basename(media[0])}"`), 'the image is linked from the document, not orphaned');
  const text = plainText(documentXml(bytes));
  assert.doesNotMatch(text, /!\[/, 'no markdown image markup survives');
  assert.doesNotMatch(text, /figure-f1\.png/, 'nor the asset path');
  assert.match(text, /Antes\./);
  assert.match(text, /Después\./);
});

test('a figure wider than the page is scaled down, keeping its proportions', async () => {
  const wide = Buffer.from(PNG);
  wide.writeUInt32BE(1200, 16);
  wide.writeUInt32BE(600, 20);
  assert.deepEqual(pngSize(wide), { width: 1200, height: 600 });
  const bytes = await markdownToDocx('![Ancha](a/f.png)', { resolveImage: () => ({ data: wide, ...pngSize(wide) }) });
  const xml = documentXml(bytes);
  const extent = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml);
  assert.ok(extent, 'the drawing declares its size');
  const [width, height] = [Number(extent[1]), Number(extent[2])];
  // 600px at 96 dpi = 5715000 EMU.
  assert.equal(width, 5715000, `expected the width capped at 600px, got ${width}`);
  assert.equal(height, Math.round(width / 2), 'the 2:1 shape is preserved');
});

test('an image the caller cannot resolve falls back to its caption, not to markup', async () => {
  const bytes = await markdownToDocx('![Una figura ausente](a/missing.png)', { resolveImage: () => null });
  const text = plainText(documentXml(bytes));
  assert.match(text, /Una figura ausente/);
  assert.doesNotMatch(text, /missing\.png/);
  assert.equal(mediaEntries(bytes).length, 0);
});

test('a caller without a resolver keeps the text it always produced', async () => {
  const line = '![Una figura](informe-assets/figure-f1.png)';
  const text = plainText(documentXml(await markdownToDocx(line)));
  assert.match(text, /!\[Una figura\]\(informe-assets\/figure-f1\.png\)/);
  assert.equal(mediaEntries(await markdownToDocx(line)).length, 0);
});

test('pngSize reads a real PNG and refuses anything else', () => {
  assert.deepEqual(pngSize(PNG), { width: 2, height: 2 });
  assert.equal(pngSize(Buffer.from('no soy un png')), null);
  assert.equal(pngSize(Buffer.alloc(0)), null);
});
