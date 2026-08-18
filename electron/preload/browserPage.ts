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
// One source of truth for page metadata: the SAME module the Chrome extension
// loads. It is pure ESM with no Chrome API and no DOM access, so both consumers
// share the Highwire / JSON-LD / COinS / Dublin Core / OpenGraph parsing rather
// than maintaining two implementations that must agree.
import { detectCapture } from '../../browser-extension/lib/detector.js';
import { collectPageSnapshot } from './browserPageSnapshot';

interface MediaEl {
  tagName?: unknown;
  paused?: unknown;
  play?: () => unknown;
  pause?: () => unknown;
  currentTime?: number;
}

interface PageDoc {
  querySelectorAll(selector: string): ArrayLike<MediaEl>;
  addEventListener(type: string, listener: (event: { target?: unknown }) => void, capture?: boolean): void;
}

const page = globalThis as unknown as { document?: PageDoc };

function mediaElements(): MediaEl[] {
  const found = page.document?.querySelectorAll('video, audio');
  return found ? Array.prototype.slice.call(found) as MediaEl[] : [];
}

function kindOf(target: unknown): 'audio' | 'video' | 'unknown' {
  const tag = String((target as MediaEl | null)?.tagName ?? '').toUpperCase();
  return tag === 'VIDEO' ? 'video' : tag === 'AUDIO' ? 'audio' : 'unknown';
}

/**
 * Report what Electron's own media events cannot say.
 *
 * `media-started-playing` and `media-paused` on the WebContents are the primary
 * signal and are what the main process trusts for session lifecycle. This adds
 * only the audio/video distinction, and only for real media elements.
 */
function report(target: unknown, playing: boolean): void {
  const kind = kindOf(target);
  if (kind === 'unknown') return;
  ipcRenderer.send('nodus-browser:page:media', { playing, kind });
}

page.document?.addEventListener('play', (event) => report(event.target, true), true);
page.document?.addEventListener('pause', (event) => report(event.target, false), true);
page.document?.addEventListener('ended', (event) => report(event.target, false), true);

/**
 * Play, pause or stop the page's media on the main process's instruction.
 *
 * Only ever driven from the Nodus header. The command set is closed and carries
 * no data from the page, so there is nothing here a site can steer.
 */
ipcRenderer.on('nodus-browser:page:mediaCommand', (_event, command: string) => {
  for (const element of mediaElements()) {
    try {
      if (command === 'play') element.play?.();
      else if (command === 'pause') element.pause?.();
      else if (command === 'stop') {
        element.pause?.();
        // Rewinding is what makes Stop different from Pause; a page that
        // refuses the seek still ends up paused, which is the important half.
        try { element.currentTime = 0; } catch { /* live streams refuse this */ }
      }
    } catch {
      // One uncooperative element must not stop us from reaching the others.
    }
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
