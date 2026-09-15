/** Diagnostics describe the runtime we actually installed, not the host's GPU inventory. */
export type LocalAiBackend = 'cpu' | 'vulkan' | 'metal';
export interface LocalAiRuntimeDiagnostics {
  backend: LocalAiBackend;
  /** Devices observed by this executable's --list-devices probe. */
  devices: string[];
  upgradeRequired: boolean;
  state: 'installed' | 'loading' | 'ready' | 'failed';
  /** null means not observed; zero is different from unknown. */
  offloadedLayers: number | null;
  fallbackReason: 'legacy-runtime' | 'gpu-unavailable' | 'gpu-startup-failed' | null;
  /** Bounded, path-redacted startup output only. Never inference/request logs. */
  startupLog: string;
}
