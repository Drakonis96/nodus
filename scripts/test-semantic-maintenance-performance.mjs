import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');
const [bridges, reprocess, queue, ideasRepo, worker, host] = await Promise.all([
  read('electron/ai/semanticBridges.ts'),
  read('electron/ai/reprocessConnections.ts'),
  read('electron/pipeline/scanQueue.ts'),
  read('electron/db/ideasRepo.ts'),
  read('electron/workers/computeWorker.ts'),
  read('electron/graph/computeHost.ts'),
]);

for (const [name, source] of [['semantic bridges', bridges], ['connection reprocessing', reprocess]]) {
  assert.equal(source.includes('findSimilarIdeas('), false, `${name} must not run synchronous per-idea SQLite vector scans`);
  assert.match(source, /computeNearestNeighbors\(/, `${name} must delegate similarity to the compute worker`);
}
assert.match(bridges, /MAX_MANUAL_QUERY_IDEAS = 400/, 'manual maintenance must be bounded');
assert.match(reprocess, /options\.nodusIds/, 'automatic reprocessing must accept changed-work scope');
assert.match(queue, /reprocessConnections\(\{ relations: true, nodusIds \}\)/, 'queue must pass only changed works');
assert.match(queue, /discoverSemanticBridges[\s\S]*?item\.scopeNodusIds/, 'automatic bridges must retain changed-work scope');

const postBatch = queue.slice(queue.indexOf('private async runPostBatch'), queue.indexOf('private chainAfterDeep'));
assert.ok(postBatch.indexOf('autoIndex(ids)') < postBatch.indexOf('autoReprocessConnections(ids)'), 'new vectors must be indexed before incremental similarity');
assert.match(ideasRepo, /ideaVectorsForCompute[\s\S]*?new Float32Array\(row\.embedding\.buffer/, 'worker vectors must stay compact Float32Array views');
assert.match(worker, /kind: 'themeMatches' \| 'nearestNeighbors'/, 'worker must support nearest-neighbour jobs');
assert.match(host, /export async function computeNearestNeighbors/, 'main process must expose worker-backed neighbour search');

console.log('Semantic maintenance performance checks passed.');
