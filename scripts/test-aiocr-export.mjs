// AI OCR — transcript export (TXT / MD / HTML / EPUB). Pure: bundles export.ts and
// asserts the produced bytes. PDF needs a BrowserWindow (printToPDF) so it is covered by
// the build/e2e, not here. The EPUB is opened for real to check the OCF structure.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const bundleDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-aiocr-export-'));
const bundle = path.join(bundleDir, 'export.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/toolkit/aiOcr/export.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const { exportTranscriptBytes, transcriptToEpubBytes, transcriptToHtml, markdownToPlainText } = require(bundle);

test.after(async () => { await rm(bundleDir, { recursive: true, force: true }); });

const MD = '# Título\n\nPrimer párrafo con **negrita**.\n\n# Capítulo dos\n\nSegundo párrafo aquí.';
const utf8 = (bytes) => Buffer.from(bytes).toString('utf8');

test('txt strips the Markdown markers but keeps the words', () => {
  const txt = utf8(exportTranscriptBytes(MD, 'txt', 'Doc'));
  assert.match(txt, /Título/);
  assert.match(txt, /negrita/);
  assert.doesNotMatch(txt, /#/);
  assert.doesNotMatch(txt, /\*\*/);
});

test('markdownToPlainText keeps paragraph breaks', () => {
  assert.equal(markdownToPlainText('# H\n\nUno.\n\nDos.'), 'H\n\nUno.\n\nDos.');
});

test('md is passed through verbatim', () => {
  assert.match(utf8(exportTranscriptBytes(MD, 'md', 'Doc')), /# Título/);
});

test('html is a full document with rendered markup', () => {
  const html = utf8(exportTranscriptBytes(MD, 'html', 'Doc'));
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<h1>Título<\/h1>/);
  assert.match(html, /<strong>negrita<\/strong>/);
  assert.equal(html, transcriptToHtml(MD, 'Doc'));
});

test('epub is a valid OCF zip: mimetype first + STORED, chapters with text', () => {
  const epub = Buffer.from(transcriptToEpubBytes(MD, 'Doc'));
  const zip = new AdmZip(epub);
  const entries = zip.getEntries();
  assert.equal(entries[0].entryName, 'mimetype', 'mimetype is the first entry');
  assert.equal(entries[0].header.method, 0, 'mimetype is STORED (uncompressed)');
  assert.equal(zip.readAsText('mimetype'), 'application/epub+zip');
  assert.ok(zip.getEntry('META-INF/container.xml'), 'has the container');
  assert.ok(zip.getEntry('OEBPS/content.opf'), 'has the OPF package');
  assert.match(zip.readAsText('OEBPS/chap1.xhtml'), /Primer párrafo/);
  assert.match(zip.readAsText('OEBPS/chap2.xhtml'), /Segundo párrafo aquí/);
});
