import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'idle-deadline-'));
await build({ entryPoints: ['electron/ai/transportDeadline.ts'], outfile: path.join(dir, 'deadline.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { withIdleTransportDeadline } = await import(pathToFileURL(path.join(dir, 'deadline.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a stream that keeps sending chunks outlives the idle deadline', async () => {
  // 12 chunks 20 ms apart = 240 ms, far past a 60 ms idle deadline: steady reasoning is progress.
  const chunks = await withIdleTransportDeadline(60, 5_000, undefined, async (signal, touch) => {
    let n = 0;
    for (; n < 12; n++) { await sleep(20); if (signal.aborted) break; touch(); }
    return n;
  });
  assert.equal(chunks, 12);
});

test('a stream that goes silent times out as idle, and a quiet end after the abort is not a success', async () => {
  await assert.rejects(withIdleTransportDeadline(40, 5_000, undefined, async (signal) => {
    // Some SDK streams stop iterating when aborted instead of throwing: return normally.
    while (!signal.aborted) await sleep(5);
    return 'partial';
  }), (error) => error.name === 'TimeoutError' && /no data for 40 ms/.test(error.message));
});

test('the total ceiling still bounds a stream that never finishes', async () => {
  await assert.rejects(withIdleTransportDeadline(1_000, 80, undefined, async (signal, touch) => {
    while (!signal.aborted) { await sleep(5); touch(); }
    return 'never';
  }), (error) => error.name === 'TimeoutError' && /after 80 ms/.test(error.message));
});

test('a caller abort is passed through, not reported as a timeout', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error('stopped by the user')), 20);
  await assert.rejects(withIdleTransportDeadline(1_000, 5_000, controller.signal, async (signal) => {
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  }), /stopped by the user/);
});
