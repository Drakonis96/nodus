import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-tree-search-'));
const bundle = path.join(outDir, 'treeSearch.cjs');
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'shared/treeSearch.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
], { cwd: root, stdio: 'inherit' });
const { matchesTreeSearch, normalizeTreeSearch } = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

test('tree search is accent-insensitive and covers visible kinship labels', () => {
  assert.equal(normalizeTreeSearch('  José Pérez  '), 'jose perez');
  assert.equal(matchesTreeSearch('jose', ['José Pérez', 'Tío paterno']), true);
  assert.equal(matchesTreeSearch('tio paterno', ['José Pérez', 'Tío paterno']), true);
  assert.equal(matchesTreeSearch('materna', ['José Pérez', 'Tío paterno']), false);
});

test('tree UI keeps non-matches visible and highlights matches', async () => {
  const source = await readFile(path.join(root, 'src/views/TreeView.tsx'), 'utf8');
  assert.match(source, /data-testid="tree-search-input"/);
  assert.match(source, /opacity=\{searchActive && !isSearchMatch \? 0\.22 : 1\}/);
  assert.match(source, /data-testid=\{`tree-search-match-\$\{n\.personId\}`\}/);
});
