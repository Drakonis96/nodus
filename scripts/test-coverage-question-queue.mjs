import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-coverage-question-queue-'));

const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const detail = (id, question) => ({
  rq: { id, question },
  subQuestions: [],
  stale: false,
  summary: { covered: 0, partial: 0, uncovered: 0, disputed: 0, unmapped: 0 },
});

try {
  const outfile = path.join(tmp, 'coverageQuestionQueue.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'src/coverageQuestionQueue.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['@shared/*'],
    logLevel: 'silent',
  });
  const { CoverageQuestionQueue } = await import(pathToFileURL(outfile).href);

  // Multiple submissions share one lane and become visible only after each
  // decomposition has finished.
  {
    let sequence = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const gates = [];
    const ready = [];
    const queue = new CoverageQuestionQueue({
      activeVaultId: async () => 'vault-1',
      create: async ({ question }) => detail(`rq-${++sequence}`, question),
      decompose: (rqId) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((resolve) => gates.push(() => {
          inFlight -= 1;
          resolve(detail(rqId, rqId));
        }));
      },
      remove: async () => {},
    });
    queue.subscribe((_jobs, event) => {
      if (event.type === 'ready') ready.push(event.rqId);
    });

    queue.enqueue({ vaultId: 'vault-1', question: 'Primera' });
    queue.enqueue({ vaultId: 'vault-1', question: 'Segunda' });
    await waitFor(() => gates.length === 1, 'the first question to start');
    assert.deepEqual(queue.snapshot().map((job) => job.status), ['running', 'queued']);
    assert.equal(maxInFlight, 1);

    gates[0]();
    await waitFor(() => ready.length === 1 && gates.length === 2, 'the second question to start');
    assert.deepEqual(ready, ['rq-1']);
    assert.deepEqual(queue.snapshot().map((job) => job.status), ['running']);

    gates[1]();
    await waitFor(() => ready.length === 2, 'both questions to finish');
    assert.deepEqual(ready, ['rq-1', 'rq-2']);
    assert.deepEqual(queue.snapshot(), []);
    assert.equal(maxInFlight, 1, 'question decomposition stays serial');
  }

  // One failed question is cleaned up and does not prevent the next queued one.
  {
    let sequence = 0;
    const removed = [];
    const ready = [];
    const queue = new CoverageQuestionQueue({
      activeVaultId: async () => 'vault-1',
      create: async ({ question }) => detail(`rq-${++sequence}`, question),
      decompose: async (rqId) => {
        if (rqId === 'rq-1') throw new Error('provider unavailable');
        return detail(rqId, rqId);
      },
      remove: async (rqId) => { removed.push(rqId); },
    });
    queue.subscribe((_jobs, event) => {
      if (event.type === 'ready') ready.push(event.rqId);
    });

    queue.enqueue({ vaultId: 'vault-1', question: 'Fallará' });
    queue.enqueue({ vaultId: 'vault-1', question: 'Continuará' });
    await waitFor(() => ready.length === 1, 'the lane to continue after an error');

    assert.deepEqual(removed, ['rq-1'], 'a failed half-created draft is removed');
    assert.deepEqual(ready, ['rq-2']);
    const failed = queue.snapshot();
    assert.equal(failed.length, 1);
    assert.equal(failed[0].status, 'failed');
    assert.match(failed[0].error, /provider unavailable/);
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('coverage question queue test passed');
