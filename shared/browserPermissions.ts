// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * What a website loaded in Nodus Browser is allowed to ask the machine for.
 *
 * Kept pure and Electron-free so the entire table can be asserted
 * (scripts/test-browser-permissions.mjs), including the property that matters
 * most: it is TOTAL over the permission names Electron actually ships. That test
 * reads the unions out of electron.d.ts rather than repeating them here, so an
 * Electron upgrade that introduces a new permission fails the suite instead of
 * silently falling through — which is exactly what happened between 33 and 43,
 * where the check handler gained `fileSystem`.
 *
 * The default is DENY. Anything unlisted, unknown, or newly invented resolves to
 * deny, because a browser that grants what it does not recognise has no policy.
 */

export type PermissionPolicy = 'allow' | 'deny' | 'ask';

/**
 * The policy table.
 *
 * Names are Electron's, spanning both `setPermissionRequestHandler` and
 * `setPermissionCheckHandler` — the two unions differ, and both handlers must be
 * installed: Chromium's `permissions.query()` path goes through the check
 * handler, so a request-only policy leaves a hole.
 *
 * Note there is no `camera` or `microphone`. Both arrive as `media`, and which
 * one is being asked for lives in `details.mediaTypes`.
 */
export const BROWSER_PERMISSION_POLICY: Readonly<Record<string, PermissionPolicy>> = {
  // — Allowed: what ordinary reading and watching needs.
  // Video needs it, and it is scoped to our own window; leaving full screen is
  // Chromium's own Escape handling plus our leave-html-full-screen restore.
  fullscreen: 'allow',
  // Denying this yields a confusing generic failure instead of the real one.
  // It will still fail on DRM content: stock Electron ships no Widevine CDM.
  mediaKeySystem: 'allow',
  // Publisher "copy citation" buttons. Chromium sanitizes the payload, and
  // writing to the clipboard cannot read what was already there.
  'clipboard-sanitized-write': 'allow',

  // — Ask: real research uses, never silently.
  // Camera and microphone both arrive here; the prompt names which.
  media: 'ask',
  // Location is not necessary for research browsing and is never prompted.
  geolocation: 'deny',

  // — Denied: no research use, or too costly to be worth one.
  // Nodus has its own notification centre; web push from publisher sites is noise.
  notifications: 'deny',
  // Silent clipboard exfiltration.
  'clipboard-read': 'deny',
  'deprecated-sync-clipboard-read': 'deny',
  // No use case, and keyboard lock can trap the user inside a page.
  pointerLock: 'deny',
  keyboardLock: 'deny',
  // A research browser has no reason to capture the screen.
  'display-capture': 'deny',
  // A web page must not reach the disk.
  fileSystem: 'deny',
  midi: 'deny',
  midiSysex: 'deny',
  // Hardware. These mostly travel through setDevicePermissionHandler and the
  // select-*-device events rather than through these handlers, but naming them
  // here keeps the table total and the intent legible in one place.
  usb: 'deny',
  serial: 'deny',
  hid: 'deny',
  bluetooth: 'deny',
  // Tells a site when the user walked away. Pure surveillance.
  'idle-detection': 'deny',
  // Lets a page enumerate and place windows across displays.
  'window-management': 'deny',
  // Lets a page pick an output device.
  'speaker-selection': 'deny',
  // Third-party cookie access. Denying is safe: it only narrows what a site sees.
  'storage-access': 'deny',
  'top-level-storage-access': 'deny',
  // External navigation happens only through our own explicit action, never
  // because a page asked for it.
  openExternal: 'deny',
  // Electron's own catch-all.
  unknown: 'deny',
};

/** A remembered per-origin decision. `ask` is never stored — it is the absence of one. */
export type StoredPermissionDecision = 'allow' | 'deny';
export type BrowserSitePermissions = Record<string, Record<string, StoredPermissionDecision>>;

export interface PermissionResolution {
  policy: PermissionPolicy;
  /** True when the answer came from something the user chose for this origin. */
  remembered: boolean;
}

/**
 * Resolve one permission for one origin.
 *
 * A stored decision wins over the table, which is what "Always allow for this
 * site" means. Everything else falls back to the table, and the table falls back
 * to deny.
 */
export function resolveBrowserPermission(
  permission: string,
  origin: string,
  stored: BrowserSitePermissions | null | undefined,
): PermissionResolution {
  const listed = Object.hasOwn(BROWSER_PERMISSION_POLICY, permission)
    ? BROWSER_PERMISSION_POLICY[permission]
    : undefined;

  // Own-property lookups only, on both maps. A plain `map[key]` walks the
  // prototype chain, so a page asking for a permission named "constructor" got
  // Object's constructor back — a truthy value, which sailed straight past the
  // `?? 'deny'` fallback and resolved to a function instead of a refusal.
  const siteRules = stored && Object.hasOwn(stored, origin) ? stored[origin] : undefined;
  const remembered = siteRules && Object.hasOwn(siteRules, permission) ? siteRules[permission] : undefined;
  // Stored decisions may only answer an explicitly promptable permission.
  // Corrupted or manually edited preferences must never turn a hard denial
  // (filesystem, geolocation, devices...) into a grant.
  if (listed === 'ask' && (remembered === 'allow' || remembered === 'deny')) {
    return { policy: remembered, remembered: true };
  }
  return { policy: listed ?? 'deny', remembered: false };
}

/**
 * What a permission CHECK should answer.
 *
 * A check is not a request: it is a page asking `permissions.query()`, and it
 * must never open a prompt. So `ask` — which means "we would prompt on a real
 * request" — answers false here, because nothing has been granted yet.
 */
export function checkBrowserPermission(
  permission: string,
  origin: string,
  stored: BrowserSitePermissions | null | undefined,
): boolean {
  return resolveBrowserPermission(permission, origin, stored).policy === 'allow';
}

/** The origin of a URL, or '' when it has none we can key on. */
export function permissionOriginOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'null' ? '' : parsed.origin;
  } catch {
    return '';
  }
}
