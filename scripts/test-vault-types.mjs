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

test('academic + genealogy + databases are selectable; estudio/primary_sources are declared but gated', () => {
  const ids = vt.availableVaultTypes().map((d) => d.id);
  assert.deepEqual(ids, ['academic', 'genealogy', 'databases']);
  assert.equal(vt.getVaultTypeDef('genealogy').available, true);
  assert.equal(vt.getVaultTypeDef('databases').available, true);
  for (const gated of ['estudio', 'primary_sources']) {
    assert.equal(vt.getVaultTypeDef(gated).available, false, `${gated} not selectable this release`);
  }
  // Order shown in the picker: shipped types first, then the coming-soon ones.
  assert.deepEqual(vt.VAULT_TYPES.map((d) => d.id), ['academic', 'genealogy', 'estudio', 'primary_sources', 'databases']);
});

test('databases mode: table/analysis/chat views scoped to it + data-analyst prompt pack', () => {
  for (const v of ['databases', 'dbAnalysis', 'dbChat']) {
    assert.equal(vt.isViewAllowedForVaultType(v, 'databases'), true, `${v} allowed for databases`);
    assert.equal(vt.isViewAllowedForVaultType(v, 'academic'), false, `${v} hidden for academic`);
    assert.equal(vt.isViewAllowedForVaultType(v, 'genealogy'), false, `${v} hidden for genealogy`);
  }
  const hidden = vt.defaultHiddenViewsForType('databases');
  for (const h of ['search', 'library', 'graph', 'ideas', 'authors', 'writing', 'projects', 'deepResearch']) {
    assert.ok(hidden.includes(h), `${h} hidden in databases mode`);
  }
  assert.ok(!hidden.includes('notes'), 'notes stays visible in databases mode');
  assert.match(vt.vaultTypePromptPack('databases'), /MODO BASES DE DATOS/);
});

test('the tree view is scoped to genealogy only', () => {
  assert.equal(vt.isViewAllowedForVaultType('tree', 'genealogy'), true);
  assert.equal(vt.isViewAllowedForVaultType('tree', 'primary_sources'), false);
  assert.equal(vt.isViewAllowedForVaultType('tree', 'academic'), false);
  // Genealogy also gets the shared records views + map.
  for (const v of ['persons', 'timeline', 'archive', 'map']) {
    assert.equal(vt.isViewAllowedForVaultType(v, 'genealogy'), true);
  }
  // Map is shared with primary_sources; tree is not.
  assert.equal(vt.isViewAllowedForVaultType('map', 'primary_sources'), true);
  assert.equal(vt.isViewAllowedForVaultType('map', 'academic'), false);
});

test('genealogy hides argumentative + idea-graph authoring views, keeps records + Deep Research', () => {
  const hidden = vt.defaultHiddenViewsForType('genealogy');
  // Argumentative/idea-graph surfaces AND the idea-graph authoring tools (Writing,
  // Projects) are hidden; they'd run empty in genealogy.
  for (const h of ['argument', 'debate', 'study', 'immersion', 'hypothesis', 'reading', 'research', 'gaps', 'ideas', 'authors', 'graph', 'writing', 'projects']) {
    assert.ok(hidden.includes(h), `${h} hidden in genealogy`);
  }
  // Deep Research STAYS (it has a genealogy pipeline over the archive/library), and so
  // do the records/genealogy views + generic notes.
  for (const kept of ['deepResearch', 'persons', 'tree', 'timeline', 'archive', 'map', 'notes', 'library']) {
    assert.ok(!hidden.includes(kept), `${kept} stays visible in genealogy`);
  }
  assert.match(vt.vaultTypePromptPack('genealogy'), /MODO GENEALOGÍA/);
});

test('vaultTypeImagePrompt steers image aesthetics by type', () => {
  assert.match(vt.vaultTypeImagePrompt('genealogy'), /family archive|heritage/i);
  assert.match(vt.vaultTypeImagePrompt('primary_sources'), /archival|documentary/i);
  assert.equal(vt.vaultTypeImagePrompt('academic'), '');
  assert.equal(vt.vaultTypeImagePrompt('estudio'), '');
});

test('primary_sources hides argument/study surfaces but keeps ideas/authors', () => {
  const hidden = vt.defaultHiddenViewsForType('primary_sources');
  assert.ok(hidden.includes('argument') && hidden.includes('debate') && hidden.includes('study'));
  for (const kept of ['ideas', 'authors', 'library', 'graph', 'notes']) {
    assert.ok(!hidden.includes(kept), `${kept} stays visible in primary_sources`);
  }
  assert.match(vt.vaultTypePromptPack('primary_sources'), /FUENTES PRIMARIAS/);
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

test('records views are scoped to primary_sources + genealogy only', () => {
  for (const view of ['persons', 'timeline', 'archive']) {
    assert.equal(vt.isViewAllowedForVaultType(view, 'primary_sources'), true, `${view} allowed for primary_sources`);
    assert.equal(vt.isViewAllowedForVaultType(view, 'genealogy'), true, `${view} allowed for genealogy`);
    assert.equal(vt.isViewAllowedForVaultType(view, 'academic'), false, `${view} hidden for academic`);
    assert.equal(vt.isViewAllowedForVaultType(view, 'estudio'), false, `${view} hidden for estudio`);
  }
  // Universal views are allowed everywhere.
  assert.equal(vt.isViewAllowedForVaultType('library', 'academic'), true);
  assert.equal(vt.isViewAllowedForVaultType('graph', 'genealogy'), true);
});

test('viewsDisallowedForType lists the scoped views not applicable to a type', () => {
  const all = ['home', 'library', 'persons', 'timeline', 'archive', 'settings'];
  assert.deepEqual(vt.viewsDisallowedForType(all, 'academic'), ['persons', 'timeline', 'archive']);
  assert.deepEqual(vt.viewsDisallowedForType(all, 'primary_sources'), []);
});

test('effectiveSidebarHidden: preset when untouched, user choice once customised', () => {
  // Untouched → the type preset drives visibility.
  assert.deepEqual(vt.effectiveSidebarHidden([], false, 'estudio'), vt.defaultHiddenViewsForType('estudio'));
  assert.deepEqual(vt.effectiveSidebarHidden([], false, 'academic'), []);
  // Customised → the user's explicit set wins, regardless of type.
  assert.deepEqual(vt.effectiveSidebarHidden(['graph'], true, 'estudio'), ['graph']);
  assert.deepEqual(vt.effectiveSidebarHidden([], true, 'estudio'), []);
});
