// Pure tests for shared/analysisSpec.ts + shared/analysisCatalog.ts — the AI↔engine
// contract and the applicability/validation layer.

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
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-anaspec-'));

function bundle(file, name) {
  const out = path.join(outDir, name);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${out}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(out);
}
const spec = bundle('shared/analysisSpec.ts', 'spec.cjs');
const cat = bundle('shared/analysisCatalog.ts', 'catalog.cjs');

test.after(() => rm(outDir, { recursive: true, force: true }));

// A small synthetic profile: 2 numeric, 1 select (lowCard), 1 free-text (highCard), 1 date.
const profile = {
  rowCount: 20,
  columns: [
    { columnId: 'price', name: 'Precio', type: 'number', filled: 20, fillRate: 1, number: { count: 20, min: 1, max: 9, mean: 5, median: 5, sum: 100, stdev: 2, histogram: [] } },
    { columnId: 'qty', name: 'Cantidad', type: 'number', filled: 20, fillRate: 1, number: { count: 20, min: 1, max: 9, mean: 5, median: 5, sum: 100, stdev: 2, histogram: [] } },
    { columnId: 'cat', name: 'Categoría', type: 'select', filled: 20, fillRate: 1, distinct: 3, distribution: [{ id: 'a', label: 'A', color: null, count: 8 }, { id: 'b', label: 'B', color: null, count: 7 }, { id: 'c', label: 'C', color: null, count: 5 }] },
    { columnId: 'notes', name: 'Notas', type: 'text', filled: 20, fillRate: 1, distinct: 19 },
    { columnId: 'when', name: 'Fecha', type: 'date', filled: 20, fillRate: 1, dateRange: { min: '2023-01-01', max: '2023-12-31' } },
  ],
};

test('isAnalysisRequest: shape validation', () => {
  assert.ok(spec.isAnalysisRequest({ kind: 'correlation', columns: ['a', 'b'] }));
  assert.ok(!spec.isAnalysisRequest({ kind: 'bogus', columns: ['a'] }));
  assert.ok(!spec.isAnalysisRequest({ kind: 'correlation', columns: [1, 2] }));
  assert.ok(!spec.isAnalysisRequest(null));
});

test('parseAnalysisSuggestions: extracts fenced JSON, drops invalid, defaults title', () => {
  const reply = 'Aquí tienes:\n```json\n[{"kind":"correlation","columns":["price","qty"],"title":"Precio vs Cantidad","rationale":"ver relación"},{"kind":"nope","columns":[]},{"kind":"top_values","columns":["cat"]}]\n```';
  const got = spec.parseAnalysisSuggestions(reply);
  assert.equal(got.length, 2);
  assert.equal(got[0].title, 'Precio vs Cantidad');
  assert.equal(got[1].title, 'top_values'); // default title
});

test('parseAnalysisSuggestions: raw array without fence', () => {
  const got = spec.parseAnalysisSuggestions('[{"kind":"descriptive","columns":["price"]}]');
  assert.equal(got.length, 1);
  assert.equal(got[0].kind, 'descriptive');
});

test('parseAnalysisSuggestions: garbage → []', () => {
  assert.deepEqual(spec.parseAnalysisSuggestions('no json here'), []);
});

test('columnRoles classifies by type/cardinality', () => {
  const roles = cat.columnRoles(profile);
  assert.deepEqual(roles.numeric.map((c) => c.id).sort(), ['price', 'qty']);
  assert.ok(roles.lowCard.some((c) => c.id === 'cat'));
  assert.ok(!roles.lowCard.some((c) => c.id === 'notes')); // 19 distinct > text limit
  assert.ok(roles.category.some((c) => c.id === 'notes')); // still a category for top-N
  assert.deepEqual(roles.date.map((c) => c.id), ['when']);
});

test('applicableKinds reflects available columns', () => {
  const kinds = cat.applicableKinds(profile);
  assert.ok(kinds.includes('correlation'));
  assert.ok(kinds.includes('correlation_matrix'));
  assert.ok(kinds.includes('group_compare'));
  assert.ok(kinds.includes('time_series'));
  assert.ok(!kinds.includes('chi_square')); // only one lowCard category
});

test('validateRequest: rejects wrong roles and inexistent columns', () => {
  assert.ok(cat.validateRequest({ kind: 'correlation', columns: ['price', 'qty'] }, profile).ok);
  assert.ok(!cat.validateRequest({ kind: 'correlation', columns: ['price', 'cat'] }, profile).ok); // cat not numeric
  assert.ok(!cat.validateRequest({ kind: 'correlation', columns: ['price', 'ghost'] }, profile).ok);
  assert.ok(!cat.validateRequest({ kind: 'correlation', columns: ['price', 'price'] }, profile).ok); // same col
});

test('validateRequest: time_series defaults options', () => {
  const r = cat.validateRequest({ kind: 'time_series', columns: ['when', 'price'] }, profile);
  assert.ok(r.ok);
  assert.equal(r.normalized.options.metric, 'mean');
  assert.equal(r.normalized.options.bucket, 'month');
  const countOnly = cat.validateRequest({ kind: 'time_series', columns: ['when'] }, profile);
  assert.ok(countOnly.ok);
  assert.equal(countOnly.normalized.options.metric, 'count');
});

test('validateRequest: correlation_matrix needs no columns', () => {
  const r = cat.validateRequest({ kind: 'correlation_matrix', columns: [] }, profile);
  assert.ok(r.ok);
});

test('catalogManifest lists kinds and real column ids', () => {
  const m = cat.catalogManifest(profile);
  assert.match(m, /=== ANÁLISIS DISPONIBLES ===/);
  assert.match(m, /"price"/);
  assert.match(m, /correlation:/);
});

test('applicableAnalyses returns bounded default set with valid requests', () => {
  const defs = cat.applicableAnalyses(profile);
  assert.ok(defs.length > 0);
  for (const r of defs) assert.ok(cat.validateRequest(r, profile).ok, `invalid default: ${JSON.stringify(r)}`);
});

test('assignColumns: multi slot consumes the rest', () => {
  const { assigned } = cat.assignColumns('group_compare', ['cat', 'price', 'qty']);
  assert.deepEqual(assigned, [['cat'], ['price', 'qty']]);
  const desc = cat.assignColumns('descriptive', ['price', 'qty']);
  assert.deepEqual(desc.assigned, [['price', 'qty']]);
  // A required multi slot left empty passes assignColumns but fails validateRequest.
  assert.deepEqual(cat.assignColumns('group_compare', ['cat']).assigned, [['cat'], []]);
  assert.ok(!cat.validateRequest({ kind: 'group_compare', columns: ['cat'] }, profile).ok);
});

test('descriptive accepts multiple numeric columns', () => {
  assert.ok(cat.validateRequest({ kind: 'descriptive', columns: ['price', 'qty'] }, profile).ok);
});

test('group_compare accepts multiple value columns', () => {
  const r = cat.validateRequest({ kind: 'group_compare', columns: ['cat', 'price', 'qty'] }, profile);
  assert.ok(r.ok);
  assert.deepEqual(r.normalized.columns, ['cat', 'price', 'qty']);
});

test('correlation_matrix: empty = all, one column rejected, subset ok', () => {
  assert.ok(cat.validateRequest({ kind: 'correlation_matrix', columns: [] }, profile).ok);
  assert.ok(!cat.validateRequest({ kind: 'correlation_matrix', columns: ['price'] }, profile).ok);
  assert.ok(cat.validateRequest({ kind: 'correlation_matrix', columns: ['price', 'qty'] }, profile).ok);
});

test('covariance_matrix + data_quality applicable', () => {
  const kinds = cat.applicableKinds(profile);
  assert.ok(kinds.includes('covariance_matrix'));
  assert.ok(kinds.includes('data_quality'));
  assert.ok(cat.validateRequest({ kind: 'data_quality', columns: [] }, profile).ok);
});

test('crosstab: needs two distinct categories, defaults aggregate', () => {
  // only one lowCard (cat) in the base profile → not applicable; build a 2-lowCard profile.
  const p2 = { rowCount: 10, columns: [
    { columnId: 'r', name: 'R', type: 'select', filled: 10, fillRate: 1, distinct: 2, distribution: [{ id: 'a', label: 'A', color: null, count: 5 }, { id: 'b', label: 'B', color: null, count: 5 }] },
    { columnId: 'c', name: 'C', type: 'select', filled: 10, fillRate: 1, distinct: 2, distribution: [{ id: 'x', label: 'X', color: null, count: 5 }, { id: 'y', label: 'Y', color: null, count: 5 }] },
    { columnId: 'v', name: 'V', type: 'number', filled: 10, fillRate: 1, number: { count: 10, min: 1, max: 9, mean: 5, median: 5, sum: 50, stdev: 2, histogram: [] } },
  ] };
  assert.ok(cat.applicableKinds(p2).includes('crosstab'));
  const countOnly = cat.validateRequest({ kind: 'crosstab', columns: ['r', 'c'] }, p2);
  assert.ok(countOnly.ok);
  assert.equal(countOnly.normalized.options.aggregate, 'count');
  const withVal = cat.validateRequest({ kind: 'crosstab', columns: ['r', 'c', 'v'] }, p2);
  assert.equal(withVal.normalized.options.aggregate, 'mean');
  assert.ok(!cat.validateRequest({ kind: 'crosstab', columns: ['r', 'r'] }, p2).ok);
});

test('time_series accepts multiple value columns', () => {
  const r = cat.validateRequest({ kind: 'time_series', columns: ['when', 'price', 'qty'] }, profile);
  assert.ok(r.ok);
  assert.deepEqual(r.normalized.columns, ['when', 'price', 'qty']);
});
