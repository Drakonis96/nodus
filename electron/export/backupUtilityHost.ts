import fs from 'node:fs';
import path from 'node:path';
import { utilityProcess } from 'electron';
import type { BackupUtilityRequest, BackupUtilityResponse } from './backupUtilityTypes';
import { SCHEMA_VERSION } from '../db/migrations';

let nextId = 1;
const TIMEOUT_MS = 60 * 60_000;

function workerFile(): string {
  return process.env.NODUS_BACKUP_UTILITY_FILE || path.join(__dirname, 'backupUtilityWorker.js');
}

async function runUtility(request: BackupUtilityRequest): Promise<BackupUtilityResponse> {
  if (process.env.ELECTRON_RUN_AS_NODE === '1' || process.env.NODUS_BACKUP_UTILITY_INLINE === '1') {
    const { runBackupUtilityRequest } = await import('./backupUtilityWorker');
    return runBackupUtilityRequest(request);
  }
  const file = workerFile();
  if (!fs.existsSync(file)) return Promise.reject(new Error('El proceso auxiliar de copia no está disponible.'));
  const child = utilityProcess.fork(file, [], { serviceName: 'Nodus backup', stdio: 'inherit' });
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('La copia auxiliar superó una hora.')), TIMEOUT_MS);
    timeout.unref?.();
    const finish = (error?: Error, response?: BackupUtilityResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      if (error) reject(error); else resolve(response!);
    };
    child.on('message', (response: BackupUtilityResponse) => {
      if (!response || response.id !== request.id) return;
      if (response.kind === 'error') finish(new Error(response.error));
      else finish(undefined, response);
    });
    child.once('error', (error) => finish(new Error(String(error))));
    child.once('exit', (code) => { if (!settled) finish(new Error(`El proceso auxiliar de copia terminó con código ${code}.`)); });
    child.postMessage(request);
  });
}

export async function snapshotVaultInUtility(input: Omit<Extract<BackupUtilityRequest, { kind: 'snapshot' }>, 'kind' | 'id'>): Promise<{ reused: boolean; sourceFingerprint: string }> {
  const response = await runUtility({ kind: 'snapshot', id: nextId++, ...input });
  if (response.kind !== 'snapshot-done') throw new Error('Respuesta de snapshot auxiliar inesperada.');
  return response;
}

export async function verifyBackupFileInUtility(archivePath: string, password: string): Promise<{ ok: boolean; message: string }> {
  const response = await runUtility({ kind: 'verify', id: nextId++, archivePath, password, schemaVersion: SCHEMA_VERSION });
  if (response.kind !== 'verify-done') throw new Error('Respuesta de verificación auxiliar inesperada.');
  return response.result;
}
