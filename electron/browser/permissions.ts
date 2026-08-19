// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Installing the browser permission policy onto the Electron session.
 *
 * The policy itself lives in @shared/browserPermissions, pure and tested. This
 * file is only the wiring, and the wiring has three parts that are easy to get
 * wrong:
 *
 *  1. BOTH permission handlers must be installed. `setPermissionRequestHandler`
 *     covers a page calling `getUserMedia()`; `setPermissionCheckHandler` covers
 *     `navigator.permissions.query()` and Chromium's own internal checks. Their
 *     unions are not the same, and installing only the first leaves a hole.
 *
 *  2. USB, Serial, HID and Bluetooth do NOT travel through those handlers. They
 *     use `setDevicePermissionHandler` plus the `select-*-device` events. Not
 *     installing those is not a denial by default in a useful sense — the
 *     chooser simply never resolves — so they are denied explicitly.
 *
 *  3. Screen capture has its own handler entirely. Electron 43 leaves a
 *     `getDisplayMedia()` request pending when a handler answers with an empty
 *     stream object, so Nodus explicitly leaves the system picker disabled and
 *     resets the source provider to `null`. The deny in BOTH permission paths
 *     and the absence of a source ensure the site can never capture a display.
 */

import type { Session } from 'electron';
import {
  permissionOriginOf,
  resolveBrowserPermission,
  checkBrowserPermission,
  type BrowserSitePermissions,
} from '@shared/browserPermissions';

/** How the UI is asked to prompt, and how the answer comes back. */
export interface PermissionPrompter {
  /** Resolve to the user's decision. Resolving `false` denies. */
  ask(request: {
    permission: string;
    origin: string;
    /** For `media`, which of camera/microphone is being requested. */
    mediaTypes?: string[];
  }): Promise<boolean>;
  /** The remembered per-origin decisions, read fresh on every request. */
  stored(): BrowserSitePermissions;
}

/**
 * Deny everything, used until the UI registers a real prompter.
 *
 * Fail-closed on purpose: if the browser somehow loads a page before the
 * renderer has wired its prompt, the answer is no, not "wait and see".
 */
const DENY_ALL: PermissionPrompter = {
  ask: async () => false,
  stored: () => ({}),
};

let prompter: PermissionPrompter = DENY_ALL;

export function setPermissionPrompter(next: PermissionPrompter | null): void {
  prompter = next ?? DENY_ALL;
}

export function installBrowserPermissions(ses: Session): void {
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = permissionOriginOf(
      // `requestingUrl` is the frame that actually asked; falling back to the
      // tab's URL would attribute an iframe's request to the top-level site.
      (details as { requestingUrl?: string }).requestingUrl || webContents?.getURL() || '',
    );
    if (!origin) {
      // An opaque origin (data:, sandboxed frame) has nothing to remember a
      // decision against and no name to show a user. Refuse.
      callback(false);
      return;
    }

    const { policy } = resolveBrowserPermission(permission, origin, prompter.stored());
    if (policy === 'allow') { callback(true); return; }
    if (policy === 'deny') { callback(false); return; }

    void prompter
      .ask({
        permission,
        origin,
        mediaTypes: (details as { mediaTypes?: string[] }).mediaTypes,
      })
      .then((granted) => callback(granted === true))
      // A prompt that fails is a denial. Never leave the callback unanswered:
      // Chromium waits on it, and the page hangs on a permission that never
      // resolves rather than being told no.
      .catch(() => callback(false));
  });

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    const origin = permissionOriginOf(requestingOrigin || '');
    if (!origin) return false;
    return checkBrowserPermission(permission, origin, prompter.stored());
  });

  // Never use the macOS system picker and never provide a display source.
  // `display-capture` is also a hard denial in both permission handlers above.
  // On Electron 43 callback({}) is not a denial: it leaves the page waiting for
  // a nonexistent video track. A null provider supplies no capture capability;
  // Chromium may still leave the caller's promise pending, but it cannot grant
  // a stream or show the privileged system picker.
  ses.setDisplayMediaRequestHandler(null, { useSystemPicker: false });

  // Hardware. USB, Serial, HID and Bluetooth never reach the permission handlers
  // above — they arrive through these, and through the `select-*-device` events.
  // Denying here is what makes them actually unavailable rather than merely
  // un-chosen: with no handler at all the chooser never resolves and the page
  // waits forever, which reads as a hang rather than as a refusal.
  ses.setDevicePermissionHandler(() => false);
  ses.setUSBProtectedClassesHandler((details) => details.protectedClasses);
  ses.setBluetoothPairingHandler((_details, callback) => callback({ confirmed: false }));

  // Device choosers are separate from both permission handlers. Always prevent
  // Electron's default selection behaviour and resolve the request as cancelled
  // so hostile pages cannot leave a chooser pending or obtain the first device.
  ses.on('select-usb-device', (event, _details, callback) => {
    event.preventDefault();
    callback();
  });
  ses.on('select-hid-device', (event, _details, callback) => {
    event.preventDefault();
    callback();
  });
  ses.on('select-serial-port', (event, _ports, _contents, callback) => {
    event.preventDefault();
    callback('');
  });
}
