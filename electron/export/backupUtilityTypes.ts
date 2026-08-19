export type BackupUtilityRequest = {
  kind: 'snapshot';
  id: number;
  sourcePath: string;
  targetPath: string;
  cacheDir: string;
  vaultId: string;
} | {
  kind: 'verify';
  id: number;
  archivePath: string;
  password: string;
  schemaVersion: number;
};

export type BackupUtilityResponse = {
  kind: 'snapshot-done';
  id: number;
  reused: boolean;
  sourceFingerprint: string;
} | {
  kind: 'verify-done';
  id: number;
  result: { ok: boolean; message: string };
} | {
  kind: 'error';
  id: number;
  error: string;
};
