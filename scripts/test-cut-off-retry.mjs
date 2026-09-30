import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-cut-off-retry-'));
const outfile = path.join(tmp, 'cutOffRetry.mjs');
await build({ entryPoints: [path.join(root, 'electron/ai/cutOffRetry.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { retryOnceWhenCutOff } = await import(pathToFileURL(outfile).href);
test.after(() => rm(tmp, { recursive: true, force: true }));

class Cut extends Error { code = 'output_truncated'; }
const isCutOff = (error) => error instanceof Cut;
const calls = (...outcomes) => { let n = 0; const fn = async () => { const o = outcomes[n++]; if (o instanceof Error) throw o; return o; }; fn.count = () => n; return fn; };

test('a cut-off answer is retried once and the retry is returned', async () => {
  const write = calls(new Cut('cut'), 'answer');
  let resets = 0;
  assert.equal(await retryOnceWhenCutOff(write, { isCutOff, beforeRetry: () => resets++ }), 'answer');
  assert.equal(write.count(), 2);
  assert.equal(resets, 1, 'the provisional stream is cleared before the retry');
});

test('a second cut-off is thrown; other errors are never retried', async () => {
  await assert.rejects(retryOnceWhenCutOff(calls(new Cut('1'), new Cut('2')), { isCutOff }), /2/);
  const other = calls(new Error('network'), 'never');
  await assert.rejects(retryOnceWhenCutOff(other, { isCutOff }), /network/);
  assert.equal(other.count(), 1);
});

test('a cancelled turn is not retried', async () => {
  const controller = new AbortController(); controller.abort();
  const write = calls(new Cut('cut'), 'never');
  await assert.rejects(retryOnceWhenCutOff(write, { isCutOff, signal: controller.signal }), /cut/);
  assert.equal(write.count(), 1);
});

test('a first answer is returned without a retry', async () => {
  const write = calls('first');
  assert.equal(await retryOnceWhenCutOff(write, { isCutOff }), 'first');
  assert.equal(write.count(), 1);
});
