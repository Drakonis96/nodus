// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * The page's own Media Session handlers, as the remote control the header needs.
 *
 * Previous and Next cannot be implemented by poking the DOM alone. A player that
 * owns its playlist internally — Spotify, YouTube, anything driving one
 * <audio>/<video> through MediaSource — exposes ONE element for every track it
 * will ever play, so "move to the next element" is either a no-op or a jump to
 * some unrelated decorative element. What such a page does publish is a
 * `nexttrack` handler on its Media Session.
 *
 * Chromium does not let an embedder invoke that handler. Media keys are
 * dispatched in the BROWSER process (its own media-key listener), never in the
 * renderer, so an injected key event is just an ordinary DOM keydown. Verified
 * against Electron 43 with a page that registers `nexttrack`: injecting
 * `MediaNextTrack` delivers `key: "MediaTrackNext"` to the document and fires
 * no action at all — which is why an earlier implementation of this feature
 * could pause a page without ever skipping a track.
 *
 * The handler is therefore captured instead. The page preload wraps
 * `navigator.mediaSession.setActionHandler` in the PAGE's own JavaScript world
 * before any page script runs, remembers what the page registers, and calls it
 * when the header asks. Calling the page's own callback is what a hardware media
 * key ends up doing anyway — minus the browser plumbing Electron does not
 * expose.
 *
 * Everything here is a string or a pure mapping on purpose: the preload cannot
 * be imported outside Electron, so this module is what the tests can exercise —
 * including the hook itself, run against a fake `window`/`navigator`.
 */

import type { MediaCommand } from './browserPageMedia';

export type MediaSessionAction = 'play' | 'pause' | 'previoustrack' | 'nexttrack' | 'stop';

export interface MediaCommandPlan {
  /** The Media Session action this command maps to, when the API has one. */
  action: MediaSessionAction | null;
  /**
   * Whether the page's handler must be tried BEFORE the DOM.
   *
   * True for Previous/Next: the page's handler is the only channel that can skip
   * a track inside a single MediaSource element, and it is what a hardware media
   * key would reach, so it outranks walking the document.
   *
   * False for Play/Pause/Stop: acting on the element already works everywhere
   * Nodus has been tried, and the page's handler is a better LAST resort than
   * the key event Chromium never routes into the page.
   */
  sessionFirst: boolean;
}

const ACTIONS: Partial<Record<MediaCommand, MediaSessionAction>> = {
  previous: 'previoustrack',
  play: 'play',
  pause: 'pause',
  next: 'nexttrack',
  stop: 'stop',
};

export function planMediaCommand(command: MediaCommand): MediaCommandPlan {
  return {
    action: ACTIONS[command] ?? null,
    sessionFirst: command === 'previous' || command === 'next',
  };
}

/** The two channels that can carry a command out. */
export type MediaChannel = 'session' | 'elements';

/**
 * The channels to try for one command, in order.
 *
 * Each appears at most once, and that is the property to keep: calling a page's
 * Media Session handler twice for one press of the header's button makes Next
 * skip two tracks and Previous land two back. The first channel that acts ends
 * the command.
 */
export function mediaChannels(plan: MediaCommandPlan): MediaChannel[] {
  return plan.sessionFirst ? ['session', 'elements'] : ['elements', 'session'];
}

/**
 * What the header should show once this command has been carried out.
 *
 * `null` means the command says nothing about playback state — skipping a track
 * leaves it playing and the page's own events report the rest. Only used to fill
 * in a state for a page that emits no media events at all.
 */
export function playbackAfterCommand(command: MediaCommand): boolean | null {
  if (command === 'play') return true;
  if (command === 'pause' || command === 'stop') return false;
  return null;
}

/**
 * The main-world script that captures the page's handlers.
 *
 * Runs in the page's world, so its only contract with the preload is the return
 * value and the bridge function it hides on `window`. The bridge is named by the
 * caller and defined non-enumerable: a page enumerating its own globals should
 * not find a Nodus-looking name to poke at, and the command set stays closed
 * because only a known action string is ever passed in.
 */
export function mediaSessionHookSource(bridgeName: string): string {
  return `(() => {
  const session = navigator.mediaSession;
  if (!session || typeof session.setActionHandler !== 'function') return 'unavailable';
  const handlers = Object.create(null);
  const original = session.setActionHandler;
  session.setActionHandler = function (action, handler) {
    if (typeof action === 'string') {
      if (typeof handler === 'function') handlers[action] = handler;
      else delete handlers[action];
    }
    return original.call(session, action, handler);
  };
  Object.defineProperty(window, ${JSON.stringify(bridgeName)}, {
    value: (action) => {
      const handler = handlers[action];
      if (typeof handler !== 'function') return 'no-handler';
      try {
        handler({ action });
        return 'called';
      } catch (error) {
        return 'threw';
      }
    },
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return 'installed';
})()`;
}

/** Ask the captured handler for one action. Never throws in the page. */
export function mediaSessionInvokeSource(bridgeName: string, action: MediaSessionAction): string {
  return `(() => {
  const invoke = window[${JSON.stringify(bridgeName)}];
  return typeof invoke === 'function' ? invoke(${JSON.stringify(action)}) : 'no-bridge';
})()`;
}
