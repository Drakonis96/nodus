import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
const readSource = (file) => readFile(path.join(root, file), 'utf8').then(variants);

test('Primary Sources Web uses dedicated read-only adapters and published projections', async () => {
  const app = await readSource('src/serverWeb/App.tsx');
  const archive = await readSource('src/serverWeb/PrimarySourcesArchiveServerView.tsx');
  const corpus = await readSource('server/lib/routes/corpus.mjs');
  for (const marker of ['PrimarySourcesSearchView', 'PrimarySourcesTimelineView', 'PrimarySourcesMapView', 'PrimarySourcesRelationsView', 'PrimarySourcesPersonsView', 'PrimarySourcesArchiveServerView']) assert.match(app, new RegExp(marker));
  for (const marker of ['primary-sources-archive', 'primary-sources-provenance-tree', 'primary-sources-view-modes', 'archive-items']) assert.match(archive, new RegExp(marker));
  for (const marker of ['primary-sources', 'primarySourceTimeline', 'primarySourceMap', 'primarySourceRelations', 'primarySourcePersons', 'primarySourceEvidence']) assert.match(corpus, new RegExp(marker));
  assert.match(corpus, /requireSnapshot\(res, json, space\.id\)/);
  assert.doesNotMatch(archive, /window\.nodus\.(ingest|create|update|delete)/);
});

test('Primary Sources projection strips local file and identity-sensitive joins', async () => {
  const corpus = await readSource('server/lib/routes/corpus.mjs');
  const projection = corpus.slice(corpus.indexOf('function primarySourceEvidence'), corpus.indexOf('function primarySourcePersons'));
  assert.match(projection, /String\(row\.source_kind \?\? ''\) === 'archive'/);
  assert.match(projection, /archive_excerpts/);
  assert.match(projection, /persons: \[\], events: \[\]/);
  assert.doesNotMatch(projection, /archive_item_files/);
});

test('Primary Sources archive hierarchy preserves provenance and collection navigation', async () => {
  const archive = await readSource('src/serverWeb/PrimarySourcesArchiveServerView.tsx');
  assert.match(archive, /function ArchiveHierarchy/);
  assert.match(archive, /tree === 'provenance'/);
  assert.match(archive, /tree === 'collections'/);
  assert.match(archive, /primary-sources-archive-hierarchy/);
  assert.match(archive, /primary-source-hierarchy-group/);
  assert.match(archive, /mode === ['"]hierarchy['"] \?[\s\S]{0,40}<ArchiveHierarchy/);
  assert.match(archive, /onClick=\{\(\) => onOpen\(text\(item\.item_id/);
});
