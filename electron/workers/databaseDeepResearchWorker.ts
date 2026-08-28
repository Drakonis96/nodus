import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  runDatabaseDeepResearch,
  type DatabaseDeepResearchRequest,
  type DatabaseResearchClaim,
  type DatabaseResearchSnapshot,
} from '../ai/databaseDeepResearch';
import type { DatabaseColumn } from '@shared/databases';

interface WorkerInput {
  request: DatabaseDeepResearchRequest;
  snapshot: DatabaseResearchSnapshot;
  columns: DatabaseColumn[];
  claims: DatabaseResearchClaim[];
  snapshotPayloadPath?: string;
}

const input = workerData as WorkerInput;

try {
  const payload = input.snapshotPayloadPath
    ? (() => {
        if (!path.isAbsolute(input.snapshotPayloadPath!)) throw new Error('Database research snapshot payload path must be absolute.');
        return JSON.parse(readFileSync(input.snapshotPayloadPath!, 'utf8')) as { snapshot: DatabaseResearchSnapshot; columns: DatabaseColumn[] };
      })()
    : { snapshot: input.snapshot, columns: input.columns };
  const result = runDatabaseDeepResearch(input.request, {
    readSnapshot: () => payload.snapshot,
    readColumns: () => payload.columns,
    onStep: (completed, total) => parentPort?.postMessage({ type: 'progress', completed, total }),
  }, input.claims);
  parentPort?.postMessage({ type: 'complete', result });
} catch (error) {
  parentPort?.postMessage({
    type: 'error',
    error: error instanceof Error ? error.message : String(error),
  });
}
