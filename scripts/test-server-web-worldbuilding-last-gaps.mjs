import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('worldbuilding workbenches keep distinct server projections', async () => {
  const client = await readFile(path.join(root, 'src/serverWeb/vaults/index.tsx'), 'utf8');
  const server = await readFile(path.join(root, 'server/lib/routes/corpus.mjs'), 'utf8');

  assert.match(client, /variant: 'conflict-board'/);
  assert.match(client, /data-testid="conflicts-tab-board"/);
  assert.match(client, /data-testid="conflicts-tab-list"/);
  assert.match(client, /params\.kind = 'conflict'/);
  assert.match(client, /params\.surface = 'conflicts'/);
  assert.match(server, /publishedConflictBoard\(snapshot, all\)/);
  assert.match(server, /board: publishedConflictBoard/);

  assert.match(client, /variant: 'world-rules'/);
  assert.match(client, /Facetas/);
  assert.match(client, /values\('hardness'\)/);
  assert.match(client, /values\('health'\)/);
  assert.match(server, /publishedWorldRules\(snapshot\)/);
  assert.match(server, /rule_health: health/);

  assert.match(client, /variant: 'world-questions'/);
  assert.match(client, /questions-settled-toggle/);
  assert.match(client, /Preguntadas por ti/);
  assert.match(client, /Huecos de prosa/);
  assert.match(server, /publishedWorldQuestions\(snapshot\)/);
  assert.match(server, /blockedScene/);
});

test('continuity and manuscript remain honest read-only projections', async () => {
  const client = await readFile(path.join(root, 'src/serverWeb/vaults/index.tsx'), 'utf8');
  const server = await readFile(path.join(root, 'server/lib/routes/corpus.mjs'), 'utf8');

  assert.match(client, /variant: 'continuity'/);
  assert.match(client, /Avisos derivados del snapshot publicado/);
  assert.match(server, /surface === 'continuity'/);
  assert.match(server, /publishedContinuityFindings\(snapshot\)/);
  assert.match(client, /variant: 'manuscript'/);
  assert.match(server, /manuscript\.content_markdown \?\? manuscript\.text \?\? manuscript\.body/);
  assert.match(server, /event_world_dates/);
  assert.match(server, /world_year_sort/);
});
