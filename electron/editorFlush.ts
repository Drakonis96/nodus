import { ipcMain, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';

/** Keep the originating database open until its renderer has saved its editor. */
export function flushWindowEditors(window: BrowserWindow): Promise<boolean> {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve(true);
  const requestId = randomUUID();
  return new Promise(resolve => {
    const finish = (saved: boolean) => { clearTimeout(timer); ipcMain.removeListener('editor:flushed', listener); resolve(saved); };
    const listener = (event: Electron.IpcMainEvent, id: string, saved: boolean) => {
      if (event.sender === window.webContents && id === requestId) finish(saved === true);
    };
    // A hung renderer must not cause a silent close with unsaved edits.
    const timer = setTimeout(() => finish(false), 15_000);
    ipcMain.on('editor:flushed', listener);
    window.webContents.send('editor:flush', requestId);
  });
}

export function installEditorCloseGuard(window: BrowserWindow, isQuitting: () => boolean): void {
  let approved = false;
  let pending = false;
  window.on('close', event => {
    if (approved || isQuitting()) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    void flushWindowEditors(window).then(saved => {
      pending = false;
      if (saved && !window.isDestroyed()) { approved = true; window.close(); }
    });
  });
}
