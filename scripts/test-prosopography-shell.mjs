import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const out = await mkdtemp(path.join(os.tmpdir(), 'nodus-prosop-shell-'));
const bundle = path.join(out, 'vaultTypes.cjs');
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'shared/vaultTypes.ts'), '--bundle', '--platform=node', '--format=cjs',
  '--target=es2022', `--outfile=${bundle}`,
], { cwd: root, stdio: 'inherit' });
const vaultTypes = require(bundle);
test.after(() => rm(out, { recursive: true, force: true }));

test('prosopography has six exclusive domain views and no genealogical UI', async () => {
  const sidebar = await readFile(path.join(root, 'src/components/ProsopographySidebar.tsx'), 'utf8');
  const views = [...sidebar.matchAll(/view: '(prosop\w+|notes)'/g)].map((match) => match[1]);
  assert.deepEqual(views, [
    'prosopSearch', 'prosopPopulation', 'prosopPersons', 'prosopSources',
    'prosopAnalysis', 'prosopNetworks', 'notes',
  ]);
  for (const view of views) assert.equal(vaultTypes.isViewAllowedForVaultType(view, 'prosopography'), true);
  for (const forbidden of ['persons', 'tree', 'relations', 'archive', 'graph']) {
    assert.equal(vaultTypes.isViewAllowedForVaultType(forbidden, 'prosopography'), false, `${forbidden} must not leak`);
  }
  assert.equal(vaultTypes.isViewAllowedForVaultType('library', 'prosopography'), true, 'the transverse Library is intentionally available in every vault');
  assert.doesNotMatch(sidebar, /Árbol genealógico|Relaciones sociales|Biblioteca/);
});

test('the app renders the dedicated sidebar, home and all six domain routes', async () => {
  const app = await Promise.resolve(readSource('@shell'));
  assert.match(app, /const isProsopography = activeVault\?\.type === 'prosopography'/);
  assert.match(app, /<ProsopographySidebar[\s\S]*?activeView=\{view\}/);
  assert.match(app, /if \(ctx\.isProsopography\) return <ProsopographyHome/);
  const components = {
    prosopSearch: 'ProsopSearchView', prosopPopulation: 'ProsopPopulationView',
    prosopPersons: 'ProsopPersonsView', prosopSources: 'ProsopSourcesView',
    prosopAnalysis: 'ProsopAnalysisView', prosopNetworks: 'ProsopNetworksView',
  };
  for (const [view, component] of Object.entries(components)) {
    assert.match(app, new RegExp(`${view}: \\(\\) => <${component}`));
  }
});

test('the shell is blue, released and has an evidence-first prompt pack', () => {
  const definition = vaultTypes.getVaultTypeDef('prosopography');
  assert.equal(definition.available, true);
  assert.equal(vaultTypes.VAULT_TYPE_COLORS.prosopography, '#2563eb');
  assert.match(definition.promptPack, /POBLACIÓN HISTÓRICA/);
  assert.match(definition.promptPack, /persona, mención, fuente, factoid y statement/);
  assert.match(definition.promptPack, /IA solo propone/);
});
