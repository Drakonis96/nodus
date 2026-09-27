import { ipcRenderer } from 'electron';
import type { ReactionIndexApi } from '@shared/api/reactionIndex';
import type { ReactionIndexStatus } from '@shared/reactionIndex';

export const reactionIndexApi: ReactionIndexApi = {
  getReactionIndexStatus: () => ipcRenderer.invoke('reactionIndex:status'),
  downloadReactionIndex: () => ipcRenderer.invoke('reactionIndex:download'),
  onReactionIndexProgress: (cb) => {
    const listener = (_event: unknown, status: ReactionIndexStatus) => cb(status);
    ipcRenderer.on('reactionIndex:progress', listener);
    return () => ipcRenderer.removeListener('reactionIndex:progress', listener);
  },
};
