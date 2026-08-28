import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('prosopography publishes aggregate-only tables and never raw identity resolution', async () => {
  const snapshot = await read('electron/serverSync/serverSnapshot.ts');
  const corpus = await read('server/lib/routes/corpus.mjs');
  const search = await read('server/lib/core/search.mjs');
  const surfaces = await read('src/serverWeb/vaults/index.tsx');
  const academicSearch = await read('src/serverWeb/academic/SearchServerView.tsx');

  assert.match(snapshot, /buildProsopographyPublicProjection/);
  assert.match(snapshot, /prosopography_public_population/);
  assert.match(snapshot, /publication_state: 'aggregate_only'/);
  assert.match(snapshot, /vault\.type === 'prosopography'\) Object\.assign/);
  assert.match(snapshot, /prosop_person_profiles/);
  assert.match(snapshot, /privacy_status !== 'restricted'/);
  assert.doesNotMatch(snapshot, /selected\.add\(['"]prosop_/);

  for (const collection of ['population', 'variables', 'sources', 'analysis', 'networks']) {
    assert.match(corpus, new RegExp(`prosopography-public-${collection}`));
  }
  assert.match(corpus, /identityResolution: false/);
  assert.match(search, /prosopography_public_search/);
  assert.match(search, /type: typeof row\.type === 'string'/);
  assert.match(academicSearch, /prosopStudy/);
  assert.match(academicSearch, /prosopVariable/);
  assert.match(academicSearch, /prosopSource/);
  assert.match(surfaces, /no se publican personas ni identidades/);
  assert.match(surfaces, /no se publican nodos, aristas ni resolución de identidad/);
  assert.match(surfaces, /aggregateAvailable/);
});

test('testimony catalogue, facets and reader keep participants and media private', async () => {
  const snapshot = await read('electron/serverSync/serverSnapshot.ts');
  const corpus = await read('server/lib/routes/corpus.mjs');
  const surfaces = await read('src/serverWeb/vaults/index.tsx');
  const search = await read('server/lib/core/search.mjs');

  assert.match(snapshot, /testimonySafeRow|(?:participant\|speaker\|narrator)/);
  assert.match(snapshot, /testimony_interviews.*testimony_transcripts.*testimony_annotations/s);
  assert.match(corpus, /function testimonySafeRow/);
  assert.match(corpus, /function publishedTestimonyFacets/);
  assert.match(corpus, /savedViews: \['all', 'transcribe', 'review', 'published'\]/);
  assert.match(corpus, /Grabación|media|testimony-media/);
  assert.match(corpus, /publishedTestimonyAnnotations\(snapshot\)/);
  assert.match(corpus, /speaker_person_id: _speakerPersonId/);
  assert.match(surfaces, /testimony-saved-views/);
  assert.match(surfaces, /testimony-facets/);
  assert.match(surfaces, /testimony-reader/);
  assert.match(surfaces, /testimony-media-state/);
  assert.match(surfaces, /Grabación no publicada/);
  assert.match(search, /table\.startsWith\('testimony_'\) \? testimonySafeRow/);
});
