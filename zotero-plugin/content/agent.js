/* Nodus for Zotero — agent layer. Parses action blocks the model emits and
 * executes them against Zotero (create notes, highlight the current selection,
 * add tags), each gated by the sidebar's permission UI. window.NodusAgent.
 *
 * Action block format (fenced) the model is instructed to emit:
 *   ```nodus:action
 *   {"tool":"create_note","title":"...","body":"<p>…</p>","standalone":false}
 *   ```
 */
/* eslint-disable no-undef */
(function () {
  "use strict";
  const { Zotero } = ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs");

  const COLORS = { yellow: "#ffd400", red: "#ff6666", green: "#5fb236", blue: "#2ea8e5", purple: "#a28ae5", orange: "#f19837", magenta: "#e56eee", gray: "#aaaaaa" };
  const TOOLS = ["create_note", "highlight", "add_tags", "add_to_collection", "set_field", "extract_annotations_note"];
  // Only fields that are safe/meaningful to overwrite from chat. Item-type
  // mismatches (e.g. `pages` on a webpage) simply fail with a clear error.
  const SAFE_FIELDS = ["title", "abstractNote", "date", "language", "url", "DOI", "publicationTitle", "journalAbbreviation", "volume", "issue", "pages", "series", "edition", "publisher", "place", "ISBN", "ISSN"];

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // Returns { clean, actions }. `clean` is the reply text with action blocks removed.
  function parseActions(text) {
    const actions = [];
    const re = /```nodus:action\s*([\s\S]*?)```/g;
    let clean = text, m;
    while ((m = re.exec(text)) !== null) {
      try {
        const obj = JSON.parse(m[1].trim());
        if (obj && TOOLS.includes(obj.tool)) actions.push(obj);
      } catch (e) { /* ignore malformed block */ }
    }
    clean = text.replace(re, "").replace(/\n{3,}/g, "\n\n").trim();
    return { clean, actions };
  }

  // Human-readable preview for the permission card.
  function describe(action, t) {
    if (action.tool === "create_note") return (action.standalone ? t("agent.desc.noteStandalone") : t("agent.desc.note")) + (action.title ? " — “" + action.title + "”" : "");
    if (action.tool === "highlight") return t("agent.desc.highlight") + (action.comment ? " — “" + action.comment + "”" : "");
    if (action.tool === "add_tags") return t("agent.desc.tags") + ": " + (Array.isArray(action.tags) ? action.tags.join(", ") : "");
    if (action.tool === "add_to_collection") return t("agent.desc.collection") + " — “" + (action.name || action.collection || "") + "”";
    if (action.tool === "set_field") return t("agent.desc.field") + " — " + (action.field || "") + ": “" + String(action.value == null ? "" : action.value).slice(0, 80) + "”";
    if (action.tool === "extract_annotations_note") return t("agent.desc.extract");
    return action.tool;
  }

  // ctx = { item, attachment, selectionDraft }. Returns { ok, message, undo? }.
  async function execute(action, ctx) {
    try {
      if (action.tool === "create_note") return await createNote(action, ctx);
      if (action.tool === "highlight") return await highlight(action, ctx);
      if (action.tool === "add_tags") return await addTags(action, ctx);
      if (action.tool === "add_to_collection") return await addToCollection(action, ctx);
      if (action.tool === "set_field") return await setField(action, ctx);
      if (action.tool === "extract_annotations_note") return await extractAnnotationsNote(action, ctx);
      return { ok: false, message: "Unknown tool " + action.tool };
    } catch (e) {
      return { ok: false, message: (e && e.message) ? e.message : String(e) };
    }
  }

  async function createNote(action, ctx) {
    const item = ctx.item;
    const libraryID = item ? item.libraryID : Zotero.Libraries.userLibraryID;
    const note = new Zotero.Item("note");
    note.libraryID = libraryID;
    const body = String(action.body || "");
    const html = (action.title ? "<h1>" + esc(action.title) + "</h1>\n" : "") + (/^\s*</.test(body) ? body : "<p>" + esc(body).replace(/\n/g, "<br/>") + "</p>");
    note.setNote(html);
    if (!action.standalone && item && !item.isAttachment()) note.parentID = item.id;
    await note.saveTx();
    return { ok: true, message: "note", createdId: note.id, createdType: "note" };
  }

  async function highlight(action, ctx) {
    const att = ctx.attachment;
    const draft = ctx.selectionDraft;
    if (!att) return { ok: false, message: "no-attachment" };
    if (!draft || !draft.position) return { ok: false, message: "no-selection" };
    const json = {
      key: Zotero.DataObjectUtilities.generateKey(),
      type: "highlight",
      text: draft.text || "",
      color: COLORS[String(action.color || "").toLowerCase()] || draft.color || COLORS.yellow,
      pageLabel: draft.pageLabel || "",
      sortIndex: draft.sortIndex || "00000|000000|00000",
      position: draft.position,
      comment: action.comment || "",
    };
    const ann = await Zotero.Annotations.saveFromJSON(att, json);
    return { ok: true, message: "highlight", createdId: ann ? ann.id : null, createdType: "annotation" };
  }

  async function addTags(action, ctx) {
    const item = ctx.item;
    if (!item) return { ok: false, message: "no-item" };
    const tags = Array.isArray(action.tags) ? action.tags.filter((x) => typeof x === "string" && x.trim()) : [];
    if (!tags.length) return { ok: false, message: "no-tags" };
    for (const tag of tags) item.addTag(tag.trim());
    await item.saveTx();
    return { ok: true, message: "tags", added: tags.length };
  }

  async function addToCollection(action, ctx) {
    const item = ctx.item;
    if (!item) return { ok: false, message: "no-item" };
    const name = String(action.name || action.collection || "").trim();
    if (!name) return { ok: false, message: "no-name" };
    const libraryID = item.libraryID;
    const existing = Zotero.Collections.getByLibrary(libraryID) || [];
    let col = existing.find((c) => c.name && c.name.toLowerCase() === name.toLowerCase());
    if (!col) {
      col = new Zotero.Collection();
      col.libraryID = libraryID;
      col.name = name;
      await col.saveTx();
    }
    item.addToCollection(col.id);
    await item.saveTx();
    return { ok: true, message: "collection", name };
  }

  async function setField(action, ctx) {
    const item = ctx.item;
    if (!item) return { ok: false, message: "no-item" };
    const field = String(action.field || "").trim();
    if (!SAFE_FIELDS.includes(field)) return { ok: false, message: "bad-field" };
    // `setField` throws for a field the item type doesn't support — surfaced as
    // a failure card, not a silent no-op.
    item.setField(field, String(action.value == null ? "" : action.value));
    await item.saveTx();
    return { ok: true, message: "field", field };
  }

  async function extractAnnotationsNote(action, ctx) {
    const parent = ctx.item;
    let att = ctx.attachment;
    if (!att && parent && parent.getBestAttachment) att = await parent.getBestAttachment();
    if (!att || !att.getAnnotations) return { ok: false, message: "no-attachment" };
    const anns = att.getAnnotations() || [];
    const rows = [];
    for (const a of anns) {
      const text = a.annotationText || "";
      const comment = a.annotationComment || "";
      const color = a.annotationColor || COLORS.yellow;
      const page = a.annotationPageLabel || "";
      let html = "";
      if (text) html += '<p style="border-left:3px solid ' + esc(color) + ';padding-left:8px;margin:6px 0;">' + esc(text) + (page ? ' <span style="color:#888;">(p. ' + esc(page) + ")</span>" : "") + "</p>";
      if (comment) html += "<p>" + esc(comment) + "</p>";
      if (html) rows.push(html);
    }
    if (!rows.length) return { ok: false, message: "no-annotations" };
    const note = new Zotero.Item("note");
    note.libraryID = (parent || att).libraryID;
    const title = action.title || "Annotations";
    note.setNote("<h1>" + esc(title) + "</h1>\n" + rows.join("\n"));
    if (parent && !parent.isAttachment()) note.parentID = parent.id;
    await note.saveTx();
    return { ok: true, message: "note", createdId: note.id, createdType: "note" };
  }

  // System-prompt fragment describing the tools (only injected when agent mode is on).
  const SYSTEM = [
    "AGENT MODE: you may act on the user's Zotero library, but ONLY when the user asks you to (create a note, summarize into a note, highlight, tag). Never act unprompted.",
    "To act, add one fenced block per action AT THE END of your reply, after a short natural-language sentence saying what you will do:",
    "```nodus:action",
    '{"tool":"create_note","title":"optional","body":"<p>HTML body</p>","standalone":false}',
    "```",
    "Tools:",
    '• create_note {title?, body (HTML), standalone?} — a child note under the open item (or standalone:true for an independent note). Use for summaries and any note. `body` is HTML. Emit several blocks to create several notes.',
    '• highlight {color?("yellow"|"green"|"blue"|"red"|"purple"), comment?} — highlights the user\'s CURRENT text selection in the reader. Only use it if the user has selected text.',
    '• add_tags {tags:[...]} — adds tags to the open item. Choose sensible tags yourself from the document; do not ask the user which tags.',
    '• add_to_collection {name} — adds the open item to a collection with that name (created if it does not exist).',
    '• set_field {field, value} — sets a bibliographic field on the open item. `value` MUST be PLAIN TEXT (no HTML). Allowed fields: title, abstractNote, date, language, url, DOI, publicationTitle, journalAbbreviation, volume, issue, pages, series, edition, publisher, place, ISBN, ISSN.',
    '• extract_annotations_note {title?} — creates a note from the annotations (highlights/comments) already in the open PDF. `title` is optional — pick a sensible one and act; no text selection needed.',
    "When the user asks for one of these actions, DO IT: pick sensible values yourself and emit the block. Do NOT reply with a clarifying question for details you can reasonably infer. Do NOT invent content the user did not ask for. Each action is shown to the user for approval before it runs.",
  ].join("\n");

  window.NodusAgent = { parseActions, describe, execute, SYSTEM, TOOLS };
})();
