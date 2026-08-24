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
 *  - Player implementations change over time. Older ElevenReader builds kept
 *    spare `<audio>` tags; the current player exposes no media element at all
 *    and has to be driven through its accessible Play/Pause control.
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

export interface SemanticMediaScope extends MediaRoot {
  parentElement?: SemanticMediaScope | null;
  isConnected?: unknown;
}

interface SemanticMediaControl extends SemanticMediaScope {
  textContent?: unknown;
  disabled?: unknown;
  isConnected?: unknown;
  click?: () => void;
  getAttribute?: (name: string) => string | null;
  getClientRects?: () => ArrayLike<unknown>;
}

export interface SemanticMediaCommandResult {
  handled: boolean;
  scope: SemanticMediaScope | null;
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

function reachableRoots(document: MediaRoot | null | undefined): MediaRoot[] {
  const start = asRoot(document);
  if (!start) return [];

  const queue: MediaRoot[] = [start];
  const visited = new Set<MediaRoot>([start]);
  const roots: MediaRoot[] = [];
  let scanned = 0;

  while (queue.length > 0 && roots.length < MAX_ROOTS) {
    const root = queue.shift() as MediaRoot;
    roots.push(root);

    for (const frame of elementsOf(root, 'iframe, frame')) {
      let child: MediaRoot | null = null;
      try {
        child = asRoot((frame as { contentDocument?: unknown }).contentDocument);
      } catch {
        // Cross-origin. Not ours to touch.
      }
      if (child && !visited.has(child) && visited.size < MAX_ROOTS) {
        visited.add(child);
        queue.push(child);
      }
    }

    if (scanned >= MAX_SCANNED) continue;
    for (const host of elementsOf(root, '*')) {
      scanned += 1;
      if (scanned > MAX_SCANNED) break;
      const shadow = asRoot((host as { shadowRoot?: unknown }).shadowRoot);
      if (shadow && !visited.has(shadow) && visited.size < MAX_ROOTS) {
        visited.add(shadow);
        queue.push(shadow);
      }
    }
  }

  return roots;
}

/**
 * Controls used by WebAudio/custom players that expose no <audio> or <video>.
 *
 * Exact labels only: a fuzzy match for "play" would happily click "Display",
 * a playlist title or an unrelated page action. The list covers Nodus's UI
 * languages and the common labels Chromium accessibility surfaces use.
 */
const PAUSE_LABELS = new Set([
  'pause', 'pausar', 'pausa', 'duraklat', '暂停', '一時停止', 'пауза', 'призупинити',
]);
const PLAY_LABELS = new Set([
  'play', 'reproducir', 'reprendre', 'lire', 'abspielen', 'riproduci', 'reproduzir', 'oynat',
  '播放', '再生', 'воспроизвести', 'відтворити',
]);

function normalizedLabel(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function controlLabel(control: SemanticMediaControl): string {
  for (const name of ['aria-label', 'title']) {
    const value = normalizedLabel(control.getAttribute?.(name));
    if (value) return value;
  }
  return normalizedLabel(control.textContent);
}

function isUsableControl(control: SemanticMediaControl): boolean {
  if (control.disabled === true || control.getAttribute?.('aria-disabled') === 'true') return false;
  if (control.getAttribute?.('hidden') !== null && control.getAttribute?.('hidden') !== undefined) return false;
  try {
    if (control.getClientRects && control.getClientRects().length === 0) return false;
  } catch {
    return false;
  }
  return typeof control.click === 'function';
}

function matchingControls(root: MediaRoot, labels: Set<string>): SemanticMediaControl[] {
  return elementsOf(root, 'button, [role="button"]')
    .map((value) => value as SemanticMediaControl)
    .filter((control) => isUsableControl(control) && labels.has(controlLabel(control)));
}

function containsProgressControl(scope: SemanticMediaScope): boolean {
  try {
    return scope.querySelectorAll('[role="slider"], input[type="range"], [aria-label*="progress" i]').length > 0;
  } catch {
    return false;
  }
}

/**
 * The stable player shell around a control.
 *
 * React commonly replaces the Play/Pause <button> when its state changes, so a
 * remembered button reference cannot resume playback. The surrounding player
 * (the nearest ancestor containing a progress slider) normally survives and
 * gives Play a safe, unambiguous place to look after Pause.
 */
function playerScope(control: SemanticMediaControl): SemanticMediaScope | null {
  let current: SemanticMediaScope | null = control;
  for (let depth = 0; current && depth < 10; depth += 1) {
    if (containsProgressControl(current)) return current;
    current = current.parentElement ?? null;
  }
  return control.parentElement ?? null;
}

function clickControl(control: SemanticMediaControl): boolean {
  try {
    control.click?.();
    return true;
  } catch {
    return false;
  }
}

function connectedScope(scope: SemanticMediaScope | null): scope is SemanticMediaScope {
  return Boolean(scope && scope.isConnected !== false);
}

/**
 * Read the state a custom player exposes through its accessible control.
 *
 * A Pause control means the player is currently running; Play means it is
 * paused. Prefer the remembered player shell so a library full of unrelated
 * Play buttons cannot confuse the result. If that shell disappeared, only a
 * single control beside a progress slider is authoritative.
 */
export function semanticPlaybackState(
  document: MediaRoot | null | undefined,
  preferredScope: SemanticMediaScope | null = null,
): boolean | null {
  const stateIn = (scope: MediaRoot): boolean | null => {
    const pause = matchingControls(scope, PAUSE_LABELS);
    const play = matchingControls(scope, PLAY_LABELS);
    if (pause.length === 1 && play.length === 0) return true;
    if (play.length === 1 && pause.length === 0) return false;
    return null;
  };

  if (connectedScope(preferredScope)) {
    const state = stateIn(preferredScope);
    if (state !== null) return state;
  }

  const start = asRoot(document);
  if (!start) return null;
  const controls = reachableRoots(start).flatMap((root) => [
    ...matchingControls(root, PAUSE_LABELS).map((control) => ({ control, playing: true })),
    ...matchingControls(root, PLAY_LABELS).map((control) => ({ control, playing: false })),
  ]);
  const inPlayers = controls.filter(({ control }) => {
    const scope = playerScope(control);
    return Boolean(scope && containsProgressControl(scope));
  });
  return inPlayers.length === 1 ? inPlayers[0].playing : null;
}

/**
 * Fallback for custom/WebAudio players.
 *
 * Only a unique control is safe page-wide. When several books each show Play,
 * resuming an arbitrary one would be worse than doing nothing. Pause may select
 * the one exact control living beside the progress slider, and remembers that
 * stable shell so the later Play command returns to the same session.
 */
export function applySemanticMediaCommand(
  document: MediaRoot | null | undefined,
  command: MediaCommand,
  preferredScope: SemanticMediaScope | null = null,
): SemanticMediaCommandResult {
  const start = asRoot(document);
  if (!start || (command !== 'play' && command !== 'pause' && command !== 'stop')) {
    return { handled: false, scope: preferredScope };
  }

  const labels = command === 'play' ? PLAY_LABELS : PAUSE_LABELS;
  if (command === 'play' && connectedScope(preferredScope)) {
    const scoped = matchingControls(preferredScope, labels);
    if (scoped.length === 1 && clickControl(scoped[0])) {
      return { handled: true, scope: preferredScope };
    }
  }

  const candidates = reachableRoots(start).flatMap((root) => matchingControls(root, labels));
  if (candidates.length === 1 && clickControl(candidates[0])) {
    return { handled: true, scope: playerScope(candidates[0]) };
  }

  const inPlayers = candidates
    .map((control) => ({ control, scope: playerScope(control) }))
    .filter((entry): entry is { control: SemanticMediaControl; scope: SemanticMediaScope } =>
      Boolean(entry.scope && containsProgressControl(entry.scope)));
  if (inPlayers.length === 1 && clickControl(inPlayers[0].control)) {
    return { handled: true, scope: inPlayers[0].scope };
  }

  return { handled: false, scope: preferredScope };
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
  const found: MediaEl[] = [];
  const seen = new Set<unknown>();
  for (const root of reachableRoots(document)) {
    for (const element of elementsOf(root, 'audio, video')) {
      if (seen.has(element)) continue;
      seen.add(element);
      found.push(element as MediaEl);
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
