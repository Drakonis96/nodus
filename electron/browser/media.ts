// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Which browser tabs have media, so the Nodus header can offer controls for it.
 *
 * The rule that shapes this file: visibility keys on whether a media SESSION
 * exists, never on whether sound is coming out right now. Chromium reports
 * audio state changing when playback pauses, so an audibility-driven icon would
 * disappear the instant the user pressed Pause — taking the Play button with it.
 *
 * A session therefore outlives a pause, outlives silence, and ends only when the
 * media does: the tab navigates away, the tab closes, or playback finished and
 * stayed finished.
 *
 * What is deliberately NOT here: previous/next. Neither the Media Session API
 * nor Electron exposes any way to discover whether a page registered
 * `previoustrack`/`nexttrack` handlers — `setActionHandler` has no getter — so
 * offering those controls would mean guessing, and a control that does nothing
 * half the time is worse than no control.
 */

import type { BrowserMediaState } from '@shared/browser';

/**
 * How long a finished track keeps its session.
 *
 * Lectures and interviews end and get scrubbed back; dropping the controls the
 * moment a file reaches its last second means the user has to go find the tab
 * again to replay it. Long enough to be useful, short enough that the icon does
 * not linger over a page nobody is listening to.
 */
const ENDED_GRACE_MS = 30_000;

interface Session extends BrowserMediaState {
  endedTimer: NodeJS.Timeout | null;
}

const sessions = new Map<string, Session>();
let notify: (() => void) | null = null;

export function setMediaNotifier(callback: (() => void) | null): void {
  notify = callback;
}

function publish(): void {
  notify?.();
}

/** Everything the header should currently offer controls for. */
export function browserMediaStates(): BrowserMediaState[] {
  return [...sessions.values()].map(({ endedTimer: _endedTimer, ...state }) => state);
}

export function hasMediaSession(tabId: string): boolean {
  return sessions.has(tabId);
}

function clearGrace(session: Session): void {
  if (!session.endedTimer) return;
  clearTimeout(session.endedTimer);
  session.endedTimer = null;
}

/**
 * Record that a tab is playing, creating the session if this is the first time.
 *
 * `describe` supplies the page's identity lazily, because the title and favicon
 * are usually not final at the moment playback starts.
 */
export function noteMediaPlaying(
  tabId: string,
  describe: () => Pick<BrowserMediaState, 'title' | 'url' | 'origin' | 'faviconDataUrl'>,
  kind: BrowserMediaState['kind'] = 'unknown',
): void {
  const existing = sessions.get(tabId);
  if (existing) {
    clearGrace(existing);
    Object.assign(existing, describe(), { playing: true, hasMedia: true });
    if (kind !== 'unknown') existing.kind = kind;
    publish();
    return;
  }
  sessions.set(tabId, {
    tabId,
    ...describe(),
    hasMedia: true,
    playing: true,
    audible: true,
    muted: false,
    canPlayPause: true,
    kind,
    endedTimer: null,
  });
  publish();
}

/** Playback paused. The session STAYS — this is the whole point of the design. */
export function noteMediaPaused(tabId: string): void {
  const session = sessions.get(tabId);
  if (!session) return;
  clearGrace(session);
  session.playing = false;
  publish();
}

/** Playback finished. Keep the session briefly, in case it is replayed. */
export function noteMediaEnded(tabId: string): void {
  const session = sessions.get(tabId);
  if (!session) return;
  session.playing = false;
  clearGrace(session);
  session.endedTimer = setTimeout(() => {
    sessions.delete(tabId);
    publish();
  }, ENDED_GRACE_MS);
  session.endedTimer.unref?.();
  publish();
}

/** Chromium's own audibility signal, which is about sound, not about existence. */
export function noteAudioState(tabId: string, audible: boolean): void {
  const session = sessions.get(tabId);
  if (!session || session.audible === audible) return;
  session.audible = audible;
  publish();
}

export function noteMuted(tabId: string, muted: boolean): void {
  const session = sessions.get(tabId);
  if (!session || session.muted === muted) return;
  session.muted = muted;
  publish();
}

/** Refresh the identity of a session whose page renamed itself or got a favicon. */
export function describeMediaSession(
  tabId: string,
  patch: Partial<Pick<BrowserMediaState, 'title' | 'url' | 'origin' | 'faviconDataUrl'>>,
): void {
  const session = sessions.get(tabId);
  if (!session) return;
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if ((session as unknown as Record<string, unknown>)[key] !== value) changed = true;
  }
  if (!changed) return;
  Object.assign(session, patch);
  publish();
}

/**
 * End a tab's session outright.
 *
 * Called when the tab navigates its main frame away or closes: the media that
 * the session described is gone, and no grace period applies because there is
 * nothing left to replay.
 */
export function dropMediaSession(tabId: string): void {
  const session = sessions.get(tabId);
  if (!session) return;
  clearGrace(session);
  sessions.delete(tabId);
  publish();
}

/** Drop everything. Used on shutdown so no timer outlives the window. */
export function clearAllMediaSessions(): void {
  for (const session of sessions.values()) clearGrace(session);
  sessions.clear();
  publish();
}
