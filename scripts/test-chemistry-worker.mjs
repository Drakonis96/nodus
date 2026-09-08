import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-chemical-worker-'));
const bundle = path.join(temporary, 'host.cjs');
await build({ entryPoints: ['electron/chemistryValidationHost.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'electron', setup(api) {
  api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }));
  api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const utilityProcess = { fork: (...args) => globalThis.__forkChemistry(...args) };' }));
} }] });
const { validateChemistryInUtility } = createRequire(import.meta.url)(bundle);
process.on('exit', () => fs.rmSync(temporary, { recursive: true, force: true }));

function child() {
  const value = new EventEmitter(); value.kills = 0;
  value.kill = () => { value.kills++; value.emit('exit', 0); };
  value.postMessage = request => { value.request = request; };
  globalThis.__forkChemistry = () => value;
  return value;
}

test('a successful validator is killed after its result and receives only molecular inputs', async () => {
  const worker = child();
  const promise = validateChemistryInUtility({ references: ['CCO'] });
  assert.deepEqual(worker.request, { references: ['CCO'] });
  worker.emit('message', { result: { engineVersion: 'test' } });
  assert.equal((await promise).engineVersion, 'test');
  assert.equal(worker.kills, 1);
});

test('cancellation kills WASM execution rather than merely rejecting a raced promise', async () => {
  const worker = child(), controller = new AbortController();
  const promise = validateChemistryInUtility({ references: ['CCO'] }, controller.signal);
  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(worker.kills, 1);
});

test('hard deadline kills a nonresponsive process exactly once', async () => {
  const worker = child();
  const original = globalThis.setTimeout;
  let timeout;
  globalThis.setTimeout = (callback, ms) => { assert.equal(ms, 15000); timeout = callback; return 0; };
  let promise;
  try { promise = validateChemistryInUtility({ references: ['CCO'] }); } finally { globalThis.setTimeout = original; }
  timeout();
  await assert.rejects(promise, /exceeded 15 seconds/);
  worker.emit('message', { result: {} });
  assert.equal(worker.kills, 1);
});

test('multi-panel rules retain a bounded thirty-second deadline and are killed on expiry', async () => {
  const worker = child(), original = globalThis.setTimeout;
  let timeout, promise;
  globalThis.setTimeout = (callback, ms) => { assert.equal(ms, 30000); timeout = callback; return 0; };
  try { promise = validateChemistryInUtility({ references: ['CCBr'], mechanism: { rule: 'e2', inputs: ['CCBr', '[OH-]'] } }); } finally { globalThis.setTimeout = original; }
  timeout();
  await assert.rejects(promise, /exceeded 30 seconds/);
  worker.emit('message', { result: {} }); assert.equal(worker.kills, 1);
});
