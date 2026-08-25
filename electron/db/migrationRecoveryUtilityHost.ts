import fs from 'node:fs';
import path from 'node:path';
import { utilityProcess } from 'electron';
import type { MigrationRecoverySnapshot } from '@shared/types';
import type {
  MigrationRecoveryUtilityRequest,
  MigrationRecoveryUtilityResponse,
} from './migrationRecoveryUtilityTypes';

let nextId = 1;
const VALIDATION_TIMEOUT_MS = 10 * 60_000;
const inFlight = new Map<string, Promise<MigrationRecoverySnapshot[]>>();

function workerFile(): string {
  return process.env.NODUS_MIGRATION_RECOVERY_UTILITY_FILE
    || path.join(__dirname, 'migrationRecoveryUtilityWorker.js');
}

function runUtility(databasePath: string): Promise<MigrationRecoverySnapshot[]> {
  const request: MigrationRecoveryUtilityRequest = { id: nextId++, databasePath };
  if (process.env.ELECTRON_RUN_AS_NODE === '1' || process.env.NODUS_MIGRATION_RECOVERY_INLINE === '1') {
    return import('./migrationRecoveryUtilityWorker').then(({ runMigrationRecoveryUtilityRequest }) => {
      const response = runMigrationRecoveryUtilityRequest(request);
      if (response.kind === 'error') throw new Error(response.error);
      return response.snapshots;
    });
  }

  const file = workerFile();
  if (!fs.existsSync(file)) return Promise.reject(new Error('El proceso auxiliar de recuperación no está disponible.'));
  const child = utilityProcess.fork(file, [], {
    serviceName: 'Nodus migration recovery validation',
    stdio: 'inherit',
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, snapshots?: MigrationRecoverySnapshot[]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeAllListeners();
      child.kill();
      if (error) reject(error); else resolve(snapshots!);
    };
    const timeout = setTimeout(
      () => finish(new Error('La validación de las copias de migración superó diez minutos.')),
      VALIDATION_TIMEOUT_MS,
    );
    timeout.unref?.();
    child.on('message', (response: MigrationRecoveryUtilityResponse) => {
      if (!response || response.id !== request.id) return;
      if (response.kind === 'error') finish(new Error(response.error));
      else finish(undefined, response.snapshots);
    });
    child.once('error', (error) => finish(new Error(String(error))));
    child.once('exit', (code) => {
      if (!settled) finish(new Error(`El proceso auxiliar de recuperación terminó con código ${code}.`));
    });
    child.postMessage(request);
  });
}

/** Hashing and SQLite quick_check may scan the complete snapshot. Keep both away from
 * Electron's main event loop and coalesce repeated Settings requests for the same vault. */
export function listMigrationRecoverySnapshotsInUtility(
  databasePath: string,
): Promise<MigrationRecoverySnapshot[]> {
  const resolved = path.resolve(databasePath);
  const current = inFlight.get(resolved);
  if (current) return current;
  const task = runUtility(resolved).finally(() => {
    if (inFlight.get(resolved) === task) inFlight.delete(resolved);
  });
  inFlight.set(resolved, task);
  return task;
}
