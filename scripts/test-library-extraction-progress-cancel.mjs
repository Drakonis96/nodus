import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--library-extraction-progress-cancel')) process.exit(0);

// Pausing documentary preparation aborts the extraction while the PDF renderer is
// still busy: it keeps reporting pages until it is terminated. The preparation's
// progress callback then throws (its lease check sees the aborted signal). Each of
// those throws escaped the worker's message handler as an uncaughtException, one
// per page — 92 of them in a real log.
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-extraction-progress-'));
const worker = path.join(scratch, 'extraction-worker.cjs');
installRuntimeHooks(path.join(scratch, 'user-data'));
const require = createRequire(import.meta.url);
const uncaught = [];
const onUncaught = error => uncaught.push(error);
process.on('uncaughtException', onUncaught);
// The host unrefs its worker and grace timer; Electron's main process keeps them alive.
const keepAlive = setInterval(() => {}, 1000);

try {
  // Ignores `cancel`, like a synchronous renderer, and reports a page every millisecond.
  await writeFile(worker, `
    process.on('message', (request) => {
      if (request.kind !== 'run') return;
      let page = 0;
      const timer = setInterval(() => {
        page += 1;
        process.send({ kind: 'progress', progress: { phase: 'extract', progress: 0.5, page, totalPages: 5000 } });
        if (page === 5000) { clearInterval(timer); process.send({ kind: 'done', result: { item: request.item } }); }
      }, 1);
    });
  `);
  process.env.NODUS_LIBRARY_EXTRACTION_WORKER_FILE = worker;
  const { extractLibraryItemInWorker } = require(path.join(repoRoot, 'electron/library/libraryExtractionWorkerHost.ts'));
  const store = { root: scratch, deviceId: 'progress-cancel' };
  const item = { id: 'nodus:progress', storageId: 'progress' };
  const waitForPages = (pages, count) => new Promise(resolve => {
    const poll = setInterval(() => { if (pages.length >= count) { clearInterval(poll); resolve(); } }, 2);
  });

  // 1. Pause: the callback checks the aborted signal on every page.
  const controller = new AbortController();
  const pages = [];
  const paused = extractLibraryItemInWorker({ item, store, signal: controller.signal, onProgress: (progress) => {
    controller.signal.throwIfAborted();
    pages.push(progress.page);
  } });
  await waitForPages(pages, 5);
  controller.abort();
  await assert.rejects(paused, error => error.name === 'AbortError');
  assert.deepEqual(uncaught.map(error => error.message), [], 'a page reported after the pause must not escape as an uncaught exception');

  // 2. The callback itself fails (a lost lease, a replaced source): the extraction
  //    stops with that error instead of throwing it into the message handler.
  const seen = [];
  const started = Date.now();
  await assert.rejects(extractLibraryItemInWorker({ item, store, onProgress: (progress) => {
    seen.push(progress.page);
    if (seen.length === 3) throw new Error('documentary_request_lease_lost');
  } }), /documentary_request_lease_lost/);
  assert.equal(seen.length, 3, 'no page is delivered after the callback has failed');
  assert.ok(Date.now() - started < 2000, 'the failing extraction is stopped, not run to completion');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(uncaught.map(error => error.message), []);
  console.log('Extraction progress after a pause or a failed callback stops the worker without uncaught exceptions.');
} finally {
  clearInterval(keepAlive);
  process.off('uncaughtException', onUncaught);
  delete process.env.NODUS_LIBRARY_EXTRACTION_WORKER_FILE;
  await rm(scratch, { recursive: true, force: true });
}
