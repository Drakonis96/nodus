import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The Documentary Index waits for a work the passage run has queued before preparing that work's
// passages, so the passage run cannot fence the index's publication mid-analysis.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-passage-activity-'));
const outfile = path.join(outDir, 'activity.mjs');
buildSync({ entryPoints: [path.join(repoRoot, 'electron/ai/passageEmbeddingActivity.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const activity = await import(pathToFileURL(outfile).href);
test.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

test('an index waits for a queued work and resumes once the passage run is done with it', async () => {
  activity.setPassageWorksPending(['w1', 'w2']);
  let resolved = false;
  const waiting = activity.waitForPassageWork('w1', undefined, 5).then(() => { resolved = true; });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(resolved, false, 'still queued');
  activity.passageWorkDone('w1');
  await waiting;
  assert.equal(resolved, true);
  assert.equal(activity.passageWorkPending('w2'), true);
});

test('a work the passage run never queued does not wait', async () => {
  activity.setPassageWorksPending([]);
  await activity.waitForPassageWork('other', undefined, 5);
});

test('a finished or stopped run releases every waiting index', async () => {
  activity.setPassageWorksPending(['w3']);
  activity.addPassageWorkPending('w4');
  const both = Promise.all([activity.waitForPassageWork('w3', undefined, 5), activity.waitForPassageWork('w4', undefined, 5)]);
  activity.setPassageWorksPending([]);
  await both;
});

test('a cancelled index stops waiting', async () => {
  activity.setPassageWorksPending(['w5']);
  const controller = new AbortController();
  const waiting = activity.waitForPassageWork('w5', controller.signal, 5);
  controller.abort();
  await assert.rejects(waiting);
  activity.setPassageWorksPending([]);
});
