// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Collect the small, passive page snapshot needed by detector.js.
 *
 * This function is deliberately self-contained because Chrome serialises it
 * into the active tab with scripting.executeScript(). Keep all constants and
 * helpers inside the function so it remains safe to inject in an isolated
 * world. A page is untrusted input: every collection and the final payload
 * have a hard budget, and the optional HTML snapshot is a readable subtree,
 * never a clone of the complete document.
 */
export function collectPageSnapshot() {
  const MAX_TOTAL_CHARS = 2 * 1024 * 1024;
  const MAX_HTML_CHARS = 900 * 1024;
  const MAX_JSONLD_CHARS = 512 * 1024;
  const MAX_JSONLD_ITEM_CHARS = 128 * 1024;
  const clamp = (value, limit) => String(value ?? '').slice(0, limit);
  const text = (value, limit) => clamp(value, limit).replace(/\s+/g, ' ').trim();
  const nodes = (selector, limit) => {
    const collection = document.querySelectorAll(selector);
    const result = [];
    for (let index = 0; index < Math.min(collection.length, limit); index += 1) result.push(collection[index]);
    return result;
  };
  const attr = (element, name, limit = 2000) => clamp(element.getAttribute(name) || '', limit);

  const metas = nodes('meta', 400).map((element) => ({
    name: attr(element, 'name', 200), property: attr(element, 'property', 200),
    httpEquiv: attr(element, 'http-equiv', 200), content: attr(element, 'content', 4000),
  }));
  const links = nodes('link[href]', 200).map((element) => ({
    rel: attr(element, 'rel', 200), type: attr(element, 'type', 200),
    href: clamp(element.href || '', 4000), title: attr(element, 'title', 500),
  }));

  let jsonLdChars = 0;
  const jsonLd = [];
  for (const element of nodes('script[type="application/ld+json"]', 40)) {
    const value = String(element.textContent || '');
    if (!value || value.length > MAX_JSONLD_ITEM_CHARS || jsonLdChars + value.length > MAX_JSONLD_CHARS) continue;
    jsonLd.push(value);
    jsonLdChars += value.length;
  }

  const coins = nodes('.Z3988[title], span[title^="ctx_ver="]', 60)
    .map((element) => attr(element, 'title', 4000));
  const filePattern = /\.(?:pdf|epub|docx?|odt|rtf|txt|md|xml|jats|csv|tsv|xlsx?|ods|pptx?|odp|png|jpe?g|webp|gif|tiff?|svg|mp3|m4a|wav|ogg|flac|mp4|webm)(?:$|[?#])/i;
  const fullTextPattern = /(?:\bpdf\b|full\s*text|texto\s+completo|texte\s+int[ée]gral|volltext|testo\s+completo|texto\s+integral|tam\s+metin|descargar\s+(?:art[ií]culo|pdf)|download\s+(?:article|paper|pdf))/i;
  const anchors = nodes('a[href]', 500).filter((element) => {
    const label = `${text(element.textContent, 500)} ${attr(element, 'title', 500)}`;
    const href = String(element.href || '');
    return filePattern.test(href) || attr(element, 'type', 100) === 'application/pdf' || fullTextPattern.test(label);
  }).slice(0, 80).map((element) => ({
    href: clamp(element.href || '', 4000), text: text(element.textContent, 300),
    title: attr(element, 'title', 500), type: attr(element, 'type', 100),
  }));

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const readableHtml = () => {
    const contentType = String(document.contentType || '');
    if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') return '';
    const candidates = [
      ...nodes('article,main,[role="main"]', 8),
      document.body,
    ].filter(Boolean);
    const source = candidates.find((element) => String(element.innerText || element.textContent || '').trim().length >= 160) || candidates[0];
    if (!source) return '';
    const sourceContent = String(source.innerText || source.textContent || '');
    const sourceText = text(sourceContent, MAX_HTML_CHARS * 2);
    const fallback = () => sourceText ? `<!doctype html><main><p>${escapeHtml(sourceText.slice(0, MAX_HTML_CHARS - 80))}</p></main>` : '';
    // Avoid cloneNode on very large article/body subtrees. Reading bounded
    // text is enough for a passive snapshot and does not duplicate the DOM.
    if (sourceContent.length > MAX_HTML_CHARS * 2) return fallback();
    if (source.querySelectorAll && source.querySelectorAll('*').length > 4000) return fallback();
    try {
      const clone = source.cloneNode(true);
      for (const element of Array.from(clone.querySelectorAll('script,noscript,iframe,object,embed,form,base,style,link,canvas,video,audio'))) element.remove();
      for (const element of Array.from(clone.querySelectorAll('*'))) {
        for (const attribute of Array.from(element.attributes || [])) {
          const name = String(attribute.name || '').toLowerCase();
          if (/^on/i.test(name) || ['srcdoc', 'style', 'src', 'srcset', 'poster'].includes(name)) {
            element.removeAttribute(attribute.name);
          } else if ((name === 'href' || name === 'xlink:href') && /^(?:\s*javascript:|\s*file:|\s*data:)/i.test(attribute.value || '')) {
            element.removeAttribute(attribute.name);
          }
        }
      }
      const html = `<!doctype html>\n${String(clone.outerHTML || '')}`;
      if (html.length <= MAX_HTML_CHARS) return html;
    } catch { /* A hostile DOM must not prevent metadata capture. */ }
    return fallback();
  };

  const result = {
    title: clamp(document.title || '', 1000), url: clamp(location.href || '', 4000),
    lang: clamp(document.documentElement?.lang || navigator.language || '', 100),
    contentType: clamp(document.contentType || '', 200), metas, links, jsonLd, coins, anchors,
    html: readableHtml(),
  };

  // The metadata arrays above are independently capped. Enforce the budget on
  // the serialised message too, accounting for object keys and JSON escaping.
  if (JSON.stringify(result).length > MAX_TOTAL_CHARS) {
    result.html = '';
    for (const key of ['coins', 'anchors', 'links', 'metas', 'jsonLd']) {
      if (JSON.stringify(result).length <= MAX_TOTAL_CHARS) break;
      result[key] = [];
    }
  }
  return result;
}
