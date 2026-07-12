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

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-archfilters-'));
async function bundle(file, name) {
  const out = path.join(outDir, name);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${out}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(out);
}
const af = await bundle('shared/archiveFilters.ts', 'archiveFilters.cjs');
const dt = await bundle('shared/archiveDocTypes.ts', 'archiveDocTypes.cjs');

test.after(() => rm(outDir, { recursive: true, force: true }));

const item = (over = {}) => ({
  title: 'Doc',
  docType: 'birth_record',
  kind: 'image',
  tags: [],
  linkedPersonIds: [],
  year: null,
  extractedText: null,
  description: null,
  metadata: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

test('single-valued facets (docType, kind) match any of the selected', () => {
  assert.equal(af.matchesArchiveFilter(item({ docType: 'birth_record' }), { docTypes: ['birth_record', 'death_record'] }), true);
  assert.equal(af.matchesArchiveFilter(item({ docType: 'census' }), { docTypes: ['birth_record'] }), false);
  assert.equal(af.matchesArchiveFilter(item({ kind: 'pdf' }), { kinds: ['image'] }), false);
  // Empty selection never filters.
  assert.equal(af.matchesArchiveFilter(item(), { docTypes: [] }), true);
});

test('tags multi-select: any (OR) vs all (AND)', () => {
  const it = item({ tags: ['censo', 'Sevilla'] });
  assert.equal(af.matchesArchiveFilter(it, { tags: ['censo', 'Madrid'], tagsMode: 'any' }), true);
  assert.equal(af.matchesArchiveFilter(it, { tags: ['censo', 'Madrid'], tagsMode: 'all' }), false);
  assert.equal(af.matchesArchiveFilter(it, { tags: ['censo', 'Sevilla'], tagsMode: 'all' }), true);
});

test('persons multi-select any/all + year range + search', () => {
  const it = item({ linkedPersonIds: ['p1', 'p2'], year: 1875, title: 'Partida de Juan', extractedText: 'jornalero' });
  assert.equal(af.matchesArchiveFilter(it, { personIds: ['p1'], personsMode: 'any' }), true);
  assert.equal(af.matchesArchiveFilter(it, { personIds: ['p1', 'p3'], personsMode: 'all' }), false);
  assert.equal(af.matchesArchiveFilter(it, { yearFrom: 1870, yearTo: 1880 }), true);
  assert.equal(af.matchesArchiveFilter(it, { yearFrom: 1900 }), false);
  assert.equal(af.matchesArchiveFilter(item({ year: null }), { yearFrom: 1800 }), false, 'undated excluded when a year filter is set');
  assert.equal(af.matchesArchiveFilter(it, { search: 'JORNALERO' }), true);
  assert.equal(af.matchesArchiveFilter(it, { search: 'nada' }), false);
});

test('every category combines with AND', () => {
  const it = item({ docType: 'birth_record', tags: ['censo'], year: 1875 });
  assert.equal(af.matchesArchiveFilter(it, { docTypes: ['birth_record'], tags: ['censo'], yearFrom: 1870, yearTo: 1880 }), true);
  assert.equal(af.matchesArchiveFilter(it, { docTypes: ['birth_record'], tags: ['censo'], yearFrom: 1900 }), false);
});

test('isArchiveFilterActive detects any narrowing', () => {
  assert.equal(af.isArchiveFilterActive({}), false);
  assert.equal(af.isArchiveFilterActive({ tags: [] }), false);
  assert.equal(af.isArchiveFilterActive({ tags: ['x'] }), true);
  assert.equal(af.isArchiveFilterActive({ yearFrom: 1850 }), true);
  assert.equal(af.isArchiveFilterActive({ search: '  ' }), false);
});

test('sorting: title, year (nulls last both directions), recency', () => {
  const items = [
    item({ title: 'Zeta', year: 1900, updatedAt: '2026-01-03T00:00:00Z' }),
    item({ title: 'Alfa', year: null, updatedAt: '2026-01-01T00:00:00Z' }),
    item({ title: 'Mika', year: 1850, updatedAt: '2026-01-02T00:00:00Z' }),
  ];
  assert.deepEqual(af.sortArchiveItems(items, 'titleAsc').map((i) => i.title), ['Alfa', 'Mika', 'Zeta']);
  assert.deepEqual(af.sortArchiveItems(items, 'yearAsc').map((i) => i.year), [1850, 1900, null]);
  assert.deepEqual(af.sortArchiveItems(items, 'yearDesc').map((i) => i.year), [1900, 1850, null]);
  assert.equal(af.sortArchiveItems(items, 'updatedDesc')[0].title, 'Zeta');
});

test('extractItemYear reads the type-specific date/year fields', () => {
  assert.equal(dt.extractItemYear('birth_record', { fecha_nacimiento: 'c. 1850' }), 1850);
  assert.equal(dt.extractItemYear('census', { anio: '1875' }), 1875);
  assert.equal(dt.extractItemYear('diary', { periodo: '1878–1902' }), 1878);
  assert.equal(dt.extractItemYear('birth_record', { padre: 'Pedro' }), null, 'non-date fields ignored');
  assert.equal(dt.extractItemYear(null, { anio: '1875' }), null);
  assert.equal(dt.extractItemYear('census', null), null);
});
