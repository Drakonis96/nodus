// TXT speaker-notes interchange: exercise the pure serializer/parser as a real
// bundled module so the tests cover the same code imported by Electron.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presenter-notes-txt-'));
const bundle = path.join(outDir, 'presenterNotesTxt.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/presenterNotesTxt.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);

const { parsePresenterNotesTxt, serializePresenterNotesTxt } = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

test('TXT notes round-trip multiline text, empty slides, whitespace, and delimiters', () => {
  const notes = {
    1: 'Opening line\nSecond line',
    3: '  keep surrounding whitespace  ',
    4: '===== END SLIDE 4 =====\n\\literal backslash',
  };
  const text = serializePresenterNotesTxt(notes, 4);
  const parsed = parsePresenterNotesTxt(text);

  assert.equal(parsed.totalSlides, 4);
  assert.deepEqual(parsed.notes, notes);
  assert.match(text, /===== SLIDE 2 =====\n===== END SLIDE 2 =====/);
  assert.match(text, /\\===== END SLIDE 4 =====/);
  assert.match(text, /\\\\literal backslash/);
});

test('TXT notes parser accepts UTF-8 BOM and Windows line endings', () => {
  const text = `\uFEFF${serializePresenterNotesTxt({ 2: 'Windows\nlines' }, 2).replace(/\n/g, '\r\n')}`;
  assert.deepEqual(parsePresenterNotesTxt(text), { notes: { 2: 'Windows\nlines' }, totalSlides: 2 });
});

test('TXT notes serializer preserves a trailing newline inside a note', () => {
  const parsed = parsePresenterNotesTxt(serializePresenterNotesTxt({ 1: 'Line\n' }, 1));
  assert.equal(parsed.notes['1'], 'Line\n');
});

test('TXT notes parser rejects unsupported, partial, reordered, and trailing content', () => {
  assert.throws(() => parsePresenterNotesTxt('plain notes'), /Unsupported/);
  assert.throws(
    () => parsePresenterNotesTxt('NODUS PDF PRESENTER NOTES\nVersion: 1\nSlides: 2\n\n===== SLIDE 1 =====\n===== END SLIDE 1 =====\n'),
    /slide 2/,
  );
  assert.throws(
    () => parsePresenterNotesTxt('NODUS PDF PRESENTER NOTES\nVersion: 1\nSlides: 1\n\n===== SLIDE 2 =====\n===== END SLIDE 2 =====\n'),
    /slide 1/,
  );
  assert.throws(
    () => parsePresenterNotesTxt(`${serializePresenterNotesTxt({}, 1)}unexpected`),
    /Unexpected content/,
  );
});

// ── "Recovered notes" dumps ──────────────────────────────────────────────────
// The second accepted shape: a `KEY: value` header, one open-ended section per
// slide that HAS a note, silent slides simply absent, and no escaping. The
// fixtures below are synthetic — the shape is what matters, not any one file.

const RECOVERED = [
  'PRESENTACIÓN: Curso de ejemplo',
  'ARCHIVO ORIGINAL: Curso de ejemplo.pdf',
  'PÁGINAS: 6',
  'NOTAS RECUPERADAS: 3',
  'FECHA DE IMPORTACIÓN: 2026-04-21T13:41:11.067Z',
  '',
  '===== DIAPOSITIVA 2 =====',
  'Primer párrafo de la segunda diapositiva.',
  '',
  'Segundo párrafo, separado por una línea en blanco.',
  '',
  '===== DIAPOSITIVA 3 =====',
  'Una sola línea.',
  '',
  '===== DIAPOSITIVA 6 =====',
  'La última diapositiva con nota.',
  '',
  '',
].join('\n');

test('recovered-notes dumps are read: declared length, gaps, and paragraph breaks', () => {
  const parsed = parsePresenterNotesTxt(RECOVERED);

  // The header's page count is the deck's length, not the number of notes — the
  // importer compares it against the real PDF, so 6 must not become 3.
  assert.equal(parsed.totalSlides, 6);
  assert.deepEqual(Object.keys(parsed.notes).sort(), ['2', '3', '6']);
  // Slides with no section stay absent rather than becoming empty strings.
  for (const silent of ['1', '4', '5']) assert.equal(parsed.notes[silent], undefined);
  // Blank lines BETWEEN paragraphs survive; the ones padding the edges do not.
  assert.equal(parsed.notes['2'], 'Primer párrafo de la segunda diapositiva.\n\nSegundo párrafo, separado por una línea en blanco.');
  assert.equal(parsed.notes['3'], 'Una sola línea.');
  // The last section runs to the end of the file, trailing blank lines and all.
  assert.equal(parsed.notes['6'], 'La última diapositiva con nota.');
});

test('recovered notes survive a round trip through the native export', () => {
  const parsed = parsePresenterNotesTxt(RECOVERED);
  const reparsed = parsePresenterNotesTxt(serializePresenterNotesTxt(parsed.notes, parsed.totalSlides));
  assert.deepEqual(reparsed, parsed);
});

test('recovered dumps accept the English marker, a BOM and Windows line endings', () => {
  const text = `﻿${['PAGES: 3', '', '===== SLIDE 2 =====', 'English dump.', ''].join('\r\n')}`;
  assert.deepEqual(parsePresenterNotesTxt(text), { notes: { 2: 'English dump.' }, totalSlides: 3 });
});

test('a recovered dump with no page-count header falls back to its highest slide', () => {
  const parsed = parsePresenterNotesTxt('===== DIAPOSITIVA 4 =====\nSin cabecera.\n');
  assert.deepEqual(parsed, { notes: { 4: 'Sin cabecera.' }, totalSlides: 4 });
});

test('a damaged native export is refused, not read as a recovered dump', () => {
  // Closing markers but no magic line: reading this leniently would fold
  // "===== END SLIDE 1 =====" into the note text instead of admitting the file
  // is broken.
  assert.throws(
    () => parsePresenterNotesTxt('===== SLIDE 1 =====\nNote\n===== END SLIDE 1 =====\n'),
    /Unsupported/,
  );
});

test('recovered dumps refuse to lose a note or name a slide the deck lacks', () => {
  assert.throws(
    () => parsePresenterNotesTxt('PÁGINAS: 4\n\n===== DIAPOSITIVA 2 =====\nUna\n\n===== DIAPOSITIVA 2 =====\nOtra\n'),
    /Duplicate presenter notes section for slide 2/,
  );
  assert.throws(
    () => parsePresenterNotesTxt('PÁGINAS: 3\n\n===== DIAPOSITIVA 9 =====\nFuera de rango\n'),
    /slide 9 in a deck of 3/,
  );
  // A header alone is still not a notes file.
  assert.throws(() => parsePresenterNotesTxt('PÁGINAS: 3\nNOTAS RECUPERADAS: 0\n'), /Unsupported/);
});
