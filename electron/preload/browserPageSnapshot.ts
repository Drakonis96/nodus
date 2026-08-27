// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Gathering the page snapshot the metadata detector runs on.
 *
 * The parsing itself is not here and is not reimplemented: it lives in
 * browser-extension/lib/detector.js, which the Chrome extension and this preload
 * both import. That file is pure ESM with no Chrome API and no DOM access — it
 * takes a snapshot and returns a capture — precisely so the two consumers cannot
 * drift. Highwire, JSON-LD, COinS, Dublin Core and OpenGraph parsing exists
 * once.
 *
 * What is here is the DOM half, mirroring collectPageSnapshot() in the
 * extension's popup.js. It runs in the preload's ISOLATED world, so it reads the
 * real DOM while the page cannot reach back and tamper with this code.
 *
 * Every collection is capped. A page is untrusted input, and an uncapped
 * querySelectorAll on a hostile document sizes our IPC payload for us.
 */

interface El {
  getAttribute(name: string): string | null;
  textContent?: unknown;
  innerText?: unknown;
  href?: unknown;
  lang?: unknown;
}
interface Doc {
  title?: unknown;
  contentType?: unknown;
  documentElement?: El;
  body?: El;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El>;
}

const page = globalThis as unknown as {
  document?: Doc;
  location?: { href?: unknown };
  navigator?: { language?: unknown };
};

const list = (nodes: ArrayLike<El> | undefined, limit = Number.POSITIVE_INFINITY): El[] =>
  nodes ? (Array.prototype.slice.call(nodes, 0, limit) as El[]) : [];

const text = (value: unknown, limit: number): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

/** Files worth offering as an attachment, by extension. */
const FILE_PATTERN =
  /\.(?:pdf|epub|docx?|odt|rtf|txt|md|xml|jats|csv|tsv|xlsx?|ods|pptx?|odp|png|jpe?g|webp|gif|tiff?|svg|mp3|m4a|wav|ogg|flac|mp4|webm)(?:$|[?#])/i;

/** Link text that means "the full text is behind here", across the UI languages we see. */
const FULL_TEXT_PATTERN =
  /(?:\bpdf\b|full\s*text|texto\s+completo|texte\s+int[ée]gral|volltext|testo\s+completo|texto\s+integral|tam\s+metin|descargar\s+(?:art[ií]culo|pdf)|download\s+(?:article|paper|pdf))/i;

// Escaping can expand a character to five bytes (`&amp;`), so one MiB of
// source text remains below the six MiB server-side HTML ceiling.
const MAX_SNAPSHOT_CHARS = 1 * 1024 * 1024;
const MAX_METADATA_CHARS = 2 * 1024 * 1024;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A bounded reader-style copy of the document, for the optional snapshot.
 *
 * It serializes text rather than cloning hostile DOM. Besides producing a much
 * more useful reading copy, that means a huge page cannot make us clone and
 * walk millions of nodes before discovering that the result exceeds the cap.
 */
function readableHtml(doc: Doc): string {
  const contentType = String(doc.contentType ?? '');
  if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') return '';
  const root = doc.querySelector('article,main,[role="main"]') ?? doc.body ?? doc.documentElement;
  if (!root) return '';
  try {
    const plain = String(root.innerText ?? root.textContent ?? '').split('\u0000').join('').slice(0, MAX_SNAPSHOT_CHARS);
    if (!plain.trim()) return '';
    const paragraphs = plain.split(/\n\s*\n|\r?\n/).map((entry) => entry.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const title = escapeHtml(text(doc.title, 1_000));
    const body = paragraphs.map((entry) => `<p>${escapeHtml(entry)}</p>`).join('\n');
    return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${title}</title></head><body><article><h1>${title}</h1>${body}</article></body></html>`;
  } catch {
    return '';
  }
}

/** Collect everything the detector needs, from the live document. */
export function collectPageSnapshot(): Record<string, unknown> | null {
  const doc = page.document;
  if (!doc) return null;

  let remaining = MAX_METADATA_CHARS;
  const bounded = (value: unknown, perField: number): string => {
    if (remaining <= 0) return '';
    const result = String(value ?? '').slice(0, Math.min(perField, remaining));
    remaining -= result.length;
    return result;
  };

  const metas = list(doc.querySelectorAll('meta'), 800).map((el) => ({
    name: el.getAttribute('name') || '',
    property: el.getAttribute('property') || '',
    httpEquiv: el.getAttribute('http-equiv') || '',
    content: bounded(el.getAttribute('content'), 100_000),
  }));

  const links = list(doc.querySelectorAll('link[href]'), 400).map((el) => ({
    rel: el.getAttribute('rel') || '',
    type: el.getAttribute('type') || '',
    href: bounded(el.href, 4_096),
    title: bounded(el.getAttribute('title'), 500),
  }));

  const jsonLd = list(doc.querySelectorAll('script[type="application/ld+json"]'))
    .slice(0, 80)
    .map((el) => bounded(el.textContent, 256_000)).filter(Boolean);

  const coins = list(doc.querySelectorAll('.Z3988[title], span[title^="ctx_ver="]'))
    .slice(0, 100)
    .map((el) => bounded(el.getAttribute('title'), 8_192)).filter(Boolean);

  const anchors = list(doc.querySelectorAll('a[href]'), 5_000)
    .filter((el) => {
      const label = `${String(el.textContent ?? '')} ${el.getAttribute('title') || ''}`;
      const href = String(el.href ?? '');
      return FILE_PATTERN.test(href) || el.getAttribute('type') === 'application/pdf' || FULL_TEXT_PATTERN.test(label);
    })
    .slice(0, 80)
    .map((el) => ({
      href: bounded(el.href, 4_096),
      text: text(el.textContent, 300),
      title: (el.getAttribute('title') || '').slice(0, 500),
      type: el.getAttribute('type') || '',
    }));

  return {
    title: String(doc.title ?? ''),
    url: String(page.location?.href ?? ''),
    lang: String(doc.documentElement?.lang ?? '') || String(page.navigator?.language ?? ''),
    contentType: String(doc.contentType ?? ''),
    metas,
    links,
    jsonLd,
    coins,
    anchors,
    html: readableHtml(doc),
  };
}
