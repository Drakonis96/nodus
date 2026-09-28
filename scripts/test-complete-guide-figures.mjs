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
