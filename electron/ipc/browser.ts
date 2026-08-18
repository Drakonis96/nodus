// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * The Nodus Browser IPC surface.
 *
 * Every channel here carries a sender check, which is a NEW invariant in this
 * codebase and the reason this file does not simply use `h()` and stop there.
 *
 * Until now Nodus had exactly one renderer — its own `file://` window — so
 * `ipcMain.handle` needed no sender validation: anything that could call a
 * channel was already trusted. Nodus Browser breaks that assumption by adding
 * WebContents that load arbitrary websites. Those pages get no bridge (see
 * electron/preload/browserPage.ts), so they cannot invoke these channels today;
 * `assertUiSender` is what keeps that true if a future edit ever gives a page a
 * preload with `ipcRenderer` on it. Defence in depth, deliberately redundant.
 */

import { BrowserWindow } from 'electron';
import type { IpcContext } from './context';
import type { BrowserViewport } from '@shared/browser';
import { parseOmniboxInput } from '@shared/browserOmnibox';
import {
  cancelPermissionRequests,
  pendingPermissionRequest,
  resolvePermissionRequest,
  setPermissionPromptNotifier,
} from '../browser/permissionPrompt';
import { browserMediaStates, setMediaNotifier } from '../browser/media';
import { activePageIsPdf, captureActivePage, importPdfIntoItem, saveCapture } from '../browser/capture';
import {
  browserDownloads, cancelDownload, completedDownloadPath, dismissDownload, setDownloadNotifier,
} from '../browser/downloads';
import { addGlobalLibraryAttachments, createGlobalLibraryItem } from '../library/libraryService';
import { setNodiQuoteSelection, setNodiViewContext } from '../ai/nodiChat';
import {
  activateTab,
  browserState,
  closeTab,
  createTab,
  goBack,
  goForward,
  initBrowserTabs,
  navigate,
  reload,
  setOverlayVisible,
  activeTabSummary,
  collectFromTab,
  sendMediaCommand,
  setTabMuted,
  setViewport,
  stopLoading,
} from '../browser/tabs';

/**
 * Refuse anything that is not the main Nodus window.
 *
 * `event.sender` is the WebContents that made the call. Comparing it against the
 * main window's own WebContents means a browser tab — which lives in a different
 * WebContents entirely — can never drive the browser it is displayed in.
 */
function assertUiSender(event: { sender: Electron.WebContents }, getWindow: () => BrowserWindow | null): void {
  const window = getWindow();
  if (!window || window.isDestroyed()) throw new Error('The Nodus window is not available.');
  if (event.sender !== window.webContents) {
    throw new Error('This channel is only available to the Nodus window.');
  }
}

function sanitizeViewport(raw: unknown): BrowserViewport | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<Record<keyof BrowserViewport, unknown>>;
  const numbers = (['x', 'y', 'width', 'height'] as const).map((key) => Number(candidate[key]));
  if (numbers.some((value) => !Number.isFinite(value))) return null;
  const [x, y, width, height] = numbers;
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
}

export function registerBrowserIpc({ h, getWindow }: IpcContext): void {
  /** Push the whole browser state; the renderer re-renders from it wholesale. */
  const broadcast = () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send('browser:state', browserState());
  };

  const broadcastPermission = () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send('browser:permissionRequest', pendingPermissionRequest());
  };

  const broadcastMedia = () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send('browser:media', browserMediaStates());
  };

  const broadcastDownloads = () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send('browser:downloads', browserDownloads());
  };

  let wired = false;
  const ensureWired = () => {
    if (wired) return;
    const window = getWindow();
    if (!window) return;
    initBrowserTabs(window, broadcast);
    setPermissionPromptNotifier(broadcastPermission);
    setMediaNotifier(broadcastMedia);
    setDownloadNotifier(broadcastDownloads);
    wired = true;
  };

  h('browser:state', async (event) => {
    assertUiSender(event, getWindow);
    ensureWired();
    return browserState();
  });

  h('browser:openTab', async (event, url: string) => {
    assertUiSender(event, getWindow);
    ensureWired();
    return createTab(String(url ?? ''));
  });

  h('browser:activateTab', async (event, id: string) => {
    assertUiSender(event, getWindow);
    await activateTab(String(id));
  });

  h('browser:closeTab', async (event, id: string) => {
    assertUiSender(event, getWindow);
    closeTab(String(id));
  });

  h('browser:goBack', async (event) => { assertUiSender(event, getWindow); goBack(); });
  h('browser:goForward', async (event) => { assertUiSender(event, getWindow); goForward(); });
  h('browser:reload', async (event) => { assertUiSender(event, getWindow); reload(); });
  h('browser:stop', async (event) => { assertUiSender(event, getWindow); stopLoading(); });

  /**
   * What the user typed in the address bar.
   *
   * Resolution happens HERE rather than in the renderer so the scheme blocklist
   * is enforced on the main-process side of the boundary, where it cannot be
   * skipped by whatever the renderer happens to send.
   */
  h('browser:submitOmnibox', async (event, input: string) => {
    assertUiSender(event, getWindow);
    ensureWired();
    const resolved = parseOmniboxInput(String(input ?? ''));
    if (resolved.kind === 'navigate' || resolved.kind === 'search') {
      const ok = navigate(resolved.url);
      return { kind: resolved.kind, url: resolved.url, ok };
    }
    return resolved;
  });

  h('browser:setViewport', async (event, raw: unknown) => {
    assertUiSender(event, getWindow);
    const viewport = sanitizeViewport(raw);
    if (viewport) setViewport(viewport);
  });

  /**
   * Hide the page while a React overlay is open.
   *
   * A WebContentsView is a native child view and paints above the window's HTML,
   * so without this every modal, the command palette and Nodi's companion would
   * be drawn underneath a web page. The WebContents is untouched: media keeps
   * playing and no navigation state is lost.
   */
  h('browser:setOverlayVisible', async (event, visible: boolean) => {
    assertUiSender(event, getWindow);
    setOverlayVisible(Boolean(visible));
  });

  h('browser:pendingPermission', async (event) => {
    assertUiSender(event, getWindow);
    return pendingPermissionRequest();
  });

  /**
   * Answer a permission prompt.
   *
   * `remember` is what "Always allow for this site" writes, and it goes to
   * app-prefs.json rather than to the vault: a site is the same site whichever
   * corpus happens to be open.
   */
  h('browser:resolvePermission', async (event, id: string, granted: boolean, remember: boolean) => {
    assertUiSender(event, getWindow);
    resolvePermissionRequest(String(id), granted === true, remember === true);
  });

  h('browser:cancelPermissions', async (event) => {
    assertUiSender(event, getWindow);
    cancelPermissionRequests();
  });

  h('browser:media', async (event) => {
    assertUiSender(event, getWindow);
    ensureWired();
    return browserMediaStates();
  });

  h('browser:mediaCommand', async (event, tabId: string, command: string) => {
    assertUiSender(event, getWindow);
    if (command !== 'play' && command !== 'pause' && command !== 'stop') return;
    sendMediaCommand(String(tabId), command);
  });

  h('browser:setTabMuted', async (event, tabId: string, muted: boolean) => {
    assertUiSender(event, getWindow);
    setTabMuted(String(tabId), muted === true);
  });

  /**
   * Add to Library.
   *
   * Returns what WOULD be stored, enriched, for the user to review. Nothing is
   * written until browser:saveCapture, because a capture creates a real Library
   * item and silently guessed metadata is worse than none.
   */
  h('browser:capturePage', async (event) => {
    assertUiSender(event, getWindow);
    return captureActivePage();
  });

  h('browser:saveCapture', async (event, request: unknown, includeSnapshot: boolean) => {
    assertUiSender(event, getWindow);
    if (!request || typeof request !== 'object') throw new Error('There is nothing to save from this page.');
    return saveCapture(request as never, { includeSnapshot: includeSnapshot === true });
  });

  h('browser:isPdf', async (event) => {
    assertUiSender(event, getWindow);
    return activePageIsPdf();
  });

  h('browser:importPdf', async (event, itemId: string, url: string, title: string) => {
    assertUiSender(event, getWindow);
    return importPdfIntoItem(String(itemId), String(url), String(title ?? ''));
  });

  /**
   * Ask Nodi about this page.
   *
   * Reuses the existing Nodi context slot rather than inventing a browser-
   * specific channel. Nothing is sent to any AI provider by this call: it only
   * puts the page where Nodi will look IF the user then asks something.
   */
  h('browser:askNodiAboutPage', async (event) => {
    assertUiSender(event, getWindow);
    const collected = await collectFromTab('text');
    const payload = (collected ?? {}) as { title?: unknown; text?: unknown };
    const tab = activeTabSummary();
    const text = String(payload.text ?? '');
    if (!text.trim()) return false;
    setNodiViewContext({
      viewId: 'browser',
      title: String(payload.title ?? tab?.title ?? 'Nodus Browser'),
      text: `${tab?.url ?? ''}\n\n${text}`,
      capturedAt: Date.now(),
      complete: true,
    });
    return true;
  });

  h('browser:downloads', async (event) => {
    assertUiSender(event, getWindow);
    ensureWired();
    return browserDownloads();
  });

  h('browser:cancelDownload', async (event, id: string) => {
    assertUiSender(event, getWindow);
    cancelDownload(String(id));
  });

  h('browser:dismissDownload', async (event, id: string) => {
    assertUiSender(event, getWindow);
    dismissDownload(String(id));
  });

  /**
   * Import a completed download into the Library.
   *
   * Only ever from an explicit click. The file is already on disk where the user
   * put it; this attaches a COPY through the normal Library path, which is what
   * runs extraction, OCR, indexing and embeddings.
   */
  h('browser:importDownload', async (event, id: string, title: string) => {
    assertUiSender(event, getWindow);
    const file = completedDownloadPath(String(id));
    if (!file) throw new Error('That download is no longer available.');
    const item = createGlobalLibraryItem({
      title: String(title ?? '').trim() || 'Downloaded document',
      itemType: 'document',
      creators: [],
      url: '',
      tags: [],
    } as never);
    const saved = await addGlobalLibraryAttachments(item.id, [file]);
    dismissDownload(String(id));
    return { itemId: saved.id, title: saved.metadata.title };
  });

  h('browser:askNodiAboutSelection', async (event) => {
    assertUiSender(event, getWindow);
    const collected = await collectFromTab('selection');
    const text = String(((collected ?? {}) as { text?: unknown }).text ?? '');
    if (!text.trim()) return false;
    const selection = setNodiQuoteSelection(text);
    const window = getWindow();
    if (selection && window && !window.isDestroyed()) {
      window.webContents.send('nodi:quoteSelection', selection);
    }
    return Boolean(selection);
  });
}
