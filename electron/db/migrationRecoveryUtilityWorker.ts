import { listMigrationRecoverySnapshots } from './migrationSafety';
import type {
  MigrationRecoveryUtilityRequest,
  MigrationRecoveryUtilityResponse,
} from './migrationRecoveryUtilityTypes';

export function runMigrationRecoveryUtilityRequest(
  request: MigrationRecoveryUtilityRequest,
): MigrationRecoveryUtilityResponse {
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
