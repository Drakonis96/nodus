import type { MigrationRecoverySnapshot } from '@shared/types';
import type { MigrationRecoveryPruneReport } from './migrationSafety';

export type MigrationRecoveryUtilityRequest = {
  kind: 'list';
  id: number;
  databasePath: string;
} | {
  kind: 'prune';
  id: number;
  databasePaths: string[];
};

export type MigrationRecoveryUtilityResponse = {
  kind: 'list-done';
  id: number;
  snapshots: MigrationRecoverySnapshot[];
} | {
  kind: 'prune-done';
  id: number;
  reports: MigrationRecoveryPruneReport[];
} | {
  kind: 'error';
  id: number;
  error: string;
};
