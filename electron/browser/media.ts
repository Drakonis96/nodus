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
 * Previous/next are commands rather than state: Chromium can route its standard
 * media keys to a page's Media Session handlers, but does not expose whether a
 * page registered those handlers.
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
  /**
   * How many players Chromium currently reports as running in this tab.
   *
   * `media-started-playing` and `media-paused` fire once PER PLAYER, not once
   * per tab. A page that keeps spare <audio> elements around — elevenreader.io
   * ships eight and sources one — pauses them constantly, and treating any one
   * of those pauses as "the tab is paused" is what left the header showing Play
   * over a track that was still running, with a Play button that then did
   * nothing because the element was already playing. Counting is what makes the
   * flag mean "something is playing" instead of "the last event was a pause".
   */
  activePlayers: number;
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
  return [...sessions.values()]
    .map(({ endedTimer: _endedTimer, activePlayers: _activePlayers, ...state }) => state);
}

export function hasMediaSession(tabId: string): boolean {
  return sessions.has(tabId);
}

function clearGrace(session: Session): void {
  if (!session.endedTimer) return;
  clearTimeout(session.endedTimer);
  session.endedTimer = null;
}

function createSession(
  tabId: string,
  description: Pick<BrowserMediaState, 'title' | 'url' | 'origin' | 'faviconDataUrl'>,
  kind: BrowserMediaState['kind'],
  activePlayers: number,
): void {
  sessions.set(tabId, {
    tabId,
    ...description,
    hasMedia: true,
    playing: activePlayers > 0,
    audible: activePlayers > 0,
    muted: false,
    canPlayPause: true,
    kind,
    endedTimer: null,
    activePlayers,
  });
  publish();
}

/**
 * One player in a tab started, creating the session if this is the first.
 *
 * `describe` supplies the page's identity lazily, because the title and favicon
 * are usually not final at the moment playback starts.
 */
export function noteMediaPlaying(
  tabId: string,
  describe: () => Pick<BrowserMediaState, 'title' | 'url' | 'origin' | 'faviconDataUrl'>,
  kind: BrowserMediaState['kind'] = 'unknown',
): void {
  const description = describe();
  const existing = sessions.get(tabId);
  if (!existing) {
    createSession(tabId, description, kind, 1);
    return;
  }
  clearGrace(existing);
  existing.activePlayers += 1;
  const nextKind = kind === 'unknown' ? existing.kind : kind;
  const changed = !existing.playing
    || !existing.hasMedia
    || existing.title !== description.title
    || existing.url !== description.url
    || existing.origin !== description.origin
    || existing.faviconDataUrl !== description.faviconDataUrl
    || existing.kind !== nextKind;
  if (!changed) return;
  Object.assign(existing, description, { playing: true, hasMedia: true, kind: nextKind });
  publish();
}

/**
 * One player stopped. The session STAYS — this is the whole point of the design.
 *
 * The tab only counts as paused once the LAST player has stopped. See
 * `Session.activePlayers`.
 */
export function noteMediaPaused(tabId: string): void {
  const session = sessions.get(tabId);
  if (!session) return;
  session.activePlayers = Math.max(0, session.activePlayers - 1);
  if (session.activePlayers > 0) return;
  if (!session.playing) return;
  clearGrace(session);
  session.playing = false;
  publish();
}

/**
 * The page's own aggregate answer to "is anything playing here?".
 *
 * Authoritative, because it is one answer about the whole document rather than
 * one element's edge, and because it arrives after every header command — so a
 * command the page refused (an autoplay policy denying `play()`) corrects the
 * button instead of leaving it lying.
 */
export function noteMediaPlaybackState(
  tabId: string,
  playing: boolean,
  describe: () => Pick<BrowserMediaState, 'title' | 'url' | 'origin' | 'faviconDataUrl'>,
  kind: BrowserMediaState['kind'] = 'unknown',
): void {
  const session = sessions.get(tabId);
  if (!session) {
    // Nothing playing and no session: there is no media to offer controls for.
    if (!playing) return;
    createSession(tabId, describe(), kind, 1);
    return;
  }
  clearGrace(session);
  session.activePlayers = playing ? Math.max(1, session.activePlayers) : 0;
  const nextKind = kind === 'unknown' ? session.kind : kind;
  if (session.playing === playing && session.kind === nextKind) return;
  session.playing = playing;
  session.kind = nextKind;
  publish();
}

/** Playback finished. Keep the session briefly, in case it is replayed. */
export function noteMediaEnded(tabId: string): void {
  const session = sessions.get(tabId);
  if (!session) return;
  session.playing = false;
  session.activePlayers = 0;
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
