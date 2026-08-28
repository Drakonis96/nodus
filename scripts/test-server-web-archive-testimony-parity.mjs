import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('archive nested records keep dedicated, navigable published dossiers', async () => {
  const corpus = await read('server/lib/routes/corpus.mjs');
  const surfaces = await read('src/serverWeb/vaults/index.tsx');
  const app = await read('src/serverWeb/App.tsx');
  assert.match(corpus, /head === 'archive-repositories'/);
  assert.match(corpus, /head === 'archive-units'/);
  assert.match(corpus, /head === 'archive-excerpts'/);
  assert.match(corpus, /head === 'source-analyses'/);
  assert.match(corpus, /items: rows\(snapshot, 'archive_items'\)/);
  assert.match(surfaces, /data-testid="archive-repository-detail"/);
  assert.match(surfaces, /data-testid="archive-unit-detail"/);
  assert.match(surfaces, /data-testid="archive-excerpt-detail"/);
  assert.match(surfaces, /data-testid="source-analysis-detail"/);
  assert.match(surfaces, /onOpenRecord\?\.\('archive-items'/);
  assert.match(app, /archive_repositories.*archive_description_units.*archive_excerpts/);
});

test('testimony code detail exposes annotations without private interview identities', async () => {
  const corpus = await read('server/lib/routes/corpus.mjs');
  const surfaces = await read('src/serverWeb/vaults/index.tsx');
  const app = await read('src/serverWeb/App.tsx');
  assert.match(corpus, /head === 'testimony-codes'/);
  assert.match(corpus, /annotations: rows\(snapshot, 'testimony_annotations'\)/);
  assert.match(corpus, /interview_id: _interviewId, transcript_id: _transcriptId/);
  assert.match(surfaces, /data-testid="testimony-code-detail"/);
  assert.match(surfaces, /Fragmentos anotados/);
  assert.match(app, /testimony_transcripts.*testimony_codes/);
});
