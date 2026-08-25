import fs from 'node:fs';
import path from 'node:path';
import { utilityProcess } from 'electron';
import type { RecoveryFolderProbe, RecoveryProbeMode } from './recoveryFolderProbe';
import type { RecoveryProbeUtilityRequest, RecoveryProbeUtilityResponse } from './recoveryProbeUtilityTypes';

let nextId = 1;
export const STARTUP_RECOVERY_PROBE_TIMEOUT_MS = 1_250;
export const INTERACTIVE_RECOVERY_PROBE_TIMEOUT_MS = 15_000;

function workerFile(): string {
  return process.env.NODUS_RECOVERY_PROBE_UTILITY_FILE || path.join(__dirname, 'recoveryProbeUtilityWorker.js');
}

export async function probeRecoveryFolderInUtility(
  folder: string,
  mode: RecoveryProbeMode,
  timeoutMs: number,
): Promise<RecoveryFolderProbe> {
  const request: RecoveryProbeUtilityRequest = { id: nextId++, folder, mode };
  if (process.env.ELECTRON_RUN_AS_NODE === '1' || process.env.NODUS_RECOVERY_PROBE_INLINE === '1') {
    const { runRecoveryProbeUtilityRequest } = await import('./recoveryProbeUtilityWorker');
    const response = runRecoveryProbeUtilityRequest(request);
    if (response.kind === 'error') throw new Error(response.error);
    return response.probe;
  }

  const file = workerFile();
  if (!fs.existsSync(file)) throw new Error('The recovery inspection process is not available.');
  const child = utilityProcess.fork(file, [], { serviceName: 'Nodus recovery inspection', stdio: 'inherit' });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, probe?: RecoveryFolderProbe): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeAllListeners();
      child.kill();
      if (error) reject(error); else resolve(probe!);
    };
    const timeout = setTimeout(
      () => finish(new Error(`Recovery inspection exceeded ${timeoutMs} ms.`)),
      Math.max(1, timeoutMs),
    );
    timeout.unref?.();
    child.on('message', (response: RecoveryProbeUtilityResponse) => {
      if (!response || response.id !== request.id) return;
      if (response.kind === 'error') finish(new Error(response.error));
      else finish(undefined, response.probe);
    });
    child.once('error', (error) => finish(new Error(String(error))));
    child.once('exit', (code) => {
      if (!settled) finish(new Error(`Recovery inspection exited with code ${code}.`));
    });
    child.postMessage(request);
  });
}
