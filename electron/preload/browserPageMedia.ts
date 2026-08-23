// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Finding, reading and driving the media a web page is actually playing.
 *
 * Split out of browserPage.ts so it can be tested against a fake DOM: the
 * preload itself cannot be imported outside Electron, and every bug this module
 * fixes was a bug about which element got picked.
 *
 * The rule this file exists to enforce: a page's media is whatever is REALLY
 * playing, not whatever `document.querySelectorAll('audio, video')` returns
 * first. Real players do not oblige.
 *
 *  - elevenreader.io keeps eight `<audio>` tags in its document and gives seven
 *    of them no source at all. Acting on the whole list meant Previous and Next
 *    landed on a dead placeholder — pausing the track that was running — and
 *    Play fired eight rejected `play()` calls to no visible effect.
 *  - Player UIs also live in open shadow roots and in same-origin frames, both
 *    invisible to a flat query on the top document.
 *
 * The DOM is reached through narrow structural types rather than `lib.dom`:
 * electron/tsconfig.json deliberately omits the DOM library.
 */

export type MediaCommand = 'previous' | 'play' | 'pause' | 'next' | 'stop';

export interface MediaEl {
  tagName?: unknown;
  paused?: unknown;
  ended?: unknown;
  readyState?: unknown;
  duration?: unknown;
  currentTime?: number;
  currentSrc?: unknown;
  src?: unknown;
  srcObject?: unknown;
  play?: () => unknown;
  pause?: () => unknown;
}

export interface MediaRoot {
  querySelectorAll(selector: string): ArrayLike<unknown>;
}

/**
 * How far the search spreads.
 *
 * Commands arrive from a header click and reports from a play/pause event, so
 * this runs rarely — but it runs inside someone else's page, and an unbounded
 * walk of a huge document is a jank the user would blame on Nodus. Both caps are
 * far above any real player and far below a pathological page.
 */
const MAX_ROOTS = 64;
const MAX_SCANNED = 20_000;

function elementsOf(root: MediaRoot, selector: string): unknown[] {
  try {
    const found = root.querySelectorAll(selector);
    return found ? Array.prototype.slice.call(found) as unknown[] : [];
  } catch {
    // A detached or cross-origin document answers by throwing.
    return [];
  }
}

function asRoot(value: unknown): MediaRoot | null {
  const candidate = value as MediaRoot | null;
  return candidate && typeof candidate.querySelectorAll === 'function' ? candidate : null;
}

/**
 * Every media element this page will let us reach.
 *
 * Descends into same-origin frames and open shadow roots. A cross-origin frame
 * answers `null` or throws, and that IS the access check — there is nothing to
 * reach inside it and nothing here tries to work around that. Closed shadow
 * roots stay unreachable by the same principle.
 */
export function collectMediaElements(document: MediaRoot | null | undefined): MediaEl[] {
  const start = asRoot(document);
  if (!start) return [];

  const found: MediaEl[] = [];
  const seen = new Set<unknown>();
  const queue: MediaRoot[] = [start];
  const visited = new Set<MediaRoot>([start]);
  let scanned = 0;

  while (queue.length > 0 && visited.size <= MAX_ROOTS) {
    const root = queue.shift() as MediaRoot;

    for (const element of elementsOf(root, 'audio, video')) {
      if (seen.has(element)) continue;
      seen.add(element);
      found.push(element as MediaEl);
    }

    for (const frame of elementsOf(root, 'iframe, frame')) {
      let document: MediaRoot | null = null;
      try {
        document = asRoot((frame as { contentDocument?: unknown }).contentDocument);
      } catch {
        // Cross-origin. Not ours to touch.
      }
      if (document && !visited.has(document)) {
        visited.add(document);
        queue.push(document);
      }
    }

    if (scanned >= MAX_SCANNED) continue;
    for (const host of elementsOf(root, '*')) {
      scanned += 1;
      if (scanned > MAX_SCANNED) break;
      const shadow = asRoot((host as { shadowRoot?: unknown }).shadowRoot);
      if (shadow && !visited.has(shadow)) {
        visited.add(shadow);
        queue.push(shadow);
      }
    }
  }

  return found;
}

function hasSource(element: MediaEl): boolean {
  if (element.srcObject) return true;
  if (String(element.currentSrc ?? '') !== '') return true;
  return String(element.src ?? '') !== '';
}

/**
 * Whether this is media a user could be listening to.
 *
 * An `<audio>` with no source and nothing buffered is a placeholder a player UI
 * keeps around for its next track. It must never be chosen over the element
 * that is actually running.
 */
export function isPlayableMedia(element: MediaEl): boolean {
  return hasSource(element) || Number(element.readyState ?? 0) > 0;
}

export function isPlaying(element: MediaEl): boolean {
  return element.paused === false && element.ended !== true;
}

/** The page's own answer to "is anything playing here?" — the header's truth. */
export function anyPlaying(elements: MediaEl[]): boolean {
  return elements.some(isPlaying);
}

/**
 * The elements worth acting on, with a deliberate fallback.
 *
 * If a page exposes nothing playable we keep the raw list rather than doing
 * nothing at all: Pause on an element we misjudged is harmless, and refusing to
 * act would be a worse answer than trying.
 */
export function playableMedia(elements: MediaEl[]): MediaEl[] {
  const playable = elements.filter(isPlayableMedia);
  return playable.length > 0 ? playable : elements;
}

export function kindOf(target: unknown): 'audio' | 'video' | 'unknown' {
  const tag = String((target as MediaEl | null)?.tagName ?? '').toUpperCase();
  return tag === 'VIDEO' ? 'video' : tag === 'AUDIO' ? 'audio' : 'unknown';
}

function play(element: MediaEl): void {
  try {
    const result = element.play?.();
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      // A page can still deny autoplay even for a user-initiated header
      // command. The state report that follows the command tells the header
      // the truth either way, so the rejection needs no handling here.
      void Promise.resolve(result).catch(() => undefined);
    }
  } catch {
    // Same story, thrown instead of rejected.
  }
}

function pause(element: MediaEl): void {
  try { element.pause?.(); } catch { /* one element must not block the next */ }
}

function rewind(element: MediaEl): void {
  try { element.currentTime = 0; } catch { /* live streams refuse this */ }
}

/**
 * Which element Play should resume.
 *
 * Preference order: whatever is already running, then the element the page last
 * played (remembered from its own `play` event), then one that has been listened
 * to, then the longest piece of media on the page. Blasting `play()` at every
 * element — the previous behaviour — started decorative background videos and
 * missed the track the user meant.
 */
export function resumeTarget(elements: MediaEl[], preferred: MediaEl | null): MediaEl | null {
  const candidates = playableMedia(elements);
  if (candidates.length === 0) return null;
  const running = candidates.find(isPlaying);
  if (running) return running;
  if (preferred && candidates.indexOf(preferred) >= 0) return preferred;
  const listened = candidates.find((element) => Number(element.currentTime ?? 0) > 0);
  if (listened) return listened;
  const longest = candidates.reduce((best, element) => (
    Number(element.duration ?? 0) > Number(best.duration ?? 0) ? element : best
  ), candidates[0]);
  return longest;
}

/**
 * Move between tracks when the page exposes an actual list of them.
 *
 * Chromium also receives the standard media key from main for players that own
 * their playlist internally; this DOM fallback makes ordinary multi-track pages
 * deterministic without guessing at site-specific buttons.
 */
function switchTrack(elements: MediaEl[], command: 'previous' | 'next', preferred: MediaEl | null): boolean {
  const candidates = playableMedia(elements);
  if (candidates.length === 0) return false;

  let activeIndex = candidates.findIndex(isPlaying);
  if (activeIndex < 0 && preferred) activeIndex = candidates.indexOf(preferred);
  if (activeIndex < 0) activeIndex = candidates.findIndex((element) => Number(element.currentTime ?? 0) > 0);
  if (activeIndex < 0) activeIndex = 0;

  const targetIndex = command === 'previous'
    ? Math.max(0, activeIndex - 1)
    : Math.min(candidates.length - 1, activeIndex + 1);
  const current = candidates[activeIndex];
  const target = candidates[targetIndex];

  if (target === current) {
    // Nowhere to go. Previous restarts the track, which is what every player
    // does at the head of a list; Next at the tail does nothing.
    if (command !== 'previous') return false;
    rewind(current);
    play(current);
    return true;
  }

  pause(current);
  rewind(target);
  play(target);
  return true;
}

/**
 * Run one header command against the page.
 *
 * Returns whether the page could act on it. A `false` is what lets main fall
 * back to Chromium's own media key, for players that keep their audio somewhere
 * no DOM query can reach.
 */
export function applyMediaCommand(
  elements: MediaEl[],
  command: MediaCommand,
  preferred: MediaEl | null = null,
): boolean {
  if (command === 'previous' || command === 'next') {
    return switchTrack(elements, command, preferred);
  }

  if (command === 'play') {
    const target = resumeTarget(elements, preferred);
    if (!target) return false;
    if (isPlaying(target)) return true;
    play(target);
    return true;
  }

  // Pause and Stop act on everything that is running: a page with two tracks
  // going should fall silent, not half silent.
  const running = elements.filter(isPlaying);
  for (const element of running) {
    pause(element);
    if (command === 'stop') {
      // Rewinding is what makes Stop different from Pause; a page that refuses
      // the seek still ends up paused, which is the important half.
      rewind(element);
    }
  }
  return running.length > 0;
}
