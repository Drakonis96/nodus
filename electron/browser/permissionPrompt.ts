// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * The bridge between a page asking for a permission and the user answering.
 *
 * A pending request is held here, in the main process, and offered to the
 * renderer as data. The renderer draws a bar and sends back a decision; the
 * Electron callback is resolved from that. Nothing about the prompt is drawn by
 * the page, and the page is never told a prompt is open.
 *
 * Only ONE request is pending at a time. A site that fires several in a row gets
 * them queued rather than stacked: two prompts on screen at once is how a user
 * ends up answering the wrong one.
 */

import { getSettings, updateSettings } from '../db/settingsRepo';
import type { BrowserSitePermissions } from '@shared/browserPermissions';
import type { PermissionPrompter } from './permissions';

export interface PendingPermissionRequest {
  id: string;
  permission: string;
  origin: string;
  /** For `media`: which of camera/microphone the page asked for. */
  mediaTypes: string[];
}

interface Waiting extends PendingPermissionRequest {
  resolve: (granted: boolean) => void;
}

const queue: Waiting[] = [];
let notify: (() => void) | null = null;
let counter = 0;

/** What the renderer should currently be showing, if anything. */
export function pendingPermissionRequest(): PendingPermissionRequest | null {
  const next = queue[0];
  if (!next) return null;
  const { id, permission, origin, mediaTypes } = next;
  return { id, permission, origin, mediaTypes };
}

function settle(id: string, granted: boolean): void {
  const index = queue.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  const [entry] = queue.splice(index, 1);
  entry.resolve(granted);
  notify?.();
}

/**
 * Answer the pending request.
 *
 * `remember` stores the decision for that origin, which is what "Always allow
 * for this site" means. It is written to app-prefs.json rather than to the vault
 * so that the answer does not change when the user switches vault — a site is a
 * site regardless of which corpus is open.
 */
export function resolvePermissionRequest(id: string, granted: boolean, remember: boolean): void {
  const entry = queue.find((candidate) => candidate.id === id);
  if (!entry) return;

  if (remember) {
    const current = getSettings().browserSitePermissions ?? {};
    const forOrigin = { ...(current[entry.origin] ?? {}), [entry.permission]: granted ? 'allow' : 'deny' } as
      Record<string, 'allow' | 'deny'>;
    updateSettings({ browserSitePermissions: { ...current, [entry.origin]: forOrigin } });
  }
  settle(id, granted);
}

/** Drop every pending request, denying each. Used when a tab closes or navigates away. */
export function cancelPermissionRequests(): void {
  while (queue.length > 0) {
    const entry = queue.shift();
    entry?.resolve(false);
  }
  notify?.();
}

export function setPermissionPromptNotifier(callback: (() => void) | null): void {
  notify = callback;
}

/** The prompter handed to installBrowserPermissions. */
export function createPermissionPrompter(): PermissionPrompter {
  return {
    stored: () => (getSettings().browserSitePermissions ?? {}) as BrowserSitePermissions,
    ask: (request) =>
      new Promise<boolean>((resolve) => {
        counter += 1;
        queue.push({
          id: `perm-${counter}`,
          permission: request.permission,
          origin: request.origin,
          mediaTypes: request.mediaTypes ?? [],
          resolve,
        });
        notify?.();
      }),
  };
}
