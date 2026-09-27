import { BrowserWindow } from 'electron';
import type { IpcContext } from './context';
import { reactionIndexService } from '../reactionIndex';

export function registerReactionIndexIpc({ h }: IpcContext): void {
  const service = reactionIndexService();
  service.onChange((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('reactionIndex:progress', status);
    }
  });

  h('reactionIndex:status', async () => service.status());
  h('reactionIndex:download', async () => service.ensure());
}
