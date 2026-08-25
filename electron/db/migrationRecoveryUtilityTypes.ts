import type { MigrationRecoverySnapshot } from '@shared/types';

export interface MigrationRecoveryUtilityRequest {
  id: number;
  databasePath: string;
}

export type MigrationRecoveryUtilityResponse = {
  kind: 'list-done';
  id: number;
  snapshots: MigrationRecoverySnapshot[];
} | {
  kind: 'error';
  id: number;
  error: string;
};
