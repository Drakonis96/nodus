// The Nodus Drift half of the renderer bridge, paired with electron/ipc/drift.ts.
// Typed as DriftApi so the compiler, not a test, guarantees the slice is complete.
import { ipcRenderer } from 'electron';
import type { DriftApi } from '@shared/api/drift';

export const driftApi: DriftApi = {
  getDriftCatalog: () => ipcRenderer.invoke('drift:catalog'),
  readDriftAudio: (soundId) => ipcRenderer.invoke('drift:read-audio', soundId),
};
