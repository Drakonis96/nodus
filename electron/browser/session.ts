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
import { decideNavigation } from '@shared/browserNavigation';
import { installBrowserPermissions } from './permissions';

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

function configureBrowserSession(ses: Session): void {
  ses.setUserAgent(browserUserAgent(ses));

  // Deny-by-default permissions, both handlers plus the device ones.
  installBrowserPermissions(ses);

  // Belt to the navigation guard's braces. `will-navigate` stops a tab from
  // MOVING to a blocked scheme; this stops a page from FETCHING one as a
  // subresource — an <img src="nodus-library://…"> or a fetch() to file://,
  // neither of which is a navigation and neither of which would otherwise be
  // seen by the navigation handler at all.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const decision = decideNavigation(details.url, { isMainFrame: details.resourceType === 'mainFrame' });
    if (decision.allowed) {
      callback({});
      return;
    }
    // Subresources legitimately use schemes the navigation policy refuses for
    // navigation, so only the genuinely dangerous ones are cancelled here.
    const scheme = decision.scheme ?? '';
    const dangerous = scheme === 'file'
      || scheme === 'javascript'
      || scheme.startsWith('nodus-')
      || scheme === 'chrome'
      || scheme === 'devtools'
      || scheme === 'view-source';
    callback({ cancel: dangerous });
  });

  // Nodus never asks Chromium to remember credentials, and there is no password
  // manager. Clearing this on configure means a stale HTTP-auth credential from
  // a previous run cannot be replayed silently.
  void ses.clearAuthCache();
}

/** Test seam: forget that the session was configured. */
export function resetBrowserSessionForTests(): void {
  configured = false;
}
