import { listMigrationRecoverySnapshots, pruneMigrationRecoverySnapshots } from './migrationSafety';
import type {
  MigrationRecoveryUtilityRequest,
  MigrationRecoveryUtilityResponse,
} from './migrationRecoveryUtilityTypes';

export function runMigrationRecoveryUtilityRequest(
  request: MigrationRecoveryUtilityRequest,
): MigrationRecoveryUtilityResponse {
  if (request.kind === 'prune') {
    return {
      kind: 'prune-done',
      id: request.id,
      reports: request.databasePaths.map((databasePath) => pruneMigrationRecoverySnapshots(databasePath)),
    };
  }
  return {
    kind: 'list-done',
    id: request.id,
    snapshots: listMigrationRecoverySnapshots(request.databasePath),
  };
}

process.parentPort?.on('message', (event) => {
  const request = event.data as MigrationRecoveryUtilityRequest;
  try {
    process.parentPort?.postMessage(runMigrationRecoveryUtilityRequest(request));
  } catch (error) {
    process.parentPort?.postMessage({
      kind: 'error',
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies MigrationRecoveryUtilityResponse);
  }
});
