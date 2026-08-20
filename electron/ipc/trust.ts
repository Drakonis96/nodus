// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * IPC trust checks shared by the privileged Nodus handlers.
 *
 * Browser pages intentionally have a tiny isolated-world preload, so a normal
 * page cannot obtain ipcRenderer. That is not the security boundary, though: a
 * renderer exploit or a future preload regression must still hit a main-process
 * refusal. The dedicated Browser session is therefore treated as an untrusted
 * principal by every handler registered through the common `h` wrapper.
 */

import { session, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { NODUS_BROWSER_PARTITION } from '../browser/session';

type IncomingIpcEvent = Pick<IpcMainEvent | IpcMainInvokeEvent, 'sender' | 'senderFrame'>;

/** True only for WebContents belonging to the isolated Browser partition. */
export function isBrowserIpcSender(event: Pick<IncomingIpcEvent, 'sender'>): boolean {
  return event.sender.session === session.fromPartition(NODUS_BROWSER_PARTITION);
}

/**
 * Reject the Browser partition before a privileged handler sees its arguments.
 *
 * This protects the complete Nodus IPC surface, including old channels that
 * predate Browser and therefore have no domain-local sender check of their own.
 */
export function assertNotBrowserIpcSender(event: Pick<IncomingIpcEvent, 'sender'>): void {
  if (isBrowserIpcSender(event)) {
    throw new Error('Nodus Browser pages cannot invoke privileged application IPC.');
  }
}

/**
 * Browser chrome actions belong exclusively to the main frame of the exact
 * trusted Nodus window. Checking WebContents alone is insufficient because a
 * third-party iframe inside a trusted renderer can also send IPC in principle.
 */
export function assertTrustedNodusMainFrame(
  event: IncomingIpcEvent,
  window: BrowserWindow | null,
): asserts window is BrowserWindow {
  if (!window || window.isDestroyed()) throw new Error('The Nodus window is not available.');
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('This channel is only available to the main Nodus frame.');
  }
}
