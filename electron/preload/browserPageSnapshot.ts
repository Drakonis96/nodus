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

interface Attr { name: string; value: string }
interface El {
  getAttribute(name: string): string | null;
  textContent?: unknown;
  href?: unknown;
  attributes?: ArrayLike<Attr>;
  querySelectorAll(selector: string): ArrayLike<El>;
  removeAttribute(name: string): void;
  remove(): void;
  cloneNode(deep: boolean): El;
  outerHTML?: unknown;
  lang?: unknown;
}
interface Doc {
  title?: unknown;
  contentType?: unknown;
  documentElement?: El;
  querySelectorAll(selector: string): ArrayLike<El>;
}

const page = globalThis as unknown as {
  document?: Doc;
  location?: { href?: unknown };
  navigator?: { language?: unknown };
};

const list = (nodes: ArrayLike<El> | undefined): El[] =>
  nodes ? (Array.prototype.slice.call(nodes) as El[]) : [];

const text = (value: unknown, limit: number): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

/** Files worth offering as an attachment, by extension. */
const FILE_PATTERN =
  /\.(?:pdf|epub|docx?|odt|rtf|txt|md|xml|jats|csv|tsv|xlsx?|ods|pptx?|odp|png|jpe?g|webp|gif|tiff?|svg|mp3|m4a|wav|ogg|flac|mp4|webm)(?:$|[?#])/i;

/** Link text that means "the full text is behind here", across the UI languages we see. */
const FULL_TEXT_PATTERN =
  /(?:\bpdf\b|full\s*text|texto\s+completo|texte\s+int[ée]gral|volltext|testo\s+completo|texto\s+integral|tam\s+metin|descargar\s+(?:art[ií]culo|pdf)|download\s+(?:article|paper|pdf))/i;

const MAX_SNAPSHOT_BYTES = 6 * 1024 * 1024;

/**
 * A sanitised copy of the document, for the optional stored snapshot.
 *
 * Scripts, frames, embedded objects, forms, every `on*` handler and `srcdoc` are
 * stripped: what gets attached to a Library item is a record of what the page
 * said, and it must not be able to execute anything if it is ever opened again.
 */
function sanitizedHtml(doc: Doc): string {
  const contentType = String(doc.contentType ?? '');
  if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') return '';
  const root = doc.documentElement;
  if (!root) return '';
  try {
    const clone = root.cloneNode(true);
    for (const element of list(clone.querySelectorAll('script,noscript,iframe,object,embed,form,base,style,link[rel="stylesheet"]'))) element.remove();
    for (const element of list(clone.querySelectorAll('*'))) {
      for (const attribute of list(element.attributes as unknown as ArrayLike<El>) as unknown as Attr[]) {
        const name = attribute.name.toLowerCase();
        if (/^on/i.test(name) || ['srcdoc', 'style', 'src', 'srcset', 'poster'].includes(name)) {
          element.removeAttribute(attribute.name);
          continue;
        }
        if ((name === 'href' || name === 'xlink:href') && /^(?:\s*javascript:|\s*file:|\s*nodus-)/i.test(attribute.value)) {
          element.removeAttribute(attribute.name);
        }
      }
    }
    const html = `<!doctype html>\n${String(clone.outerHTML ?? '')}`;
    return html.length <= MAX_SNAPSHOT_BYTES ? html : '';
  } catch {
    return '';
  }
}

/** Collect everything the detector needs, from the live document. */
export function collectPageSnapshot(): Record<string, unknown> | null {
  const doc = page.document;
  if (!doc) return null;

  const metas = list(doc.querySelectorAll('meta')).slice(0, 800).map((el) => ({
    name: el.getAttribute('name') || '',
    property: el.getAttribute('property') || '',
    httpEquiv: el.getAttribute('http-equiv') || '',
    content: el.getAttribute('content') || '',
  }));

  const links = list(doc.querySelectorAll('link[href]')).slice(0, 400).map((el) => ({
    rel: el.getAttribute('rel') || '',
    type: el.getAttribute('type') || '',
    href: String(el.href ?? ''),
    title: el.getAttribute('title') || '',
  }));

  const jsonLd = list(doc.querySelectorAll('script[type="application/ld+json"]'))
    .slice(0, 80)
    .map((el) => String(el.textContent ?? '').slice(0, 1_000_000));

  const coins = list(doc.querySelectorAll('.Z3988[title], span[title^="ctx_ver="]'))
    .slice(0, 100)
    .map((el) => el.getAttribute('title') || '');

  const anchors = list(doc.querySelectorAll('a[href]'))
    .filter((el) => {
      const label = `${String(el.textContent ?? '')} ${el.getAttribute('title') || ''}`;
      const href = String(el.href ?? '');
      return FILE_PATTERN.test(href) || el.getAttribute('type') === 'application/pdf' || FULL_TEXT_PATTERN.test(label);
    })
    .slice(0, 80)
    .map((el) => ({
      href: String(el.href ?? ''),
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
    html: sanitizedHtml(doc),
  };
}
