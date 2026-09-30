import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './drift-test-utils.mjs';

const { sortDriftItems } = loadTs('src/components/drift/driftSort.ts');
const items = [
  { name: 'Viento', type: 'Naturaleza', uses: 0 },
  { name: 'Truenos', type: 'Lluvia', uses: 3 },
  { name: 'Árboles', type: 'Naturaleza', uses: 0 },
  { name: 'Gotas', type: 'Lluvia', uses: 3 },
  { name: 'Café', type: 'Lugares', uses: 5 },
];
const labels = { language: 'es', name: item => item.name, type: item => item.type, uses: item => item.uses };
const names = mode => sortDriftItems(items, mode, labels).map(item => item.name);

test('recommended keeps the original order; alphabetical compares localized names and numeric labels', () => {
  assert.deepEqual(names('recommended'), ['Viento', 'Truenos', 'Árboles', 'Gotas', 'Café']);
  assert.deepEqual(names('alphabetical'), ['Árboles', 'Café', 'Gotas', 'Truenos', 'Viento']);
  assert.deepEqual(sortDriftItems([{ name: 'Alpha 20' }, { name: 'Alpha 2' }], 'alphabetical', labels).map(item => item.name), ['Alpha 2', 'Alpha 20']);
  assert.deepEqual(items.map(item => item.name), names('recommended'), 'sorting never mutates the source order');
});

test('type sorts category names and then sound names alphabetically', () => {
  assert.deepEqual(names('type'), ['Gotas', 'Truenos', 'Café', 'Árboles', 'Viento']);
});

test('usage is descending, with alphabetical ties and unused sounds at the end', () => {
  assert.deepEqual(names('usage'), ['Café', 'Gotas', 'Truenos', 'Árboles', 'Viento']);
});
