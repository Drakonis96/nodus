import { probeRecoveryFolder } from './recoveryFolderProbe';
import type { RecoveryProbeUtilityRequest, RecoveryProbeUtilityResponse } from './recoveryProbeUtilityTypes';

export function runRecoveryProbeUtilityRequest(request: RecoveryProbeUtilityRequest): RecoveryProbeUtilityResponse {
  return {
    kind: 'probe-done',
    id: request.id,
    probe: probeRecoveryFolder(request.folder, request.mode),
  };
}

process.parentPort?.on('message', (event) => {
  const request = event.data as RecoveryProbeUtilityRequest;
  try {
    process.parentPort?.postMessage(runRecoveryProbeUtilityRequest(request));
  } catch (error) {
    process.parentPort?.postMessage({
      kind: 'error',
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies RecoveryProbeUtilityResponse);
  }
});
