import type { RecoveryFolderProbe, RecoveryProbeMode } from './recoveryFolderProbe';

export interface RecoveryProbeUtilityRequest {
  id: number;
  folder: string;
  mode: RecoveryProbeMode;
}

export type RecoveryProbeUtilityResponse = {
  kind: 'probe-done';
  id: number;
  probe: RecoveryFolderProbe;
} | {
  kind: 'error';
  id: number;
  error: string;
};
