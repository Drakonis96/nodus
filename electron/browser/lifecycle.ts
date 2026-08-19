// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Browser subsystem lifecycle.
 *
 * This is intentionally smaller than the Nodus application lifecycle. It owns
 * only Browser tabs/views, Browser media, Browser permission prompts and live
 * Browser downloads. Persistent session data and application services never
 * enter this module, so a Browser restart cannot touch vaults, the Library,
 * Nodi, databases, settings, cookies, site storage or cache.
 */

import { cancelPermissionRequests } from './permissionPrompt';
import { resetBrowserDownloads } from './downloads';
import { closeAllBrowserTabs, createTab } from './tabs';
import { clearBrowserHistoryOnCloseIfConfigured } from './history';

export interface DestroyBrowserSubsystemOptions {
  /** Keep the current renderer-published rectangle for the replacement view. */
  preserveViewport?: boolean;
}

/** Shared cleanup for Browser restart, normal quit and updater shutdown. */
export function destroyBrowserSubsystem(options: DestroyBrowserSubsystemOptions = {}): void {
  clearBrowserHistoryOnCloseIfConfigured();
  // Closing tabs stops all page loads and media before other transient state is
  // discarded. closeAllBrowserTabs itself uses the same per-tab destructor as
  // ordinary close and unexpected WebContents destruction.
  closeAllBrowserTabs({ preserveViewport: options.preserveViewport });
  cancelPermissionRequests();
  resetBrowserDownloads();
}

/** Destroy the old Browser runtime, then create exactly one configured tab. */
export async function restartBrowserSubsystem(homeUrl: string): Promise<string | null> {
  destroyBrowserSubsystem({ preserveViewport: true });
  return createTab(homeUrl);
}
