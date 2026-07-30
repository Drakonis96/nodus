// The little that every IPC domain module needs from the aggregator.
//
// electron/ipc.ts used to be a single 6,000-line function holding all ~1,200
// channels, and the reason it could not simply be cut into files was the state
// its handlers closed over. Measured before the split, that state turned out to
// be almost entirely domain-local — the four AbortController maps, the toolkit
// and translate signal maps, the presenter's pending imports — so each of those
// moves into the module that owns it and stays private there.
//
// Only two things are genuinely shared, and they are what this context carries:
// the `h` wrapper (so every channel keeps the same localization behaviour) and
// the accessor for the main window.
import { ipcMain, type BrowserWindow } from 'electron';
import { localizeIpcPayload, localizeRuntimeError } from '@shared/uiLanguage';
import { getSettings } from '../db/settingsRepo';

export interface IpcContext {
  /**
   * ipcMain.handle with the app's error and payload localization applied. Every
   * channel goes through it: results are localized for the current UI language,
   * and a thrown message is translated when a translation exists (and rethrown
   * untouched when it does not, so stack traces survive).
   */
  h: typeof ipcMain.handle;
  /** The main window, or null while it is closed or being recreated. */
  getWindow: () => BrowserWindow | null;
}

/** Build the context handed to every `register*Ipc` function. */
export function createIpcContext(getWindow: () => BrowserWindow | null): IpcContext {
  const h: typeof ipcMain.handle = (channel, listener) => ipcMain.handle(channel, async (event, ...args) => {
    try {
      const result = await listener(event, ...args);
      return localizeIpcPayload(result, getSettings().uiLanguage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const localized = localizeRuntimeError(message, getSettings().uiLanguage);
      if (localized === message) throw error;
      throw new Error(localized);
    }
  });
  return { h, getWindow };
}
