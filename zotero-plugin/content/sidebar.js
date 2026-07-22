/* Nodus for Zotero — sidebar app. Two modes:
 *  - "connected": talks to the Nodus local server (library context, ideas, page cites).
 *  - "standalone": talks directly to AI providers with the user's own keys (no Nodus).
 */
/* eslint-disable no-undef */
"use strict";

const { Zotero } = ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs");
const NP = window.NodusProviders;
const NS = window.NodusStore;
const NA = window.NodusAgent;

const I18N = {
  en: {
    "tab.chat": "Chat", "tab.providers": "Providers", "tab.settings": "Settings",
    "composer.send": "Send", "composer.placeholder": "Ask about this document…",
    "chat.new": "New conversation", "chat.history": "Conversations",
    "settings.mode": "Mode", "mode.connected": "Linked with Nodus", "mode.standalone": "Standalone", "mode.linkTag": "Link mode",
    "mode.hint.connected": "Uses your running Nodus app: library context, ideas, page citations.",
    "mode.hint.standalone": "Works without Nodus, using your own provider API keys. Nodus-only features are off.",
    "settings.context": "Context", "settings.useIdeas": "Use Nodus ideas when available",
    "settings.useFulltext": "Send document text", "settings.useCorpus": "Search my Nodus library for related passages",
    "settings.standaloneNote": "Nodus-only features are unavailable in Standalone mode.",
    "settings.language": "Language", "settings.connection": "Nodus connection", "settings.test": "Test connection",
    "settings.token": "token", "settings.manualHint": "Leave empty to auto-detect from Nodus.",
    "providers.intro": "Add API keys per provider, load their models, and pin the ones you want in the model menu. Used in Standalone mode.",
    "providers.load": "Load models", "providers.loading": "Loading…", "providers.key": "API key", "providers.baseUrl": "Server URL",
    "providers.saved": "Saved", "providers.noModels": "No models pinned yet — open a provider and pin some.",
    "providers.sub": "Subscription — sign in through the Nodus app and use it in Link mode.",
    "providers.subCodex": "Uses your ChatGPT/Codex subscription credits. Sign in through the Nodus app and use it in Link mode.",
    "history.search": "Search conversations…", "history.clearAll": "Delete all conversations", "history.empty": "No conversations yet.",
    "modal.cancel": "Cancel", "modal.delete": "Delete",
    "modal.delOne": "Delete this conversation? This cannot be undone.", "modal.delAll": "Delete ALL conversations? This cannot be undone.",
    "conn.on": "Connected", "conn.off": "Not connected",
    "conn.detailOn": "Connected to Nodus on port", "conn.detailOff": "Nodus server not found. Enable it in Nodus → Settings → Nodus for Zotero.",
    "item.none": "Select a document in Zotero.", "item.analyzed": "Full analysis in Nodus", "item.notAnalyzed": "Not analyzed in Nodus", "item.ideas": "ideas",
    "prompt.summary": "Summary", "prompt.ideas": "Main ideas", "prompt.connections": "Connections", "prompt.selection": "Explain selection", "prompt.quotes": "Key quotes",
    "p.summary": "Summarize this document.", "p.ideas": "What are the main ideas of this document?",
    "p.connections": "Which items in my library connect to this one, and how?", "p.selection": "Explain the selected passage and its significance.",
    "p.quotes": "Give the key quotes with their page numbers.",
    "close": "Close", "chat.prompts": "Prompt templates", "chat.stop": "Stop",
    "prompt.methodology": "Methodology", "p.methodology": "Explain the methodology used and its strengths and weaknesses.",
    "prompt.critique": "Critique", "p.critique": "Give a critical appraisal: assumptions, limitations, and what would strengthen it.",
    "prompt.gaps": "Research gaps", "p.gaps": "What research gaps or open questions does this raise?",
    "prompt.contributions": "Key contributions", "p.contributions": "What are the key contributions of this work?",
    "prompt.compare": "Compare with library", "p.compare": "How does this compare to related work in my library?",
    "prompt.simple": "Explain simply", "p.simple": "Explain the core argument in simple terms.",
    "prompt.terms": "Key terms", "p.terms": "Define the key terms and concepts used here.",
    "prompt.thesis": "Thesis & evidence", "p.thesis": "State the main thesis and the evidence given for it.",
    "chat.offline": "Not connected. In Settings, switch to Standalone mode (with your own API keys) or start the Nodus for Zotero server in Nodus.",
    "chat.noModel": "Pick a model first (Providers tab in Standalone mode, or your Nodus favorites).",
    "chat.hint": "Ask about this document: summary, main ideas, or connections across your library.",
    "sel.clear": "clear", "you": "You", "nodus": "Nodus",
    "agent.mode": "Agent mode", "agent.auto": "Auto-approve actions (no confirmation each time)",
    "agent.modeDesc": "Let Nodus act on your Zotero library (create notes, highlight, tag) — with your approval.",
    "agent.hint": "Each action asks for permission unless auto-approve is on.",
    "agent.autoConfirm": "Auto-approve lets Nodus modify your Zotero library WITHOUT asking each time. Enable it?",
    "agent.allow": "Allow", "agent.deny": "Deny", "agent.enable": "Enable", "agent.acting": "Working…", "agent.denied": "Skipped",
    "agent.desc.note": "Create a note under this item", "agent.desc.noteStandalone": "Create a standalone note",
    "agent.desc.highlight": "Highlight the selected passage", "agent.desc.tags": "Add tags",
    "agent.ok.note": "Note created ✓", "agent.ok.highlight": "Highlighted ✓", "agent.ok.tags": "Tags added ✓",
    "agent.fail": "Couldn't complete", "agent.needSel": "Select text in the reader first, then ask again.",
    "providers.linkedMsg": "Providers are only used in Standalone mode. In Link mode, models come from Nodus — add or pin models in the Nodus app.",
    "agent.on": "Agent mode ON — Nodus can now propose actions on your Zotero (create notes, highlight, tag). It asks permission each time you chat.",
    "agent.off": "Agent mode off.",
  },
  es: {
    "tab.chat": "Chat", "tab.providers": "Proveedores", "tab.settings": "Ajustes",
    "composer.send": "Enviar", "composer.placeholder": "Pregunta sobre este documento…",
    "chat.new": "Nueva conversación", "chat.history": "Conversaciones",
    "settings.mode": "Modo", "mode.connected": "Vinculado con Nodus", "mode.standalone": "Autónomo", "mode.linkTag": "Modo Link",
    "mode.hint.connected": "Usa tu app de Nodus en marcha: contexto de biblioteca, ideas, citas de página.",
    "mode.hint.standalone": "Funciona sin Nodus, con tus propias API keys. Las funciones exclusivas de Nodus quedan desactivadas.",
    "settings.context": "Contexto", "settings.useIdeas": "Usar ideas de Nodus cuando existan",
    "settings.useFulltext": "Enviar texto del documento", "settings.useCorpus": "Buscar pasajes relacionados en mi biblioteca Nodus",
    "settings.standaloneNote": "Las funciones exclusivas de Nodus no están disponibles en modo Autónomo.",
    "settings.language": "Idioma", "settings.connection": "Conexión con Nodus", "settings.test": "Probar conexión",
    "settings.token": "token", "settings.manualHint": "Déjalo vacío para detectarlo automáticamente desde Nodus.",
    "providers.intro": "Añade API keys por proveedor, carga sus modelos y fija los que quieras en el menú de modelos. Se usan en modo Autónomo.",
    "providers.load": "Cargar modelos", "providers.loading": "Cargando…", "providers.key": "API key", "providers.baseUrl": "URL del servidor",
    "providers.saved": "Guardado", "providers.noModels": "Aún no hay modelos fijados — abre un proveedor y fija algunos.",
    "providers.sub": "Suscripción — inicia sesión en la app de Nodus y úsala en modo Link.",
    "providers.subCodex": "Usa los créditos de tu suscripción ChatGPT/Codex. Inicia sesión desde la app de Nodus y úsala en modo Link.",
    "history.search": "Buscar conversaciones…", "history.clearAll": "Eliminar todas las conversaciones", "history.empty": "Aún no hay conversaciones.",
    "modal.cancel": "Cancelar", "modal.delete": "Eliminar",
    "modal.delOne": "¿Eliminar esta conversación? No se puede deshacer.", "modal.delAll": "¿Eliminar TODAS las conversaciones? No se puede deshacer.",
    "conn.on": "Conectado", "conn.off": "Sin conexión",
    "conn.detailOn": "Conectado a Nodus en el puerto", "conn.detailOff": "No se encontró el servidor de Nodus. Actívalo en Nodus → Ajustes → Nodus para Zotero.",
    "item.none": "Selecciona un documento en Zotero.", "item.analyzed": "Análisis completo en Nodus", "item.notAnalyzed": "Sin analizar en Nodus", "item.ideas": "ideas",
    "prompt.summary": "Resumen", "prompt.ideas": "Ideas principales", "prompt.connections": "Conexiones", "prompt.selection": "Explicar selección", "prompt.quotes": "Citas clave",
    "p.summary": "Haz un resumen de este documento.", "p.ideas": "¿Cuáles son las ideas principales de este documento?",
    "p.connections": "¿Qué ítems de mi biblioteca conectan con este y cómo?", "p.selection": "Explica el pasaje seleccionado y su relevancia.",
    "p.quotes": "Dame las citas clave con su número de página.",
    "close": "Cerrar", "chat.prompts": "Plantillas de prompt", "chat.stop": "Detener",
    "prompt.methodology": "Metodología", "p.methodology": "Explica la metodología usada y sus fortalezas y debilidades.",
    "prompt.critique": "Crítica", "p.critique": "Haz una valoración crítica: supuestos, limitaciones y qué lo reforzaría.",
    "prompt.gaps": "Huecos de investigación", "p.gaps": "¿Qué huecos de investigación o preguntas abiertas plantea?",
    "prompt.contributions": "Aportaciones clave", "p.contributions": "¿Cuáles son las aportaciones clave de este trabajo?",
    "prompt.compare": "Comparar con biblioteca", "p.compare": "¿Cómo se compara con trabajos relacionados de mi biblioteca?",
    "prompt.simple": "Explica sencillo", "p.simple": "Explica el argumento central en términos sencillos.",
    "prompt.terms": "Términos clave", "p.terms": "Define los términos y conceptos clave que se usan aquí.",
    "prompt.thesis": "Tesis y evidencia", "p.thesis": "Expón la tesis principal y la evidencia que la respalda.",
    "chat.offline": "Sin conexión. En Ajustes, cambia a modo Autónomo (con tus API keys) o arranca el servidor de Nodus para Zotero.",
    "chat.noModel": "Elige primero un modelo (pestaña Proveedores en modo Autónomo, o tus favoritos de Nodus).",
    "chat.hint": "Pregunta sobre este documento: resumen, ideas principales o conexiones en tu biblioteca.",
    "sel.clear": "quitar", "you": "Tú", "nodus": "Nodus",
    "agent.mode": "Modo agente", "agent.auto": "Aprobar acciones automáticamente (sin confirmar cada vez)",
    "agent.modeDesc": "Deja que Nodus actúe en tu biblioteca de Zotero (crear notas, subrayar, etiquetar) — con tu permiso.",
    "agent.hint": "Cada acción pide permiso salvo que actives la aprobación automática.",
    "agent.autoConfirm": "La aprobación automática deja que Nodus modifique tu biblioteca de Zotero SIN preguntar cada vez. ¿Activar?",
    "agent.allow": "Permitir", "agent.deny": "Denegar", "agent.enable": "Activar", "agent.acting": "Trabajando…", "agent.denied": "Omitido",
    "agent.desc.note": "Crear una nota en este ítem", "agent.desc.noteStandalone": "Crear una nota independiente",
    "agent.desc.highlight": "Subrayar el pasaje seleccionado", "agent.desc.tags": "Añadir etiquetas",
    "agent.ok.note": "Nota creada ✓", "agent.ok.highlight": "Subrayado ✓", "agent.ok.tags": "Etiquetas añadidas ✓",
    "agent.fail": "No se pudo completar", "agent.needSel": "Selecciona texto en el lector primero y vuelve a pedirlo.",
    "providers.linkedMsg": "Los proveedores solo se usan en modo Autónomo. En modo Link, los modelos vienen de Nodus — añade o fija modelos en la app de Nodus.",
    "agent.on": "Modo agente ACTIVADO — Nodus podrá proponer acciones sobre tu Zotero (crear notas, subrayar, etiquetar). Pedirá permiso cada vez que chatees.",
    "agent.off": "Modo agente desactivado.",
  },
};

const state = {
  mode: "connected", lang: "en", connected: false, config: null,
  modelsConnected: [], model: null,
  item: null, attachmentKey: null, selection: "", ideaLabels: {},
  conversations: [], conv: null, busy: false, lastItemKey: null, abort: null,
  agentEnabled: false, agentAuto: false, selectionDraft: null,
};

const t = (k) => (I18N[state.lang] && I18N[state.lang][k]) || I18N.en[k] || k;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

// ─────────────────────────────────────────── Nodus client (connected mode)
function bridgePath() {
  const home = Services.dirsvc.get("Home", Components.interfaces.nsIFile).path;
  return PathUtils.join(home, ".nodus", "zotero-bridge.json");
}
async function loadConfig() {
  const m = NS.getManual();
  if (m.port && m.token) return { port: m.port, token: m.token };
  try { const j = JSON.parse(await IOUtils.readUTF8(bridgePath())); if (j && j.port && j.token) return { port: Number(j.port), token: String(j.token) }; } catch (e) {}
  return null;
}
async function api(pathname, opts) {
  const cfg = state.config;
  if (!cfg) throw new Error("not connected");
  const init = Object.assign({ method: "GET" }, opts || {});
  init.headers = Object.assign({ "Content-Type": "application/json", Authorization: "Bearer " + cfg.token }, (opts && opts.headers) || {});
  return fetch("http://127.0.0.1:" + cfg.port + pathname, init);
}
async function apiJson(pathname, opts) { const r = await api(pathname, opts); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }

async function connect() {
  state.connected = false; state.config = null;
  if (state.mode === "connected") {
    state.config = await loadConfig();
    if (state.config) { try { const h = await apiJson("/api/z/health"); state.connected = Boolean(h && h.ok); } catch (e) {} }
  }
  renderConn();
}
function renderConn() {
  const chip = $("#nd-conn");
  // The "Link mode" pill already conveys the mode, so we don't repeat "Connected".
  // The badge only appears as a red warning when linked but the server is unreachable.
  if (state.mode === "standalone" || state.connected) { chip.className = "nd-conn"; chip.textContent = ""; chip.hidden = true; }
  else { chip.className = "nd-conn nd-conn--off"; chip.textContent = t("conn.off"); chip.hidden = false; }
  const detail = $("#nd-conn-detail");
  if (detail) detail.textContent = state.connected ? t("conn.detailOn") + " " + (state.config ? state.config.port : "") : t("conn.detailOff");
  updateSendEnabled();
}
function updateSendEnabled() {
  const ok = !!currentModel() && (state.mode === "standalone" || state.connected);
  $("#nd-send").disabled = !ok || state.busy;
  $("#nd-send").hidden = state.busy;
  $("#nd-stop").hidden = !state.busy;
}
function stopStreaming() { if (state.abort) { try { state.abort.abort(); } catch (e) {} } }
function closeSidebar() {
  try {
    const p = window.parent; if (!p || !p.document) return;
    const s = p.document.getElementById("nodus-sidebar"); const sp = p.document.getElementById("nodus-splitter");
    if (s) s.hidden = true; if (sp) sp.hidden = true;
  } catch (e) {}
}

// ─────────────────────────────────────────── model selection
function currentModel() { return state.model; }
function availableModels() { return state.mode === "connected" ? state.modelsConnected : NS.getPinned(); }

async function loadModelsForMode() {
  if (state.mode === "connected") {
    state.modelsConnected = [];
    if (state.connected) { try { const d = await apiJson("/api/z/models"); state.modelsConnected = Array.isArray(d.models) ? d.models : []; } catch (e) {} }
  }
  const models = availableModels();
  const saved = NS.getModel(state.mode);
  let chosen = models.find((m) => saved && m.provider === saved.provider && m.model === saved.model) || models[0] || null;
  state.model = chosen;
  const sel = $("#nd-model");
  sel.innerHTML = "";
  if (!models.length) { const o = el("option", null, state.mode === "standalone" ? "— (pin models in Providers)" : "—"); o.value = ""; sel.appendChild(o); }
  for (const m of models) { const o = el("option", null, m.model + "  ·  " + m.provider); o.value = m.provider + "::" + m.model; sel.appendChild(o); }
  if (chosen) sel.value = chosen.provider + "::" + chosen.model;
  updateSendEnabled();
}

// ─────────────────────────────────────────── current Zotero item
function activeReader() {
  try { const w = Zotero.getMainWindow(); const id = w && w.Zotero_Tabs && w.Zotero_Tabs.selectedID; if (id && Zotero.Reader.getByTabID) return Zotero.Reader.getByTabID(id) || null; } catch (e) {}
  return null;
}
function getCurrentItem() {
  const reader = activeReader();
  if (reader && reader.itemID) { try { const att = Zotero.Items.get(reader.itemID); const parent = att && att.parentItem ? att.parentItem : att; return { item: parent, attachment: att, reader }; } catch (e) {} }
  try {
    const w = Zotero.getMainWindow(); const zp = (w && w.ZoteroPane) || (Zotero.getActiveZoteroPane && Zotero.getActiveZoteroPane());
    const items = zp && zp.getSelectedItems ? zp.getSelectedItems() : [];
    if (items && items.length) { let it = items[0]; let att = null; if (it.isAttachment && it.isAttachment()) { att = it; if (it.parentItem) it = it.parentItem; } return { item: it, attachment: att, reader: null }; }
  } catch (e) {}
  return { item: null, attachment: null, reader: null };
}
async function refreshItem(force) {
  const cur = getCurrentItem();
  const key = cur.item ? cur.item.key : null;
  if (!force && key === state.lastItemKey) return;
  state.lastItemKey = key;
  const box = $("#nd-item");
  if (!cur.item) { state.item = null; state.attachmentKey = null; box.textContent = t("item.none"); return; }
  let title = "", doi = "";
  try { title = cur.item.getDisplayTitle ? cur.item.getDisplayTitle() : cur.item.getField("title"); } catch (e) {}
  try { doi = cur.item.getField ? cur.item.getField("DOI") : ""; } catch (e) {}
  state.item = { key: cur.item.key, doi: doi || "", title: title || "" };
  state.attachmentKey = cur.attachment ? cur.attachment.key : null;
  box.innerHTML = "";
  box.appendChild(el("div", "nd-item-title", title || cur.item.key));
  if (state.mode === "connected" && state.connected) {
    try {
      const r = await apiJson("/api/z/resolve", { method: "POST", body: JSON.stringify({ zoteroKey: state.item.key, doi: state.item.doi, title: state.item.title }) });
      const badge = el("span", "nd-badge " + (r.matched && r.hasAnalysis ? "nd-badge--yes" : "nd-badge--no"));
      badge.textContent = r.matched && r.hasAnalysis ? "✓ " + t("item.analyzed") + " · " + (r.ideaCount || 0) + " " + t("item.ideas") : t("item.notAnalyzed");
      box.appendChild(badge);
    } catch (e) {}
  }
}
async function getDocumentText() {
  try {
    const cur = getCurrentItem(); let att = cur.attachment;
    if (!att && cur.item && cur.item.getBestAttachment) att = await cur.item.getBestAttachment();
    if (att) { const text = await att.attachmentText; if (text) return String(text).slice(0, 120000); }
  } catch (e) {}
  return "";
}

// ─────────────────────────────────────────── messages + citations
const messagesEl = () => $("#nd-messages");
function addMessage(role, text) {
  const wrap = el("div", "nd-msg nd-msg--" + role);
  wrap.appendChild(el("div", "nd-who", role === "user" ? t("you") : t("nodus")));
  const body = el("div", "nd-body"); body.textContent = text; wrap.appendChild(body);
  const hint = messagesEl().querySelector(".nd-hint"); if (hint) hint.remove();
  messagesEl().appendChild(wrap); messagesEl().scrollTop = messagesEl().scrollHeight;
  return body;
}
function renderCitations(bodyEl, text) {
  bodyEl.textContent = "";
  const re = /\[\[(p|idea|zotero|gap):([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) { if (m.index > last) bodyEl.appendChild(document.createTextNode(text.slice(last, m.index))); bodyEl.appendChild(makeCite(m[1], m[2].trim(), m[3])); last = re.lastIndex; }
  if (last < text.length) bodyEl.appendChild(document.createTextNode(text.slice(last)));
}
function makeCite(kind, id, label) {
  const chip = el("a", "nd-cite");
  if (kind === "p") { chip.textContent = "p. " + id; chip.onclick = () => goToPage(id); }
  else if (kind === "idea") { chip.textContent = "▸ " + (label || state.ideaLabels[id] || "idea"); chip.onclick = () => openInNodus("idea", id); }
  else if (kind === "gap") { chip.textContent = "◇ " + (label || "gap"); chip.onclick = () => openInNodus("gap", id); }
  else if (kind === "zotero") { chip.textContent = "↗ " + (label || "source"); chip.onclick = () => selectInZotero(id); }
  return chip;
}
function goToPage(pageLabel) {
  const n = parseInt(String(pageLabel).replace(/[^0-9]/g, ""), 10);
  const reader = activeReader();
  if (reader && !isNaN(n)) { try { reader.navigate({ pageIndex: Math.max(0, n - 1) }); return; } catch (e) {} }
  if (state.attachmentKey && !isNaN(n)) { try { Zotero.launchURL("zotero://open-pdf/library/items/" + state.attachmentKey + "?page=" + n); } catch (e) {} }
}
async function openInNodus(kind, id) { try { await api("/api/z/open", { method: "POST", body: JSON.stringify({ kind, id }) }); } catch (e) {} }
async function selectInZotero(key) {
  if (state.mode === "connected") { try { await api("/api/z/select", { method: "POST", body: JSON.stringify({ zoteroKey: key }) }); return; } catch (e) {} }
  try { Zotero.launchURL("zotero://select/library/items/" + key); } catch (e) {}
}

// ─────────────────────────────────────────── conversations
function startNewConversation() {
  state.conv = { id: NS.newId(), title: "", mode: state.mode, model: state.model, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  messagesEl().innerHTML = "";
  const h = el("div", "nd-hint"); h.textContent = t("chat.hint"); messagesEl().appendChild(h);
}
async function persistConv() {
  if (!state.conv || !state.conv.messages.length) return;
  if (!state.conv.title) { const first = state.conv.messages.find((m) => m.role === "user"); state.conv.title = first ? first.content.slice(0, 60) : "Conversation"; }
  state.conv.updatedAt = Date.now();
  const i = state.conversations.findIndex((c) => c.id === state.conv.id);
  if (i >= 0) state.conversations[i] = state.conv; else state.conversations.unshift(state.conv);
  await NS.saveConversations(state.conversations);
}
function loadConversation(id) {
  const c = state.conversations.find((x) => x.id === id);
  if (!c) return;
  state.conv = c;
  messagesEl().innerHTML = "";
  for (const m of c.messages) { const b = addMessage(m.role, m.content); if (m.role === "assistant") { b.setAttribute("data-raw", m.content); renderCitations(b, m.content); } }
  closeHistory();
}

// ─────────────────────────────────────────── send
async function send(text) {
  if (!text || !text.trim() || state.busy) return;
  const model = currentModel();
  if (!model) { addMessage("assistant", t("chat.noModel")); return; }
  if (state.mode === "connected" && !state.connected) { addMessage("assistant", t("chat.offline")); return; }
  if (!state.conv) startNewConversation();
  state.busy = true; state.abort = new AbortController(); updateSendEnabled();
  addMessage("user", text);
  state.conv.messages.push({ role: "user", content: text });

  const bodyEl = addMessage("assistant", "");
  let acc = "";
  try {
    if (state.mode === "connected") acc = await sendConnected(bodyEl, state.abort.signal);
    else acc = await sendStandalone(bodyEl, state.abort.signal);
  } catch (e) {
    const aborted = e && (e.name === "AbortError" || String(e).toLowerCase().includes("abort"));
    acc = bodyEl.textContent || acc;
    if (!aborted) acc = (acc ? acc + "\n\n" : "") + "⚠ " + (e && e.message ? e.message : e);
    else if (!acc) acc = "⏹";
    bodyEl.textContent = acc;
  }
  let display = acc;
  if (state.agentEnabled && NA && acc) {
    const parsed = NA.parseActions(acc);
    if (parsed.actions.length) { display = parsed.clean || acc; renderActionCards(bodyEl, parsed.actions); }
  }
  bodyEl.setAttribute("data-raw", display);
  renderCitations(bodyEl, display);
  state.conv.messages.push({ role: "assistant", content: display });
  await persistConv();
  state.busy = false; state.abort = null; updateSendEnabled();
}

async function sendConnected(bodyEl, signal) {
  const ctx = NS.getContext();
  const payload = {
    model: state.model,
    messages: state.conv.messages.map((m) => ({ role: m.role, content: m.content })),
    context: { zoteroKey: state.item ? state.item.key : "", doi: state.item ? state.item.doi : "", title: state.item ? state.item.title : "", selection: state.selection || "", useIdeas: ctx.useIdeas, useCorpus: ctx.useCorpus, agentInstructions: state.agentEnabled && NA ? NA.SYSTEM : "" },
  };
  if (ctx.useFulltext) { const d = await getDocumentText(); if (d) payload.context.documentText = d; }
  const res = await api("/api/z/chat/stream", { method: "POST", body: JSON.stringify(payload), signal });
  if (!res.ok || !res.body) throw new Error("HTTP " + res.status);
  let acc = ""; const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1); if (!line) continue;
      let o; try { o = JSON.parse(line); } catch (e) { continue; }
      if (o.type === "delta") { acc += o.text; bodyEl.textContent = acc; }
      else if (o.type === "meta" && Array.isArray(o.ideas)) o.ideas.forEach((i) => (state.ideaLabels[i.globalId] = i.label));
      else if (o.type === "error") { acc += "\n[error] " + o.error; bodyEl.textContent = acc; }
      messagesEl().scrollTop = messagesEl().scrollHeight;
    }
  }
  return acc;
}

async function sendStandalone(bodyEl, signal) {
  const ctx = NS.getContext();
  const parts = [];
  if (state.item && state.item.title) parts.push("Open document: " + state.item.title);
  if (state.selection) parts.push('The user highlighted this passage (focus on it):\n"""\n' + state.selection + '\n"""');
  if (ctx.useFulltext) { const d = await getDocumentText(); if (d) parts.push('Document text:\n"""\n' + d.slice(0, 60000) + '\n"""'); }
  let system = "You are a research assistant embedded in Zotero. Answer about the open document, grounded in the provided text. Be concise and answer in the user's language.\n\n" + parts.join("\n\n");
  if (state.agentEnabled && NA) system += "\n\n" + NA.SYSTEM;
  const key = NS.getKey(state.model.provider);
  const localBase = NS.getLocalBase(state.model.provider);
  let acc = "";
  await NP.chatStream(state.model, {
    system, key, localBase,
    messages: state.conv.messages.map((m) => ({ role: m.role, content: m.content })),
  }, (delta) => { acc += delta; bodyEl.textContent = acc; messagesEl().scrollTop = messagesEl().scrollHeight; }, signal);
  return acc;
}

// ─────────────────────────────────────────── providers tab
async function renderProviders() {
  const wrap = $("#nd-providers"); wrap.innerHTML = "";
  for (const p of NP.PROVIDERS) {
    if (p.subscription) {
      const card = el("div", "nd-prov");
      const head = el("div", "nd-prov-head");
      head.appendChild(el("span", "nd-prov-dot"));
      head.appendChild(el("span", "nd-prov-name", p.label));
      head.appendChild(el("span", "nd-badge nd-badge--no", "Link"));
      card.appendChild(head);
      card.appendChild(el("div", "nd-prov-note nd-muted", t(p.note === "codex" ? "providers.subCodex" : "providers.sub")));
      wrap.appendChild(card);
      continue;
    }
    const card = el("div", "nd-prov");
    const head = el("div", "nd-prov-head");
    const dot = el("span", "nd-prov-dot" + ((p.needsKey ? NS.getKey(p.id) : true) ? " nd-prov-dot--on" : ""));
    const name = el("span", "nd-prov-name", p.label);
    const count = el("span", "nd-muted", String(NS.getPinned().filter((m) => m.provider === p.id).length || ""));
    head.appendChild(dot); head.appendChild(name); head.appendChild(count);
    const body = el("div", "nd-prov-body");
    // key or base URL
    const inp = el("input"); inp.type = p.needsKey ? "password" : "text";
    inp.placeholder = p.needsKey ? t("providers.key") : t("providers.baseUrl") + " (" + (p.defaultBase || "") + ")";
    inp.value = p.needsKey ? NS.getKey(p.id) : NS.getLocalBase(p.id);
    inp.addEventListener("change", () => { if (p.needsKey) NS.setKey(p.id, inp.value.trim()); else NS.setLocalBase(p.id, inp.value.trim()); dot.className = "nd-prov-dot" + ((p.needsKey ? inp.value.trim() : true) ? " nd-prov-dot--on" : ""); });
    const actions = el("div", "nd-prov-actions");
    const loadBtn = el("button", "nd-btn-ghost", t("providers.load"));
    const modelsBox = el("div", "nd-prov-models");
    loadBtn.addEventListener("click", async () => {
      loadBtn.textContent = t("providers.loading"); loadBtn.disabled = true;
      try {
        const ids = await NP.listModels(p.id, { key: NS.getKey(p.id), localBase: NS.getLocalBase(p.id) });
        modelsBox.innerHTML = "";
        for (const id of ids) modelsBox.appendChild(modelRow(p.id, id, count));
      } catch (e) { modelsBox.innerHTML = ""; modelsBox.appendChild(el("div", "nd-muted", String(e.message || e))); }
      finally { loadBtn.textContent = t("providers.load"); loadBtn.disabled = false; }
    });
    actions.appendChild(loadBtn);
    body.appendChild(inp); body.appendChild(actions); body.appendChild(modelsBox);
    head.addEventListener("click", (e) => { if (e.target === inp) return; body.classList.toggle("nd-prov-body--open"); });
    card.appendChild(head); card.appendChild(body); wrap.appendChild(card);
  }
}
function modelRow(provider, id, countEl) {
  const row = el("div", "nd-model-row");
  const ref = { provider, model: id };
  const star = el("span", "nd-star" + (NS.isPinned(ref) ? " nd-star--on" : ""), "★");
  star.addEventListener("click", () => {
    NS.togglePinned(ref);
    star.className = "nd-star" + (NS.isPinned(ref) ? " nd-star--on" : "");
    if (countEl) countEl.textContent = String(NS.getPinned().filter((m) => m.provider === provider).length || "");
    if (state.mode === "standalone") loadModelsForMode();
  });
  row.appendChild(star); row.appendChild(el("span", "nd-model-id", id));
  return row;
}

// ─────────────────────────────────────────── history + modal
function openHistory() { renderHistory(""); $("#nd-history").hidden = false; $("#nd-history-search").value = ""; $("#nd-history-search").focus(); }
function closeHistory() { $("#nd-history").hidden = true; }
function renderHistory(filter) {
  const list = $("#nd-history-list"); list.innerHTML = "";
  const f = (filter || "").toLowerCase();
  const items = state.conversations
    .filter((c) => !f || (c.title || "").toLowerCase().includes(f) || c.messages.some((m) => m.content.toLowerCase().includes(f)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (!items.length) { list.appendChild(el("div", "nd-muted", t("history.empty"))); return; }
  for (const c of items) {
    const row = el("div", "nd-conv");
    const main = el("div", "nd-conv-main");
    main.appendChild(el("div", "nd-conv-title", c.title || "Conversation"));
    main.appendChild(el("div", "nd-conv-meta", new Date(c.updatedAt).toLocaleString() + " · " + (c.mode === "standalone" ? t("mode.standalone") : t("mode.linkTag"))));
    main.addEventListener("click", () => loadConversation(c.id));
    const del = el("span", "nd-conv-del", "🗑");
    del.addEventListener("click", async (e) => { e.stopPropagation(); if (await showConfirm(t("modal.delOne"))) { state.conversations = state.conversations.filter((x) => x.id !== c.id); await NS.saveConversations(state.conversations); if (state.conv && state.conv.id === c.id) startNewConversation(); renderHistory($("#nd-history-search").value); } });
    row.appendChild(main); row.appendChild(del); list.appendChild(row);
  }
}
function showConfirm(msg, okLabel) {
  return new Promise((resolve) => {
    $("#nd-modal-msg").textContent = msg; $("#nd-modal").hidden = false;
    const ok = $("#nd-modal-ok"), cancel = $("#nd-modal-cancel");
    ok.textContent = okLabel || t("modal.delete");
    const done = (v) => { $("#nd-modal").hidden = true; ok.onclick = null; cancel.onclick = null; ok.textContent = t("modal.delete"); resolve(v); };
    ok.onclick = () => done(true); cancel.onclick = () => done(false);
  });
}

// ─────────────────────────────────────────── agent mode
function setAgentEnabled(on, announce) {
  state.agentEnabled = !!on; NS.setAgent(state.agentEnabled);
  const cb = $("#nd-agent"); if (cb) cb.checked = state.agentEnabled;
  const btn = $("#nd-agent-btn"); if (btn) { btn.classList.toggle("nd-iconbtn--active", state.agentEnabled); btn.title = t("agent.mode") + (state.agentEnabled ? " ✓" : ""); }
  if (announce) showToast(t(state.agentEnabled ? "agent.on" : "agent.off"));
}
function renderActionCards(bodyEl, actions) {
  const wrap = bodyEl.parentNode;
  for (const action of actions) {
    const card = el("div", "nd-action");
    card.appendChild(el("div", "nd-action-desc", "🛠 " + NA.describe(action, t)));
    if (state.agentAuto) { runAction(action, card); }
    else {
      const btns = el("div", "nd-action-btns");
      const allow = el("button", "nd-action-allow", t("agent.allow"));
      const deny = el("button", "nd-btn-ghost", t("agent.deny"));
      allow.onclick = () => { btns.remove(); runAction(action, card); };
      deny.onclick = () => { btns.remove(); card.appendChild(el("div", "nd-action-status nd-muted", t("agent.denied"))); };
      btns.appendChild(allow); btns.appendChild(deny); card.appendChild(btns);
    }
    wrap.appendChild(card);
  }
  messagesEl().scrollTop = messagesEl().scrollHeight;
}
async function runAction(action, card) {
  const status = el("div", "nd-action-status", t("agent.acting")); card.appendChild(status);
  const cur = getCurrentItem();
  const res = await NA.execute(action, { item: cur.item, attachment: cur.attachment, selectionDraft: state.selectionDraft });
  status.className = "nd-action-status " + (res.ok ? "nd-action-ok" : "nd-action-err");
  status.textContent = res.ok ? okMsg(action) : (t("agent.fail") + (res.message ? " — " + friendlyErr(res.message) : ""));
}
function okMsg(a) { return a.tool === "create_note" ? t("agent.ok.note") : a.tool === "highlight" ? t("agent.ok.highlight") : a.tool === "add_tags" ? t("agent.ok.tags") : "✓"; }
function friendlyErr(m) { return (m === "no-selection" || m === "no-attachment") ? t("agent.needSel") : m; }

// ─────────────────────────────────────────── mode + i18n + wiring
function renderMode() {
  $("#nd-mode-pill").textContent = state.mode === "standalone" ? t("mode.standalone") : t("mode.linkTag");
  $$("#nd-mode-seg .nd-seg-btn").forEach((b) => b.classList.toggle("nd-seg-btn--active", b.getAttribute("data-mode") === state.mode));
  $("#nd-mode-hint").textContent = state.mode === "standalone" ? t("mode.hint.standalone") : t("mode.hint.connected");
  const standalone = state.mode === "standalone";
  const provTab = document.querySelector('.nd-tab[data-tab="providers"]');
  if (provTab) provTab.classList.toggle("nd-tab--disabled", !standalone);
  if (!standalone) { const p = document.querySelector('.nd-panel[data-panel="providers"]'); if (p && p.classList.contains("nd-panel--active")) switchTab("chat"); }
  $$("[data-nodus-only]").forEach((n) => (n.style.display = standalone ? "none" : ""));
  $$("[data-nodus-only-hint]").forEach((n) => (n.hidden = !standalone));
  if (standalone) { $("#nd-ctx-ideas").checked = false; $("#nd-ctx-corpus").checked = false; }
  renderConn();
  renderPromptMenu();
}
async function setMode(m) {
  state.mode = m === "standalone" ? "standalone" : "connected"; NS.setMode(state.mode);
  renderMode();
  await connect();
  await loadModelsForMode();
  startNewConversation();
}
function applyI18n() {
  $$("[data-i18n]").forEach((n) => (n.textContent = t(n.getAttribute("data-i18n"))));
  $$("[data-i18n-ph]").forEach((n) => n.setAttribute("placeholder", t(n.getAttribute("data-i18n-ph"))));
  $$("[data-i18n-title]").forEach((n) => n.setAttribute("title", t(n.getAttribute("data-i18n-title"))));
  renderPromptMenu();
}
function promptDefs() {
  const defs = [];
  if (state.selection) defs.push(["prompt.selection", "p.selection"]);
  defs.push(["prompt.summary", "p.summary"], ["prompt.ideas", "p.ideas"], ["prompt.thesis", "p.thesis"],
    ["prompt.quotes", "p.quotes"], ["prompt.methodology", "p.methodology"], ["prompt.critique", "p.critique"],
    ["prompt.terms", "p.terms"], ["prompt.simple", "p.simple"], ["prompt.gaps", "p.gaps"], ["prompt.contributions", "p.contributions"]);
  if (state.mode === "connected") { defs.push(["prompt.connections", "p.connections"], ["prompt.compare", "p.compare"]); }
  return defs;
}
// Rebuilds the prompt-template dropdown. Clicking an item INSERTS the prompt into
// the composer (does not send), per the requested UX.
function renderPromptMenu() {
  const menu = $("#nd-prompt-menu"); if (!menu) return; menu.innerHTML = "";
  for (const [lk, pk] of promptDefs()) {
    const item = el("div", "nd-menu-item");
    item.appendChild(el("div", "nd-menu-title", t(lk)));
    item.appendChild(el("div", "nd-menu-sub", t(pk)));
    item.onclick = () => { insertPrompt(t(pk)); togglePromptMenu(false); };
    menu.appendChild(item);
  }
}
function insertPrompt(text) {
  const inp = $("#nd-input");
  inp.value = inp.value && inp.value.trim() ? inp.value.replace(/\s+$/, "") + "\n" + text : text;
  inp.focus();
}
function togglePromptMenu(show) {
  const menu = $("#nd-prompt-menu");
  const willShow = show === undefined ? menu.hidden : show;
  if (willShow) renderPromptMenu();
  menu.hidden = !willShow;
}
function showSelection() {
  const box = $("#nd-selection");
  if (!state.selection) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false; box.innerHTML = "";
  const clr = el("span", "nd-conv-del", "✕ " + t("sel.clear")); clr.style.float = "right"; clr.onclick = () => { state.selection = ""; showSelection(); renderPromptMenu(); };
  box.appendChild(clr); box.appendChild(el("div", null, "“" + state.selection.slice(0, 400) + (state.selection.length > 400 ? "…" : "") + "”"));
}
let toastTimer = null;
function showToast(msg) {
  let box = document.getElementById("nd-toast");
  if (!box) { box = el("div", "nd-toast"); box.id = "nd-toast"; document.getElementById("nodus-app").appendChild(box); }
  box.textContent = msg; box.classList.add("nd-toast--show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("nd-toast--show"), 4500);
}
function switchTab(name) {
  // Providers only make sense in Standalone mode; in Link mode models come from Nodus.
  if (name === "providers" && state.mode !== "standalone") { showToast(t("providers.linkedMsg")); return; }
  $$(".nd-tab").forEach((b) => b.classList.toggle("nd-tab--active", b.getAttribute("data-tab") === name));
  $$(".nd-panel").forEach((p) => p.classList.toggle("nd-panel--active", p.getAttribute("data-panel") === name));
  if (name === "providers") renderProviders();
}

function wire() {
  $("#nd-logo").innerHTML = '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lg" x1="14" y1="10" x2="50" y2="54" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ddd6fe"/><stop offset=".45" stop-color="#a78bfa"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><path d="M18 48V16L46 48V16" fill="none" stroke="url(#lg)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18" cy="16" r="6.5" fill="#ddd6fe"/><circle cx="18" cy="48" r="6.5" fill="#a78bfa"/><circle cx="46" cy="48" r="6.5" fill="#8b5cf6"/><circle cx="46" cy="16" r="6.5" fill="#7c3aed"/></svg>';
  $$(".nd-tab").forEach((b) => b.addEventListener("click", () => switchTab(b.getAttribute("data-tab"))));
  $$("#nd-mode-seg .nd-seg-btn").forEach((b) => b.addEventListener("click", () => setMode(b.getAttribute("data-mode"))));
  $("#nd-send").addEventListener("click", () => { const v = $("#nd-input").value; $("#nd-input").value = ""; send(v); });
  $("#nd-stop").addEventListener("click", stopStreaming);
  $("#nd-close").addEventListener("click", closeSidebar);
  $("#nd-prompt-btn").addEventListener("click", () => togglePromptMenu());
  $("#nd-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); const v = $("#nd-input").value; $("#nd-input").value = ""; send(v); } });
  // dismiss the prompt menu on outside click
  document.addEventListener("click", (e) => { const menu = $("#nd-prompt-menu"); if (!menu || menu.hidden) return; if (!menu.contains(e.target) && e.target.id !== "nd-prompt-btn") togglePromptMenu(false); });
  $("#nd-model").addEventListener("change", (e) => { const [p, m] = e.target.value.split("::"); state.model = p && m ? { provider: p, model: m } : null; NS.setModel(state.mode, state.model); updateSendEnabled(); });
  $("#nd-lang").addEventListener("change", (e) => { state.lang = e.target.value === "es" ? "es" : "en"; NS.setLang(state.lang); applyI18n(); renderMode(); });
  $("#nd-new").addEventListener("click", () => startNewConversation());
  $("#nd-history-btn").addEventListener("click", openHistory);
  $("#nd-history-close").addEventListener("click", closeHistory);
  $("#nd-history-search").addEventListener("input", (e) => renderHistory(e.target.value));
  $("#nd-history-clear").addEventListener("click", async () => { if (await showConfirm(t("modal.delAll"))) { state.conversations = []; await NS.saveConversations([]); startNewConversation(); renderHistory(""); } });
  $("#nd-ctx-fulltext").addEventListener("change", saveContext);
  $("#nd-ctx-ideas").addEventListener("change", saveContext);
  $("#nd-ctx-corpus").addEventListener("change", saveContext);
  $("#nd-test").addEventListener("click", () => { NS.setManual($("#nd-port").value, $("#nd-token").value.trim()); connect().then(loadModelsForMode); });
  window.addEventListener("message", (e) => { if (e.data && e.data.type === "nodus-selection") { state.selection = String(e.data.text || ""); state.selectionDraft = e.data.draft || null; switchTab("chat"); showSelection(); renderPromptMenu(); } });
  $("#nd-agent-btn").addEventListener("click", () => setAgentEnabled(!state.agentEnabled, true));
  $("#nd-agent").addEventListener("change", (e) => setAgentEnabled(e.target.checked, true));
  $("#nd-agent-auto").addEventListener("change", async (e) => {
    if (e.target.checked) { const ok = await showConfirm(t("agent.autoConfirm"), t("agent.enable")); if (!ok) { e.target.checked = false; return; } }
    state.agentAuto = e.target.checked; NS.setAgentAuto(state.agentAuto);
  });
  setInterval(() => { refreshItem(false).catch(() => {}); }, 1200);
}
function saveContext() { NS.setContext({ useFulltext: $("#nd-ctx-fulltext").checked, useIdeas: $("#nd-ctx-ideas").checked, useCorpus: $("#nd-ctx-corpus").checked }); }

async function boot() {
  state.mode = NS.getMode(); state.lang = NS.getLang();
  const ctx = NS.getContext();
  wire();
  $("#nd-lang").value = state.lang;
  const m = NS.getManual(); $("#nd-port").value = m.port || ""; $("#nd-token").value = m.token || "";
  $("#nd-ctx-fulltext").checked = ctx.useFulltext; $("#nd-ctx-ideas").checked = ctx.useIdeas; $("#nd-ctx-corpus").checked = ctx.useCorpus;
  state.agentEnabled = NS.getAgent(); state.agentAuto = NS.getAgentAuto();
  $("#nd-agent").checked = state.agentEnabled; $("#nd-agent-auto").checked = state.agentAuto;
  $("#nd-agent-btn").classList.toggle("nd-iconbtn--active", state.agentEnabled);
  applyI18n();
  renderMode();
  state.conversations = await NS.loadConversations();
  startNewConversation();
  await connect();
  await loadModelsForMode();
  await refreshItem(true);
}
boot().catch((e) => { try { Zotero.logError(e); } catch (x) {} });
