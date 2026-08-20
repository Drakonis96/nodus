import { ipcRenderer } from 'electron';
import type { RadarApi } from '@shared/api/radar';

export const radarApi: RadarApi = {
  getRadarSnapshot: () => ipcRenderer.invoke('radar:snapshot'),
  createRadarFollow: (input) => ipcRenderer.invoke('radar:createFollow', input),
  updateRadarFollow: (id, patch) => ipcRenderer.invoke('radar:updateFollow', id, patch),
  removeRadarFollow: (id) => ipcRenderer.invoke('radar:removeFollow', id),
  checkRadar: (request) => ipcRenderer.invoke('radar:check', request),
  markRadarUpdateRead: (id, read) => ipcRenderer.invoke('radar:markRead', id, read),
  markAllRadarUpdatesRead: () => ipcRenderer.invoke('radar:markAllRead'),
  removeRadarUpdate: (id) => ipcRenderer.invoke('radar:removeUpdate', id),
  onRadarChanged: (cb) => {
    const listener = (_event: unknown, snapshot: Parameters<typeof cb>[0]) => cb(snapshot);
    ipcRenderer.on('radar:changed', listener);
    return () => ipcRenderer.removeListener('radar:changed', listener);
  },
};
