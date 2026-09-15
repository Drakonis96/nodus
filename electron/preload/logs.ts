// The processing-log half of the renderer bridge, paired with electron/ipc/logs.ts.
// Typed as LogsApi so the compiler, not a test, guarantees the slice is complete.
import { ipcRenderer } from 'electron';
import type { LogsApi } from '@shared/api/logs';

export const logsApi: LogsApi = {
  getPipelineLogs: (query) => ipcRenderer.invoke('logs:query', query),
  deletePipelineLogs: (filter) => ipcRenderer.invoke('logs:delete', filter),
  clearPipelineLogs: () => ipcRenderer.invoke('logs:clear'),
  exportPipelineLogs: (text, defaultName) => ipcRenderer.invoke('logs:export', text, defaultName),
  onPipelineLogsChanged: (callback) => {
    const listener = (_event: unknown, change: { revision: number; total: number }) => callback(change);
    ipcRenderer.on('logs:changed', listener);
    return () => ipcRenderer.removeListener('logs:changed', listener);
  },
};
