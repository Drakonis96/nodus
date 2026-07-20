// AI OCR — block reconstruction (pure). Bundles shared/aiOcrReconstruct.ts and asserts
// the clean-Markdown output: de-hyphenation, soft-wrap joining, paragraph preservation,
// reading-order sorting by bounding box, TITLE -> heading, and the label filter.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const bundleDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-aiocr-recon-'));
const bundle = path.join(bundleDir, 'reconstruct.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/aiOcrReconstruct.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const { cleanBlockContent, pageToMarkdown, reconstructMarkdown } = require(bundle);

test.after(async () => { await rm(bundleDir, { recursive: true, force: true }); });

test('cleanBlockContent rejoins hyphenated words split across lines', () => {
  assert.equal(cleanBlockContent('exam-\nple text'), 'example text');
});

test('cleanBlockContent joins soft-wrapped lines but keeps real paragraph breaks', () => {
  const input = 'Primera línea\nque continúa.\n\nSegundo párrafo aquí.';
  assert.equal(cleanBlockContent(input), 'Primera línea que continúa.\n\nSegundo párrafo aquí.');
});

test('cleanBlockContent collapses double spaces', () => {
  assert.equal(cleanBlockContent('hola    mundo'), 'hola mundo');
});

test('pageToMarkdown renders TITLE as a heading and body as paragraphs', () => {
  const page = {
    blankPage: false,
    blocks: [
      { text: 'El título', label: 'TITLE', box_2d: [10, 10, 40, 900] },
      { text: 'Cuerpo del texto.', label: 'MAIN_TEXT', box_2d: [50, 10, 90, 900] },
    ],
  };
  assert.equal(pageToMarkdown(page), '# El título\n\nCuerpo del texto.');
});

test('pageToMarkdown sorts blocks into reading order by bounding box', () => {
  const page = {
    blankPage: false,
    blocks: [
      { text: 'Segundo', label: 'MAIN_TEXT', box_2d: [200, 10, 240, 900] },
      { text: 'Primero', label: 'MAIN_TEXT', box_2d: [10, 10, 50, 900] },
    ],
  };
  assert.equal(pageToMarkdown(page), 'Primero\n\nSegundo');
});

test('pageToMarkdown drops chrome labels by default and keeps them when asked', () => {
  const page = {
    blankPage: false,
    blocks: [
      { text: 'Encabezado 12', label: 'HEADER', box_2d: [0, 10, 8, 900] },
      { text: 'Cuerpo real.', label: 'MAIN_TEXT', box_2d: [50, 10, 90, 900] },
      { text: 'Nota al pie.', label: 'FOOTNOTE', box_2d: [95, 10, 99, 900] },
    ],
  };
  assert.equal(pageToMarkdown(page), 'Cuerpo real.', 'header + footnote filtered out by default');
  const withFootnotes = pageToMarkdown(page, ['MAIN_TEXT', 'FOOTNOTE']);
  assert.match(withFootnotes, /Cuerpo real\./);
  assert.match(withFootnotes, /Nota al pie\./);
  assert.doesNotMatch(withFootnotes, /Encabezado/);
});

test('pageToMarkdown returns empty for a blank page', () => {
  assert.equal(pageToMarkdown({ blankPage: true, blocks: [] }), '');
});

test('reconstructMarkdown concatenates ordered pages and normalizes spacing', () => {
  const pages = [
    { blankPage: false, blocks: [{ text: 'Página uno.', label: 'MAIN_TEXT' }] },
    { blankPage: true, blocks: [] },
    { blankPage: false, blocks: [{ text: 'Página tres.', label: 'MAIN_TEXT' }] },
  ];
  assert.equal(reconstructMarkdown(pages), 'Página uno.\n\nPágina tres.');
});
