// Indexing shows in the Queue as one entry, like Idea extraction: one row per document
// however many campaigns asked for it, and one progress figure for the whole set.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const repo = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-preparation-queue-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const outfile = path.join(scratch, 'queue.cjs');
await build({ entryPoints: [path.join(repo, 'src/preparationQueue.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', alias: { '@shared': path.join(repo, 'shared') } });
const { summarizePreparationQueue } = createRequire(import.meta.url)(outfile);
const job = (documentId, state, extra = {}) => ({ id: `job-${documentId}-${state}`, documentId, title: `Doc ${documentId}`, state, stage: 'embeddings', completedPassages: 0, totalPassages: 12, unknownRequests: 0, error: null, ...extra });
const campaign = (id, createdAt, jobs, embedding = { provider: 'openrouter', model: 'baai/bge-m3', external: true }) => ({ id, vaultId: 'v', vaultName: 'Vault', createdAt, updatedAt: createdAt, state: 'active', embedding, jobs });

test('a document asked for by two campaigns is one row, in its most relevant state', () => {
  const summary = summarizePreparationQueue({ paused: false, campaigns: [
    campaign('old', 1, [job('seville', 'failed', { error: 'documentary_embedding_job_unavailable' })]),
    campaign('new', 2, [job('seville', 'running', { completedPassages: 6 })]),
  ] });
  assert.equal(summary.items.length, 1);
  assert.equal(summary.items[0].state, 'running');
  assert.equal(summary.items[0].retryCampaignId, 'old', 'the failed request can still be retried from the row');
  assert.deepEqual(summary.items[0].liveCampaignIds, ['new']);
  assert.equal(summary.percent, 50, 'half the passages of the only document');
});

test('progress counts settled documents plus the one being embedded, and never reads 100% while live', () => {
  const summary = summarizePreparationQueue({ paused: false, campaigns: [campaign('c', 1, [
    job('a', 'complete'), job('b', 'failed'), job('c', 'running', { completedPassages: 3 }), job('d', 'queued'),
  ])] });
  assert.equal(summary.total, 4);
  assert.equal(summary.settled, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.running.documentId, 'c');
  assert.equal(summary.percent, Math.round(((2 + 0.25) / 4) * 100));
  const nearlyDone = summarizePreparationQueue({ paused: false, campaigns: [campaign('c', 1, [...Array.from({ length: 199 }, (_, i) => job(`x${i}`, 'complete')), job('last', 'queued')])] });
  assert.equal(nearlyDone.percent, 99);
  const done = summarizePreparationQueue({ paused: false, campaigns: [campaign('c', 1, [job('a', 'complete'), job('b', 'complete')])] });
  assert.deepEqual([done.percent, done.live], [100, false]);
});

test('an indexed document is not shown as failed because an older request for it failed', () => {
  const summary = summarizePreparationQueue({ paused: false, campaigns: [campaign('old', 1, [job('a', 'failed')]), campaign('new', 2, [job('a', 'complete')])] });
  assert.equal(summary.items[0].state, 'complete');
  assert.equal(summary.failed, 0);
});

test('a paused set reads as paused', () => {
  assert.equal(summarizePreparationQueue({ paused: true, campaigns: [campaign('c', 1, [job('a', 'queued')])] }).paused, true);
  assert.equal(summarizePreparationQueue({ paused: false, campaigns: [campaign('c', 1, [job('a', 'paused'), job('b', 'complete')])] }).paused, true);
  assert.equal(summarizePreparationQueue({ paused: false, campaigns: [] }).total, 0);
});
