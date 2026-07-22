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
  const TOOLS = ["create_note", "highlight", "add_tags"];

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
    return action.tool;
  }

  // ctx = { item, attachment, selectionDraft }. Returns { ok, message, undo? }.
  async function execute(action, ctx) {
    try {
      if (action.tool === "create_note") return await createNote(action, ctx);
      if (action.tool === "highlight") return await highlight(action, ctx);
      if (action.tool === "add_tags") return await addTags(action, ctx);
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

  // System-prompt fragment describing the tools (only injected when agent mode is on).
  const SYSTEM = [
    "AGENT MODE: you may act on the user's Zotero library, but ONLY when the user asks you to (create a note, summarize into a note, highlight, tag). Never act unprompted.",
    "To act, add one fenced block per action AT THE END of your reply, after a short natural-language sentence saying what you will do:",
    "```nodus:action",
    '{"tool":"create_note","title":"optional","body":"<p>HTML body</p>","standalone":false}',
    "```",
    "Tools:",
    '• create_note {title?, body (HTML), standalone?} — a child note under the open item (or standalone:true for an independent note). Use for summaries and any note. Emit several blocks to create several notes.',
    '• highlight {color?("yellow"|"green"|"blue"|"red"|"purple"), comment?} — highlights the user\'s CURRENT text selection in the reader. Only use it if the user has selected text.',
    '• add_tags {tags:[...]} — adds tags to the open item.',
    "Do NOT invent content the user did not ask for. Each action will be shown to the user for approval before it runs.",
  ].join("\n");

  window.NodusAgent = { parseActions, describe, execute, SYSTEM, TOOLS };
})();
