// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * The Nodus Browser slice of the MAIN WINDOW's bridge.
 *
 * Not to be confused with ./browserPage.ts, which runs inside a web page and
 * deliberately exposes nothing. This one is ordinary: it belongs to the trusted
 * Nodus renderer and lets it draw the browser chrome and issue commands.
 *
 * The renderer never holds a WebContents. It reports the rectangle it has
 * reserved, sends commands, and re-renders from the state it is pushed.
 */

import { ipcRenderer } from 'electron';
import type { BrowserState, BrowserViewport } from '@shared/browser';
import type { OmniboxResolution } from '@shared/browserOmnibox';
import type { PendingBrowserPermission } from '@shared/browser';

/** What `browser:submitOmnibox` answers: the resolution, plus whether it landed. */
export type BrowserOmniboxResult =
  | (OmniboxResolution & { ok?: boolean });

export const browserApi = {
  getBrowserState: (): Promise<BrowserState> => ipcRenderer.invoke('browser:state'),
  openBrowserTab: (url: string): Promise<string | null> => ipcRenderer.invoke('browser:openTab', url),
  activateBrowserTab: (id: string): Promise<void> =>
    ipcRenderer.invoke('browser:activateTab', id).then(() => undefined),
  closeBrowserTab: (id: string): Promise<void> =>
    ipcRenderer.invoke('browser:closeTab', id).then(() => undefined),
  browserGoBack: (): Promise<void> => ipcRenderer.invoke('browser:goBack').then(() => undefined),
  browserGoForward: (): Promise<void> => ipcRenderer.invoke('browser:goForward').then(() => undefined),
  browserReload: (): Promise<void> => ipcRenderer.invoke('browser:reload').then(() => undefined),
  browserStop: (): Promise<void> => ipcRenderer.invoke('browser:stop').then(() => undefined),
  submitBrowserOmnibox: (input: string): Promise<BrowserOmniboxResult> =>
    ipcRenderer.invoke('browser:submitOmnibox', input),
  setBrowserViewport: (viewport: BrowserViewport): Promise<void> =>
    ipcRenderer.invoke('browser:setViewport', viewport).then(() => undefined),
  setBrowserOverlayVisible: (visible: boolean): Promise<void> =>
    ipcRenderer.invoke('browser:setOverlayVisible', visible).then(() => undefined),
  getPendingBrowserPermission: (): Promise<PendingBrowserPermission | null> =>
    ipcRenderer.invoke('browser:pendingPermission'),
  resolveBrowserPermission: (id: string, granted: boolean, remember: boolean): Promise<void> =>
    ipcRenderer.invoke('browser:resolvePermission', id, granted, remember).then(() => undefined),
  cancelBrowserPermissions: (): Promise<void> =>
    ipcRenderer.invoke('browser:cancelPermissions').then(() => undefined),
  onBrowserPermissionRequest: (callback: (request: PendingBrowserPermission | null) => void): (() => void) => {
    const listener = (_event: unknown, request: PendingBrowserPermission | null) => callback(request);
    ipcRenderer.on('browser:permissionRequest', listener);
    return () => ipcRenderer.removeListener('browser:permissionRequest', listener);
  },
  onBrowserStateChanged: (callback: (state: BrowserState) => void): (() => void) => {
    const listener = (_event: unknown, state: BrowserState) => callback(state);
    ipcRenderer.on('browser:state', listener);
    return () => ipcRenderer.removeListener('browser:state', listener);
  },
};
