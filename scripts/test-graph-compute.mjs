// Exercises the REAL vector-math pipeline that keeps the graph build off the
// main thread: similarityCore (pure math), computeWorker (worker_threads
// roundtrip) and computeHost (worker path + inline fallback). The three paths
// must produce identical matches, because graphService picks whichever is
// available at runtime.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-graph-compute-'));

try {
  // ── Bundle the real sources ────────────────────────────────────────────────
  const coreOut = path.join(tmp, 'similarityCore.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/graph/similarityCore.ts')],
    outfile: coreOut,
    bundle: true,
    format: 'esm',
    platform: 'node',
  });
  const workerOut = path.join(tmp, 'computeWorker.js'); // CJS so worker_threads loads it without package.json hints
  await build({
    entryPoints: [path.join(repoRoot, 'electron/workers/computeWorker.ts')],
    outfile: workerOut,
    bundle: true,
    format: 'cjs',
    platform: 'node',
  });
  const hostOut = path.join(tmp, 'computeHost.cjs'); // __dirname works in CJS; computeWorker.js sits next to it
  await build({
    entryPoints: [path.join(repoRoot, 'electron/graph/computeHost.ts')],
    outfile: hostOut,
    bundle: true,
    format: 'cjs',
    platform: 'node',
  });
  await writeFile(path.join(tmp, 'package.json'), JSON.stringify({ type: 'commonjs' }));

  const core = await import(pathToFileURL(coreOut).href);

  // ── Pure math against known values ────────────────────────────────────────
  const v = (...nums) => new Float32Array(nums);
  assert.ok(Math.abs(core.cosineF32(v(1, 0), v(1, 0)) - 1) < 1e-6, 'identical vectors → 1');
  assert.equal(core.cosineF32(v(1, 0), v(0, 1)), 0, 'orthogonal → 0');
  assert.equal(core.cosineF32(v(0, 0), v(1, 1)), 0, 'zero vector → 0, not NaN');
  assert.ok(core.cosineF32(v(1, 1), v(1, 0.9)) > 0.99, 'near-parallel → ~1');

  assert.equal(core.centroidF32([]), null, 'empty centroid → null');
  const c = core.centroidF32([v(1, 0), v(0, 1)]);
  assert.deepEqual([...c], [0.5, 0.5], 'centroid is the mean');

  // ── topMatchesPerCentroid vs a brute-force oracle on seeded random data ───
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const dim = 24;
  const mkvec = () => new Float32Array(Array.from({ length: dim }, () => rand() * 2 - 1));
  const centroids = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, vector: mkvec() }));
  const candidates = Array.from({ length: 300 }, (_, i) => ({ id: `i${i}`, vector: mkvec() }));
  const THRESHOLD = 0.15;
  const MAXPC = 4;

  const oracle = [];
  for (const ct of centroids) {
    const scored = candidates
      .map((cand) => ({ centroidId: ct.id, candidateId: cand.id, similarity: core.cosineF32(ct.vector, cand.vector) }))
      .filter((m) => m.similarity >= THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, MAXPC);
    oracle.push(...scored);
  }

  const sync = core.topMatchesPerCentroid(centroids, candidates, THRESHOLD, MAXPC);
  assert.deepEqual(strip(sync), strip(oracle), 'sync path matches brute-force oracle');
  assert.ok(sync.every((m) => m.similarity >= THRESHOLD), 'threshold respected');

  let yields = 0;
  const chunked = await core.topMatchesPerCentroidChunked(centroids, candidates, THRESHOLD, MAXPC, async () => {
    yields += 1;
  }, 100);
  assert.deepEqual(strip(chunked), strip(oracle), 'chunked fallback identical to sync');
  assert.ok(yields > 0, 'chunked variant actually yields to the event loop');

  // ── Worker roundtrip with transferable buffers ─────────────────────────────
  const workerMatches = await new Promise((resolve, reject) => {
    const w = new Worker(workerOut);
    const timer = setTimeout(() => reject(new Error('worker timed out')), 10_000);
    w.on('message', (res) => {
      clearTimeout(timer);
      w.terminate();
      res.ok ? resolve(res.matches) : reject(new Error(res.error));
    });
    w.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    const wire = (list) => list.map((x) => ({ id: x.id, buffer: new Float32Array(x.vector).buffer }));
    const cw = wire(centroids);
    const iw = wire(candidates);
    w.postMessage(
      { id: 1, kind: 'themeMatches', centroids: cw, candidates: iw, threshold: THRESHOLD, maxPerCentroid: MAXPC },
      [...cw, ...iw].map((x) => x.buffer)
    );
  });
  assert.deepEqual(strip(workerMatches), strip(oracle), 'worker roundtrip identical to oracle');

  // ── computeHost: real worker path (computeWorker.js lives next to the host) ─
  delete process.env.NODUS_DISABLE_COMPUTE_WORKER;
  const { createRequire } = await import('node:module');
  const requireCjs = createRequire(import.meta.url);
  const host = requireCjs(hostOut);
  assert.equal(host.computeWorkerAvailable(), true, 'host finds the worker file');
  const viaWorker = await host.computeThemeMatches(centroids, candidates, THRESHOLD, MAXPC);
  assert.deepEqual(strip(viaWorker), strip(oracle), 'computeHost worker path identical to oracle');

  // Vectors must survive the transfer (host copies before transferring).
  assert.equal(centroids[0].vector.length, dim, 'caller vectors not detached by transfer');

  // ── computeHost: forced inline fallback produces the same results ──────────
  process.env.NODUS_DISABLE_COMPUTE_WORKER = '1';
  const viaFallback = await host.computeThemeMatches(centroids, candidates, THRESHOLD, MAXPC);
  assert.deepEqual(strip(viaFallback), strip(oracle), 'computeHost fallback identical to oracle');
  delete process.env.NODUS_DISABLE_COMPUTE_WORKER;

  console.log('graph compute (worker + fallback) test passed');
  process.exit(0);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

/** Round similarities so float noise between paths can't cause flaky diffs. */
function strip(matches) {
  return matches.map((m) => ({ c: m.centroidId, i: m.candidateId, s: Number(m.similarity.toFixed(5)) }));
}
