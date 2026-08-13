import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './ipc-channel-census.mjs';

test('Ideas opens as a library-style metadata catalogue', async () => {
  const view = await readSource('src/views/IdeasView.tsx');
  for (const marker of ['ideas-workspace', 'ideas-table-scroll', 'ideas-catalog-table', 'ideas-search']) {
    assert.match(view, new RegExp(marker));
  }
  for (const field of ['Idea', 'Tipo', 'Nº de obras', 'Nº de conexiones', 'Confianza', 'Temas']) {
    assert.match(view, new RegExp(field), `catalogue shows ${field}`);
  }
  for (const metadata of ['node.statement', 'node.workCount', 'node.connectionCount', 'node.maxConfidence', 'node.themes']) {
    assert.match(view, new RegExp(metadata.replace('.', '\\.')), `${metadata} is visible in the catalogue`);
  }
});

test('Ideas catalogue can be searched, filtered and sorted', async () => {
  const view = await readSource('src/views/IdeasView.tsx');
  assert.match(view, /data-testid="ideas-filters-toggle"/);
  assert.match(view, /data-testid="ideas-type-filter"/);
  assert.match(view, /data-testid="ideas-sort"/);
  for (const sort of ['label', 'type', 'works', 'connections', 'confidence']) {
    assert.match(view, new RegExp(`sort="${sort}"|value="${sort}"`), `catalogue supports ${sort} sorting`);
  }
});

test('clicking an idea opens a persistent detail tab', async () => {
  const view = await readSource('src/views/IdeasView.tsx');
  assert.match(view, /setSelectedId\(idea\.id\);[\s\S]*setOpenIdea\(idea\);[\s\S]*setSurface\('idea'\)/);
  assert.match(view, /data-testid="ideas-tab-catalog"/);
  assert.match(view, /data-testid="ideas-tab-idea"/);
  assert.match(view, /surface === 'catalog' \? 'flex h-full min-h-0 flex-col' : 'hidden'/, 'catalogue stays mounted behind the detail tab');
  assert.match(view, /surface === 'idea' \? 'h-full overflow-y-auto p-5' : 'hidden'/, 'idea detail is rendered as a workspace tab');
});

test('idea detail keeps evidence, works and expandable connected ideas', async () => {
  const view = await readSource('src/views/IdeasView.tsx');
  assert.match(view, /detail\.occurrences\.map/);
  assert.match(view, /detail\.evidence\.map/);
  assert.match(view, /data-testid="idea-connections"/);
  assert.match(view, /<ConnectedIdeaRow/);
  assert.match(view, /aria-expanded=\{open\}/, 'connected ideas remain expandable inline');
});

test('Ideas catalogue and detail explicitly support light and dark themes', async () => {
  const view = await readSource('src/views/IdeasView.tsx');
  assert.match(view, /bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100/);
  assert.match(view, /border-neutral-200[^\n]*dark:border-neutral-800/);
  assert.match(view, /hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900\/55/);
  assert.match(view, /border-indigo-100 bg-indigo-50\/80[^\n]*dark:border-neutral-800 dark:bg-neutral-900\/35/);
});

test('academic, generic, study and teaching idea routes share the academic Ideas surface', async () => {
  const corpus = await readSource('src/app/views/corpus.tsx');
  const studyRegistry = await readSource('src/app/views/study.tsx');
  const study = await readSource('src/views/StudyIdeasView.tsx');
  assert.match(corpus, /ideas:[\s\S]*<IdeasView/);
  assert.match(studyRegistry, /studyIdeas:[\s\S]*<StudyIdeasView/);
  assert.match(study, /import \{ IdeasView \} from '\.\/IdeasView'/);
  assert.match(study, /return <IdeasView/);
  assert.doesNotMatch(study, /if \(!workspace\.subjects\.length\) return/, 'an empty study or teaching vault must not replace the catalogue with a bespoke empty screen');
});

test('study and teaching preserve the academic catalogue when there are no subjects', async () => {
  const study = await readSource('src/views/StudyIdeasView.tsx');
  const source = await readSource('src/views/studyKnowledgeViewSource.ts');
  assert.match(study, /emptyMessage=\{!hasSubjects/);
  assert.match(study, /disabled=\{!hasSubjects\}/);
  assert.match(study, /<option value="">\{t\('Asignatura'\)\}<\/option>/);
  assert.match(source, /if \(!subjectId\) return \{ items: \[\], total: 0/);
});
