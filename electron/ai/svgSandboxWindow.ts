import { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';

/** An offscreen document with no network, no scripts of its own and its own partition,
 *  used to measure SVG with real font metrics. Shared by the core's drawing QA and by the
 *  generic SVG services a capability may call: there is one place where untrusted markup
 *  is parsed, and it is this one. */
export async function evaluateInSvgSandbox<T>(script: string): Promise<T> {
  const win = new BrowserWindow({
    show: false, focusable: false, skipTaskbar: true, width: 1200, height: 1000,
    webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      partition: `chat-svg-qa-${randomUUID()}`,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';"><body style="margin:0">'));
    return await win.webContents.executeJavaScript(script) as T;
  } finally { if (!win.isDestroyed()) win.destroy(); }
}
