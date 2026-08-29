// Electron stub for tests that exercise secret persistence. It models an
// available OS credential store with a deterministic test-only envelope.
const tmp = process.env.NODUS_TEST_USERDATA || '/tmp/nodus-safe-storage-test';
export const app = { getPath: () => tmp, getAppPath: () => process.cwd(), isPackaged: false };
export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`test-safe:${String(value)}`, 'utf8'),
  decryptString: (buffer) => {
    const value = Buffer.from(buffer).toString('utf8');
    if (!value.startsWith('test-safe:')) throw new Error('invalid test secret');
    return value.slice('test-safe:'.length);
  },
};
export const dialog = { showSaveDialog: async () => ({ canceled: true, filePath: undefined }) };
export const ipcMain = { handle: () => undefined, on: () => undefined };
export class BrowserWindow {}
export const shell = { openExternal: async () => undefined };
export const utilityProcess = { fork: () => { throw new Error('utilityProcess is unavailable in headless tests'); } };
export default { app, safeStorage, dialog, ipcMain, BrowserWindow, shell, utilityProcess };
