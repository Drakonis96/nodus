// What a semantic search costs everybody else.
//
// A query compares the posted vector against every vector in the space. That is straight-line
// arithmetic with no I/O in it, so on the main thread it owns the process until it finishes:
// the health check the container polls, a phone opening a screen and a second person's search
// all wait behind it. This measures that directly — it fires searches at a real server while
// polling `/healthz`, and counts how many health checks got through while they ran.
//
// A count, not a stopwatch: "the server answered 0 of 60 health checks during the search" is
// the finding, and it does not move when the machine is busy the way a millisecond figure does.
//
// Both arms are the same server binary. The only difference is NODUS_VECTOR_WORKERS.
//
//   node scripts/bench-server-search.mjs
//   NODUS_BENCH_PASSAGES=33016 NODUS_BENCH_DIM=1024 node scripts/bench-server-search.mjs
//
// The defaults are the shape of a real corpus: 33,016 passages at 1024 dimensions, measured
// from an academic vault of 1,214 works.

import { gzipSync } from 'node:zlib';
import { withServer } from './lib/nodusServerHarness.mjs';

const COUNT = Number(process.env.NODUS_BENCH_PASSAGES || 33_016);
const DIM = Number(process.env.NODUS_BENCH_DIM || 1024);
const CONCURRENCY = Number(process.env.NODUS_BENCH_CONCURRENCY || 8);
const PROVIDER = 'openai';
const MODEL = 'text-embedding-3-small';

/** Deterministic bytes, so two runs of this benchmark compare like with like. */
function pseudoBytes(length, seed) {
  const out = new Int8Array(length);
  let state = seed;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out[index] = (state % 255) - 127;
  }
  return out;
}

/**
 * The published matrix, in the wire format server/lib/core/vectors.mjs decodes:
 *   [uint32le headerLength][header JSON][uint32le idsLength][ids JSON][count * dim int8]
 *
 * Built directly rather than through `encodeVectorSet`, which takes float32 entries: at this
 * size that would be 135 MB of Float32Arrays to produce 34 MB of int8.
 */
function vectorPayload(ids) {
  const matrix = Buffer.from(pseudoBytes(ids.length * DIM, 12_345).buffer);
  const header = Buffer.from(JSON.stringify({
    format: 'nodus.vectors', version: 1, kind: 'passages',
    provider: PROVIDER, model: MODEL, dim: DIM, quant: 'int8-l2', count: ids.length,
  }), 'utf8');
  const idTable = Buffer.from(JSON.stringify(ids), 'utf8');
  const headerLength = Buffer.alloc(4);
  headerLength.writeUInt32LE(header.length, 0);
  const idsLength = Buffer.alloc(4);
  idsLength.writeUInt32LE(idTable.length, 0);
  return Buffer.concat([headerLength, header, idsLength, idTable, matrix]);
}

function snapshotPayload(ids) {
  return {
    format: 'nodus.server-snapshot',
    formatVersion: 2,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    vault: { id: 'bench', name: 'Benchmark', type: 'academic' },
    capabilities: { includesUserContent: false, includesPassages: true, hasAssets: false },
    assets: [],
    tables: {
      works: [{ nodus_id: 'w-1', title: 'Benchmark work', authors_json: '[]' }],
      passages: ids.map((id, index) => ({ passage_id: id, nodus_id: 'w-1', page: index, text: `passage ${index}` })),
    },
  };
}

function queryVector() {
  const vector = new Array(DIM);
  let state = 99;
  for (let index = 0; index < DIM; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    vector[index] = (state / 2147483648) * 2 - 1;
  }
  return vector;
}

/**
 * Poll `/healthz` as fast as it answers, and record every reply, until stopped.
 *
 * Sequential on purpose: a fixed-interval poller would queue requests during a stall and
 * report them all as fast once it cleared. One request at a time means the count IS the
 * number of round trips the server actually completed.
 */
function healthPoller(origin) {
  const latencies = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const started = process.hrtime.bigint();
      try {
        await fetch(`${origin}/healthz`);
        latencies.push(Number(process.hrtime.bigint() - started) / 1e6);
      } catch {
        // A refused connection is not a measurement; keep polling.
      }
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      return latencies;
    },
  };
}

async function arm(label, env) {
  return withServer({ label: 'bench-search', env }, async (context) => {
    const spaceId = await context.createSpace('Benchmark');
    const { deviceToken: owner } = await context.deviceToken(context.adminEmail, context.adminPassword, spaceId);
    const ids = Array.from({ length: COUNT }, (_, index) => `p-${index}`);

    const snapshot = gzipSync(Buffer.from(JSON.stringify(snapshotPayload(ids))));
    const published = await context.api(owner, 'PUT', `/api/v1/spaces/${spaceId}/snapshot`, {
      headers: { 'content-type': 'application/vnd.nodus.snapshot+json', 'content-encoding': 'gzip', 'x-nodus-revision': `bench-${COUNT}` },
      body: snapshot,
    });
    if (!published.ok) throw new Error(`publish failed: ${published.status} ${await published.text()}`);

    const vectors = await context.api(owner, 'PUT', `/api/v1/spaces/${spaceId}/vectors?kind=passages`, {
      headers: { 'content-type': 'application/vnd.nodus.vectors' },
      body: vectorPayload(ids),
    });
    if (!vectors.ok) throw new Error(`vector upload failed: ${vectors.status} ${await vectors.text()}`);

    // One search first, so the matrix is decoded and cached and the measurement is not
    // dominated by reading 34 MB off disk.
    const warm = await context.api(owner, 'POST', `/api/v1/spaces/${spaceId}/search/semantic`, {
      json: { kind: 'passages', provider: PROVIDER, model: MODEL, dim: DIM, vector: queryVector(), limit: 5 },
    });
    if (!warm.ok) throw new Error(`search failed: ${warm.status} ${await warm.text()}`);

    const poller = healthPoller(context.origin);
    const started = process.hrtime.bigint();
    const searches = await Promise.all(Array.from({ length: CONCURRENCY }, () => context.api(owner, 'POST', `/api/v1/spaces/${spaceId}/search/semantic`, {
      json: { kind: 'passages', provider: PROVIDER, model: MODEL, dim: DIM, vector: queryVector(), limit: 5 },
    })));
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    const latencies = await poller.stop();

    const failed = searches.filter((response) => !response.ok);
    if (failed.length > 0) throw new Error(`${failed.length} searches failed: ${failed[0].status} ${await failed[0].text()}`);

    const worst = latencies.length > 0 ? Math.max(...latencies) : 0;
    return { label, health: latencies.length, worst, elapsed };
  });
}

const rows = [];
rows.push(await arm('worker threads (default)', {}));
rows.push(await arm('inline on the main thread', { NODUS_VECTOR_WORKERS: '0' }));

console.log(`\n${COUNT.toLocaleString()} vectors x ${DIM} dimensions, ${CONCURRENCY} concurrent searches\n`);
console.log('                              health checks answered   worst health reply   searches took');
for (const row of rows) {
  console.log(`  ${row.label.padEnd(28)}${String(row.health).padStart(14)}${`${row.worst.toFixed(0)} ms`.padStart(21)}${`${row.elapsed.toFixed(0)} ms`.padStart(16)}`);
}
console.log('\nThe first column is the point: it is how much of the rest of the server kept working.');
