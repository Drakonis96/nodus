import crypto from 'node:crypto';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  shell,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
} from 'electron';

type PendingFileImportPrivacyRequest = {
  senderId: number;
  settle: (allowed: boolean) => void;
};

const pendingFileImportPrivacyRequests = new Map<string, PendingFileImportPrivacyRequest>();

export function privacyPolicyPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'legal', 'PRIVACY.md')
    : path.join(app.getAppPath(), 'PRIVACY.md');
}

export async function openPrivacyPolicy(): Promise<void> {
  const target = privacyPolicyPath();
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
}

function privacyRequestWindow(parent?: BrowserWindow | null): BrowserWindow | null {
  if (parent && !parent.isDestroyed() && !parent.webContents.isDestroyed()) return parent;
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed() && !focused.webContents.isDestroyed()) return focused;
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && !win.webContents.isDestroyed()) ?? null;
}

/**
 * Ask the renderer to show Nodus's own privacy modal. The native file picker is
 * not opened until the renderer explicitly confirms, and a missing/destroyed
 * renderer always fails closed.
 */
async function requestFileImportPrivacy(parent?: BrowserWindow | null): Promise<boolean> {
  const win = privacyRequestWindow(parent);
  if (!win) return false;

  const requestId = crypto.randomUUID();
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;
    const onClosed = () => settle(false);
    const settle = (allowed: boolean) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      win.removeListener('closed', onClosed);
      pendingFileImportPrivacyRequests.delete(requestId);
      resolve(allowed);
    };

    timeout = setTimeout(() => settle(false), 10 * 60 * 1000);
    win.once('closed', onClosed);
    pendingFileImportPrivacyRequests.set(requestId, { senderId: win.webContents.id, settle });
    try {
      win.webContents.send('privacy:fileImport:request', { requestId });
    } catch {
      settle(false);
    }
  });
}

/** Accept a privacy-modal response only from the renderer that received it. */
export function resolveFileImportPrivacyRequest(
  senderId: number,
  requestId: string,
  allowed: boolean,
): void {
  if (typeof requestId !== 'string' || typeof allowed !== 'boolean') return;
  const pending = pendingFileImportPrivacyRequests.get(requestId);
  if (!pending || pending.senderId !== senderId) return;
  pending.settle(allowed);
}

/**
 * Just-in-time first layer for every native file/folder picker used to ingest
 * data. The warning is an in-app modal; only the actual OS picker is native.
 */
export async function showPrivacyAwareOpenDialog(
  parentOrOptions: BrowserWindow | OpenDialogOptions,
  maybeOptions?: OpenDialogOptions,
): Promise<OpenDialogReturnValue> {
  const parent = maybeOptions ? parentOrOptions as BrowserWindow | undefined : undefined;
  const options = maybeOptions ?? parentOrOptions as OpenDialogOptions;
  if (!(await requestFileImportPrivacy(parent))) return { canceled: true, filePaths: [] };
  return parent
    ? dialog.showOpenDialog(parent, options)
    : dialog.showOpenDialog(options);
}
