import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(repoRoot, 'src/views/ArgumentMapView.tsx'), 'utf8');

test('argument map opens as a library-style metadata catalogue', () => {
  assert.match(source, /data-testid="argument-routes-table"/);
  for (const field of ['Idea', 'Tipo', 'Nº de conexiones', 'Debates', 'Confianza', 'Relaciones']) {
    assert.match(source, new RegExp(`label="${field}"|t\\('${field}'\\)`), `catalogue shows ${field}`);
  }
  assert.match(source, /s\.statement/);
  assert.match(source, /s\.topRelations/);
  assert.match(source, /s\.neighborLabels/);
});

test('catalogue metadata can be searched, filtered and sorted', () => {
  assert.match(source, /data-testid="argument-routes-search"/);
  assert.match(source, /setMinConnections/);
  for (const sort of ['label', 'type', 'connections', 'debates', 'confidence']) {
    assert.match(source, new RegExp(`routeSort === '${sort}'|sort="${sort}"`), `catalogue supports ${sort} sorting`);
  }
});

test('clicking a row opens a persistent idea tab around the existing tree', () => {
  assert.match(source, /setOpenArgumentMap\(\{ ideaId: sid, label, mode \}\);\s*setSurface\('map'\);/);
  assert.match(source, /onClick=\{\(\) => build\(s\.ideaId\)\}/);
  assert.match(source, /data-testid="argument-tab-map"/);
  assert.match(source, /<BlockTree block=\{map\.root\}/, 'the tab renders the established nested idea tree');
});

test('catalogue and tabs explicitly support light and dark themes', () => {
  assert.match(source, /bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100/);
  assert.match(source, /border-neutral-200[^\n]*dark:border-neutral-800/);
  assert.match(source, /hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900\/55/);
  assert.match(source, /bg-neutral-100[^\n]*dark:bg-neutral-800/);
});
