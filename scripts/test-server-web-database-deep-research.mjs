import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
const readSource = (file) => readFile(path.join(root, file), 'utf8').then(variants);

test('database Deep Research Server is a private, scoped surface', async () => {
  const view = await readSource('src/serverWeb/DatabaseDeepResearchServerView.tsx');
  const app = await readSource('src/serverWeb/App.tsx');
  const gateway = await readSource('server/lib/ai/providerGateway.mjs');
  assert.match(view, /api\.runAI\(\s*spaceId,\s*["']database-deep-research["']/);
  assert.match(view, /api\.aiJobs\(\)/);
  assert.match(view, /api\.cancelAIJob\(job\.id/);
  assert.match(view, /api\.retryAIJob\(job\.id/);
  assert.match(view, /metadata\.surface === ["']database-deep-research["']/);
  assert.match(view, /job\.capability === ["']database-deep-research["']/);
  assert.match(view, /materializedJobs/);
  assert.match(view, /sourceJobId: job\.id/);
  assert.match(view, /SENSITIVE/);
  assert.match(view, /MAX_ROWS = 2_000/);
  assert.match(view, /data-testid="database-deep-research-composer"/);
  assert.match(view, /data-testid="database-deep-research-delete"/);
  assert.match(view, /serverModelsFor\(preferences, provider, model\)/);
  assert.doesNotMatch(view, /window\.nodus\./, 'Server surface must not call Desktop IPC');
  assert.match(app, /<DatabaseDeepResearchServerView key=\{active\.id\} spaceId=\{active\.id\} csrfToken=\{me\.csrfToken\}/);
  assert.match(gateway, /'database-deep-research'/);
});
