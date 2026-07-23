/* Nodus for Zotero — small pure helpers shared by the sidebar. Kept out of
 * sidebar.js so they can be unit-tested in Node with no DOM/Zotero. No side
 * effects, no globals beyond window.NodusUtil.
 */
/* eslint-disable no-undef */
(function () {
  "use strict";

  const OMIT = "\n\n[… omitted middle of a long document …]\n\n";

  // Clamp document text to `limit` chars WITHOUT silently dropping the end:
  // when a work is too long we keep the head AND the tail (abstract/intro +
  // conclusions), joined by a visible omission marker, instead of the old
  // head-only slice that made the model answer about a book having seen only
  // its first pages. Returns { text, truncated, sentChars, totalChars, ratio }.
  function sampleDocText(text, limit) {
    const s = String(text == null ? "" : text);
    const max = limit > 0 ? limit : 200000;
    const total = s.length;
    if (total <= max) return { text: s, truncated: false, sentChars: total, totalChars: total, ratio: 1 };
    const budget = Math.max(0, max - OMIT.length);
    const headLen = Math.floor(budget * 0.7);
    const tailLen = budget - headLen;
    const out = s.slice(0, headLen) + OMIT + s.slice(total - tailLen);
    return { text: out, truncated: true, sentChars: out.length, totalChars: total, ratio: max / total };
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Render a stored conversation as note HTML (for "save chat as note").
  // labels = { you, nodus }. Pure string→string.
  function conversationToHtml(conv, labels) {
    const you = (labels && labels.you) || "You";
    const nodus = (labels && labels.nodus) || "Nodus";
    const rows = [];
    for (const m of (conv && conv.messages) || []) {
      if (!m || !m.content) continue;
      const who = m.role === "user" ? you : nodus;
      const body = esc(m.content).replace(/\n/g, "<br/>");
      rows.push('<p><b>' + esc(who) + ':</b> ' + body + '</p>');
    }
    return rows.join("\n");
  }

  // Compact multi-item context block: one line per selected item with title,
  // creators, year and (trimmed) abstract. Used when the user has several items
  // selected in Zotero so the model can compare/relate them. Pure.
  function buildItemsSummary(items, opts) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (list.length < 2) return "";
    const maxAbstract = (opts && opts.maxAbstract) || 600;
    const lines = list.map((it, idx) => {
      const bits = [String(idx + 1) + ". " + (it.title || it.key || "Untitled")];
      if (it.creators) bits.push("— " + it.creators);
      if (it.year) bits.push("(" + it.year + ")");
      let head = bits.join(" ");
      if (it.abstract) head += "\n   " + String(it.abstract).replace(/\s+/g, " ").slice(0, maxAbstract);
      return head;
    });
    return "SELECTED DOCUMENTS (the user selected " + list.length + " items — you may compare, relate and reference them):\n" + lines.join("\n");
  }

  window.NodusUtil = { sampleDocText, conversationToHtml, buildItemsSummary };
})();
