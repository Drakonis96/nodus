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
