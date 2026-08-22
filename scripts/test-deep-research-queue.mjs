// Tests for the single Deep Research generation lane. The real queue in
// electron/ai/deepResearchQueue.ts has no Electron/DB/AI dependencies (only erased
// type imports), so we bundle just that file with esbuild and drive it with fakes —
// no provider calls, no database, and crucially NOT the running local app instance.
//
// It locks the guarantees that make a *deferred* report safe to queue:
//   • only one report is ever generated at a time, whoever asked for it;
//   • a caller waiting behind others is told how many are ahead;
//   • a queued report survives a vault switch and resumes only against its own corpus;
//   • a report whose vault changed *during* generation is never saved as a draft of
//     the new vault;
//   • a report that cannot be filed is still returned, not thrown away;
//   • a queued report can be cancelled, a running one cannot;
//   • one failure does not stall the lane.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-deep-research-queue-test-'));

const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/** A report shaped just enough for the lane: it only ever touches `draft`. */
const fakeReport = (objective) => ({ draft: { title: objective, sections: [] } });

try {
  const outfile = path.join(tmp, 'deepResearchQueue.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/deepResearchQueue.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    alias: { '@shared': path.join(repoRoot, 'shared') },
    logLevel: 'silent',
  });
  const queue = await import(pathToFileURL(outfile).href);

  // ── One lane: two reports never generate at once ───────────────────────────
  {
    queue.__resetDeepResearchQueueForTest();
    let inFlight = 0;
    let maxInFlight = 0;
    const gates = [];
    queue.configureDeepResearchQueue({
      generate: (request) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((resolve) => {
          gates.push(() => {
            inFlight -= 1;
            resolve(fakeReport(request.objective));
          });
        });
      },
      saveDraft: () => 'draft-1',
      activeVault: () => ({ id: 'v1', name: 'Corpus' }),
    });

    const positions = [];
    const first = queue.runDeepResearchJob({ request: { objective: 'A' }, origin: 'app', save: false });
    const second = queue.runDeepResearchJob({ request: { objective: 'B' }, origin: 'mcp', save: false }, (p) =>
      positions.push(p)
    );

    // `>= 1`, not `=== 1`: if the lane ever let both start, this must reach the
    // assertion below and name the fault, not hang waiting for a count it overshot.
    await waitFor(() => gates.length >= 1, 'the first report to start');
    assert.equal(maxInFlight, 1, 'a second report must not start while one is generating');
    const queued = queue.listDeepResearchJobs().find((job) => job.title === 'B');
    assert.equal(queued.status, 'queued');
    assert.equal(queued.ahead, 1, 'the waiting report knows one is in front of it');
    assert.deepEqual(
      positions.map((p) => p.phase),
      ['queued'],
      'a caller that has to wait is told so'
    );
    assert.match(positions[0].message, /1 informe/);

    gates[0]();
    await first;
    await waitFor(() => gates.length === 2, 'the second report to start');
    gates[1]();
    await second;
    assert.equal(maxInFlight, 1, 'the lane never ran two pipelines at once');
    assert.equal(queue.isDeepResearchLaneBusy(), false);
  }

  // ── A vault switch parks the job until its own corpus is active again ────────
  {
    queue.__resetDeepResearchQueueForTest();
    let generated = 0;
    let vault = { id: 'v1', name: 'Corpus A' };
    const gates = [];
    queue.configureDeepResearchQueue({
      generate: (request) => {
        generated += 1;
        return new Promise((resolve) => gates.push(() => resolve(fakeReport(request.objective))));
      },
      saveDraft: () => 'draft-1',
      activeVault: () => vault,
      // Flips the vault the moment the first report is filed and before the next one
      // is picked up, so the switch happens exactly while B is still waiting.
      onSettled: (job) => {
        if (job.title === 'A') vault = { id: 'v2', name: 'Corpus B' };
      },
    });

    const running = queue.runDeepResearchJob({ request: { objective: 'A' }, origin: 'app', save: false });
    const deferred = queue.runDeepResearchJob({ request: { objective: 'B' }, origin: 'mcp', save: false });
    await waitFor(() => gates.length === 1, 'the first report to start');

    gates[0]();
    await running;
    await waitFor(() => queue.listDeepResearchJobs().find((job) => job.title === 'B')?.status === 'queued', 'the deferred report to remain parked');
    assert.equal(generated, 1, 'the deferred report was never generated against the new vault');
    vault = { id: 'v1', name: 'Corpus A' };
    assert.equal(queue.cancelDeepResearchJobsForOtherVaults('v1'), 0, 'the legacy switch hook preserves durable work');
    await waitFor(() => gates.length === 2, 'the parked report to resume in its vault');
    gates[1]();
    assert.equal((await deferred).draft.title, 'B');
    assert.equal(generated, 2);
  }

  // ── Approach/model survive queue serialization and completion metadata ──────
  {
    queue.__resetDeepResearchQueueForTest();
    const model = { provider: 'gemini', model: 'gemini-3.1-flash-lite' };
    queue.configureDeepResearchQueue({
      generate: (request) => Promise.resolve({
        draft: {
          title: request.objective,
          deepResearchApproach: request.approach,
          generationModel: request.model,
        },
      }),
      saveDraft: () => 'draft-approach',
      activeVault: () => ({ id: 'v1', name: 'Corpus' }),
    });
    const report = await queue.runDeepResearchJob({
      request: { objective: 'Comparar A y B', approach: 'comparative', model },
      origin: 'mcp',
      save: true,
    });
    const restored = JSON.parse(JSON.stringify(queue.listDeepResearchJobs()[0]));
    assert.equal(restored.deepResearchApproach, 'comparative');
    assert.deepEqual(restored.model, model);
    assert.equal(report.draft.deepResearchApproach, 'comparative');
    assert.deepEqual(report.draft.generationModel, model);
  }

  // ── A vault switch *during* generation must not save into the new vault ─────
  {
    queue.__resetDeepResearchQueueForTest();
    let vault = { id: 'v1', name: 'Corpus A' };
    const saves = [];
    let release;
    queue.configureDeepResearchQueue({
      generate: (request) =>
        new Promise((resolve) => {
          release = () => resolve(fakeReport(request.objective));
        }),
      saveDraft: (input) => {
        saves.push(input);
        return 'draft-1';
      },
      activeVault: () => vault,
    });

    const job = queue.runDeepResearchJob({ request: { objective: 'A' }, origin: 'mcp', save: true }).catch((e) => e);
    await waitFor(() => typeof release === 'function', 'generation to start');
    vault = { id: 'v2', name: 'Corpus B' };
    release();

    const outcome = await job;
    assert.ok(outcome instanceof Error, 'a report whose vault changed mid-generation must not be handed back as if nothing happened');
    assert.match(outcome.message, /Corpus A/);
    assert.equal(saves.length, 0, 'a finished report is never filed in a vault it was not researched against');
    assert.equal(queue.listDeepResearchJobs()[0].status, 'failed');
  }

  // ── A report that cannot be filed is still a report ────────────────────────
  {
    queue.__resetDeepResearchQueueForTest();
    queue.configureDeepResearchQueue({
      generate: (request) => Promise.resolve(fakeReport(request.objective)),
      saveDraft: () => {
        throw new Error('disk full');
      },
      activeVault: () => ({ id: 'v1', name: 'Corpus' }),
    });

    const report = await queue.runDeepResearchJob({ request: { objective: 'A' }, origin: 'mcp', save: true });
    assert.equal(report.draft.title, 'A', 'the generation is returned even though it could not be stored');
    const record = queue.listDeepResearchJobs()[0];
    assert.equal(record.status, 'completed');
    assert.equal(record.savedDraftId, null);
    assert.match(record.saveError, /disk full/);
    assert.equal(queue.getDeepResearchJob(record.id).report.draft.title, 'A', 'the report stays readable through the job');
  }

  // ── Cancelling: queued yes, running no ─────────────────────────────────────
  {
    queue.__resetDeepResearchQueueForTest();
    let release;
    queue.configureDeepResearchQueue({
      generate: (request) =>
        new Promise((resolve) => {
          release = () => resolve(fakeReport(request.objective));
        }),
      saveDraft: () => 'draft-1',
      activeVault: () => ({ id: 'v1', name: 'Corpus' }),
    });

    const running = queue.runDeepResearchJob({ request: { objective: 'A' }, origin: 'app', save: false });
    const waiting = queue.enqueueDeepResearchJob({ request: { objective: 'B' }, origin: 'mcp', save: false });
    await waitFor(() => typeof release === 'function', 'generation to start');

    const runningId = queue.listDeepResearchJobs().find((job) => job.title === 'A').id;
    assert.equal(queue.cancelDeepResearchJob(runningId), false, 'a running report is never abandoned mid-flight');
    assert.equal(queue.cancelDeepResearchJob(waiting.id), true);
    assert.equal(queue.getDeepResearchJob(waiting.id).job.status, 'cancelled');
    assert.equal(queue.cancelDeepResearchJob(waiting.id), false, 'cancelling twice is not a second cancellation');

    release();
    await running;
    assert.equal(queue.listDeepResearchJobs().filter((job) => job.status === 'completed').length, 1);
  }

  // ── A failure does not stall the lane ──────────────────────────────────────
  {
    queue.__resetDeepResearchQueueForTest();
    const changes = [];
    const settled = [];
    queue.configureDeepResearchQueue({
      generate: (request) =>
        request.objective === 'boom' ? Promise.reject(new Error('provider exploded')) : Promise.resolve(fakeReport(request.objective)),
      saveDraft: () => 'draft-1',
      activeVault: () => ({ id: 'v1', name: 'Corpus' }),
      onChange: (jobs) => changes.push(jobs),
      onSettled: (job) => settled.push(job),
    });

    const failing = queue.runDeepResearchJob({ request: { objective: 'boom' }, origin: 'mcp', save: false });
    const following = queue.runDeepResearchJob({ request: { objective: 'ok' }, origin: 'mcp', save: false });
    await assert.rejects(failing, /provider exploded/);
    const report = await following;
    assert.equal(report.draft.title, 'ok', 'the report behind a failed one still runs');
    assert.deepEqual(
      settled.map((job) => job.status),
      ['failed', 'completed']
    );
    assert.ok(changes.length > 0, 'the lane broadcasts its state so the app window can mirror it');

    assert.equal(queue.clearFinishedDeepResearchJobs(), 2);
    assert.deepEqual(queue.listDeepResearchJobs(), [], 'clearing empties the finished tail');
  }

  // ── Relaunch restores running work as queued and keeps foreign-vault work ───
  {
    queue.__resetDeepResearchQueueForTest();
    let vault = { id: 'v2', name: 'Corpus B' };
    const persisted = [];
    const restored = {
      record: {
        id: 'drj-restored', origin: 'mcp', vaultId: 'v1', vaultName: 'Corpus A', objective: 'Restored', title: 'Restored',
        deepResearchApproach: 'general', model: null, status: 'running', progress: { phase: 'writing', message: 'Writing' },
        error: null, savedDraftId: null, saveError: null, ahead: null, enqueuedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(), finishedAt: null,
      },
      request: { objective: 'Restored', language: 'en' },
      save: false,
      draftTitle: null,
    };
    queue.configureDeepResearchQueue({
      generate: (request) => Promise.resolve(fakeReport(request.objective)),
      saveDraft: () => 'draft-1',
      activeVault: () => vault,
      load: () => [restored],
      persist: (jobs) => persisted.push(structuredClone(jobs)),
    });

    let parked = queue.getDeepResearchJob('drj-restored').job;
    assert.equal(parked.status, 'queued', 'a process interruption turns running back into recoverable queued work');
    assert.match(parked.progress.message, /Recovered/);
    assert.equal(queue.cancelDeepResearchJobsForOtherVaults('v2'), 0);
    parked = queue.getDeepResearchJob('drj-restored').job;
    assert.equal(parked.status, 'queued', 'opening another vault never deletes the restored request');
    vault = { id: 'v1', name: 'Corpus A' };
    queue.cancelDeepResearchJobsForOtherVaults('v1');
    await waitFor(() => queue.getDeepResearchJob('drj-restored').job.status === 'completed', 'the restored request to finish');
    assert.ok(persisted.some((snapshot) => snapshot.some((job) => job.record.status === 'completed')), 'terminal state is durably checkpointed');
  }

  // ── The finished tail stays bounded ────────────────────────────────────────
  {
    queue.__resetDeepResearchQueueForTest();
    queue.configureDeepResearchQueue({
      generate: (request) => Promise.resolve(fakeReport(request.objective)),
      saveDraft: () => 'draft-1',
      activeVault: () => ({ id: 'v1', name: 'Corpus' }),
    });

    for (let i = 0; i < 25; i++) {
      await queue.runDeepResearchJob({ request: { objective: `report ${i}` }, origin: 'mcp', save: false });
    }
    const all = queue.listDeepResearchJobs();
    assert.equal(all.length, 20, 'the lane keeps a bounded history');
    assert.equal(all.filter((job) => queue.getDeepResearchJob(job.id).report !== null).length, 5, 'only the last few reports stay in memory');
    assert.equal(all[all.length - 1].title, 'report 24', 'the newest report is the last one kept');
  }

  console.log('deep research queue test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
