import { registerUntrustedSession } from './ipc/untrustedSessions';
import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { SkillTool } from '@shared/skillMarketplace';
/** An ephemeral Chromium sandbox with no preload, app bridge, storage or network. */
export async function runSkillTool(tool: SkillTool, input: unknown, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const encoded = JSON.stringify(input ?? null);
  if (encoded.length > 64000 || tool.source.length > 64000) throw new Error('Tool input or source is too large.');
  const isolated = session.fromPartition(`skill-${randomUUID()}`, { cache: false });
  registerUntrustedSession(isolated);
  isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:text/html,') }));
  const win = new BrowserWindow({ show: false, webPreferences: {
    session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
    webSecurity: true, devTools: false, disableDialogs: true, backgroundThrottling: false,
  } });
  win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    return await Promise.race([
      (async () => {
        await isolated.setProxy({ mode: 'fixed_servers', proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9', proxyBypassRules: '<-loopback>' });
        await win.loadURL('data:text/html,' + encodeURIComponent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-eval\'; connect-src \'none\'; worker-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\'"><title>Skill sandbox</title>'));
        const result = await win.webContents.executeJavaScript(`(async () => {
          for (const key of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCIceTransport', 'RTCDtlsTransport']) {
            Object.defineProperty(globalThis, key, { value: undefined, writable: false, configurable: false });
          }
          const tool = (${tool.source}\n);
          if (typeof tool !== 'function') throw new Error('Tool entry must be a function expression.');
          const result = JSON.stringify(await tool(JSON.parse(${JSON.stringify(encoded)})));
          if (typeof result !== 'string' || result.length > 64000) throw new Error('Tool output must be JSON and at most 64 KB.');
          return result;
        })()`);
        signal?.throwIfAborted();
        if (typeof result !== 'string' || result.length > 64000) throw new Error('Invalid tool output.');
        return result;
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Tool exceeded the five-second time limit.')), 5000);
        cancel = () => reject(new DOMException('Tool execution cancelled.', 'AbortError'));
        signal?.addEventListener('abort', cancel, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    if (cancel) signal?.removeEventListener('abort', cancel);
    if (!win.isDestroyed()) win.destroy();
    void isolated.clearStorageData();
  }
}
