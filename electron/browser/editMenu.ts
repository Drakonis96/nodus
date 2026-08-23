// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Cut, Copy and Paste — the three entries every text field is expected to have.
 *
 * They live in their own module because two very different surfaces need the
 * same three items in the same order: a remote web page inside a browser tab,
 * and Nodus's own trusted UI (the address bar and every other input in the app).
 * Neither had Paste at all, and the page menu had Copy without the other two.
 *
 * The ORDER is not incidental. Cut, Copy, Paste is what every platform ships and
 * what a hand reaches for without reading; any other arrangement makes people
 * mis-click. So the order is fixed here rather than at each call site, and a test
 * holds it.
 *
 * Deciding what is enabled is separated from building the native menu so it can
 * be tested without Electron: `editEntries` is pure, `appendEditItems` is the
 * thin part that turns it into `MenuItem`s.
 */

import { Menu, MenuItem, clipboard, type WebContents } from 'electron';
import { browserMenuIcon, type BrowserMenuIcon } from './menuIcons';

export type EditAction = 'cut' | 'copy' | 'paste';

export interface EditContext {
  /** The click landed in a text field, so all three entries belong. */
  isEditable: boolean;
  /** Text currently selected, if any. */
  hasSelection: boolean;
  /**
   * Chromium's own verdict, straight from `params.editFlags`.
   *
   * It knows things this module cannot guess: a `readonly` input refuses Cut and
   * Paste, a password field refuses Copy. Asking it beats re-deriving the rules.
   */
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  /** Whether the clipboard holds anything at all to paste. */
  clipboardHasContent: boolean;
}

export interface EditEntry {
  action: EditAction;
  enabled: boolean;
}

const ICONS: Record<EditAction, BrowserMenuIcon> = { cut: 'cut', copy: 'copy', paste: 'paste' };

/**
 * Which of the three entries to show, and which of them are live.
 *
 * A text field always shows all three even when some are dead: a Paste that is
 * greyed out tells the user the clipboard is empty, whereas a Paste that is
 * simply absent reads as "this app cannot paste" — which is the bug being fixed.
 * Outside a text field there is nothing to cut or paste into, so a selection
 * gets Copy alone.
 */
export function editEntries(context: EditContext): EditEntry[] {
  if (!context.isEditable) {
    return context.hasSelection ? [{ action: 'copy', enabled: context.canCopy }] : [];
  }
  return [
    { action: 'cut', enabled: context.canCut && context.hasSelection },
    { action: 'copy', enabled: context.canCopy && context.hasSelection },
    { action: 'paste', enabled: context.canPaste && context.clipboardHasContent },
  ];
}

/** The app's own words for the three actions. */
export const EDIT_LABELS: Record<EditAction, string> = {
  cut: 'Cortar',
  copy: 'Copiar',
  paste: 'Pegar',
};

/** Whether the clipboard has anything a field could receive. */
export function clipboardHasContent(): boolean {
  try {
    return clipboard.availableFormats().length > 0;
  } catch {
    return false;
  }
}

/**
 * Append the entries to a menu, wired to the WebContents that was clicked.
 *
 * `contents.cut/copy/paste` rather than menu roles: a role targets whatever
 * Electron believes is focused, and a browser tab is a WebContentsView rather
 * than a window — the role's guess is wrong exactly when it matters. Naming the
 * WebContents leaves no guess to get wrong.
 *
 * Returns how many items were appended, so the caller can decide about separators.
 */
export function appendEditItems(
  menu: Menu,
  contents: WebContents,
  context: EditContext,
  t: (key: string) => string,
): number {
  const entries = editEntries(context);
  for (const entry of entries) {
    menu.append(new MenuItem({
      label: t(EDIT_LABELS[entry.action]),
      icon: browserMenuIcon(ICONS[entry.action]),
      enabled: entry.enabled,
      click: () => {
        if (contents.isDestroyed()) return;
        if (entry.action === 'cut') contents.cut();
        else if (entry.action === 'copy') contents.copy();
        else contents.paste();
      },
    }));
  }
  return entries.length;
}

/**
 * Give Nodus's OWN windows a text-field context menu.
 *
 * The address bar is HTML in the trusted renderer, and right-clicking it did
 * nothing at all: Electron shows no menu unless the app builds one, and nothing
 * here ever did. This installs the same three entries every text field in Nodus
 * now gets — including the address bar, which is what prompted it.
 *
 * Scoped deliberately: nothing but Cut/Copy/Paste, and only where there is a
 * text field or a selection. Views that already draw their own HTML context menu
 * call `preventDefault()` on the DOM event, and Electron then never raises this
 * one, so the two cannot collide.
 */
export function installAppEditContextMenu(contents: WebContents, t: (key: string) => string): void {
  contents.on('context-menu', (event, params) => {
    const context: EditContext = {
      isEditable: params.isEditable,
      hasSelection: Boolean(String(params.selectionText ?? '').trim()),
      canCut: params.editFlags.canCut,
      canCopy: params.editFlags.canCopy,
      canPaste: params.editFlags.canPaste,
      clipboardHasContent: clipboardHasContent(),
    };
    // Nothing to offer: leave the event alone rather than popping an empty menu.
    if (editEntries(context).length === 0) return;
    event.preventDefault();

    const menu = new Menu();
    appendEditItems(menu, contents, context, t);
    menu.popup({
      ...(params.frame ? { frame: params.frame } : {}),
      sourceType: params.menuSourceType,
    });
  });
}
