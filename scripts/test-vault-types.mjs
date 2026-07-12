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

// shared/vaultTypes.ts is dependency-free, so a plain esbuild bundle is enough.
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-vaulttypes-'));
const bundle = path.join(outDir, 'vaultTypes.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/vaultTypes.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const vt = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('academic is the default and every declared type round-trips', () => {
  assert.equal(vt.DEFAULT_VAULT_TYPE, 'academic');
  for (const def of vt.VAULT_TYPES) {
    assert.ok(vt.isVaultType(def.id), `${def.id} recognised`);
    assert.equal(vt.normalizeVaultType(def.id), def.id);
    assert.equal(vt.getVaultTypeDef(def.id).id, def.id);
  }
});

test('unknown / missing values normalise to academic', () => {
  for (const bad of [undefined, null, '', 'nope', 42, {}]) {
    assert.equal(vt.isVaultType(bad), false);
    assert.equal(vt.normalizeVaultType(bad), 'academic');
    assert.equal(vt.getVaultTypeDef(bad).id, 'academic');
  }
});

test('only academic + estudio are selectable in phase A', () => {
  const ids = vt.availableVaultTypes().map((d) => d.id);
  assert.deepEqual(ids, ['academic', 'estudio']);
  assert.equal(vt.getVaultTypeDef('primary_sources').available, false);
  assert.equal(vt.getVaultTypeDef('genealogy').available, false);
});

test('academic shows the full sidebar; estudio hides research/authoring views', () => {
  assert.deepEqual(vt.defaultHiddenViewsForType('academic'), []);
  const estudioHidden = vt.defaultHiddenViewsForType('estudio');
  assert.ok(estudioHidden.includes('debate'));
  assert.ok(estudioHidden.includes('deepResearch'));
  // Core learning surfaces must stay visible.
  for (const kept of ['search', 'library', 'ideas', 'study', 'reading', 'notes']) {
    assert.ok(!estudioHidden.includes(kept), `${kept} stays visible in estudio`);
  }
});

test('defaultHiddenViewsForType returns a fresh copy (no shared mutation)', () => {
  const a = vt.defaultHiddenViewsForType('estudio');
  a.push('mutated');
  assert.ok(!vt.defaultHiddenViewsForType('estudio').includes('mutated'));
});

test('prompt pack: academic empty, estudio carries a persona directive', () => {
  assert.equal(vt.vaultTypePromptPack('academic'), '');
  assert.match(vt.vaultTypePromptPack('estudio'), /MODO ESTUDIO/);
});

test('effectiveSidebarHidden: preset when untouched, user choice once customised', () => {
  // Untouched → the type preset drives visibility.
  assert.deepEqual(vt.effectiveSidebarHidden([], false, 'estudio'), vt.defaultHiddenViewsForType('estudio'));
  assert.deepEqual(vt.effectiveSidebarHidden([], false, 'academic'), []);
  // Customised → the user's explicit set wins, regardless of type.
  assert.deepEqual(vt.effectiveSidebarHidden(['graph'], true, 'estudio'), ['graph']);
  assert.deepEqual(vt.effectiveSidebarHidden([], true, 'estudio'), []);
});
