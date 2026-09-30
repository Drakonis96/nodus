// Complete study guide figures: selection from anchored figure items (no vision),
// block placement, slide pictures without template art, and real PDF crops.
import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const electronStub = { app: { getPath: () => '/tmp', isPackaged: false, getAppPath: () => process.cwd() }, BrowserWindow: class {}, ipcMain: { handle() {}, on() {} } };
async function load(entry) {
  const built = await build({
    entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', tsconfig: 'electron/tsconfig.json', logLevel: 'error',
    external: ['electron', 'better-sqlite3', '@napi-rs/canvas', 'pdfjs-dist', 'sharp', 'tesseract.js', 'canvas', 'adm-zip'],
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', '__filename', built.outputFiles[0].text)(module, module.exports, (id) => (id === 'electron' ? electronStub : require_(id)), `${process.cwd()}/electron/ai/x.js`);
  return module.exports;
}
const { selectFigureRequests, figureBlockId } = await load('shared/completeGuide/figures.ts');
const { pptxSlidePictures } = await load('electron/ai/completeGuide/figures.ts');
const { extractPdfPageFigures } = await load('electron/library/libraryExtractionEngine.ts');

async function noisyPng(width, height, seed = 1) {
  const pixels = Buffer.alloc(width * height * 3);
  let value = seed;
  for (let index = 0; index < pixels.length; index += 1) { value = (value * 1103515245 + 12345) & 0x7fffffff; pixels[index] = value % 256; }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

const item = (id, overrides = {}) => ({ id, type: 'figure', title: `Figura ${id}`, statement: 'Diagrama de fases.', importance: 'core', unitKey: 'topic:1', order: Number(id.slice(1)), evidence: [{ passageId: 'A1.1', sourceKey: 'material:m' }], ...overrides });

test('figures are chosen from anchored figure items, one per page, capped per chapter and in total', () => {
  const passages = new Map([
    ['A1.1', { id: 'A1.1', sourceKey: 'material:m', locator: { kind: 'page', page: 3, from: 0, to: 1 } }],
    ['A1.2', { id: 'A1.2', sourceKey: 'material:m', locator: { kind: 'page', page: 4, from: 0, to: 1 } }],
    ['A2.1', { id: 'A2.1', sourceKey: 'material:s', locator: { kind: 'slide', slide: 2, from: 0, to: 1 } }],
    ['D1.1', { id: 'D1.1', sourceKey: 'document:d', locator: { kind: 'offset', from: 0, to: 1 } }],
  ]);
  const sources = new Map([
    ['material:m', { sourceKey: 'material:m', kind: 'material', sourceId: 'm', alias: 'A1' }],
    ['material:s', { sourceKey: 'material:s', kind: 'material', sourceId: 's', alias: 'A2' }],
    ['document:d', { sourceKey: 'document:d', kind: 'document', sourceId: 'd', alias: 'D1' }],
  ]);
  const items = [
    item('K0001'),
    item('K0002'), // same page as K0001: skipped
    item('K0003', { evidence: [{ passageId: 'A1.2', sourceKey: 'material:m' }] }),
    item('K0004', { evidence: [{ passageId: 'A2.1', sourceKey: 'material:s' }] }),
    item('K0005', { evidence: [{ passageId: 'D1.1', sourceKey: 'document:d' }] }), // notes have no images
    item('K0006', { importance: 'detail', evidence: [{ passageId: 'A2.1', sourceKey: 'material:s' }] }),
    item('K0007', { type: 'definition' }),
  ];
  const requests = selectFigureRequests(items, passages, sources, { perChapter: 2, total: 10 });
  assert.deepEqual(requests.map((request) => [request.itemId, request.page, request.slide]), [['K0001', 3, null], ['K0003', 4, null]]);
  assert.equal(requests[0].source, 'nodus://study/material/m?page=3&e=K0001');
  const wider = selectFigureRequests(items, passages, sources, { perChapter: 5, total: 10 });
  assert.deepEqual(wider.map((request) => request.itemId), ['K0001', 'K0003', 'K0004']);
  assert.equal(selectFigureRequests(items, passages, sources, { perChapter: 5, total: 1 }).length, 1);
});

test('a figure goes after the block citing its item, else a block citing a sibling, never a heading', () => {
  const blocks = [
    { id: 'body:0', markdown: '### Fases' },
    { id: 'body:1', markdown: 'Texto ([A1 · p. 3](nodus://study/material/m?page=3&e=K0002))' },
    { id: 'body:2', markdown: 'Otro ([A1 · p. 3](nodus://study/material/m?page=3&e=K0010))' },
  ];
  assert.equal(figureBlockId(blocks, 'K0010'), 'body:2');
  assert.equal(figureBlockId(blocks, 'K0001', ['K0002']), 'body:1');
  assert.equal(figureBlockId(blocks, 'K0001'), null);
  assert.equal(figureBlockId(blocks, 'K001'), null, 'item ids never match by prefix');
});

test('slide pictures: the biggest picture of each slide, never the template art repeated on every slide', async () => {
  const zip = new AdmZip();
  const logo = await noisyPng(60, 60, 9);
  const diagram = await noisyPng(320, 200, 3);
  const photo = await noisyPng(200, 120, 5);
  for (let slide = 1; slide <= 4; slide += 1) {
    const pictures = [`<p:pic><p:blipFill><a:blip r:embed="rIdLogo"/></p:blipFill></p:pic>`];
    if (slide === 2) pictures.push(`<p:pic><a:blip r:embed="rId2"/></p:pic>`, `<p:pic><a:blip r:embed="rId3"/></p:pic>`);
    zip.addFile(`ppt/slides/slide${slide}.xml`, Buffer.from(`<p:sld><p:cSld><p:spTree>${pictures.join('')}</p:spTree></p:cSld></p:sld>`));
    zip.addFile(`ppt/slides/_rels/slide${slide}.xml.rels`, Buffer.from(`<Relationships><Relationship Id="rIdLogo" Target="../media/logo.png"/><Relationship Id="rId2" Target="../media/diagram.png"/><Relationship Id="rId3" Target="../media/photo.png"/></Relationships>`));
  }
  zip.addFile('ppt/media/logo.png', logo);
  zip.addFile('ppt/media/diagram.png', diagram);
  zip.addFile('ppt/media/photo.png', photo);
  const pictures = pptxSlidePictures(zip.toBuffer(), [1, 2, 3]);
  assert.deepEqual(pictures.map((picture) => picture.slide), [2], 'slides with only the logo yield nothing');
  assert.ok(pictures[0].data.equals(diagram), 'the biggest picture on the slide');
});

test('PDF pages: placed images are cropped; vector-only pages fall back to the whole page', async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const image = await pdf.embedPng(await noisyPng(300, 200, 7));
  const first = pdf.addPage([595, 842]);
  first.drawText('Figura 1. Diagrama de fases', { x: 60, y: 520, size: 12, font });
  first.drawImage(image, { x: 60, y: 540, width: 300, height: 200 });
  const second = pdf.addPage([595, 842]);
  second.drawText('Solo texto y una linea', { x: 60, y: 700, size: 12, font });
  second.drawLine({ start: { x: 60, y: 600 }, end: { x: 400, y: 600 } });
  const bytes = new Uint8Array(await pdf.save());
  const crops = await extractPdfPageFigures(bytes, [1, 2, 9], { wholePageFallback: true });
  assert.deepEqual(crops.map((crop) => [crop.page, crop.wholePage]), [[1, false], [2, true]], 'out-of-range pages are ignored');
  const crop = crops[0];
  assert.ok(Math.abs(crop.width - 600) <= 4 && Math.abs(crop.height - 400) <= 4, `2× crop of the placed image (${crop.width}×${crop.height})`);
  assert.equal(crop.png.subarray(1, 4).toString(), 'PNG');
  assert.ok(crops[1].width > 1000, 'whole page rendered at 2×');
  assert.deepEqual(await extractPdfPageFigures(bytes, [2]), [], 'no fallback, no figure');
});

const webImagesShared = await load('shared/completeGuide/webImages.ts');
const { findCompleteGuideWebImages } = await load('electron/ai/completeGuide/webImages.ts');

test('web images: only core concepts without a material figure, one per chapter, capped', () => {
  const items = [
    item('K0001', { type: 'concept', title: 'Diagrama de fases', unitKey: 'topic:1' }),
    item('K0002', { type: 'figure', title: 'Curva de calentamiento', unitKey: 'topic:1' }),
    item('K0003', { type: 'formula', title: 'Ley de Boyle', unitKey: 'topic:2' }),
    item('K0004', { type: 'definition', title: 'Ácido de Brønsted', unitKey: 'topic:2', importance: 'support' }),
    item('K0005', { type: 'definition', title: 'Base (química)', unitKey: 'topic:2' }),
    item('K0006', { type: 'concept', title: 'Gas ideal', unitKey: 'topic:3' }),
  ];
  const requests = webImagesShared.selectWebImageRequests(items, ['topic:1', 'topic:2', 'topic:3'], new Set(['K0006']));
  assert.deepEqual(requests.map((request) => [request.unitKey, request.itemId, request.query]), [['topic:1', 'K0002', 'Curva de calentamiento'], ['topic:2', 'K0005', 'Base química']],
    'figure items first; formulas and support items skipped; an illustrated chapter gets nothing');
  assert.equal(webImagesShared.selectWebImageRequests(items, ['topic:1', 'topic:2'], new Set(), { perChapter: 1, total: 1 }).length, 1);
});

test('web images: licences, relevance and Commons file titles are checked from data', () => {
  const { freeImageLicense, imageMatchesQuery, commonsFileTitle, webImageCaption } = webImagesShared;
  for (const ok of ['CC BY-SA 4.0', 'CC BY 2.0', 'CC0', 'Public domain', 'PD-US', 'cc-by-sa-3.0']) assert.ok(freeImageLicense(ok), ok);
  for (const bad of ['CC BY-NC 2.0', 'CC BY-ND 4.0', 'Fair use', 'All rights reserved', '', 'GFDL']) assert.ok(!freeImageLicense(bad), bad);
  assert.ok(imageMatchesQuery('Diagrama de fases', ['Phase diagram of water', 'Diagrama de fases del agua']));
  assert.ok(!imageMatchesQuery('Diagrama de fases', ['Portrait of a cat']));
  assert.equal(commonsFileTitle('https://commons.wikimedia.org/wiki/File:Phase_diagram_of_water.svg'), 'File:Phase diagram of water.svg');
  assert.equal(commonsFileTitle('https://evil.test/wiki/File:x.png'), null);
  assert.equal(webImageCaption('Diagrama de fases', { title: 'Phase diagram of water', author: 'Cmglee', license: 'CC BY-SA 3.0', url: 'https://commons.wikimedia.org/wiki/File:X', site: 'Wikimedia Commons' }),
    'Diagrama de fases — Phase diagram of water, Cmglee · CC BY-SA 3.0 · Wikimedia Commons');
});

test('web images: Commons results with a confirmed free licence are downloaded as raster and attributed', async () => {
  const png = await noisyPng(400, 300, 11);
  const fetched = [];
  const commons = (name) => `https://commons.wikimedia.org/wiki/File:${name}`;
  const metadata = {
    'File:Fases.svg': { LicenseShortName: 'CC BY-SA 4.0', Artist: '<a href="//x">Ana <b>Pérez</b></a>', ObjectName: 'Diagrama de fases del agua' },
    'File:Nc.png': { LicenseShortName: 'CC BY-NC 2.0', Artist: 'X', ObjectName: 'Diagrama de fases' },
    'File:Gato.png': { LicenseShortName: 'CC0', Artist: 'Y', ObjectName: 'Retrato de gato' },
  };
  const deps = {
    search: async (query) => [
      { url: 'https://example.org/fases.png', title: 'Diagrama de fases', content: '', engines: ['bing images'] },
      { url: commons('Nc.png'), title: 'Diagrama de fases', content: '', engines: ['wikicommons.images'] },
      { url: commons('Gato.png'), title: 'Gato', content: '', engines: ['wikicommons.images'] },
      { url: commons('Fases.svg'), title: query, content: '', engines: ['wikicommons.images'] },
    ],
    fetchJson: async (url) => {
      const title = new URL(url).searchParams.get('titles');
      const meta = metadata[title];
      return { query: { pages: [{ imageinfo: [{ url: `https://upload.wikimedia.org/${title}`, mime: title.endsWith('.svg') ? 'image/svg+xml' : 'image/png', thumburl: `https://upload.wikimedia.org/thumb/${title}.png`, thumbmime: 'image/png', descriptionurl: commons(title.slice(5)),
        extmetadata: Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, { value }])) }] }] } };
    },
    fetchImage: async (url) => { fetched.push(url); return { bytes: png, contentType: 'image/png' }; },
  };
  const figures = await findCompleteGuideWebImages([{ itemId: 'K0001', unitKey: 'topic:1', query: 'Diagrama de fases', caption: 'Diagrama de fases' }], 'es', undefined, deps);
  assert.equal(figures.length, 1);
  assert.deepEqual(fetched, ['https://upload.wikimedia.org/thumb/File:Fases.svg.png'], 'the NC file and the off-topic file are never downloaded; SVG arrives rasterized');
  const [figure] = figures;
  assert.deepEqual(figure.attribution, { title: 'Diagrama de fases del agua', author: 'Ana Pérez', license: 'CC BY-SA 4.0', url: commons('Fases.svg'), site: 'Wikimedia Commons' });
  assert.equal(figure.caption, 'Diagrama de fases — Diagrama de fases del agua, Ana Pérez · CC BY-SA 4.0 · Wikimedia Commons');
  assert.equal(figure.source, commons('Fases.svg'));
  assert.equal(Buffer.from(figure.png, 'base64').subarray(1, 4).toString(), 'PNG');

  const svg = await findCompleteGuideWebImages([{ itemId: 'K0001', unitKey: 'topic:1', query: 'Diagrama de fases', caption: 'x' }], 'es', undefined, { ...deps, fetchImage: async () => ({ bytes: Buffer.from('<svg/>'), contentType: 'image/svg+xml' }) });
  assert.equal(svg.length, 0, 'a non-raster response is refused');
  const down = await findCompleteGuideWebImages([{ itemId: 'K0001', unitKey: 'topic:1', query: 'Diagrama de fases', caption: 'x' }], 'es', undefined, { ...deps, search: async () => { throw new Error('searxng down'); } });
  assert.equal(down.length, 0, 'search failures skip the request');
});
