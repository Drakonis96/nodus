import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');

require.extensions['.ts'] = function loadTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(output, filename);
};

test('three consecutive publish failures cannot rebuild three snapshots in fifteen seconds', () => {
  const policy = require(path.join(repoRoot, 'electron/serverSync/publishRetryPolicy.ts'));
  const runtime = {
    pending: true,
    dirtySince: 1,
    lastUploadStartedAt: -Infinity,
    consecutiveFailures: 0,
    retryNotBefore: 0,
  };
  let snapshotBuilds = 0;

  for (let now = 0; now <= 15_000; now += 5_000) {
    if (policy.publishRetryIsDue(runtime, now)) runtime.pending = true;
    if (!runtime.pending || !policy.mayAttemptPublish(runtime, now)) continue;
    runtime.lastUploadStartedAt = now;
    snapshotBuilds += 1;
    // The simulated PUT fails after the expensive snapshot has been built.
    runtime.pending = false;
    runtime.dirtySince = 0;
    policy.notePublishFailure(runtime, now);
  }

  assert.equal(snapshotBuilds, 2, 'the first retry is delayed to 15 s; a third rebuild needs the 30 s backoff too');
  assert.equal(runtime.consecutiveFailures, 2);
  assert.equal(runtime.retryNotBefore, 45_000);
});

test('publish retry backoff grows exponentially, is capped, and success resets it', () => {
  const policy = require(path.join(repoRoot, 'electron/serverSync/publishRetryPolicy.ts'));
  const runtime = { consecutiveFailures: 0, retryNotBefore: 0, lastUploadStartedAt: 0 };
  const delays = [];
  let now = 100_000;
  for (let failure = 0; failure < 10; failure += 1) {
    policy.notePublishFailure(runtime, now);
    delays.push(runtime.retryNotBefore - now);
    now = runtime.retryNotBefore;
  }
  assert.deepEqual(delays.slice(0, 4), [15_000, 30_000, 60_000, 120_000]);
  assert.equal(delays.at(-1), policy.PUBLISH_RETRY_MAX_MS);
  assert.ok(delays.every((delay) => delay <= policy.PUBLISH_RETRY_MAX_MS));

  policy.clearPublishRetry(runtime);
  assert.equal(runtime.consecutiveFailures, 0);
  assert.equal(runtime.retryNotBefore, 0);
});
