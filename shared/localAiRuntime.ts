export type LocalRuntimeBackend = 'cpu' | 'metal' | 'vulkan' | 'cuda';
export interface LocalRuntimeDevice { id: string; name: string }
export interface LocalRuntimeDiagnostics {
  backend: LocalRuntimeBackend | null;
  devices: LocalRuntimeDevice[];
  legacy: boolean;
  fallbackReason?: 'legacy-cpu' | 'gpu-unavailable' | 'gpu-start-failed';
  /** Bounded startup/probe output, local only; never prompt/completion logs. */
  detail?: string;
  phase: 'not-installed' | 'installed' | 'starting' | 'running' | 'calibrating' | 'error';
  /** Null means unmeasured, not successful GPU acceleration. */
  offloadedLayers: number | null;
}
