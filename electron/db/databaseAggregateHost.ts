import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type { DatabaseAggregateQuery, DatabaseAggregateResult } from '@shared/databaseTableOps';

function workerFile(): string {
  return process.env.NODUS_DATABASE_AGGREGATE_WORKER_FILE
    || path.join(__dirname, 'databaseAggregateWorker.cjs');
}

/**
 * Footer aggregates can scan millions of typed values. Run them on their own SQLite
 * connection so opening and editing a database never blocks Electron's main thread.
 * The caller supplies the already-authorized active vault path; the worker runtime
 * rejects missing or relative paths.
 */
export function aggregateDatabaseRowsInWorker(
  nodusDatabasePath: string,
  input: DatabaseAggregateQuery,
): Promise<DatabaseAggregateResult> {
  const file = workerFile();
  if (!fs.existsSync(file)) return Promise.reject(new Error(`Worker de agregados no encontrado: ${file}`));
  return new Promise((resolve, reject) => {
    const worker = new Worker(file, { workerData: { nodusDatabasePath, input } });
    worker.unref();
    let settled = false;
    const finish = (work: () => void) => {
      if (settled) return;
      settled = true;
      work();
    };
    worker.once('message', (message: { type?: string; result?: DatabaseAggregateResult; message?: string }) => {
      if (message.type === 'complete' && message.result) finish(() => resolve(message.result!));
      else finish(() => reject(new Error(message.message || 'Falló el cálculo de agregados.')));
    });
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) => {
      if (code !== 0) finish(() => reject(new Error(`El worker de agregados terminó con código ${code}.`)));
    });
  });
}
