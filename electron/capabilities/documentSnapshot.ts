import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ViewDocumentV1, ViewNode } from '../../packages/capability-api/src/views';
import { getCapabilityFile } from '../chatAssets';
import { validateModelAsset } from '../../packages/capability-api/src/models';
import { validateMediaAsset } from '../../packages/capability-api/src/media';

export async function snapshotDocumentFigure(view: ViewDocumentV1, owner: string, signal?: AbortSignal): Promise<string> {
  const assets: Record<string, { base64: string; mimeType: string }> = {};
  const visit = (nodes: ViewNode[]) => nodes.forEach(node => {
    if (node.kind === 'details') visit(node.children);
    if ('attachmentId' in node) {
      const file = getCapabilityFile(`nodus-capability://chat/${owner}/${node.attachmentId}`);
      if (!file) throw new Error('Missing figure attachment.');
      if (node.kind === 'model') validateModelAsset(new Uint8Array(file.blob), file.mimeType);
      if (node.kind === 'image') validateMediaAsset(new Uint8Array(file.blob), file.mimeType);
      assets[node.attachmentId] = { base64: file.blob.toString('base64'), mimeType: file.mimeType };
    }
    if (node.kind === 'imageTiles' || node.kind === 'map' && node.basemap) throw new Error('Document snapshots must be self-contained.');
  });
  visit(view.nodes);
  signal?.throwIfAborted();
  const win = new BrowserWindow({ show: false, width: 1048, height: 2300, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: `document-figure-${randomUUID()}` } });
  const abort = () => { if (!win.isDestroyed()) win.destroy(); };
  signal?.addEventListener('abort', abort, { once: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const dev = process.env.VITE_DEV_SERVER_URL;
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) && !(dev && new URL(details.url).origin === new URL(dev).origin) }));
  try {
    if (dev) await win.loadURL(new URL('documentFigure.html', dev).href);
    else await win.loadFile(path.join(app.getAppPath(), 'dist', 'documentFigure.html'));
    const rect = await win.webContents.executeJavaScript(`window.renderDocumentFigure(${JSON.stringify({ view, owner, assets })})`) as { x: number; y: number; width: number; height: number };
    signal?.throwIfAborted();
    return (await win.webContents.capturePage(rect)).toDataURL();
  } finally { signal?.removeEventListener('abort', abort); if (!win.isDestroyed()) win.destroy(); }
}
