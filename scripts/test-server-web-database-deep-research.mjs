import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('database Deep Research Server is a private, scoped surface', async () => {
  const view = await readFile(path.join(root, 'src/serverWeb/DatabaseDeepResearchServerView.tsx'), 'utf8');
  const app = await readFile(path.join(root, 'src/serverWeb/App.tsx'), 'utf8');
  const gateway = await readFile(path.join(root, 'server/lib/ai/providerGateway.mjs'), 'utf8');
  assert.match(view, /api\.runAI\(spaceId, 'database-deep-research'/);
  assert.match(view, /api\.aiJobs\(\)/);
  assert.match(view, /api\.cancelAIJob\(job\.id/);
  assert.match(view, /api\.retryAIJob\(job\.id/);
  assert.match(view, /metadata\.surface === 'database-deep-research'/);
  assert.match(view, /job\.capability === 'database-deep-research'/);
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
