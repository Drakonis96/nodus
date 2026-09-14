// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * The bridge between an HTTP authentication challenge and the user answering it.
 *
 * A pending request is held here, in the main process, and offered to the
 * renderer as data. The renderer draws a bar, the user types credentials, and
 * Chromium's callback is resolved from that. Credentials only ever travel from
 * the trusted renderer to this module to the callback: nothing is written to
 * disk, logged, or handed to the page.
 *
 * Requests are owned by the tab that raised them. Navigating that tab away, or
 * closing it, cancels its requests so Chromium is never left waiting on an
 * answer that can no longer arrive.
 */

export interface PendingBrowserAuthRequest {
  id: string;
  /** The host that answered 401 (or the proxy that answered 407), with port. */
  host: string;
  /** The server's own realm, verbatim. Empty when it sent none. */
  realm: string;
  /** The page that triggered the challenge, for context. */
  url: string;
  isProxy: boolean;
}

export interface BrowserCredentials {
  username: string;
  password: string;
}

interface Waiting extends PendingBrowserAuthRequest {
  tabId: string;
  resolve: (credentials: BrowserCredentials | null) => void;
}

/** Only the first request is shown; a second waits rather than stacking. */
const queue: Waiting[] = [];
let notify: (() => void) | null = null;
let counter = 0;

/** What the renderer should currently be showing, if anything. */
export function pendingBrowserAuthRequest(): PendingBrowserAuthRequest | null {
  const next = queue[0];
  if (!next) return null;
  const { id, host, realm, url, isProxy } = next;
  return { id, host, realm, url, isProxy };
}

function settle(id: string, credentials: BrowserCredentials | null): void {
  const index = queue.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  const [entry] = queue.splice(index, 1);
  entry.resolve(credentials);
  notify?.();
}

/**
 * Ask the user for credentials. Resolves null when the request is cancelled —
 * including by tab or navigation teardown — which cancels Chromium's challenge.
 */
export function requestBrowserAuth(
  tabId: string,
  request: Omit<PendingBrowserAuthRequest, 'id'>,
): Promise<BrowserCredentials | null> {
  counter += 1;
  return new Promise((resolve) => {
    queue.push({ id: `auth-${counter}`, tabId, ...request, resolve });
    notify?.();
  });
}

export function resolveBrowserAuthRequest(id: string, username: string, password: string): void {
  settle(id, { username, password });
}

export function cancelBrowserAuthRequest(id: string): void {
  settle(id, null);
}

/** Drop every request raised by one tab, cancelling each. */
export function cancelBrowserAuthRequestsForTab(tabId: string): void {
  for (const entry of [...queue]) {
    if (entry.tabId === tabId) settle(entry.id, null);
  }
}

/** Drop every pending request, cancelling each. Used on section/teardown paths. */
export function cancelAllBrowserAuthRequests(): void {
  while (queue.length > 0) queue.shift()?.resolve(null);
  notify?.();
}

export function setBrowserAuthNotifier(callback: (() => void) | null): void {
  notify = callback;
}

/** Test seam: how many requests are still waiting on an answer. */
export function pendingBrowserAuthCount(): number {
  return queue.length;
}
