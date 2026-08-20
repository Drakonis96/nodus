import { BrowserWindow } from 'electron';
import type { RadarCheckRequest, RadarFollowInput, RadarFollowPatch } from '@shared/radar';
import type { IpcContext } from './context';
import { radarService } from '../radar/radarService';

export function registerRadarIpc({ h }: IpcContext): void {
  const service = radarService();
  service.setNotifier((snapshot) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('radar:changed', snapshot);
    }
  });

  h('radar:snapshot', async () => service.snapshot());
  h('radar:createFollow', async (_event, input: RadarFollowInput) => service.createFollow(input));
  h('radar:updateFollow', async (_event, id: string, patch: RadarFollowPatch) => service.updateFollow(String(id), patch));
  h('radar:removeFollow', async (_event, id: string) => service.removeFollow(String(id)));
  h('radar:check', async (_event, request?: RadarCheckRequest) => service.check(request));
  h('radar:markRead', async (_event, id: string, read?: boolean) => service.markUpdateRead(String(id), read !== false));
  h('radar:markAllRead', async () => service.markAllRead());
  h('radar:removeUpdate', async (_event, id: string) => service.removeUpdate(String(id)));
}
