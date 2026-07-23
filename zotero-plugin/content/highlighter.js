/* Nodus for Zotero — auto-highlighter engine. Turns AI-chosen passages (exact
 * quotes + importance level) into REAL, rendered Zotero highlight annotations on
 * the open PDF, by replicating Zotero's own reader math (getRangeRects /
 * getSortIndex) and creating them through the reader's annotationManager (the
 * only path that both persists AND renders). window.NodusHighlighter.
 *
 * The reader recipe (verified in Zotero 9):
 *  - reader._internalReader._primaryView._pdfPages is a DICT keyed by pageIndex
 *    (NOT an array); each page has `.chars` (structured chars) + `.viewBox`.
 *  - each char: {c, u, rect:[x1,y1,x2,y2], inlineRect, rotation, lineBreakAfter}.
 *  - build rects from a char range like Zotero's getRangeRects; sortIndex like
 *    getSortIndex; then annotationManager.addAnnotation(cloneInto(annotation)).
 */
/* eslint-disable no-undef */
(function () {
  "use strict";
  const { Zotero } = ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs");

  // ─────────────────────────────── pure helpers (unit-tested, no Zotero) ──
  function norm4(r) { return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]; }

  // Replica of Zotero reader's getRangeRects: one rect per line-run, split at
  // char.lineBreakAfter. Horizontal runs take left/right from the first/last
  // char and top/bottom from the line's inlineRect.
  function rangeRects(chars, offsetStart, offsetEnd) {
    const rects = []; let start = offsetStart;
    for (let i = start; i <= offsetEnd; i++) {
      const ch = chars[i]; if (!ch) break;
      if (!(ch.lineBreakAfter || i === offsetEnd)) continue;
      const fc = chars[start], lc = ch;
      const fr = norm4(fc.rect), lr = norm4(lc.rect), fi = norm4(fc.inlineRect || fc.rect);
      const rot = fc.rotation || 0, vert = rot === 90 || rot === 270;
      rects.push(vert ? [fi[0], fr[1], fi[2], lr[3]] : [fr[0], fi[1], lr[2], fi[3]]);
      start = i + 1;
    }
    return rects;
  }

  // Replica of Zotero reader's getSortIndex string (page|offset|top), padded.
  function sortIndexStr(pageIndex, viewBox, firstRectTop, offsetStart) {
    let top = 0;
    if (viewBox && typeof firstRectTop === "number") top = Math.max(0, (viewBox[3] - viewBox[1]) - firstRectTop);
    const pad = (n, l) => String(n).slice(0, l).padStart(l, "0");
    return [pad(pageIndex, 5), pad(offsetStart || 0, 6), pad(Math.floor(top), 5)].join("|");
  }

  // Per-char normalization for matching: NFKC (decomposes ligatures ﬁ→fi, ﬂ→fl),
  // unify curly quotes/apostrophes, drop whitespace + every dash/hyphen variant,
  // lowercase. Returns '' to drop the char; a source glyph can expand to >1 char.
  function normChar(ch) {
    let s = String(ch).normalize("NFKC").replace(/[‘’´`]/g, "'").replace(/[“”]/g, '"');
    s = s.replace(/[\s­‐-―−-]/g, "");
    return s.toLowerCase();
  }
  // The quote text, normalized the same way the page text is (so matches align).
  function normalizeText(s) {
    const str = String(s == null ? "" : s); let out = "";
    for (const ch of str) out += normChar(ch);
    return out;
  }
  // Per-page normalized string + a map from norm-index → char index. A ligature
  // maps several norm positions to one char, so a matched range still covers it.
  function buildPageNorm(chars) {
    let norm = ""; const map = [];
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i]; const raw = c && (c.c != null ? c.c : c.u);
      if (raw == null) continue;
      const ns = normChar(raw);
      for (let k = 0; k < ns.length; k++) { norm += ns[k]; map.push(i); }
    }
    return { norm, map };
  }
  // Locate a normalized quote across pages: exact first, then a shrinking prefix
  // (tolerates ligature/char drift later in a long quote). Returns {pg,start,end}.
  function findQuote(pages, qnorm) {
    if (!qnorm || qnorm.length < 8) return null;
    const lens = [qnorm.length];
    const ratios = [0.85, 0.7, 0.55, 0.4];
    for (let r = 0; r < ratios.length; r++) { const l = Math.floor(qnorm.length * ratios[r]); if (l >= 12 && l < qnorm.length) lens.push(l); }
    for (let li = 0; li < lens.length; li++) {
      const q = qnorm.slice(0, lens[li]);
      for (let pi = 0; pi < pages.length; pi++) {
        const pg = pages[pi]; const at = pg.norm.indexOf(q);
        if (at >= 0) return { pg, start: pg.map[at], end: pg.map[at + q.length - 1] };
      }
    }
    return null;
  }

  // Robustly parse the model's passage list: [{text, level}] (or bare strings).
  function parsePassages(text) {
    if (!text) return [];
    let s = String(text).replace(/```(?:json)?/gi, "");
    const a = s.indexOf("["), b = s.lastIndexOf("]");
    if (a < 0 || b <= a) return [];
    let arr; try { arr = JSON.parse(s.slice(a, b + 1)); } catch (e) { return []; }
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const it of arr) {
      if (!it) continue;
      const t = typeof it === "string" ? it : it.text;
      if (typeof t !== "string" || !t.trim()) continue;
      const raw = String((typeof it === "object" && (it.level || it.importance)) || "medium").toLowerCase();
      const level = /(high|very|muy|crit|red|rojo|1)/.test(raw) ? "high" : "medium";
      out.push({ text: t.trim(), level });
    }
    return out;
  }

  const DEFAULT_COLORS = { high: "#ff6666", medium: "#ffd400" };

  // ─────────────────────────────── reader access (needs Zotero) ──────────
  // The open PDF reader whose pages have extracted chars, or null.
  function getReaderPdf() {
    const readers = (Zotero.Reader && Zotero.Reader._readers) || [];
    for (let k = 0; k < readers.length; k++) {
      try {
        const r = readers[k]; const ir = r && r._internalReader; const pv = ir && ir._primaryView;
        const dict = pv && pv._pdfPages;
        if (!dict) continue;
        const keys = Object.keys(dict);
        for (let j = 0; j < keys.length; j++) { const p = dict[keys[j]]; if (p && p.chars && p.chars.length) return { reader: r, ir, dict }; }
      } catch (e) {}
    }
    return null;
  }

  function buildPages(dict) {
    const pages = [];
    const keys = Object.keys(dict);
    for (let j = 0; j < keys.length; j++) {
      const page = dict[keys[j]];
      if (!page || !page.chars || !page.chars.length) continue;
      const { norm, map } = buildPageNorm(page.chars);
      if (!norm) continue;
      pages.push({ pageIndex: page.pageIndex != null ? page.pageIndex : Number(keys[j]), page, chars: page.chars, norm, map });
    }
    return pages;
  }

  // Apply highlights for `passages` (each {text, level}). colors maps level→hex.
  // Returns { applied:[{key,level,pageIndex,text}], missed:[text], error? }.
  function highlightPassages(passages, colors) {
    const rp = getReaderPdf();
    if (!rp) return { error: "no-reader", applied: [], missed: [] };
    const colorMap = colors || DEFAULT_COLORS;
    const pages = buildPages(rp.dict);
    if (!pages.length) return { error: "no-text", applied: [], missed: [] };
    const Cu = Components.utils;
    const am = rp.ir._annotationManager;
    const g = Cu.getGlobalForObject(am);
    const applied = [], missed = [];
    for (const p of passages || []) {
      const qnorm = normalizeText(p.text);
      const hit = findQuote(pages, qnorm);
      if (!hit) { missed.push(p.text); continue; }
      const rects = rangeRects(hit.pg.chars, hit.start, hit.end);
      if (!rects.length) { missed.push(p.text); continue; }
      const position = { pageIndex: hit.pg.pageIndex, rects };
      const si = sortIndexStr(hit.pg.pageIndex, hit.pg.page.viewBox, rects[0][3], hit.start);
      const color = colorMap[p.level] || colorMap.medium || DEFAULT_COLORS.medium;
      const annotation = { type: "highlight", color, sortIndex: si, pageLabel: String(hit.pg.pageIndex + 1), position, text: String(p.text).slice(0, 500), tags: [], comment: "" };
      try {
        const r = am.addAnnotation(Cu.cloneInto(annotation, g));
        applied.push({ key: r ? (r.id || r.key) : null, level: p.level, pageIndex: hit.pg.pageIndex, text: p.text });
      } catch (e) { missed.push(p.text); }
    }
    return { applied, missed };
  }

  // Remove highlights previously created (revert). keys = annotation ids/keys.
  function revert(keys) {
    if (!keys || !keys.length) return 0;
    const rp = getReaderPdf();
    if (!rp) return 0;
    const Cu = Components.utils;
    const am = rp.ir._annotationManager;
    try {
      const g = Cu.getGlobalForObject(am);
      am.deleteAnnotations(Cu.cloneInto(keys.slice(), g));
      return keys.length;
    } catch (e) { try { Zotero.logError(e); } catch (x) {} return 0; }
  }

  window.NodusHighlighter = {
    // pure (tested)
    norm4, rangeRects, sortIndexStr, normChar, normalizeText, buildPageNorm, findQuote, parsePassages, DEFAULT_COLORS,
    // reader
    getReaderPdf, buildPages, highlightPassages, revert,
  };
})();
