import fs from 'node:fs';
import path from 'node:path';
import { utilityProcess } from 'electron';
import type { MigrationRecoverySnapshot } from '@shared/types';
import type { MigrationRecoveryPruneReport } from './migrationSafety';
import type {
  MigrationRecoveryUtilityRequest,
  MigrationRecoveryUtilityResponse,
} from './migrationRecoveryUtilityTypes';

let nextId = 1;
const UTILITY_TIMEOUT_MS = 10 * 60_000;
const RETENTION_DELAY_MS = 15_000;
const listInFlight = new Map<string, Promise<MigrationRecoverySnapshot[]>>();
let operationTail: Promise<void> = Promise.resolve();
let retentionTimer: NodeJS.Timeout | null = null;
const pendingRetentionPaths = new Set<string>();

function workerFile(): string {
  return process.env.NODUS_MIGRATION_RECOVERY_UTILITY_FILE
    || path.join(__dirname, 'migrationRecoveryUtilityWorker.js');
}

function runUtility(request: MigrationRecoveryUtilityRequest): Promise<MigrationRecoveryUtilityResponse> {
  if (process.env.ELECTRON_RUN_AS_NODE === '1' || process.env.NODUS_MIGRATION_RECOVERY_INLINE === '1') {
    return import('./migrationRecoveryUtilityWorker').then(({ runMigrationRecoveryUtilityRequest }) => {
      const response = runMigrationRecoveryUtilityRequest(request);
      if (response.kind === 'error') throw new Error(response.error);
      return response;
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
    const finish = (error?: Error, response?: MigrationRecoveryUtilityResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeAllListeners();
      child.kill();
      if (error) reject(error); else resolve(response!);
    };
    const timeout = setTimeout(
      () => finish(new Error('La tarea auxiliar de recuperación superó diez minutos.')),
      UTILITY_TIMEOUT_MS,
    );
    timeout.unref?.();
    child.on('message', (response: MigrationRecoveryUtilityResponse) => {
      if (!response || response.id !== request.id) return;
      if (response.kind === 'error') finish(new Error(response.error));
      else finish(undefined, response);
    });
    child.once('error', (error) => finish(new Error(String(error))));
    child.once('exit', (code) => {
      if (!settled) finish(new Error(`El proceso auxiliar de recuperación terminó con código ${code}.`));
    });
    child.postMessage(request);
  });
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const task = operationTail.catch(() => undefined).then(work);
  operationTail = task.then(() => undefined, () => undefined);
  return task;
}

/** Hashing and SQLite quick_check may scan the complete snapshot. Keep both away from
 * Electron's main event loop and coalesce repeated Settings requests for the same vault. */
export function listMigrationRecoverySnapshotsInUtility(
  databasePath: string,
): Promise<MigrationRecoverySnapshot[]> {
  const resolved = path.resolve(databasePath);
  const current = listInFlight.get(resolved);
  if (current) return current;
  const task = enqueue(async () => {
    const response = await runUtility({ kind: 'list', id: nextId++, databasePath: resolved });
    if (response.kind !== 'list-done') throw new Error('Respuesta inesperada al listar copias de migración.');
    return response.snapshots;
  }).finally(() => {
    if (listInFlight.get(resolved) === task) listInFlight.delete(resolved);
  });
  listInFlight.set(resolved, task);
  return task;
}

/** Holds the same queue used by pruning until the caller has finished consuming the
 * validated snapshot. This closes the gap between Settings validation and copying the
 * immutable database into a new vault. */
export function withMigrationRecoverySnapshotsInUtility<T>(
  databasePath: string,
  work: (snapshots: MigrationRecoverySnapshot[]) => Promise<T> | T,
): Promise<T> {
  const resolved = path.resolve(databasePath);
  return enqueue(async () => {
    const response = await runUtility({ kind: 'list', id: nextId++, databasePath: resolved });
    if (response.kind !== 'list-done') throw new Error('Respuesta inesperada al validar una copia de migración.');
    return work(response.snapshots);
  });
}

/** Runs every requested vault in one disposable worker. The shared operation queue keeps
 * Settings list/open requests from observing a snapshot halfway through removal. */
export function pruneMigrationRecoverySnapshotsInUtility(
  databasePaths: string[],
): Promise<MigrationRecoveryPruneReport[]> {
  const resolved = [...new Set(databasePaths.map((databasePath) => path.resolve(databasePath)))];
  if (resolved.length === 0) return Promise.resolve([]);
  return enqueue(async () => {
    const response = await runUtility({ kind: 'prune', id: nextId++, databasePaths: resolved });
    if (response.kind !== 'prune-done') throw new Error('Respuesta inesperada al limpiar copias de migración.');
    return response.reports;
  });
}

function logRetentionReports(reports: MigrationRecoveryPruneReport[]): void {
  const removedSnapshots = reports.reduce((total, report) => total + report.removedSnapshots, 0);
  const removedBytes = reports.reduce((total, report) => total + report.removedBytes, 0);
  const errors = reports.flatMap((report) => report.errors);
  if (removedSnapshots > 0 || errors.length > 0) {
    console.log(`[migration-retention] removed ${removedSnapshots} snapshots (${removedBytes} bytes) across ${reports.length} vaults; errors=${errors.length}`);
  }
  for (const error of errors) {
    console.warn(`[migration-retention] ${error.snapshotId}: ${error.message}`);
  }
}

function flushScheduledRetention(): void {
  retentionTimer = null;
  const databasePaths = [...pendingRetentionPaths];
  pendingRetentionPaths.clear();
  void pruneMigrationRecoverySnapshotsInUtility(databasePaths)
    .then(logRetentionReports)
    .catch((error) => console.warn(`[migration-retention] failed safely: ${error instanceof Error ? error.message : String(error)}`));
}

/** Coalesces startup inventory and later vault opens into one non-blocking maintenance pass. */
export function scheduleMigrationRecoveryRetention(databasePaths: string | string[]): void {
  for (const databasePath of Array.isArray(databasePaths) ? databasePaths : [databasePaths]) {
    if (databasePath) pendingRetentionPaths.add(path.resolve(databasePath));
  }
  if (pendingRetentionPaths.size === 0 || retentionTimer) return;
  retentionTimer = setTimeout(flushScheduledRetention, RETENTION_DELAY_MS);
  retentionTimer.unref?.();
}

export function cancelScheduledMigrationRecoveryRetention(): void {
  if (retentionTimer) clearTimeout(retentionTimer);
  retentionTimer = null;
  pendingRetentionPaths.clear();
}
