import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-reranker-cancel-'));
const outfile = path.join(tmp, 'reranker.mjs');
globalThis.__rerankerTest = { children: [], health: [] };
await build({ entryPoints: [path.join(root, 'electron/ai/localReranker.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'isolated-reranker-process', setup(api) {
    const stubs = {
      electron: `export const app = { getPath: () => '/isolated', on() {} };`,
      'node:fs': `export default { statSync: () => ({size: 635676416}) };`,
      './nodusLocalAi': `export const llamaServerPath = async () => '/isolated/llama-server'; export const freePort = async () => 12345;`,
      'node:child_process': `import { EventEmitter } from 'node:events'; export function spawn() {
        const child = new EventEmitter(); child.exitCode = null; child.kills = [];
        child.kill = signal => { child.kills.push(signal); child.exitCode = 0; child.emit('exit'); };
        globalThis.__rerankerTest.children.push(child); return child;
      }`,
    };
    api.onResolve({ filter: /.*/ }, args => stubs[args.path] ? { path: args.path, namespace: 'stub' } : undefined);
    api.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path] }));
  } }],
});
const { rerank, stopReranker } = await import(pathToFileURL(outfile));
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (url.endsWith('/health')) return new Promise((resolve, reject) => {
    globalThis.__rerankerTest.health.push(resolve);
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  return { ok: true, json: async () => ({ results: [{ index: 0, relevance_score: 0.9 }] }) };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
test.after(async () => { stopReranker(); globalThis.fetch = originalFetch; await rm(tmp, { recursive: true, force: true }); });

test('cancelling the only startup waiter stops the process and a later request can retry', async () => {
  const controller = new AbortController();
  const pending = rerank('query', ['document'], controller.signal);
  pending.catch(() => {});
  await tick();
  const first = globalThis.__rerankerTest.children.at(-1);
  assert.ok(first);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await tick();
  assert.deepEqual(first.kills, ['SIGKILL']);
  const retry = rerank('retry', ['document']);
  await tick();
  assert.notEqual(globalThis.__rerankerTest.children.at(-1), first);
  globalThis.__rerankerTest.health.at(-1)({ ok: true });
  assert.deepEqual(await retry, [0.9]);
  stopReranker();
});

test('cancelling one of two startup waiters leaves the other request usable', async () => {
  const controller = new AbortController();
  const cancelled = rerank('first', ['document'], controller.signal);
  cancelled.catch(() => {});
  const live = rerank('second', ['document']);
  await tick();
  const child = globalThis.__rerankerTest.children.at(-1);
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.deepEqual(child.kills, []);
  globalThis.__rerankerTest.health.at(-1)({ ok: true });
  assert.deepEqual(await live, [0.9]);
  assert.deepEqual(child.kills, []);
  stopReranker();
});

test('an already cancelled request never spawns a process', async () => {
  const count = globalThis.__rerankerTest.children.length;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(rerank('query', ['document'], controller.signal), { name: 'AbortError' });
  assert.equal(globalThis.__rerankerTest.children.length, count);
});
