import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const output = await build({ entryPoints: ['shared/hybridSearch.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { mergeHybridResults, literalRelevance, searchSnippet } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const hit = (kind, id, title, extra = {}) => ({ kind, id, title, ...extra });

test('literal and semantic hits form one ranking across kinds and keep navigation metadata', () => {
  const results = mergeHybridResults('memoria oral', [
    hit('note', 'n', 'Introducción', { snippet: 'Un estudio de memoria oral.' }),
    hit('work', 'w', 'Memoria oral', { zoteroKey: 'Z123' }),
  ], [hit('work', 'w', 'Memoria oral', { similarity: .9 }), hit('passage', 'p', 'Recuerdos narrados', { similarity: .8 })]);
  assert.deepEqual(results.map((row) => row.id), ['w', 'n', 'p']);
  assert.equal(results[0].zoteroKey, 'Z123');
  assert.equal(results[0].similarity, .9);
  assert.equal(results.length, 3);
});
test('filters run before top-k and an empty selection yields no results', () => {
  const rows = [hit('note', 'n', 'Exact title'), hit('work', 'w', 'Other', { similarity: .7 })];
  assert.equal(mergeHybridResults('Exact title', rows, [], new Set(['work']), 1)[0].id, 'w');
  assert.deepEqual(mergeHybridResults('Exact title', rows, rows, new Set()), []);
});
test('entity identity includes kind; duplicate scores and ties are deterministic', () => {
  const rows = [hit('note', '1', 'A'), hit('work', '1', 'A'), hit('work', '1', 'A', { similarity: .8 })];
  const first = mergeHybridResults('else', rows, []);
  assert.equal(first.length, 2);
  assert.deepEqual(first, mergeHybridResults('else', [...rows].reverse(), []));
});
test('accent folding, phrase matches, partial terms and semantic-only recovery share an ordered scale', () => {
  assert.equal(literalRelevance('educacion', hit('note', 'n', 'Educación')), 1);
  const rows = mergeHybridResults('memoria oral', [hit('note', 'partial', 'Memoria de trabajo')], [hit('work', 'semantic', 'Recuerdos narrados', { similarity: .9 })]);
  assert.equal(rows[0].id, 'semantic');
  assert.equal(literalRelevance('', hit('note', 'n', 'anything')), 0);
});
test('literal fallback remains useful without semantic results and excerpts include late matches', () => {
  assert.equal(mergeHybridResults('término', [hit('note', 'n', 'Título', { snippet: 'término' })], []).length, 1);
  const text = 'prefacio '.repeat(200) + 'memoria oral' + ' final'.repeat(200);
  assert.match(searchSnippet(text, 'memoria oral'), /memoria oral/);
  assert.ok(searchSnippet(text, 'memoria oral').length <= 402);
});
