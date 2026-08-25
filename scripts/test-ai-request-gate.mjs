import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadGate() {
  const output = await mkdtemp(path.join(os.tmpdir(), 'nodus-ai-gate-'));
  const bundle = path.join(output, 'gate.mjs');
  await build({
    entryPoints: [path.join(root, 'electron/ai/aiRequestGate.ts')],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  return { Gate: (await import(pathToFileURL(bundle))).AiRequestGate, output };
}

test('the AI request gate enforces the configured process-wide limit', async () => {
  const { Gate, output } = await loadGate();
  try {
    let active = 0;
    let peak = 0;
    const releases = [];
    const gate = new Gate(() => 2);
    const jobs = Array.from({ length: 5 }, (_, index) => gate.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return index;
    }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(peak, 2);
    while (releases.length) {
      releases.shift()();
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4]);
    assert.equal(peak, 2);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('a request aborted while waiting never occupies a provider slot', async () => {
  const { Gate, output } = await loadGate();
  try {
    const gate = new Gate(() => 1);
    let releaseFirst;
    const first = gate.run(() => new Promise((resolve) => { releaseFirst = resolve; }));
    const controller = new AbortController();
    let ran = false;
    const waiting = gate.run(async () => { ran = true; }, controller.signal);
    controller.abort(new Error('cancelled'));
    await assert.rejects(waiting, /cancelled/);
    assert.equal(ran, false);
    releaseFirst();
    await first;
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
