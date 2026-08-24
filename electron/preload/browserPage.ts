// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * The preload that runs inside a Nodus Browser page.
 *
 * It never calls contextBridge, and that is the whole design. Every other
 * preload in this repo exists to hand a renderer a bridge; this one exists to
 * make sure a remote website never gets one. A page loaded here has no
 * `window.nodus`, no `ipcRenderer`, no `require`, no `process` — there is no
 * name it can reach for.
 *
 * What it does instead is act as a sensor and a remote control, driven entirely
 * by the main process. Main sends a command on a browser-scoped channel; this
 * replies or acts. It never evaluates anything the page provides.
 *
 * Because contextIsolation is on, this runs in an ISOLATED world: it shares the
 * DOM with the page but not the JavaScript globals. That is what makes the media
 * control below trustworthy — a page that overwrites
 * `HTMLMediaElement.prototype.play` in its own world does not affect the
 * function this code calls.
 *
 * The DOM is reached through narrow structural casts rather than `lib.dom`:
 * electron/tsconfig.json deliberately omits the DOM library, and
 * electron/preload/api.ts reads `location` the same way.
 */

import { ipcRenderer } from 'electron';
import { isNodusResearchSiteUrl } from '../../shared/browser';
// One source of truth for page metadata: the SAME module the Chrome extension
// loads. It is pure ESM with no Chrome API and no DOM access, so both consumers
// share the Highwire / JSON-LD / COinS / Dublin Core / OpenGraph parsing rather
// than maintaining two implementations that must agree.
import { detectCapture } from '../../browser-extension/lib/detector.js';
import { collectPageSnapshot } from './browserPageSnapshot';
import {
  anyPlaying,
  applyMediaCommand,
  applySemanticMediaCommand,
  collectMediaElements,
  isPlayableMedia,
  kindOf,
  semanticPlaybackState,
  type MediaCommand,
  type MediaEl,
  type MediaRoot,
  type SemanticMediaScope,
} from './browserPageMedia';

interface PageDoc extends MediaRoot {
  addEventListener(type: string, listener: (event: { target?: unknown }) => void, capture?: boolean): void;
}

const page = globalThis as unknown as { document?: PageDoc };

interface BrowserBookmarksClick {
  isTrusted?: boolean;
  preventDefault(): void;
}

interface BrowserBookmarksEntry {
  addEventListener(type: 'click', listener: (event: BrowserBookmarksClick) => void): void;
  removeAttribute(name: string): void;
}

interface BrowserIntegrationDoc {
  readyState?: string;
  querySelector(selector: string): BrowserBookmarksEntry | null;
  addEventListener(type: 'DOMContentLoaded', listener: () => void, options?: { once?: boolean }): void;
}

const integrationPage = globalThis as unknown as {
  document?: BrowserIntegrationDoc;
  location?: { href?: unknown };
};

/**
 * Complete the public header only inside Nodus Browser.
 *
 * The website owns the inert, hidden slot; this isolated preload owns the
 * action. Nothing is exposed in the page's JavaScript world, and synthetic
 * clicks are ignored so first-party content cannot move the user into an
 * internal page without a real gesture.
 */
function installNodusBookmarksEntry(): void {
  const document = integrationPage.document;
  if (!document || !isNodusResearchSiteUrl(String(integrationPage.location?.href ?? ''))) return;
  const entry = document.querySelector('[data-nodus-browser-bookmarks]');
  if (!entry) return;
  entry.addEventListener('click', (event) => {
    event.preventDefault();
    if (event.isTrusted !== true) return;
    ipcRenderer.send('nodus-browser:page:openBookmarks');
  });
  // Reveal only after the protected click handler is installed. If the preload
  // ever fails, normal site navigation remains unchanged rather than exposing a
  // dead local-only link.
  entry.removeAttribute('hidden');
}

if (integrationPage.document?.readyState === 'loading') {
  integrationPage.document.addEventListener('DOMContentLoaded', installNodusBookmarksEntry, { once: true });
} else {
  installNodusBookmarksEntry();
}

function mediaElements(): MediaEl[] {
  return collectMediaElements(page.document);
}

/**
 * The element the page itself last started.
 *
 * Kept so Play resumes what the user was listening to rather than whatever the
 * document happens to list first. Held as a plain reference: it is only ever
 * compared by identity against a freshly collected list, so a stale one for a
 * removed element simply falls out of the comparison.
 */
let lastPlayed: MediaEl | null = null;
let lastSemanticScope: SemanticMediaScope | null = null;

/**
 * Tell main what is REALLY playing in this page.
 *
 * The bug this replaces: pages used to report each element's own play/pause
 * edge, so a spare <audio> placeholder could announce "paused" while the actual
 * track ran on. The header then showed Play for something already playing, and
 * pressing it changed nothing — the reported symptom of a media button that
 * "does nothing".
 *
 * An aggregate cannot lie that way: it is a single answer about the whole page.
 */
function reportPlaybackState(target?: unknown): void {
  const elements = mediaElements();
  const playing = anyPlaying(elements);
  const active = elements.find((element) => element.paused === false);
  const kind = kindOf(target) !== 'unknown' ? kindOf(target) : kindOf(active ?? lastPlayed);
  ipcRenderer.send('nodus-browser:page:media', { playing, kind });
}

/**
 * Coalesce the burst of events a player emits when it swaps tracks.
 *
 * Pausing one element and starting the next fires pause-then-play within the
 * same task; reporting each would flick the header icon. A microtask-scale delay
 * is enough to let the page finish and still feels instant.
 */
const REPORT_DELAY_MS = 30;
let reportTimer: ReturnType<typeof setTimeout> | null = null;
let lastReportTarget: unknown = null;
function scheduleReport(target?: unknown): void {
  if (kindOf(target) !== 'unknown' && (target as MediaEl | null)) {
    // Remember the audio/video distinction from the element that moved, since
    // by the time the timer runs there may be nothing playing to ask.
    lastReportTarget = target;
  }
  if (reportTimer) clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    reportTimer = null;
    const captured = lastReportTarget;
    lastReportTarget = null;
    reportPlaybackState(captured);
  }, REPORT_DELAY_MS);
}

page.document?.addEventListener('play', (event) => {
  const target = event.target as MediaEl | null;
  if (target && isPlayableMedia(target)) lastPlayed = target;
  scheduleReport(event.target);
}, true);
page.document?.addEventListener('pause', (event) => scheduleReport(event.target), true);
page.document?.addEventListener('ended', (event) => scheduleReport(event.target), true);

/**
 * Play, pause or stop the page's media on the main process's instruction.
 *
 * Only ever driven from the Nodus header. The command set is closed and carries
 * no data from the page, so there is nothing here a site can steer.
 *
 * Two things follow every command. The result tells main whether the page could
 * act at all, so it can fall back to Chromium's own media key for a player whose
 * audio lives somewhere no DOM query reaches. The state report that follows tells
 * the header what actually happened, so a command the page refused — an autoplay
 * policy denying `play()`, say — leaves the button showing the truth instead of
 * silently pretending it worked.
 */
ipcRenderer.on('nodus-browser:page:mediaCommand', (_event, command: string) => {
  const known: MediaCommand[] = ['previous', 'play', 'pause', 'next', 'stop'];
  if (known.indexOf(command as MediaCommand) < 0) return;
  const elements = mediaElements();
  const domHandled = applyMediaCommand(elements, command as MediaCommand, lastPlayed);
  const semantic = domHandled
    ? { handled: false, scope: lastSemanticScope }
    : applySemanticMediaCommand(page.document, command as MediaCommand, lastSemanticScope);
  if (semantic.scope) lastSemanticScope = semantic.scope;
  const handled = domHandled || semantic.handled;
  ipcRenderer.send('nodus-browser:page:mediaCommandResult', { command, handled });
  // An aggregate report is authoritative only when this preload can actually
  // see media elements. A WebAudio player such as ElevenReader exposes none:
  // reporting `false` after its visible Pause button was clicked overwrote
  // Chromium's real event and made the header lie while the audio kept going.
  if (elements.length > 0) {
    // Long enough for a resolved play() to have flipped `paused`, short enough
    // that the button does not sit wrong while the user is looking at it.
    setTimeout(() => reportPlaybackState(), 120);
  } else if (semantic.handled) {
    // WebAudio/custom players do not emit HTMLMediaElement events, so Chromium
    // may keep reporting the pre-command state forever. Read the replacement
    // Play/Pause control after React has rendered it and update the header from
    // that. Falling back to the requested state covers players whose accessible
    // label does not change, while a refused click remains detectable because
    // the old control is still present.
    setTimeout(() => {
      const observed = semanticPlaybackState(page.document, lastSemanticScope);
      const requested = command === 'play';
      ipcRenderer.send('nodus-browser:page:media', {
        playing: observed ?? requested,
        kind: 'unknown',
      });
    }, 120);
  }
});

/** Everything main can ask this page for. The command set is closed. */
const MAX_TEXT_CHARS = 120_000;
const MAX_SELECTION_CHARS = 20_000;

interface TextDoc {
  title?: unknown;
  contentType?: unknown;
  body?: { innerText?: unknown } | null;
  querySelector(selector: string): { innerText?: unknown } | null;
}
const textPage = globalThis as unknown as {
  document?: TextDoc;
  location?: { href?: unknown };
  getSelection?: () => { toString(): string } | null;
};

/** Strip NUL bytes (which truncate downstream) and cap the length. */
function clip(value: unknown, limit: number): string {
  return String(value ?? '')
    .split('\u0000')
    .join('')
    .slice(0, limit);
}

function readableText(): string {
  const doc = textPage.document;
  if (!doc) return '';
  const main = doc.querySelector('main, article, [role="main"]') ?? doc.body ?? null;
  return clip(main?.innerText, MAX_TEXT_CHARS);
}

ipcRenderer.on('nodus-browser:page:collect', (_event, requestId: string, what: string) => {
  let payload: unknown = null;
  try {
    if (what === 'text') {
      payload = { title: clip(textPage.document?.title, 300), text: readableText() };
    } else if (what === 'selection') {
      payload = { text: clip(textPage.getSelection?.()?.toString() ?? '', MAX_SELECTION_CHARS) };
    } else if (what === 'capture') {
      const snapshot = collectPageSnapshot();
      // detectCapture throws on a page with no usable URL; a null payload is the
      // honest answer, and main reports it rather than inventing metadata.
      payload = snapshot ? detectCapture(snapshot as never) : null;
    } else if (what === 'pdf') {
      const contentType = String(textPage.document?.contentType ?? '');
      payload = { isPdf: contentType === 'application/pdf', url: clip(textPage.location?.href, 2048) };
    }
  } catch {
    payload = null;
  }
  ipcRenderer.send('nodus-browser:page:collected', requestId, payload);
});
