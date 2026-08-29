import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildDocx, buildEpub, buildScannedPdf, buildTextPdf } from './toolkit-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bundleDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-translate-tests-'));
const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-translate-fx-'));

function bundle(file, name, external = []) {
  const out = path.join(bundleDir, `${name}.cjs`);
  execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
    path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    ...external.map((value) => `--external:${value}`),
    `--outfile=${out}`,
  ], { cwd: repoRoot, stdio: 'inherit' });
  return require(out);
}

const segmentsModule = bundle('electron/toolkit/translate/segments.ts', 'segments');
const documentsModule = bundle('electron/toolkit/translate/documents.ts', 'documents', ['adm-zip']);
const facsimileModule = bundle('electron/toolkit/translate/facsimile.ts', 'facsimile', ['pdfjs-dist', '@napi-rs/canvas', 'pdf-lib']);
const historyModule = bundle('electron/toolkit/translate/history.ts', 'history', ['electron']);
const markdownModule = bundle('shared/toolkitMarkdown.ts', 'markdown');
const AdmZip = require('adm-zip');

test.after(async () => {
  await rm(bundleDir, { recursive: true, force: true });
  await rm(fixtureDir, { recursive: true, force: true });
});

function translateWords(value) {
  return value
    .replace(/Titulo Principal/g, 'Main Title')
    .replace(/Texto normal/g, 'Normal text')
    .replace(/en negrita/g, 'in bold')
    .replace(/incluida/g, 'included')
    .replace(/Primer elemento/g, 'First item')
    .replace(/Segundo elemento/g, 'Second item')
    .replace(/Celda/g, 'Cell')
    .replace(/Capitulo Primero/g, 'First Chapter')
    .replace(/Capitulo Segundo/g, 'Second Chapter')
    .replace(/El comienzo de la historia narrada aqui/g, 'The beginning of the story told here')
    .replace(/La continuacion despues del primero/g, 'The continuation after the first')
    .replace(/Introduccion General/g, 'General Introduction')
    .replace(/El rapido zorro marron salta sobre el perro perezoso/g, 'The quick brown fox jumps over the lazy dog')
    .replace(/La investigacion cualitativa requiere rigor documental/g, 'Qualitative research requires documentary rigor')
    .replace(/Los hallazgos confirman la hipotesis inicial del estudio/g, 'The findings confirm the initial study hypothesis')
    .replace(/Encabezado de prueba/g, 'Test Header')
    .replace(/Pie de prueba/g, 'Test Footer')
    .replace(/Nota al pie de prueba/g, 'Test footnote');
}

const adapterTranslate = async (segments) => segments.map((segment) => ({ ...segment, translated: translateWords(segment.text) }));

test('segment protocol retries a missing id and never loses content', async () => {
  let calls = 0;
  const input = [
    { id: 'one', text: 'Titulo Principal', kind: 'plain' },
    { id: 'two', text: 'Texto normal', kind: 'plain' },
  ];
  const output = await segmentsModule.translateSegments(input, { targetLanguage: 'English', maxChars: 10_000 }, async ({ user }) => {
    calls += 1;
    const translated = translateWords(user);
    if (calls === 1) return translated.replace(/<<<NODUS_SEGMENT:two>>>[\s\S]*?<<<NODUS_END:two>>>/, '');
    return translated;
  });
  assert.equal(output[0].translated, 'Main Title');
  assert.equal(output[1].translated, 'Normal text');
  assert.equal(calls, 2, 'one malformed batch plus one isolated retry');
});

test('HTML translation preserves scripts, URLs and inline markup', async () => {
  const script = '<script>const titulo = "Titulo Principal";</script>';
  const html = `<!doctype html><html><head>${script}</head><body><h1>Titulo Principal</h1><p>Texto normal con <strong>en negrita</strong>.</p><a href="https://example.com/Titulo">Texto normal</a></body></html>`;
  const translated = await documentsModule.translateHtmlDocument(html, { translate: adapterTranslate });
  assert.match(translated, /<h1>Main Title<\/h1>/);
  assert.match(translated, /<strong>in bold<\/strong>/);
  assert.ok(translated.includes(script), 'script payload remains byte-identical');
  assert.match(translated, /href="https:\/\/example\.com\/Titulo"/, 'URL is unchanged');
});

test('Markdown translation restores list numbering changed by a model', async () => {
  const source = '1. First item\n\n2. Second item\n\n3. Third item';
  const translated = await documentsModule.translateMarkdownDocument(source, {
    translate: async (segments) => segments.map((segment) => ({
      ...segment,
      translated: `1. ${segment.text.replace(/^\d+\.\s*/, '')} traduit`,
    })),
  });
  assert.equal(translated, '1. First item traduit\n\n2. Second item traduit\n\n3. Third item traduit');
});

test('Markdown rendering preserves the start of separated ordered-list items', () => {
  const html = markdownModule.markdownToHtml('1. First\n\n2. Second\n\n3. Third');
  assert.match(html, /<ol><li>First<\/li><\/ol>/);
  assert.match(html, /<ol start="2"><li>Second<\/li><\/ol>/);
  assert.match(html, /<ol start="3"><li>Third<\/li><\/ol>/);
});

test('DOCX translation keeps styles, bold runs, media, headers, footers and footnotes', async () => {
  const source = await buildDocx(fixtureDir, 'structured.docx');
  const zip = new AdmZip(source);
  zip.addFile('word/header1.xml', Buffer.from('<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Encabezado de prueba</w:t></w:r></w:p></w:hdr>'));
  zip.addFile('word/footer1.xml', Buffer.from('<?xml version="1.0"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Pie de prueba</w:t></w:r></w:p></w:ftr>'));
  zip.addFile('word/footnotes.xml', Buffer.from('<?xml version="1.0"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>Nota al pie de prueba</w:t></w:r></w:p></w:footnote></w:footnotes>'));
  const media = Buffer.from([1, 4, 9, 16, 25, 36]);
  zip.addFile('word/media/image1.png', media);
  const translatedBytes = await documentsModule.translateDocxBytes(zip.toBuffer(), { translate: adapterTranslate });
  const out = new AdmZip(Buffer.from(translatedBytes));
  const documentXml = out.readAsText('word/document.xml');
  assert.match(documentXml, /Main Title/);
  assert.match(documentXml, /w:pStyle w:val="Heading1"/, 'heading style stays real');
  assert.match(documentXml, /<w:b\b/, 'bold run remains in OOXML');
  assert.match(documentXml, /in bold/, 'bold text was translated inside its run');
  assert.match(out.readAsText('word/header1.xml'), /Test Header/);
  assert.match(out.readAsText('word/footer1.xml'), /Test Footer/);
  assert.match(out.readAsText('word/footnotes.xml'), /Test footnote/);
  assert.deepEqual(out.readFile('word/media/image1.png'), media, 'embedded image bytes are untouched');
});

test('EPUB translation keeps package structure and binary assets', async () => {
  const source = await buildEpub(fixtureDir, 'book.epub');
  const zip = new AdmZip(source);
  const cover = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  zip.addFile('OEBPS/cover.png', cover);
  const translated = await documentsModule.translateEpubBytes(zip.toBuffer(), { translate: adapterTranslate });
  const out = new AdmZip(Buffer.from(translated));
  assert.match(out.readAsText('OEBPS/chap1.xhtml'), /First Chapter/);
  assert.match(out.readAsText('OEBPS/chap2.xhtml'), /Second Chapter/);
  assert.match(out.readAsText('OEBPS/content.opf'), /Libro de Prueba/, 'manifest metadata is not mutated unsafely');
  assert.deepEqual(out.readFile('OEBPS/cover.png'), cover);
  assert.equal(out.readAsText('mimetype'), 'application/epub+zip');
});

test('PDF facsimile keeps page count and page geometry while producing translated page images', async () => {
  const source = await buildTextPdf(fixtureDir, 'facsimile-source.pdf');
  const result = await facsimileModule.buildFacsimilePdf(source, { translate: adapterTranslate });
  assert.equal(result.pageCount, 3);
  assert.ok(result.data.length > 20_000, 'facsimile contains rendered page images');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: result.data, isEvalSupported: false }).promise;
  assert.equal(pdf.numPages, 3);
  const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
  assert.ok(Math.abs(viewport.width - 595) < 1 && Math.abs(viewport.height - 842) < 1, 'A4 source geometry is retained');
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map((item) => item.str || '').join('');
  assert.equal(text, '', 'raster facsimile does not leak the original-language text layer');
});

test('facsimile layout keeps same-baseline columns in separate paragraphs', () => {
  const viewport = {
    height: 800,
    convertToViewportPoint: (x, y) => [x * 2, (800 - y) * 2],
  };
  const item = (text, x, y, width) => ({ str: text, width, height: 10, fontName: 'F1', transform: [10, 0, 0, 10, x, y] });
  const lines = facsimileModule.groupDigitalLines({
    styles: { F1: { fontFamily: 'Arial' } },
    items: [
      item('Left first line', 30, 740, 65), item('Right first line', 260, 740, 70),
      item('Left second line', 30, 725, 70), item('Right second line', 260, 725, 75),
    ],
  }, viewport, 1);
  assert.equal(lines.length, 4, 'large horizontal whitespace splits a shared baseline');
  const blocks = facsimileModule.groupParagraphs(lines, 1);
  assert.equal(blocks.length, 2, 'alternating column lines reconnect to their own reading flow');
  assert.ok(blocks.every((block) => block.eraseRegions.length === 2), 'paragraph erasure retains exact line rectangles');
  assert.ok(blocks.some((block) => /Left first line Left second line/.test(block.text)));
  assert.ok(blocks.some((block) => /Right first line Right second line/.test(block.text)));
});

test('PDF list prefixes stay attached to their heading run', () => {
  const viewport = { height: 800, convertToViewportPoint: (x, y) => [x * 2, (800 - y) * 2] };
  const lines = facsimileModule.groupDigitalLines({ styles: {}, items: [
    { str: '1.', width: 5, height: 10, transform: [10, 0, 0, 10, 30, 740] },
    { str: 'The Plains Indians', width: 80, height: 10, transform: [10, 0, 0, 10, 50, 740] },
  ] }, viewport, 1);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, '1. The Plains Indians');
});

test('scanned PDF facsimile invokes page vision and places its already-translated blocks', async () => {
  const source = await buildScannedPdf(fixtureDir, 'scanned-facsimile.pdf');
  const pagesSeen = [];
  const result = await facsimileModule.buildFacsimilePdf(source, {
    translate: async (segments) => {
      assert.equal(segments.length, 0, 'vision output is not translated a second time');
      return [];
    },
    translatePageImage: async ({ pageNumber }) => {
      pagesSeen.push(pageNumber);
      return {
        blankPage: false,
        blocks: [{ text: `Translated scan page ${pageNumber}`, label: 'MAIN_TEXT', box_2d: [100, 50, 260, 900] }],
      };
    },
  });
  assert.deepEqual(pagesSeen, [1, 2]);
  assert.equal(result.pageCount, 2);
  assert.ok(result.data.length > 10_000);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: result.data, isEvalSupported: false }).promise;
  assert.equal(pdf.numPages, 2);
});

test('translation history persists results, reports missing files and removes records', async () => {
  const root = await mkdtemp(path.join(fixtureDir, 'history-'));
  const outputPath = path.join(root, 'translated.pdf');
  fs.writeFileSync(outputPath, 'pdf-placeholder');
  const created = historyModule.addTranslateHistory({
    inputKind: 'files', sourceLabel: 'source.pdf', sourcePath: path.join(root, 'source.pdf'),
    targetLanguage: 'fr', targetLanguageLabel: 'Français',
    model: { provider: 'lmstudio', model: 'history-test' }, pdfMode: 'facsimile',
    outputPath, format: 'pdf', pageCount: 2, overflowPages: [2], warnings: ['review page 2'],
  }, root);
  assert.equal(created.outputExists, true);
  assert.equal(historyModule.listTranslateHistory(root)[0].targetLanguage, 'fr');
  fs.unlinkSync(outputPath);
  assert.equal(historyModule.listTranslateHistory(root)[0].outputExists, false, 'missing output is reflected without losing its record');
  assert.deepEqual(historyModule.removeTranslateHistory(created.id, root), []);
});
