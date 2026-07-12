import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-treeport-'));
async function bundle(file, name) {
  const out = path.join(outDir, name);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${out}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(out);
}
const tp = await bundle('shared/treePortraits.ts', 'treePortraits.cjs');
const tf = await bundle('shared/treeFrames.ts', 'treeFrames.cjs');

test.after(() => rm(outDir, { recursive: true, force: true }));

test('default portrait kind by sex', () => {
  assert.equal(tp.defaultPortraitKind('male'), 'man');
  assert.equal(tp.defaultPortraitKind('female'), 'woman');
  assert.equal(tp.defaultPortraitKind('unknown'), null);
  assert.equal(tp.defaultPortraitKind(null), null);
});

test('native facing: man right, woman left', () => {
  assert.equal(tp.nativeFacing('male'), 'right');
  assert.equal(tp.nativeFacing('female'), 'left');
  assert.equal(tp.nativeFacing('unknown'), null);
});

test('desired facing is inward for each side', () => {
  assert.equal(tp.desiredFacing('left'), 'right');
  assert.equal(tp.desiredFacing('right'), 'left');
  assert.equal(tp.desiredFacing('none'), null);
});

test('mirroring: hetero man-left/woman-right needs none; same-sex mirrors the odd one', () => {
  // Hetero couple placed correctly: man left (faces right ✓), woman right (faces left ✓).
  assert.equal(tp.mirrorDefaultPortrait('male', 'left'), false);
  assert.equal(tp.mirrorDefaultPortrait('female', 'right'), false);
  // Man on the right must be mirrored to look left; woman on the left mirrored to look right.
  assert.equal(tp.mirrorDefaultPortrait('male', 'right'), true);
  assert.equal(tp.mirrorDefaultPortrait('female', 'left'), true);
  // Single people keep native facing.
  assert.equal(tp.mirrorDefaultPortrait('male', 'none'), false);
  assert.equal(tp.mirrorDefaultPortrait('female', 'none'), false);
  // Unknown sex has no default to mirror.
  assert.equal(tp.mirrorDefaultPortrait('unknown', 'right'), false);
});

test('frame registry: normalise + effective override', () => {
  assert.equal(tf.DEFAULT_TREE_FRAME, 'oak');
  assert.equal(tf.isTreeFrame('walnut'), true);
  assert.equal(tf.isTreeFrame('nope'), false);
  assert.equal(tf.normalizeTreeFrame('bogus'), 'oak');
  assert.equal(tf.normalizeTreeFrame('gilded'), 'gilded');
  // Person override wins; else the vault default; else the global default.
  assert.equal(tf.effectiveFrame('rustic', 'walnut'), 'rustic');
  assert.equal(tf.effectiveFrame(null, 'walnut'), 'walnut');
  assert.equal(tf.effectiveFrame(null, null), 'oak');
  assert.equal(tf.effectiveFrame('bad', 'walnut'), 'walnut');
});
