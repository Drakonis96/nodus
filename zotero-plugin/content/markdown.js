/* Nodus for Zotero — tiny Markdown renderer. No dependencies, no innerHTML with
 * model output: `parse` is a pure text→tokens function (unit-tested), `render`
 * walks the tokens and builds DOM nodes, so everything is XSS-safe by
 * construction. Nodus citation tokens ([[p:..]], [[idea:..]], …) are parsed as
 * inline spans and turned into clickable chips via a caller-supplied `citeFn`.
 * Exposed as window.NodusMarkdown.
 */
/* eslint-disable no-undef */
(function () {
  "use strict";
  // Self-contained import (like agent.js/store.js) so the link handler below
  // never depends on sidebar.js's script-scoped `Zotero` binding being loaded.
  const { Zotero } = ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs");

  // Only `*`/`**` emphasis (not `_`): underscores routinely appear inside
  // snake_case identifiers, file names and URLs in academic/code text and must
  // not be mangled into italics.
  const INLINE = [
    { type: "cite", re: /\[\[(e|p|idea|zotero|gap):([^\]|]+?)(?:\|([^\]]+?))?\]\]/ },
    { type: "code", re: /`([^`]+)`/ },
    { type: "strong", re: /\*\*([\s\S]+?)\*\*/ },
    { type: "em", re: /\*(?!\s)([\s\S]+?)(?<!\s)\*/ },
    { type: "link", re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  ];

  function parseInline(text) {
    const out = [];
    let s = String(text == null ? "" : text);
    while (s) {
      let best = null;
      for (const p of INLINE) {
        const m = p.re.exec(s);
        if (m && (best === null || m.index < best.m.index)) best = { p, m };
      }
      if (!best) { out.push({ type: "text", value: s }); break; }
      const m = best.m;
      if (m.index > 0) out.push({ type: "text", value: s.slice(0, m.index) });
      if (best.p.type === "cite") out.push({ type: "cite", kind: m[1], id: (m[2] || "").trim(), label: m[3] });
      else if (best.p.type === "code") out.push({ type: "code", value: m[1] });
      else if (best.p.type === "link") out.push({ type: "link", href: m[2], children: parseInline(m[1]) });
      else out.push({ type: best.p.type, children: parseInline(m[1]) });
      s = s.slice(m.index + m[0].length);
    }
    return out;
  }

  function isBlockStart(line) {
    return (
      /^\s*```/.test(line) ||
      /^\s{0,3}#{1,6}\s+/.test(line) ||
      /^\s*([-*_])(\s*\1){2,}\s*$/.test(line) ||
      /^\s*>\s?/.test(line) ||
      /^\s*([-*+]|\d+[.)])\s+/.test(line)
    );
  }

  // text → array of block tokens. Pure (no DOM). Covers what chat models emit:
  // headings, fenced code, blockquotes, ordered/unordered lists, hr, paragraphs.
  function parse(text) {
    const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const fence = line.match(/^\s*```(.*)$/);
      if (fence) {
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // closing fence (or EOF)
        blocks.push({ type: "code", text: buf.join("\n") });
        continue;
      }
      if (/^\s*$/.test(line)) { i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ type: "hr" }); i++; continue; }
      const h = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
      if (h) { blocks.push({ type: "heading", level: h[1].length, inline: parseInline(h[2].replace(/\s+#+\s*$/, "")) }); i++; continue; }
      if (/^\s*>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        blocks.push({ type: "blockquote", inline: parseInline(buf.join("\n")) });
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
          items.push(parseInline(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, "")));
          i++;
        }
        blocks.push({ type: "list", ordered, items });
        continue;
      }
      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) { buf.push(lines[i]); i++; }
      blocks.push({ type: "paragraph", inline: parseInline(buf.join("\n")) });
    }
    return blocks;
  }

  // ---- DOM rendering ----
  function renderInline(doc, spans, parent, citeFn) {
    for (const sp of spans) {
      if (sp.type === "text") { parent.appendChild(doc.createTextNode(sp.value)); continue; }
      if (sp.type === "cite") {
        const chip = citeFn ? citeFn(sp.kind, sp.id, sp.label) : null;
        parent.appendChild(chip || doc.createTextNode(sp.label || sp.id || ""));
        continue;
      }
      if (sp.type === "code") { const c = doc.createElement("code"); c.className = "nd-md-code"; c.textContent = sp.value; parent.appendChild(c); continue; }
      if (sp.type === "link") {
        const a = doc.createElement("a");
        a.className = "nd-md-link";
        a.setAttribute("href", sp.href);
        // Open externally: chrome:// docs can't navigate to http in place.
        a.addEventListener("click", (e) => { e.preventDefault(); try { Zotero.launchURL(sp.href); } catch (x) {} });
        renderInline(doc, sp.children, a, citeFn);
        parent.appendChild(a);
        continue;
      }
      const tag = sp.type === "strong" ? "strong" : "em";
      const node = doc.createElement(tag);
      renderInline(doc, sp.children, node, citeFn);
      parent.appendChild(node);
    }
  }

  function renderBlock(doc, b, citeFn) {
    if (b.type === "heading") { const h = doc.createElement("h" + Math.min(6, b.level)); h.className = "nd-md-h"; renderInline(doc, b.inline, h, citeFn); return h; }
    if (b.type === "code") { const pre = doc.createElement("pre"); pre.className = "nd-md-pre"; const code = doc.createElement("code"); code.textContent = b.text; pre.appendChild(code); return pre; }
    if (b.type === "hr") { const hr = doc.createElement("hr"); hr.className = "nd-md-hr"; return hr; }
    if (b.type === "blockquote") { const q = doc.createElement("blockquote"); q.className = "nd-md-quote"; renderInline(doc, b.inline, q, citeFn); return q; }
    if (b.type === "list") {
      const list = doc.createElement(b.ordered ? "ol" : "ul");
      list.className = "nd-md-list";
      for (const item of b.items) { const li = doc.createElement("li"); renderInline(doc, item, li, citeFn); list.appendChild(li); }
      return list;
    }
    const p = doc.createElement("p");
    p.className = "nd-md-p";
    renderInline(doc, b.inline, p, citeFn);
    return p;
  }

  // Clears `container` and renders `text` as formatted markdown. `citeFn(kind,
  // id, label)` should return a DOM node for a Nodus citation chip (or null).
  function render(container, text, citeFn) {
    const doc = container.ownerDocument || document;
    container.textContent = "";
    for (const b of parse(text)) container.appendChild(renderBlock(doc, b, citeFn));
  }

  window.NodusMarkdown = { parse, parseInline, render };
})();
