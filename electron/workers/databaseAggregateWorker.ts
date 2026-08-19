import { parentPort, workerData } from 'node:worker_threads';
// The query suffix keeps this graph independent from the main process bundle. The
// worker build aliases the database runtime to the explicitly authorized vault path.
// @ts-expect-error Vite resolves the query variant to the typed source module.
import { aggregateDatabaseRows } from '../db/databasesRepo?aggregate-worker';
import type { DatabaseAggregateQuery } from '@shared/databaseTableOps';

interface AggregateWorkerInput {
  nodusDatabasePath: string;
  input: DatabaseAggregateQuery;
}

try {
  const request = workerData as AggregateWorkerInput;
  parentPort?.postMessage({ type: 'complete', result: aggregateDatabaseRows(request.input) });
} catch (error) {
  parentPort?.postMessage({
    type: 'error',
    message: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  process.exitCode = 1;
}
