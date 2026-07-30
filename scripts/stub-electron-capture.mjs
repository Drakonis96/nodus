// `electron` stub that CAPTURES every ipcMain.handle registration, so a bench can
// invoke the real main-process handlers headlessly against a copied vault.
//
// Separate from scripts/stub-electron.mjs, which exists for pure-DB smoke tests and
// throws ipcMain registrations away. This one keeps them in HANDLERS, which is what
// lets scripts/bench-ipc-latency.ts and scripts/bench-in-clause-audit.ts call all
// ~1,200 channels without booting a window. It is deliberately generous about what
// it exports: registerIpc pulls in most of the main process, and every missing
// electron export is a build error rather than a runtime one.
const tmp = process.env.NODUS_TEST_USERDATA || '/tmp/nodus-smoke-userdata';

export const HANDLERS = new Map();
export const LISTENERS = new Map();

export const ipcMain = {
  handle: (channel, fn) => { HANDLERS.set(channel, fn); },
  handleOnce: (channel, fn) => { HANDLERS.set(channel, fn); },
  removeHandler: (channel) => { HANDLERS.delete(channel); },
  on: (channel, fn) => { LISTENERS.set(channel, fn); },
  once: (channel, fn) => { LISTENERS.set(channel, fn); },
  removeAllListeners: () => undefined,
  emit: () => undefined,
};

export const app = {
  getPath: () => tmp,
  getName: () => 'Nodus',
  setName: () => undefined,
  getVersion: () => '3.0.0',
  getAppPath: () => process.cwd(),
  isPackaged: false,
  on: () => undefined,
  once: () => undefined,
  whenReady: async () => undefined,
  quit: () => undefined,
  exit: () => undefined,
  relaunch: () => undefined,
  setLoginItemSettings: () => undefined,
  getLoginItemSettings: () => ({ openAtLogin: false }),
  requestSingleInstanceLock: () => true,
  setAsDefaultProtocolClient: () => true,
  addRecentDocument: () => undefined,
  dock: { setIcon: () => undefined, setBadge: () => undefined, bounce: () => 0 },
  getLocale: () => 'es',
};

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s) => Buffer.from(String(s)),
  decryptString: (b) => Buffer.from(b).toString(),
};

export const dialog = {
  showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showMessageBox: async () => ({ response: 0 }),
  showErrorBox: () => undefined,
};

export class BrowserWindow {
  static getAllWindows() { return []; }
  static fromWebContents() { return null; }
  constructor() {
    this.webContents = {
      send: () => undefined,
      on: () => undefined,
      once: () => undefined,
      session: { setPermissionRequestHandler: () => undefined, webRequest: { onBeforeSendHeaders: () => undefined } },
      setWindowOpenHandler: () => undefined,
      executeJavaScript: async () => undefined,
    };
  }
  on() { return this; }
  once() { return this; }
  loadURL() { return Promise.resolve(); }
  loadFile() { return Promise.resolve(); }
  show() {}
  hide() {}
  close() {}
  destroy() {}
  isDestroyed() { return false; }
  setBounds() {}
  getBounds() { return { x: 0, y: 0, width: 1440, height: 900 }; }
}

export const shell = {
  openExternal: async () => undefined,
  openPath: async () => '',
  showItemInFolder: () => undefined,
  trashItem: async () => undefined,
};

export const nativeTheme = { shouldUseDarkColors: false, on: () => undefined, themeSource: 'system' };
export const Menu = { setApplicationMenu: () => undefined, buildFromTemplate: () => ({ popup: () => undefined }) };
export const MenuItem = class {};
export const Tray = class { constructor() {} setToolTip() {} setContextMenu() {} on() {} destroy() {} };
export const screen = {
  getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 }, bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 2 }),
  getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1440, height: 900 }, bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 2 }],
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 }, bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 2 }),
  on: () => undefined,
};
export const session = { defaultSession: { setPermissionRequestHandler: () => undefined, webRequest: { onBeforeSendHeaders: () => undefined } }, fromPartition: () => ({}) };
export const protocol = {
  registerSchemesAsPrivileged: () => undefined,
  handle: () => undefined,
  registerFileProtocol: () => true,
};
export const net = { fetch: async () => { throw new Error('net disabled in bench'); } };
export const powerMonitor = { on: () => undefined };
export const powerSaveBlocker = { start: () => 0, stop: () => undefined, isStarted: () => false };
export const systemPreferences = { getMediaAccessStatus: () => 'granted', askForMediaAccess: async () => true };
export const nativeImage = { createFromPath: () => ({ isEmpty: () => true, resize: () => ({}), toPNG: () => Buffer.alloc(0) }), createFromBuffer: () => ({ isEmpty: () => true, resize: () => ({}), toPNG: () => Buffer.alloc(0) }), createEmpty: () => ({ isEmpty: () => true }) };
export const clipboard = { writeText: () => undefined, readText: () => '' };
export const globalShortcut = { register: () => true, unregisterAll: () => undefined };
export const desktopCapturer = { getSources: async () => [] };
export const webContents = { getAllWebContents: () => [], fromId: () => null };
export const utilityProcess = { fork: () => ({ on: () => undefined, postMessage: () => undefined, kill: () => undefined }) };

export default {
  app, safeStorage, dialog, ipcMain, BrowserWindow, shell, nativeTheme, Menu, MenuItem, Tray,
  screen, session, protocol, net, powerMonitor, powerSaveBlocker, systemPreferences,
  nativeImage, clipboard, globalShortcut, desktopCapturer, webContents, utilityProcess,
};

export const ShareMenu = class { constructor() {} popup() {} closePopup() {} };
export const Notification = class { constructor() {} show() {} close() {} on() {} static isSupported() { return false; } };
export const crashReporter = { start: () => undefined };
export const inAppPurchase = {};
export const contextBridge = { exposeInMainWorld: () => undefined };
export const ipcRenderer = { invoke: async () => undefined, send: () => undefined, on: () => undefined };
export const webFrame = {};
export const webFrameMain = { fromId: () => null };
