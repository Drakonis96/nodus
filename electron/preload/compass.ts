import { ipcRenderer } from 'electron';
import type { CompassApi } from '@shared/api/compass';

export const compassApi: CompassApi = {
  startCompassSearch: (request) => ipcRenderer.invoke('compass:search:start', request),
  loadMoreCompass: (searchId, requestId, generation, offset) => ipcRenderer.invoke('compass:search:loadMore', searchId, requestId, generation, offset),
  cancelCompassSearch: (searchId, requestId) => ipcRenderer.invoke('compass:search:cancel', searchId, requestId),
  getCompassSearch: (searchId) => ipcRenderer.invoke('compass:search:get', searchId),
  listCompassResults: (searchId, offset, limit) => ipcRenderer.invoke('compass:results:list', searchId, offset, limit),
  listCompassHistory: (limit) => ipcRenderer.invoke('compass:history:list', limit),
  deleteCompassHistory: (searchId) => ipcRenderer.invoke('compass:history:delete', searchId),
  clearCompassHistory: () => ipcRenderer.invoke('compass:history:clear'),
  saveCompassCandidate: (searchId, key) => ipcRenderer.invoke('compass:candidate:save', searchId, key),
  listCompassSavedCandidates: (limit) => ipcRenderer.invoke('compass:candidate:listSaved', limit),
  dismissCompassCandidate: (searchId, key) => ipcRenderer.invoke('compass:candidate:dismiss', searchId, key),
  restoreCompassCandidate: (searchId, key) => ipcRenderer.invoke('compass:candidate:restore', searchId, key),
  setCompassSelection: (searchId, keys, revision) => ipcRenderer.invoke('compass:selection:update', searchId, keys, revision),
  getCompassSelection: (searchId) => ipcRenderer.invoke('compass:selection:get', searchId),
  startCompassImport: (request) => ipcRenderer.invoke('compass:import:start', request),
  getCompassImport: (jobId) => ipcRenderer.invoke('compass:import:get', jobId),
  cancelCompassImport: (jobId) => ipcRenderer.invoke('compass:import:cancel', jobId),
  retryCompassImport: (jobId) => ipcRenderer.invoke('compass:import:retry', jobId),
  listCompassProviderStatus: () => ipcRenderer.invoke('compass:providers:status'),
  setCompassProviderKey: (provider, key) => ipcRenderer.invoke('compass:providers:setKey', provider, key),
  clearCompassProviderKey: (provider) => ipcRenderer.invoke('compass:providers:clearKey', provider),
  onCompassSearchProgress: (callback) => { const listener = (_event: unknown, progress: Parameters<typeof callback>[0]) => callback(progress); ipcRenderer.on('compass:searchProgress', listener); return () => ipcRenderer.removeListener('compass:searchProgress', listener); },
  onCompassImportProgress: (callback) => { const listener = (_event: unknown, progress: Parameters<typeof callback>[0]) => callback(progress); ipcRenderer.on('compass:importProgress', listener); return () => ipcRenderer.removeListener('compass:importProgress', listener); },
};
