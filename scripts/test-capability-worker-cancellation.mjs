import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-worker-cancel-'));
const outfile = path.join(tmp, 'worker.mjs');
globalThis.__workerCancelChildren = [];
await build({ entryPoints: [path.join(root, 'electron/capabilities/workerHost.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'worker-process-fixture', setup(api) {
    api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }));
    api.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
      import { EventEmitter } from 'node:events';
      export const utilityProcess = { fork() {
        const child = new EventEmitter(); child.messages = []; child.killed = false;
        child.postMessage = message => { child.messages.push(message); if(message.type === 'shutdown') queueMicrotask(() => child.emit('exit',0)); };
        child.kill = () => { child.killed = true; };
        globalThis.__workerCancelChildren.push(child); return child;
      } };
    ` }));
  } }],
});
const { CapabilityWorkerHandle } = await import(pathToFileURL(outfile));
const handleFor = () => new CapabilityWorkerHandle({ capabilityId: 'nodus:test', plugin: { id: 'test', version: '1', digest: 'a'.repeat(64) }, manifest: {}, entryPath: '/isolated/worker.cjs', permissions: {} }, { bootstrapPath: '/isolated/bootstrap.cjs', services: async () => null });
const tick = () => new Promise(resolve => setImmediate(resolve));
const ready = child => child.emit('message', { type: 'ready', protocol: 1, capabilityId: 'nodus:test' });
test.after(() => rm(tmp, { recursive: true, force: true }));

test('cancellation during the worker handshake settles promptly and never invokes the tool', async () => {
  const handle = handleFor(), controller = new AbortController();
  const pending = handle.call('invoke', {}, { signal: controller.signal });
  pending.catch(() => {});
  const child = globalThis.__workerCancelChildren.at(-1);
  child.emit('spawn');
  controller.abort();
  let timer;
  try {
    await assert.rejects(Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('cancel waited for worker readiness')), 200); })]), { name: 'AbortError' });
    ready(child); // A late handshake cannot resurrect the cancelled invocation.
    await tick();
    assert.ok(child.messages.some(message => message.type === 'cancel'));
    assert.ok(!child.messages.some(message => message.type === 'call'));
  } finally { clearTimeout(timer); await handle.stop(); }
});

test('cancellation arriving with the ready frame still prevents the tool call', async () => {
  const handle = handleFor(), controller = new AbortController();
  const pending = handle.call('invoke', {}, { signal: controller.signal });
  pending.catch(() => {});
  const child = globalThis.__workerCancelChildren.at(-1);
  ready(child); controller.abort();
  try {
    await assert.rejects(pending, { name: 'AbortError' });
    assert.ok(!child.messages.some(message => message.type === 'call'));
  } finally { await handle.stop(); }
});

test('a live caller completes normally and an already aborted caller never forks', async () => {
  const handle = handleFor();
  const pending = handle.call('invoke', {});
  const child = globalThis.__workerCancelChildren.at(-1);
  ready(child); await tick();
  const call = child.messages.find(message => message.type === 'call');
  assert.ok(call);
  child.emit('message', { type: 'result', callId: call.callId, ok: true, value: 'normal result' });
  assert.equal(await pending, 'normal result');
  await handle.stop();
  const count = globalThis.__workerCancelChildren.length;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(handleFor().call('invoke', {}, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(globalThis.__workerCancelChildren.length, count);
});
