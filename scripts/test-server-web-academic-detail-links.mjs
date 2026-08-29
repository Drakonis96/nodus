import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const source = (name) => readFile(new URL(name, root), 'utf8');

test('academic work details keep the browser-safe path to the published reader', async () => {
  const explorer = await source('src/serverWeb/academic/AcademicDetailExplorer.tsx');
  assert.match(explorer, /academic-work-open-reader/);
  assert.match(explorer, /href=\{`\/library\/\$\{encodeURIComponent\(workId\)\}`\}/);
  assert.doesNotMatch(explorer, /window\.nodus/);
});

test('author dossiers retain edited volumes as a distinct published fact', async () => {
  const explorer = await source('src/serverWeb/academic/AcademicDetailExplorer.tsx');
  assert.match(explorer, /editedWorks \|\| \[\]/);
  assert.match(explorer, /academic-author-edited-works/);
  assert.match(explorer, /Atribución provisional/);
});

test('saved searches tolerate malformed or unavailable browser storage', async () => {
  const search = await source('src/serverWeb/academic/SearchServerView.tsx');
  assert.match(search, /value\.flatMap/);
  assert.match(search, /kind in KIND_META/);
  assert.match(search, /function writeSaved/);
  assert.match(search, /blocked quota must not break global search/);
});
