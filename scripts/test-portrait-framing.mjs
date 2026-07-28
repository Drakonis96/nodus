import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const out = await mkdtemp(path.join(os.tmpdir(), 'nodus-portrait-framing-'));
const bundle = path.join(out, 'portraitFraming.cjs');
execFileSync(
  path.join(root, 'node_modules/.bin/esbuild'),
  [path.join(root, 'shared/portraitFraming.ts'), '--bundle', '--platform=node', '--format=cjs', `--outfile=${bundle}`],
  { cwd: root, stdio: 'inherit' }
);
const framing = require(bundle);

test.after(() => rm(out, { recursive: true, force: true }));

test('portrait drag follows the pointer and uses each frame real dimensions', () => {
  const initial = { focusX: 0.5, focusY: 0.5, scale: 2 };
  assert.deepEqual(framing.dragPortraitFocus(initial, 24, -12, 96, 120), {
    focusX: 0.25,
    focusY: 0.6,
    scale: 2,
  });
  assert.deepEqual(initial, { focusX: 0.5, focusY: 0.5, scale: 2 }, 'the persisted input is not mutated');
});

test('portrait drag cannot expose space outside the stored focal range', () => {
  const initial = { focusX: 0.5, focusY: 0.5, scale: 1 };
  assert.equal(framing.dragPortraitFocus(initial, 999, 999, 96, 96).focusX, 0);
  assert.equal(framing.dragPortraitFocus(initial, -999, -999, 96, 96).focusY, 1);
  assert.equal(framing.dragPortraitFocus(initial, 10, 10, 0, 0).focusX, 0);
});

test('genealogy and worldbuilding editors capture, persist and reload the latest frame', async () => {
  const [personEditor, characterEditor, portrait] = await Promise.all([
    readFile(path.join(root, 'src/components/PersonDossier.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/CharacterPortraitEditor.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/PersonPortrait.tsx'), 'utf8'),
  ]);
  for (const source of [personEditor, characterEditor]) {
    assert.match(source, /event?\.currentTarget\.setPointerCapture|e\.currentTarget\.setPointerCapture/);
    assert.match(source, /getBoundingClientRect\(\)/);
    assert.match(source, /firstElementChild/);
    assert.match(source, /dragPortraitFocus\(/);
    assert.match(source, /focusRef\.current/);
    assert.match(source, /onPointerCancel=\{finishDrag\}/);
    assert.match(source, /onLostPointerCapture=\{finishDrag\}/);
    assert.match(
      source,
      /const persistFocus = async[\s\S]*?await window\.nodus\.updatePortraitFocus\([\s\S]*?await onChanged\(\)/,
      'the persisted frame replaces the stale person or character held by the parent collection'
    );
    assert.match(source, /onPointerUp=\{\(\) => void persistFocus\(\)\}/);
    assert.match(source, /onKeyUp=\{\(\) => void persistFocus\(\)\}/);
    assert.match(source, /onBlur=\{\(\) => void persistFocus\(\)\}/);
  }
  assert.match(portrait, /transformOrigin: `\$\{focus\.focusX \* 100\}% \$\{focus\.focusY \* 100\}%`/);
});
