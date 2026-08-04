// One thread that does nothing but multiply.
//
// Its whole reason to exist is that `scoreVectors` over a real corpus takes around 200 ms of
// straight-line arithmetic, and Node runs one event loop: on the main thread that is 200 ms
// in which the server answers nobody — not the phone loading a screen, not the health check,
// not another person's search. Here it costs the requester its own latency and nobody else's.
//
// The worker holds no state. The matrix arrives as a `SharedArrayBuffer` handle, which is not
// copied, so a job message is a few kilobytes whatever the corpus weighs.

import { parentPort } from 'node:worker_threads';
import { scoreVectors } from './vectors.mjs';

parentPort.on('message', (job) => {
  try {
    const matches = scoreVectors(
      { dim: job.dim, count: job.count, matrix: new Int8Array(job.matrix) },
      job.query,
      { limit: job.limit, threshold: job.threshold },
    );
    parentPort.postMessage({ id: job.id, matches });
  } catch (error) {
    // A job that throws must not take the worker down with it: the pool would spawn a
    // replacement and the next query would pay for it, for what is almost always a
    // malformed vector that the route should answer with a 400.
    parentPort.postMessage({ id: job.id, error: error instanceof Error ? error.message : String(error) });
  }
});
