// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Keyboard shortcuts that must work WHILE a web page has focus.
 *
 * Shared, because both sides of the app need the same answers: main claims the
 * keystroke a page would otherwise swallow, and the renderer reads the same
 * modifiers off a toolbar click. Pure functions, no Electron, no DOM.
 *
 * The reason the keyboard half is a main-process concern at all: a browser tab
 * is a native WebContentsView, and it takes the keyboard as it takes the pointer.
 * A `keydown` listener in Nodus's own renderer never hears a key pressed while
 * the user is reading a page — which is precisely when Cmd/Ctrl+T means "open a
 * new tab". Main sits above both and is the only place that hears everything.
 *
 * The matcher is pure so it can be tested without Electron, and deliberately
 * narrow: it claims Nodus's own shortcuts and nothing else. Anything it does not
 * recognise reaches the page untouched, including whatever the site binds.
 */

export type BrowserShortcut = 'newTab';

/** The shape of `Electron.Input` this module actually reads. */
export interface ShortcutInput {
  type?: string;
  key?: string;
  control?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  isAutoRepeat?: boolean;
}

/**
 * Which Nodus shortcut a keystroke is, if any.
 *
 * `control || meta` rather than a per-platform branch: Cmd is the modifier on
 * macOS and Ctrl everywhere else, and accepting both costs nothing while making
 * the behaviour identical for a user who moves between machines.
 */
export function browserShortcutFor(input: ShortcutInput | null | undefined): BrowserShortcut | null {
  if (!input || input.type !== 'keyDown') return null;
  // Holding the key down must open ONE tab, not a tab per repeat.
  if (input.isAutoRepeat === true) return null;
  const accelerator = input.control === true || input.meta === true;
  if (!accelerator || input.alt === true || input.shift === true) return null;
  if (String(input.key ?? '').toLowerCase() === 't') return 'newTab';
  return null;
}

/**
 * Whether a click on Back or Forward asked for a new tab instead of navigation.
 *
 * Cmd/Ctrl-click and middle-click are the two gestures every browser treats as
 * "same target, new tab", so both are honoured here.
 */
export function opensInNewTab(event: {
  metaKey?: boolean; ctrlKey?: boolean; button?: number;
}): boolean {
  if (event.button === 1) return true;
  return event.metaKey === true || event.ctrlKey === true;
}

/**
 * The index a Back or Forward step would land on.
 *
 * Returns null when there is nowhere to go, which is what keeps the caller from
 * asking Electron for an entry outside the history.
 */
export function historyNeighbourIndex(
  activeIndex: number,
  length: number,
  direction: 'back' | 'forward',
): number | null {
  const index = activeIndex + (direction === 'back' ? -1 : 1);
  if (!Number.isInteger(index) || index < 0 || index >= length) return null;
  return index;
}
