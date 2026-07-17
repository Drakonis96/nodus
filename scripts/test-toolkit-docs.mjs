// F3 — document conversions (A1–A4, A6, A7) against real fixtures. A5 (MD/HTML →
// PDF) needs a BrowserWindow and is covered by the e2e run. The Electron-free
// docs module is bundled under node_modules (so its runtime pdfjs/mammoth/turndown/
// docx/adm-zip imports resolve) and driven directly; assertions are on produced
// content — extracted text, heading styles inside document.xml, EPUB structure.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTextPdf, buildDocx, buildEpub, buildMarkdown, buildHtml } from './toolkit-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const bundleDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-toolkit-docs-'));
const fxDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-tk-docs-fx-'));
const bundle = path.join(bundleDir, 'docs.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/toolkit/convert/docs.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    '--external:pdfjs-dist', '--external:@napi-rs/canvas',
    '--external:mammoth', '--external:turndown', '--external:docx', '--external:adm-zip',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const { docOps } = require(bundle);

test.after(async () => {
  await rm(bundleDir, { recursive: true, force: true });
  await rm(fxDir, { recursive: true, force: true });
});

const dec = (bytes) => Buffer.from(bytes).toString('utf8');
function ctx(outputFormat = null, options = {}) {
  return { request: {}, outputFormat, options, signal: { cancelled: false }, onPageProgress() {} };
}

test('A1 — PDF → text keeps all three pages of phrases in reading order', async () => {
  const pdf = await buildTextPdf(fxDir);
  const [out] = await docOps['pdf-to-txt'].run([pdf], ctx());
  const text = dec(out.data);
  const zorro = text.indexOf('zorro marron');
  const metodo = text.indexOf('investigacion cualitativa');
  const hallaz = text.indexOf('hallazgos confirman');
  assert.ok(zorro >= 0 && metodo >= 0 && hallaz >= 0, 'all phrases present');
  assert.ok(zorro < metodo && metodo < hallaz, 'in page order');
});

test('A2 — PDF → Markdown marks the large lines as headings', async () => {
  const pdf = await buildTextPdf(fxDir);
  const [out] = await docOps['pdf-to-md'].run([pdf], ctx());
  const md = dec(out.data);
  assert.match(md, /(^|\n)#{1,2}\s+Introduccion General/, 'the title becomes a heading');
  assert.match(md, /zorro marron salta/, 'body text is preserved');
});

test('A3 — DOCX → Markdown / HTML / text keeps headings, bold, list and table', async () => {
  const docx = await buildDocx(fxDir);
  const [md] = await docOps['docx-to-text'].run([docx], ctx('md'));
  const m = dec(md.data);
  assert.match(m, /#\s+Titulo Principal/, 'heading as atx');
  assert.match(m, /\*\*en negrita\*\*/, 'bold survives');
  assert.match(m, /Primer elemento/, 'list item present');
  assert.match(m, /Celda A1/, 'table cell text present');

  const [html] = await docOps['docx-to-text'].run([docx], ctx('html'));
  assert.match(dec(html.data), /<h1[^>]*>Titulo Principal/);

  const [txt] = await docOps['docx-to-text'].run([docx], ctx('txt'));
  assert.match(dec(txt.data), /en negrita/);
});

test('A4 — Markdown → DOCX writes real heading styles, bold, list and table', async () => {
  const md = buildMarkdown(fxDir);
  const [out] = await docOps['text-to-docx'].run([md], ctx());
  const xml = new AdmZip(Buffer.from(out.data)).readAsText('word/document.xml');
  assert.match(xml, /w:pStyle w:val="Heading1"/, 'heading 1 style applied');
  assert.match(xml, /<w:b\b/, 'a bold run exists');
  assert.match(xml, /Titulo Principal/);
  assert.match(xml, /negrita/);
  assert.match(xml, /Primer punto/, 'bullet item text');
  assert.match(xml, /Columna A/, 'table header cell');
  assert.match(xml, /A1/, 'table body cell');
});

test('A4 — HTML → DOCX round-trips through the same writer', async () => {
  const html = buildHtml(fxDir);
  const [out] = await docOps['text-to-docx'].run([html], ctx());
  const xml = new AdmZip(Buffer.from(out.data)).readAsText('word/document.xml');
  assert.match(xml, /w:pStyle w:val="Heading1"/);
  assert.match(xml, /Titulo Principal/);
  assert.match(xml, /A1/);
});

test('A6 — EPUB → text/Markdown follows the spine order', async () => {
  const epub = await buildEpub(fxDir);
  const [txt] = await docOps['epub-to-text'].run([epub], ctx('txt'));
  const t = dec(txt.data);
  const first = t.indexOf('Capitulo Primero');
  const second = t.indexOf('Capitulo Segundo');
  assert.ok(first >= 0 && second >= 0, 'both chapters present');
  assert.ok(first < second, 'spine order preserved');
  assert.match(t, /comienzo de la historia/);

  const [md] = await docOps['epub-to-text'].run([epub], ctx('md'));
  assert.match(dec(md.data), /Capitulo Primero/);
});

test('A7 — Markdown → EPUB is structurally valid (mimetype first + stored)', async () => {
  const md = buildMarkdown(fxDir);
  const [out] = await docOps['md-to-epub'].run([md], ctx());
  const zip = new AdmZip(Buffer.from(out.data));
  const entries = zip.getEntries();
  assert.equal(entries[0].entryName, 'mimetype', 'mimetype is the first entry');
  assert.equal(entries[0].header.method, 0, 'mimetype is stored (uncompressed)');
  assert.equal(zip.readAsText('mimetype'), 'application/epub+zip');
  const container = zip.readAsText('META-INF/container.xml');
  assert.match(container, /full-path="OEBPS\/content\.opf"/);
  const opf = zip.readAsText('OEBPS/content.opf');
  assert.match(opf, /<spine>[\s\S]*<itemref/, 'the spine references at least one chapter');
  const chapter = zip.readAsText('OEBPS/chap1.xhtml');
  assert.match(chapter, /Titulo Principal/);
  assert.match(chapter, /<strong>negrita<\/strong>/, 'inline markdown became HTML');
});
