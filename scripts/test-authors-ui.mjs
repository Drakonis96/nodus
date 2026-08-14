import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './ipc-channel-census.mjs';

test('Authors is a library-style catalogue with real metadata and saved authors as a filter', async () => {
  const [view, dossier, types] = await Promise.all([
    readSource('src/views/AuthorsView.tsx'),
    readSource('electron/ai/authorDossier.ts'),
    readSource('shared/types.ts'),
  ]);

  for (const marker of [
    'authors-workspace', 'authors-table-scroll', 'authors-search',
    'authors-tab-saved', 'authors-open-matrix', 'author-name',
  ]) assert.match(view, new RegExp(marker));

  for (const field of ['firstName', 'lastName', 'workCount', 'ideaCount', 'relationCount', 'topTags']) {
    assert.match(view, new RegExp(`author\\.${field}`), `${field} is visible in the author catalogue`);
  }
  assert.match(view, /setSavedOnly\(\(value\) => !value\)/, 'saved authors is a filter instead of a separate workspace');
  assert.doesNotMatch(view, /AuthorsSurface[^\n]*saved/, 'saved authors is not an internal tab');
  assert.match(types, /topTags: string\[\]/, 'the author summary carries real source tags');
  assert.match(dossier, /JOIN work_zotero_tags[\s\S]*JOIN zotero_tags/, 'author tags come from Zotero work metadata');
});

test('author and synthesis-matrix clicks open persistent internal tabs', async () => {
  const view = await readSource('src/views/AuthorsView.tsx');
  assert.match(view, /setOpenAuthor\(author\);[\s\S]*setSurface\('author'\)/);
  assert.match(view, /setMatrixOpen\(true\);[\s\S]*setSurface\('matrix'\)/);
  assert.match(view, /surface === 'catalog' \? 'h-full' : 'hidden'/, 'the catalogue remains mounted behind other tabs');
  assert.match(view, /surface === 'author' \? 'h-full' : 'hidden'/, 'author detail remains mounted as a tab');
  assert.match(view, /surface === 'matrix' \? 'h-full p-5' : 'hidden'/, 'the synthesis matrix remains mounted as a tab');
});

test('author detail reads synthesis, works, searchable ideas and strongest connected authors in that order', async () => {
  const view = await readSource('src/views/AuthorsView.tsx');
  const synthesis = view.indexOf('data-testid="author-synthesis"');
  const works = view.indexOf("{/* 2. Works */}");
  const ideas = view.indexOf('<AuthorIdeasSection');
  const connections = view.indexOf('data-testid="author-connections"');
  assert.ok(synthesis >= 0 && works > synthesis && ideas > works && connections > ideas, 'detail sections follow the requested reading order');
  assert.match(view, /data-testid="author-ideas-search"/);
  assert.match(view, /right\.weight - left\.weight/, 'connected authors are ordered from strongest to weakest');
});
