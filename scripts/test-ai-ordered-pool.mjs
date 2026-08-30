import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadPool() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nodus-ordered-pool-'));
  const output = path.join(directory, 'pool.mjs');
  await build({ entryPoints: [path.join(root, 'electron/ai/orderedPool.ts')], outfile: output, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  return { mapOrderedPool: (await import(pathToFileURL(output))).mapOrderedPool, directory };
}

test('ordered pool bounds concurrency and reconstructs by input index', async () => {
  const { mapOrderedPool, directory } = await loadPool();
  try {
    let active = 0;
    let peak = 0;
    const result = await mapOrderedPool([40, 5, 25, 1], 2, async (delay, index) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return `result-${index}`;
    });
    assert.equal(peak, 2);
    assert.deepEqual(result, ['result-0', 'result-1', 'result-2', 'result-3']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a fatal worker aborts pending work and returns the original error', async () => {
  const { mapOrderedPool, directory } = await loadPool();
  try {
    const started = [];
    await assert.rejects(mapOrderedPool([0, 1, 2, 3, 4], 2, async (_value, index, signal) => {
      started.push(index);
      if (index === 1) throw new Error('fatal-schema');
      await new Promise((resolve) => setTimeout(resolve, 20));
      signal.throwIfAborted();
      return index;
    }), /fatal-schema/);
    assert.ok(!started.includes(4), `pending work started after fatal failure: ${started.join(',')}`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
