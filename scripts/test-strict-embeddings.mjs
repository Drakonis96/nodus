import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function load() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nodus-strict-embeddings-'));
  const output = path.join(directory, 'strict.mjs');
  await build({ entryPoints: [path.join(root, 'electron/ai/strictEmbeddings.ts')], outfile: output, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  return { module: await import(pathToFileURL(output)), directory };
}

test('embedding validation rejects missing, duplicate, non-finite and incompatible vectors', async () => {
  const { module, directory } = await load();
  try {
    assert.throws(() => module.validateEmbeddingVectors([[1, 2]], 2, 'model'), /1 vectores para 2/);
    assert.throws(() => module.validateEmbeddingVectors([[1, 2], [1]], 2, 'model'), /dimensiones incompatibles/);
    assert.throws(() => module.validateEmbeddingVectors([[1, 2], [Number.NaN, 2]], 2, 'model'), /inválidos/);
    assert.throws(() => module.validateEmbeddingVectors([[0, 0]], 1, 'model'), /vacíos/);
    assert.throws(() => module.orderedEmbeddingEntries([
      { index: 0, embedding: [1, 2] }, { index: 0, embedding: [2, 3] },
    ], 2, 'model'), /índices ausentes, repetidos o desordenados/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a failed embedding batch is bisected without dropping or reordering inputs', async () => {
  const { module, directory } = await load();
  try {
    const calls = [];
    const result = await module.requestEmbeddingBatchWithBisection(['a', 'b', 'c', 'd'], async (texts) => {
      calls.push([...texts]);
      if (texts.length > 1) throw new Error('payload-too-large');
      return [[texts[0].charCodeAt(0), 1]];
    });
    assert.deepEqual(result, [[97, 1], [98, 1], [99, 1], [100, 1]]);
    assert.deepEqual(calls[0], ['a', 'b', 'c', 'd']);
    assert.equal(calls.filter((entry) => entry.length === 1).length, 4);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('rate-limit and configuration failures do not recursively amplify embedding traffic', async () => {
  const { module, directory } = await load();
  try {
    let calls = 0;
    const failure = Object.assign(new Error('rate-limited'), { retriable: true });
    await assert.rejects(
      module.requestEmbeddingBatchWithBisection(
        ['a', 'b', 'c', 'd'],
        async () => { calls += 1; throw failure; },
        undefined,
        (error) => !error.retriable,
      ),
      /rate-limited/,
    );
    assert.equal(calls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
