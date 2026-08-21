// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * The one Electron session every Nodus Browser tab shares.
 *
 * Two properties matter, and they pull in opposite directions:
 *
 *  - It is PERSISTENT, so a login to JSTOR or a university IdP survives a
 *    restart. That is the entire reason the feature exists.
 *  - It is SEPARATE from `session.defaultSession`, which is where Nodus itself
 *    lives and where nodus-image/nodus-archive/nodus-library are registered.
 *    Those protocols serve vault bytes; nothing loaded from the web may share a
 *    session with them.
 *
 * Nodus stores no usernames and no passwords. What persists here is Chromium's
 * own cookie jar and site storage — the same mechanism as any browser's "stay
 * signed in" — and nothing else.
 */

import { session, type Session } from 'electron';
import { isBrowserResourceAllowed } from '@shared/browserNavigation';
import { installBrowserPermissions, setPermissionPrompter } from './permissions';
import { createPermissionPrompter } from './permissionPrompt';
import { installDownloadHandling } from './downloads';
import { getSettings } from '../db/settingsRepo';

export const NODUS_BROWSER_PARTITION = 'persist:nodus-browser';

let configured = false;

/**
 * The browser session, configured on first use.
 *
 * Deliberately lazy: it costs nothing until a page loads, and startup is the one
 * moment the main process's single event loop is genuinely contended (the same
 * argument the announcements timer makes in main.ts).
 */
export function browserSession(): Session {
  const ses = session.fromPartition(NODUS_BROWSER_PARTITION);
  if (!configured) {
    configured = true;
    configureBrowserSession(ses);
  }
  return ses;
}

/**
 * A Chrome-shaped User-Agent.
 *
 * Electron's default carries `Electron/x.y.z` and the app name, and a
 * non-trivial number of library proxies and publisher platforms sniff the UA and
 * serve a degraded page — or refuse outright — to anything they do not
 * recognise. Stripping those two tokens leaves an ordinary Chrome UA.
 *
 * Note this is set on the BROWSER session only. main.ts does the same thing to
 * `defaultSession` for the tutorial embeds, and the two must stay independent so
 * neither one's needs constrain the other.
 */
function browserUserAgent(ses: Session): string {
  return ses
    .getUserAgent()
    .replace(/\s*Electron\/[\S]+/g, '')
    .replace(/\s*nodus\/[\S]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The real Chromium version embedded in this Electron build, taken from the
 * session's own User-Agent. The Sec-CH-UA spoof MUST use this exact version:
 * a mismatch (e.g. UA says Chrome/142 but Sec-CH-UA says 132) is precisely
 * what Google's anti-spoofing detects, and a hard-coded version goes stale
 * with every Electron upgrade.
 */
function chromeVersionFromUserAgent(ua: string): { major: string; full: string } {
  const match = /Chrome\/([\d.]+)/.exec(ua);
  if (!match) return { major: '132', full: '132.0.0.0' };
  const full = match[1];
  return { major: full.split('.')[0], full };
}

function configureBrowserSession(ses: Session): void {
  const cleanUa = browserUserAgent(ses);
  ses.setUserAgent(cleanUa);
  const { major, full } = chromeVersionFromUserAgent(cleanUa);

  // Spoof Sec-CH-UA to hide Electron: Google's "browser not secure" check reads
  // the User-Agent string AND the Sec-CH-UA brand list. setUserAgent() alone
  // does not affect Sec-CH-UA, so it is rewritten here with the real Chromium
  // version from the UA above.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    if (headers['Sec-CH-UA']) {
      headers['Sec-CH-UA'] =
        `"Not A(Brand";v="8", "Chromium";v="${major}", "Google Chrome";v="${major}"`;
    }
    if (headers['Sec-CH-UA-Full-Version-List']) {
      headers['Sec-CH-UA-Full-Version-List'] =
        `"Not A(Brand";v="8.0.0.0", "Chromium";v="${full}", "Google Chrome";v="${full}"`;
    }
    // Belt-and-braces: ensure User-Agent header matches the cleaned session UA.
    if (headers['User-Agent']) {
      headers['User-Agent'] = String(headers['User-Agent'])
        .replace(/\s*Electron\/[\S]+/g, '')
        .replace(/\s*nodus\/[\S]+/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    callback({ requestHeaders: headers });
  });

  // Deny-by-default permissions, both handlers plus the device ones. The
  // prompter is registered first: installing the handlers without it would
  // leave `ask` permissions resolving through the fail-closed DENY_ALL stub,
  // which is safe but silently refuses the camera instead of asking.
  setPermissionPrompter(createPermissionPrompter());
  installBrowserPermissions(ses);

  // Downloads: classified, size-capped, and never opened afterwards.
  installDownloadHandling(ses, () => getSettings().browserDownloadFolder ?? null);

  // Belt to the navigation guard's braces. This is an allowlist, not a list of
  // three known-bad schemes: unknown custom protocols fail closed as well.
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isBrowserResourceAllowed(details.url, details.resourceType) });
  });
}

/** Test seam: forget that the session was configured. */
export function resetBrowserSessionForTests(): void {
  configured = false;
}
