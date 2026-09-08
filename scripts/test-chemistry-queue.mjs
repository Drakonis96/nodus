import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chemistry-queue-'));
await build({ entryPoints: ['electron/chemistry.ts'], outfile: path.join(temp, 'lib.mjs'), bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'controlled-tex', setup(api) {
  api.onResolve({ filter: /^node:module$/ }, () => ({ path: 'module', namespace: 'mock' }));
  api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const createRequire = () => () => ({ default: (...args) => globalThis.__testTex(...args) });' }));
} }], logLevel: 'silent' });
const { compileChemfig } = await import(pathToFileURL(path.join(temp, 'lib.mjs')).href);
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));

test('one process-global engine call at a time, including rejected and queued compiles', async () => {
  let active = 0, calls = 0;
  globalThis.__testTex = async (input, options) => {
    assert.deepEqual(options.texPackages, { amsmath: '', chemfig: '' });
    assert.equal(++active, 1); calls++;
    await new Promise(resolve => setImmediate(resolve)); active--;
    if (input.includes('broken')) throw new Error('bad TeX');
    return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  };
  const settled = await Promise.allSettled(['one', 'broken', 'two', 'three'].map(compileChemfig));
  assert.deepEqual(settled.map(s => s.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
  assert.equal(calls, 4); assert.equal(active, 0);
});

test('a timeout never hands a still-running WASM instance to the next queued job', async () => {
  const original = globalThis.setTimeout;
  let fire, calls = 0, finish;
  globalThis.__testTex = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  globalThis.setTimeout = (callback, ms) => { assert.equal(ms, 15000); fire = callback; return 0; };
  let first, second;
  try {
    first = compileChemfig('hung'); second = compileChemfig('queued');
    await new Promise(resolve => setImmediate(resolve));
  } finally { globalThis.setTimeout = original; }
  const outcomes = Promise.allSettled([first, second]); fire();
  assert.deepEqual((await outcomes).map(s => s.status), ['rejected', 'rejected']);
  assert.equal(calls, 1);
  finish('<svg></svg>');
  await assert.rejects(compileChemfig('later'), /restart/);
  assert.equal(calls, 1);
});
