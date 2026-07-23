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
const NM = window.NodusMarkdown;
const NU = window.NodusUtil;
const NH = window.NodusHighlighter;
const NI = window.NodusIcons;
const ico = (name, size) => (NI ? NI.svg(name, { size: size || 16 }) : "");

// Full-document context cap (~50k tokens): big enough for most modern models,
// with a visible warning + head/tail sampling when a work is longer. See
// NodusUtil.sampleDocText.
const DOC_CHAR_LIMIT = 200000;
// Animated "typing" indicator shown in the assistant bubble until the first token
// arrives (the streaming code replaces it via textContent on the first delta).
const TYPING_HTML = '<span class="nd-typing" aria-label="…"><span class="nd-typing-dot"></span><span class="nd-typing-dot"></span><span class="nd-typing-dot"></span></span>';

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
    "modal.cancel": "Cancel", "modal.delete": "Delete", "modal.close": "Close",
    "modal.save": "Save", "modal.highlight": "Highlight", "modal.enable": "Enable",
    "confirm.saveNote": "Save this conversation as a note in Zotero?",
    "confirm.highlight": "Analyze the whole document and highlight its most important passages? Highlights are added to the PDF and can be undone.",
    "confirm.agentOn": "Enable Agent mode? Nodus will be able to act on your Zotero library (create notes, highlight, tag). Each action still asks for approval unless auto-approve is on.",
    "modal.delOne": "Delete this conversation? This cannot be undone.", "modal.delAll": "Delete ALL conversations? This cannot be undone.",
    "conn.on": "Connected", "conn.off": "Not connected",
    "conn.detailOn": "Connected to Nodus on port", "conn.detailOff": "Nodus server not found. Enable it in Nodus → Settings → Nodus for Zotero.",
    "item.none": "Select a document in Zotero.", "item.analyzed": "Full analysis in Nodus", "item.notAnalyzed": "Not analyzed in Nodus", "item.ideas": "ideas",
    "prompt.summary": "Summary", "prompt.ideas": "Main ideas", "prompt.connections": "Connections", "prompt.selection": "Explain selection", "prompt.quotes": "Key quotes",
    "p.summary": "Summarize this document.", "p.ideas": "What are the main ideas of this document?",
    "p.explainSel": "Explain the selected passage in detail: what it means, its significance in the context of this document, and define any key terms or concepts it uses.",
    "p.connections": "Which items in my library connect to this one, and how?", "p.selection": "Explain the selected passage and its significance.",
    "p.quotes": "Give the key quotes, with their page numbers when the document has them.",
    "close": "Close", "chat.prompts": "Prompt templates", "chat.stop": "Stop",
    "prompt.addNew": "Add a prompt", "prompt.newTitle": "New prompt", "prompt.titlePh": "Title", "prompt.textPh": "Prompt text…",
    "prompt.del": "Delete prompt", "prompt.untitled": "Untitled", "prompt.needBoth": "Add a title and prompt text.", "prompt.saved": "Prompt saved.",
    "prompt.delConfirm": "Delete this prompt? This cannot be undone.",
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
    "agent.desc.collection": "Add this item to a collection", "agent.desc.field": "Set a field on this item", "agent.desc.extract": "Create a note from the PDF annotations",
    "agent.ok.note": "Note created ✓", "agent.ok.highlight": "Highlighted ✓", "agent.ok.tags": "Tags added ✓",
    "agent.ok.collection": "Added to collection ✓", "agent.ok.field": "Field updated ✓", "agent.ok.extract": "Note from annotations ✓",
    "agent.err.badField": "That field can't be edited from here.", "agent.err.noAnnotations": "No annotations in this PDF yet.", "agent.err.noName": "No collection name given.",
    "agent.fail": "Couldn't complete", "agent.needSel": "Select text in the reader first, then ask again.",
    "chat.saveNote": "Save chat as note", "note.saved": "Chat saved as a Zotero note ✓", "note.empty": "Nothing to save yet — start a conversation first.",
    "settings.maxTokens": "Max response length", "settings.maxTokensHint": "Maximum tokens the model may generate per reply. Higher = longer answers.",
    "doc.truncated": "⚠ This document is long — only ~{pct}% was sent to the model ({sent} of {total} characters, beginning + end).",
    "item.multi": "{n} documents selected",
    "msg.copy": "Copy", "msg.edit": "Edit & resend", "msg.regenerate": "Regenerate",
    "reasoning.title": "Thinking / reasoning effort (if the model supports it)",
    "reasoning.default": "Auto", "reasoning.off": "Off", "reasoning.low": "Low", "reasoning.medium": "Medium", "reasoning.high": "High",
    "hl.btn": "Auto-highlight the document", "hl.title": "Auto-highlight colors", "hl.high": "Very important", "hl.medium": "Important",
    "hl.hint": "Open the PDF in Zotero's reader, then press 🖍️ to highlight the most important passages (red = very important, yellow = important).",
    "hl.analyzing": "Reading the document and highlighting the most important passages…",
    "hl.noReader": "Open the document in Zotero's PDF reader first, then press 🖍️ again.",
    "hl.noText": "Couldn't read the document text.", "hl.noPassages": "The model didn't return any passages to highlight.",
    "hl.result": "🖍️ Highlighted {n} passages — {high} very important (red), {medium} important (yellow).",
    "hl.missed": "{n} couldn't be located in the PDF and were skipped.",
    "hl.revert": "Undo highlights", "hl.reverted": "Highlights removed.",
    "model.search": "Search models…", "model.pinHint": "— pin models in Providers —", "model.noMatch": "No models match.",
    "prov.delKey": "Remove API key", "prov.delKeyConfirm": "Remove the saved {provider} API key? This can't be undone.",
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
    "modal.cancel": "Cancelar", "modal.delete": "Eliminar", "modal.close": "Cerrar",
    "modal.save": "Guardar", "modal.highlight": "Subrayar", "modal.enable": "Activar",
    "confirm.saveNote": "¿Guardar esta conversación como nota en Zotero?",
    "confirm.highlight": "¿Analizar todo el documento y subrayar sus pasajes más importantes? Los subrayados se añaden al PDF y se pueden deshacer.",
    "confirm.agentOn": "¿Activar el modo Agente? Nodus podrá actuar sobre tu biblioteca de Zotero (crear notas, subrayar, etiquetar). Cada acción pide aprobación salvo que la aprobación automática esté activada.",
    "modal.delOne": "¿Eliminar esta conversación? No se puede deshacer.", "modal.delAll": "¿Eliminar TODAS las conversaciones? No se puede deshacer.",
    "conn.on": "Conectado", "conn.off": "Sin conexión",
    "conn.detailOn": "Conectado a Nodus en el puerto", "conn.detailOff": "No se encontró el servidor de Nodus. Actívalo en Nodus → Ajustes → Nodus para Zotero.",
    "item.none": "Selecciona un documento en Zotero.", "item.analyzed": "Análisis completo en Nodus", "item.notAnalyzed": "Sin analizar en Nodus", "item.ideas": "ideas",
    "prompt.summary": "Resumen", "prompt.ideas": "Ideas principales", "prompt.connections": "Conexiones", "prompt.selection": "Explicar selección", "prompt.quotes": "Citas clave",
    "p.summary": "Haz un resumen de este documento.", "p.ideas": "¿Cuáles son las ideas principales de este documento?",
    "p.explainSel": "Explica en detalle el pasaje seleccionado: qué significa, su relevancia en el contexto de este documento, y define los términos o conceptos clave que usa.",
    "p.connections": "¿Qué ítems de mi biblioteca conectan con este y cómo?", "p.selection": "Explica el pasaje seleccionado y su relevancia.",
    "p.quotes": "Dame las citas clave, con su número de página cuando el documento lo tenga.",
    "close": "Cerrar", "chat.prompts": "Plantillas de prompt", "chat.stop": "Detener",
    "prompt.addNew": "Añadir un prompt", "prompt.newTitle": "Nuevo prompt", "prompt.titlePh": "Título", "prompt.textPh": "Texto del prompt…",
    "prompt.del": "Eliminar prompt", "prompt.untitled": "Sin título", "prompt.needBoth": "Añade un título y el texto del prompt.", "prompt.saved": "Prompt guardado.",
    "prompt.delConfirm": "¿Eliminar este prompt? No se puede deshacer.",
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
    "agent.desc.collection": "Añadir este ítem a una colección", "agent.desc.field": "Fijar un campo de este ítem", "agent.desc.extract": "Crear una nota con las anotaciones del PDF",
    "agent.ok.note": "Nota creada ✓", "agent.ok.highlight": "Subrayado ✓", "agent.ok.tags": "Etiquetas añadidas ✓",
    "agent.ok.collection": "Añadido a la colección ✓", "agent.ok.field": "Campo actualizado ✓", "agent.ok.extract": "Nota con anotaciones ✓",
    "agent.err.badField": "Ese campo no se puede editar desde aquí.", "agent.err.noAnnotations": "Este PDF aún no tiene anotaciones.", "agent.err.noName": "No se indicó el nombre de la colección.",
    "agent.fail": "No se pudo completar", "agent.needSel": "Selecciona texto en el lector primero y vuelve a pedirlo.",
    "chat.saveNote": "Guardar chat como nota", "note.saved": "Chat guardado como nota de Zotero ✓", "note.empty": "Aún no hay nada que guardar — empieza una conversación.",
    "settings.maxTokens": "Longitud máxima de respuesta", "settings.maxTokensHint": "Tokens máximos que el modelo puede generar por respuesta. Más = respuestas más largas.",
    "doc.truncated": "⚠ Documento largo — solo se envió ~{pct}% al modelo ({sent} de {total} caracteres, principio + final).",
    "item.multi": "{n} documentos seleccionados",
    "msg.copy": "Copiar", "msg.edit": "Editar y reenviar", "msg.regenerate": "Regenerar",
    "reasoning.title": "Razonamiento / esfuerzo de pensamiento (si el modelo lo permite)",
    "reasoning.default": "Auto", "reasoning.off": "No", "reasoning.low": "Bajo", "reasoning.medium": "Medio", "reasoning.high": "Alto",
    "hl.btn": "Auto-subrayar el documento", "hl.title": "Colores de auto-subrayado", "hl.high": "Muy importante", "hl.medium": "Importante",
    "hl.hint": "Abre el PDF en el lector de Zotero y pulsa 🖍️ para subrayar los pasajes más importantes (rojo = muy importante, amarillo = importante).",
    "hl.analyzing": "Leyendo el documento y subrayando los pasajes más importantes…",
    "hl.noReader": "Abre primero el documento en el lector de PDF de Zotero y vuelve a pulsar 🖍️.",
    "hl.noText": "No se pudo leer el texto del documento.", "hl.noPassages": "El modelo no devolvió pasajes para subrayar.",
    "hl.result": "🖍️ Subrayados {n} pasajes — {high} muy importantes (rojo), {medium} importantes (amarillo).",
    "hl.missed": "{n} no se pudieron localizar en el PDF y se omitieron.",
    "hl.revert": "Deshacer subrayados", "hl.reverted": "Subrayados eliminados.",
    "model.search": "Buscar modelos…", "model.pinHint": "— fija modelos en Proveedores —", "model.noMatch": "Ningún modelo coincide.",
    "prov.delKey": "Eliminar API key", "prov.delKeyConfirm": "¿Eliminar la API key guardada de {provider}? No se puede deshacer.",
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
  items: [], maxTokens: 8192, reasoning: "default", notifierID: null, pollTimer: null,
  hlColors: { high: "#ff6666", medium: "#ffd400" }, lastHighlightKeys: [],
};

const t = (k) => (I18N[state.lang] && I18N[state.lang][k]) || I18N.en[k] || k;
// t() with {placeholder} interpolation.
const tf = (k, params) => t(k).replace(/\{(\w+)\}/g, (m, p) => (params && params[p] != null ? String(params[p]) : m));
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
  const chosen = models.find((m) => saved && m.provider === saved.provider && m.model === saved.model) || models[0] || null;
  state.model = chosen;
  renderModelDropdown();
  updateSendEnabled();
}

// Custom searchable model dropdown (replaces the native <select>).
function modelBtnLabel() {
  return state.model ? state.model.model : (state.mode === "standalone" ? t("model.pinHint") : "—");
}
function renderModelDropdown() {
  const label = $("#nd-model-label"); if (label) label.textContent = modelBtnLabel();
  const list = $("#nd-model-list"); if (!list) return;
  list.innerHTML = "";
  const models = availableModels();
  const filter = (($("#nd-model-search") && $("#nd-model-search").value) || "").toLowerCase();
  if (!models.length) { list.appendChild(el("div", "nd-dd-empty", t("model.pinHint"))); return; }
  let shown = 0;
  for (const m of models) {
    const labelStr = m.model + " · " + m.provider;
    if (filter && labelStr.toLowerCase().indexOf(filter) < 0) continue;
    const sel = state.model && state.model.provider === m.provider && state.model.model === m.model;
    const it = el("div", "nd-dd-item" + (sel ? " nd-dd-item--sel" : ""));
    it.appendChild(el("span", "nd-dd-model", m.model));
    it.appendChild(el("span", "nd-dd-prov", m.provider));
    it.addEventListener("click", () => {
      state.model = { provider: m.provider, model: m.model };
      NS.setModel(state.mode, state.model);
      closeModelMenu(); renderModelDropdown(); updateSendEnabled();
    });
    list.appendChild(it); shown++;
  }
  if (!shown) list.appendChild(el("div", "nd-dd-empty", t("model.noMatch")));
}
function openModelMenu() { const m = $("#nd-model-menu"); if (!m) return; m.hidden = false; const s = $("#nd-model-search"); if (s) { s.value = ""; } renderModelDropdown(); if (s) s.focus(); }
function closeModelMenu() { const m = $("#nd-model-menu"); if (m) m.hidden = true; }
function toggleModelMenu() { const m = $("#nd-model-menu"); if (!m) return; if (m.hidden) openModelMenu(); else closeModelMenu(); }

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
// Info for every item currently selected in the library (for multi-item chat).
// Regular items only; a single reader tab is handled by getCurrentItem.
function getSelectedItemInfos() {
  try {
    const w = Zotero.getMainWindow();
    const zp = (w && w.ZoteroPane) || (Zotero.getActiveZoteroPane && Zotero.getActiveZoteroPane());
    const sel = zp && zp.getSelectedItems ? zp.getSelectedItems() : [];
    const infos = [];
    for (let it of sel || []) {
      if (it.isAttachment && it.isAttachment()) { if (it.parentItem) it = it.parentItem; else continue; }
      if (it.isNote && it.isNote()) continue;
      const info = { key: it.key };
      try { info.title = it.getDisplayTitle ? it.getDisplayTitle() : it.getField("title"); } catch (e) {}
      try { info.year = it.getField("date") ? String(it.getField("date")).slice(0, 4) : ""; } catch (e) {}
      try { info.creators = it.getField("firstCreator") || ""; } catch (e) {}
      try { info.abstract = it.getField("abstractNote") || ""; } catch (e) {}
      infos.push(info);
    }
    return infos;
  } catch (e) { return []; }
}
async function refreshItem(force) {
  const cur = getCurrentItem();
  const key = cur.item ? cur.item.key : null;
  // Track multi-selection independently of the single focused item.
  state.items = cur.reader ? [] : getSelectedItemInfos();
  const multiKey = state.items.length > 1 ? state.items.map((i) => i.key).join(",") : key;
  if (!force && multiKey === state.lastItemKey) return;
  state.lastItemKey = multiKey;
  const box = $("#nd-item");
  if (state.items.length > 1) {
    state.item = null; state.attachmentKey = null;
    box.innerHTML = "";
    box.appendChild(el("div", "nd-item-title", tf("item.multi", { n: state.items.length })));
    const names = state.items.slice(0, 6).map((i) => i.title || i.key).join(" · ") + (state.items.length > 6 ? " …" : "");
    box.appendChild(el("div", "nd-muted", names));
    return;
  }
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
    // Return the raw text (bounded to keep memory sane); send() then head/tail-
    // samples it to DOC_CHAR_LIMIT and warns the user if it had to trim.
    if (att) { const text = await att.attachmentText; if (text) return String(text).slice(0, 2000000); }
  } catch (e) {}
  return "";
}

// ─────────────────────────────────────────── messages + citations
const messagesEl = () => $("#nd-messages");
// `index` is the message's position in state.conv.messages; when given, a small
// action row (copy · edit/regenerate) is attached. Streaming/transient bubbles
// pass no index and get their actions attached on completion.
function addMessage(role, text, index) {
  const wrap = el("div", "nd-msg nd-msg--" + role);
  wrap.appendChild(el("div", "nd-who", role === "user" ? t("you") : t("nodus")));
  const body = el("div", "nd-body"); body.textContent = text; wrap.appendChild(body);
  if (index != null) attachMessageActions(wrap, role, index, text);
  const hint = messagesEl().querySelector(".nd-hint"); if (hint) hint.remove();
  messagesEl().appendChild(wrap); messagesEl().scrollTop = messagesEl().scrollHeight;
  return body;
}
function attachMessageActions(wrap, role, index, rawText) {
  const row = el("div", "nd-msg-actions");
  const copy = el("button", "nd-msg-act"); copy.innerHTML = ico("copy", 14); copy.title = t("msg.copy");
  copy.addEventListener("click", () => { if (copyToClipboard(rawText)) { copy.innerHTML = ico("check", 14); setTimeout(() => { copy.innerHTML = ico("copy", 14); }, 1200); } });
  row.appendChild(copy);
  if (role === "user") {
    const edit = el("button", "nd-msg-act"); edit.innerHTML = ico("pencil", 14); edit.title = t("msg.edit");
    edit.addEventListener("click", () => editUserMessage(index));
    row.appendChild(edit);
  } else {
    const regen = el("button", "nd-msg-act"); regen.innerHTML = ico("refresh", 14); regen.title = t("msg.regenerate");
    regen.addEventListener("click", () => { regenerateFrom(index).catch((e) => { try { Zotero.logError(e); } catch (x) {} }); });
    row.appendChild(regen);
  }
  wrap.appendChild(row);
}
function copyToClipboard(text) {
  const s = String(text == null ? "" : text);
  try {
    Components.classes["@mozilla.org/widget/clipboardhelper;1"].getService(Components.interfaces.nsIClipboardHelper).copyString(s);
    return true;
  } catch (e) {
    try { Zotero.Utilities.Internal.copyTextToClipboard(s); return true; } catch (x) { return false; }
  }
}
// Rebuild the whole thread from state.conv.messages (with per-message actions +
// fresh indices). Used after edit/regenerate truncate the conversation.
function rerenderConversation() {
  messagesEl().innerHTML = "";
  if (!state.conv || !state.conv.messages.length) { const h = el("div", "nd-hint"); h.textContent = t("chat.hint"); messagesEl().appendChild(h); return; }
  state.conv.messages.forEach((m, i) => {
    const b = addMessage(m.role, m.content, i);
    if (m.role === "assistant") { b.setAttribute("data-raw", m.content); renderRich(b, m.content); }
  });
}
// Reload the user message into the composer and drop it + everything after, so
// the user can edit and resend.
function editUserMessage(index) {
  if (state.busy || !state.conv) return;
  const m = state.conv.messages[index];
  if (!m || m.role !== "user") return;
  const inp = $("#nd-input");
  inp.value = m.content;
  state.conv.messages = state.conv.messages.slice(0, index);
  rerenderConversation();
  inp.focus();
  persistConv().catch(() => {});
}
// Drop this assistant reply (and anything after it) and generate a fresh one for
// the same prior user turn.
async function regenerateFrom(index) {
  if (state.busy || !state.conv) return;
  state.conv.messages = state.conv.messages.slice(0, index);
  if (!state.conv.messages.length) return;
  rerenderConversation();
  await generateAssistant();
}
// Persistent inline notice that a long document was only partially sent.
function addDocNote(info) {
  const note = el("div", "nd-doc-note");
  const pct = Math.max(1, Math.round((info.ratio || 0) * 100));
  note.textContent = tf("doc.truncated", { pct, sent: (info.sentChars || 0).toLocaleString(), total: (info.totalChars || 0).toLocaleString() });
  messagesEl().appendChild(note); messagesEl().scrollTop = messagesEl().scrollHeight;
}
function renderCitations(bodyEl, text) {
  bodyEl.textContent = "";
  const re = /\[\[(p|idea|zotero|gap):([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) { if (m.index > last) bodyEl.appendChild(document.createTextNode(text.slice(last, m.index))); bodyEl.appendChild(makeCite(m[1], m[2].trim(), m[3])); last = re.lastIndex; }
  if (last < text.length) bodyEl.appendChild(document.createTextNode(text.slice(last)));
}
// Render an assistant message: formatted Markdown with clickable Nodus citation
// chips. Falls back to plain citation rendering if the markdown module is absent.
function renderRich(bodyEl, text) {
  bodyEl.classList.add("nd-md");
  if (NM && NM.render) { try { NM.render(bodyEl, text, makeCite); return; } catch (e) { try { Zotero.logError(e); } catch (x) {} } }
  renderCitations(bodyEl, text);
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
// Save the current conversation as a Zotero note (child of the open item, or a
// standalone note when nothing is open). Reuses the agent's create_note path.
async function saveConversationAsNote() {
  if (!state.conv || !state.conv.messages.length || !NU || !NA) { showToast(t("note.empty")); return; }
  const title = state.conv.title || (state.conv.messages.find((m) => m.role === "user") || {}).content || "Nodus chat";
  const body = NU.conversationToHtml(state.conv, { you: t("you"), nodus: t("nodus") });
  const cur = getCurrentItem();
  const action = { tool: "create_note", title: String(title).slice(0, 120), body, standalone: !cur.item };
  const res = await NA.execute(action, { item: cur.item, attachment: cur.attachment });
  showToast(res && res.ok ? t("note.saved") : t("agent.fail"));
}
function loadConversation(id) {
  const c = state.conversations.find((x) => x.id === id);
  if (!c) return;
  state.conv = c;
  rerenderConversation();
  closeHistory();
}

// ─────────────────────────────────────────── auto-highlight
const HL_SYSTEM =
  "You pick the most important passages of a document to highlight for a student. " +
  "Read the DOCUMENT TEXT and choose the passages that matter most, as EXACT verbatim quotes copied from the text — do NOT paraphrase, keep the exact wording so they can be located in the PDF. " +
  "Assign each a level: 'high' for the few MOST important (core thesis, key definitions, critical findings/conclusions) and 'medium' for important supporting points. " +
  "Prefer a single sentence or a short clause per passage (never a whole paragraph). Return between 8 and 25 passages. " +
  'Respond with ONLY a JSON array and nothing else: [{"text":"exact quote","level":"high|medium"}].';
const hlUser = (doc) => 'DOCUMENT TEXT:\n"""\n' + doc + '\n"""\n\nReturn the JSON array of the most important passages to highlight.';

async function fetchHighlightsStandalone(doc, signal) {
  const key = NS.getKey(state.model.provider);
  const localBase = NS.getLocalBase(state.model.provider);
  let acc = "";
  await NP.chatStream(state.model, { system: HL_SYSTEM, key, localBase, maxTokens: state.maxTokens, reasoning: state.reasoning, messages: [{ role: "user", content: hlUser(doc) }] }, (d) => { acc += d; }, signal);
  return NH.parsePassages(acc);
}
async function fetchHighlightsConnected(doc, signal) {
  const res = await api("/api/z/highlight", { method: "POST", body: JSON.stringify({ model: state.model, documentText: doc, reasoning: state.reasoning }), signal });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const d = await res.json();
  return Array.isArray(d.passages) ? d.passages : [];
}
async function autoHighlight() {
  if (state.busy || !NH) return;
  if (!currentModel()) { if (!state.conv) startNewConversation(); addMessage("assistant", t("chat.noModel")); return; }
  if (state.mode === "connected" && !state.connected) { if (!state.conv) startNewConversation(); addMessage("assistant", t("chat.offline")); return; }
  if (!NH.getReaderPdf()) { if (!state.conv) startNewConversation(); addMessage("assistant", t("hl.noReader")); return; }
  if (!state.conv) startNewConversation();
  state.busy = true; state.abort = new AbortController(); updateSendEnabled();
  const bodyEl = addMessage("assistant", t("hl.analyzing"));
  try {
    const raw = await getDocumentText();
    const docInfo = NU ? NU.sampleDocText(raw, DOC_CHAR_LIMIT) : { text: raw };
    if (!docInfo.text) { bodyEl.textContent = t("hl.noText"); return; }
    const passages = state.mode === "connected" ? await fetchHighlightsConnected(docInfo.text, state.abort.signal) : await fetchHighlightsStandalone(docInfo.text, state.abort.signal);
    if (!passages || !passages.length) { bodyEl.textContent = t("hl.noPassages"); return; }
    const res = NH.highlightPassages(passages, state.hlColors);
    if (res.error === "no-reader") { bodyEl.textContent = t("hl.noReader"); return; }
    if (res.error === "no-text") { bodyEl.textContent = t("hl.noText"); return; }
    renderHighlightResult(bodyEl, res);
  } catch (e) {
    const aborted = e && (e.name === "AbortError" || String(e).toLowerCase().includes("abort"));
    bodyEl.textContent = aborted ? "⏹" : "⚠ " + (e && e.message ? e.message : e);
  } finally {
    state.busy = false; state.abort = null; updateSendEnabled();
  }
}
function renderHighlightResult(bodyEl, res) {
  const applied = res.applied || [], missed = res.missed || [];
  const high = applied.filter((a) => a.level === "high").length;
  let msg = tf("hl.result", { n: applied.length, high, medium: applied.length - high });
  if (missed.length) msg += " " + tf("hl.missed", { n: missed.length });
  bodyEl.textContent = msg;
  const keys = applied.map((a) => a.key).filter(Boolean);
  if (!keys.length) return;
  state.lastHighlightKeys = keys;
  const row = el("div", "nd-msg-actions nd-msg-actions--persist");
  const undo = el("button", "nd-msg-act nd-hl-undo"); undo.innerHTML = ico("undo", 14); undo.appendChild(document.createTextNode(" " + t("hl.revert")));
  undo.addEventListener("click", () => { try { NH.revert(keys); } catch (e) {} showToast(t("hl.reverted")); undo.remove(); });
  row.appendChild(undo);
  bodyEl.parentNode.appendChild(row);
}

// ─────────────────────────────────────────── send
async function send(text) {
  if (!text || !text.trim() || state.busy) return;
  if (!currentModel()) { if (!state.conv) startNewConversation(); addMessage("assistant", t("chat.noModel")); return; }
  if (state.mode === "connected" && !state.connected) { if (!state.conv) startNewConversation(); addMessage("assistant", t("chat.offline")); return; }
  if (!state.conv) startNewConversation();
  const uidx = state.conv.messages.push({ role: "user", content: text }) - 1;
  addMessage("user", text, uidx);
  await generateAssistant();
}

// Streams an assistant reply for the current conversation tail (which must end
// in a user message). Shared by send() and regenerateFrom().
async function generateAssistant() {
  if (!currentModel()) { addMessage("assistant", t("chat.noModel")); return; }
  if (state.mode === "connected" && !state.connected) { addMessage("assistant", t("chat.offline")); return; }
  state.busy = true; state.abort = new AbortController(); updateSendEnabled();

  // Wrapped in try/finally so state.busy ALWAYS resets — otherwise a throw in the
  // post-stream steps (renderRich, parseActions, persistConv) would leave the
  // composer permanently disabled ("stuck button").
  const bodyEl = addMessage("assistant", "");
  bodyEl.innerHTML = TYPING_HTML; // animated dots until the first token streams in
  let acc = "";
  try {
    // Sample the open document ONCE (both modes share it) and warn if the work is
    // too long to send whole, instead of silently truncating.
    let docInfo = { text: "", truncated: false };
    if (NS.getContext().useFulltext) {
      const raw = await getDocumentText();
      docInfo = NU ? NU.sampleDocText(raw, DOC_CHAR_LIMIT) : { text: raw, truncated: false };
      if (docInfo.truncated) addDocNote(docInfo);
    }
    try {
      if (state.mode === "connected") acc = await sendConnected(bodyEl, state.abort.signal, docInfo);
      else acc = await sendStandalone(bodyEl, state.abort.signal, docInfo);
    } catch (e) {
      const aborted = e && (e.name === "AbortError" || String(e).toLowerCase().includes("abort"));
      acc = (bodyEl.textContent && bodyEl.textContent !== "") ? bodyEl.textContent : acc;
      if (!aborted) acc = (acc ? acc + "\n\n" : "") + "⚠ " + (e && e.message ? e.message : e);
      else if (!acc) acc = "⏹";
      bodyEl.textContent = acc;
    }
    let display = acc;
    let actions = null;
    if (state.agentEnabled && NA && acc) {
      const parsed = NA.parseActions(acc);
      if (parsed.actions.length) { display = parsed.clean || acc; actions = parsed.actions; }
    }
    if (!display) bodyEl.textContent = ""; // clear the dots if nothing came back
    bodyEl.setAttribute("data-raw", display);
    renderRich(bodyEl, display);
    if (actions) renderActionCards(bodyEl, actions);
    const aidx = state.conv.messages.push({ role: "assistant", content: display }) - 1;
    attachMessageActions(bodyEl.parentNode, "assistant", aidx, display);
    await persistConv();
  } catch (e) {
    try { Zotero.logError(e); } catch (x) {}
    if (bodyEl.querySelector(".nd-typing")) bodyEl.textContent = "⚠ " + (e && e.message ? e.message : e);
  } finally {
    state.busy = false; state.abort = null; updateSendEnabled();
  }
}

async function sendConnected(bodyEl, signal, docInfo) {
  const ctx = NS.getContext();
  const extraContext = NU ? NU.buildItemsSummary(state.items) : "";
  const payload = {
    model: state.model,
    messages: state.conv.messages.map((m) => ({ role: m.role, content: m.content })),
    context: { zoteroKey: state.item ? state.item.key : "", doi: state.item ? state.item.doi : "", title: state.item ? state.item.title : "", selection: state.selection || "", useIdeas: ctx.useIdeas, useCorpus: ctx.useCorpus, agentInstructions: state.agentEnabled && NA ? NA.SYSTEM : "", extraContext, reasoning: state.reasoning },
  };
  if (docInfo && docInfo.text) payload.context.documentText = docInfo.text;
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

async function sendStandalone(bodyEl, signal, docInfo) {
  const parts = [];
  if (state.item && state.item.title) parts.push("Open document: " + state.item.title);
  const itemsSummary = NU ? NU.buildItemsSummary(state.items) : "";
  if (itemsSummary) parts.push(itemsSummary);
  if (state.selection) parts.push('The user highlighted this passage (focus on it):\n"""\n' + state.selection + '\n"""');
  if (docInfo && docInfo.text) parts.push('Document text:\n"""\n' + docInfo.text + '\n"""');
  // Pin the reply language: some models (e.g. deepseek) otherwise drift to their
  // training language even for an English/Spanish question.
  const lang = state.lang === "es" ? "Spanish" : "English";
  let system = "You are a research assistant embedded in Zotero. Answer about the open document, grounded in the provided text. Be concise. Always answer in " + lang + " unless the user's last message is clearly in another language, in which case match that language.\n\n" + parts.join("\n\n");
  if (state.agentEnabled && NA) system += "\n\n" + NA.SYSTEM;
  const key = NS.getKey(state.model.provider);
  const localBase = NS.getLocalBase(state.model.provider);
  let acc = "";
  await NP.chatStream(state.model, {
    system, key, localBase, maxTokens: state.maxTokens, reasoning: state.reasoning,
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
    // key/baseUrl row: input + (for key providers) a delete button.
    const keyRow = el("div", "nd-prov-keyrow"); keyRow.appendChild(inp);
    let delKey = null;
    if (p.needsKey) {
      delKey = el("button", "nd-prov-del"); delKey.innerHTML = ico("trash", 15); delKey.title = t("prov.delKey"); delKey.type = "button";
      delKey.style.display = NS.getKey(p.id) ? "" : "none";
      delKey.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (await showConfirm(tf("prov.delKeyConfirm", { provider: p.label }))) {
          NS.setKey(p.id, ""); inp.value = ""; delKey.style.display = "none";
          dot.className = "nd-prov-dot";
        }
      });
      keyRow.appendChild(delKey);
    }
    inp.addEventListener("change", () => {
      if (p.needsKey) NS.setKey(p.id, inp.value.trim()); else NS.setLocalBase(p.id, inp.value.trim());
      dot.className = "nd-prov-dot" + ((p.needsKey ? inp.value.trim() : true) ? " nd-prov-dot--on" : "");
      if (delKey) delKey.style.display = inp.value.trim() ? "" : "none";
    });
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
    body.appendChild(keyRow); body.appendChild(actions); body.appendChild(modelsBox);
    head.addEventListener("click", (e) => { if (e.target === inp) return; body.classList.toggle("nd-prov-body--open"); });
    card.appendChild(head); card.appendChild(body); wrap.appendChild(card);
  }
}
function modelRow(provider, id, countEl) {
  const row = el("div", "nd-model-row");
  const ref = { provider, model: id };
  const star = el("span", "nd-star" + (NS.isPinned(ref) ? " nd-star--on" : ""));
  star.innerHTML = ico(NS.isPinned(ref) ? "star" : "star-line");
  star.addEventListener("click", () => {
    NS.togglePinned(ref);
    star.className = "nd-star" + (NS.isPinned(ref) ? " nd-star--on" : "");
    star.innerHTML = ico(NS.isPinned(ref) ? "star" : "star-line");
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
    const del = el("span", "nd-conv-del"); del.innerHTML = ico("trash", 15);
    del.addEventListener("click", async (e) => { e.stopPropagation(); if (await showConfirm(t("modal.delOne"))) { state.conversations = state.conversations.filter((x) => x.id !== c.id); await NS.saveConversations(state.conversations); if (state.conv && state.conv.id === c.id) startNewConversation(); renderHistory($("#nd-history-search").value); } });
    row.appendChild(main); row.appendChild(del); list.appendChild(row);
  }
}
// Generic confirm modal. opts.danger === false renders the OK button in the
// accent colour (for non-destructive actions like Save / Highlight / Enable).
function showConfirm(msg, okLabel, opts) {
  opts = opts || {};
  const danger = opts.danger !== false;
  return new Promise((resolve) => {
    $("#nd-modal-msg").textContent = msg; $("#nd-modal").hidden = false;
    const ok = $("#nd-modal-ok"), cancel = $("#nd-modal-cancel");
    ok.textContent = okLabel || t("modal.delete");
    ok.classList.toggle("nd-danger", danger); ok.classList.toggle("nd-btn-primary", !danger);
    const done = (v) => {
      $("#nd-modal").hidden = true; ok.onclick = null; cancel.onclick = null;
      ok.textContent = t("modal.delete"); ok.classList.add("nd-danger"); ok.classList.remove("nd-btn-primary");
      resolve(v);
    };
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
    const desc = el("div", "nd-action-desc"); desc.innerHTML = ico("bot", 14); desc.appendChild(document.createTextNode(" " + NA.describe(action, t))); card.appendChild(desc);
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
function okMsg(a) {
  const map = {
    create_note: "agent.ok.note", highlight: "agent.ok.highlight", add_tags: "agent.ok.tags",
    add_to_collection: "agent.ok.collection", set_field: "agent.ok.field", extract_annotations_note: "agent.ok.extract",
  };
  return map[a.tool] ? t(map[a.tool]) : "✓";
}
function friendlyErr(m) {
  if (m === "no-selection" || m === "no-attachment") return t("agent.needSel");
  if (m === "bad-field") return t("agent.err.badField");
  if (m === "no-annotations") return t("agent.err.noAnnotations");
  if (m === "no-name") return t("agent.err.noName");
  return m;
}

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
// Swap the static toolbar/composer/header glyphs for inline SVG icons.
function applyIcons() {
  if (!NI) return;
  const set = (sel, name, size) => { const e = $(sel); if (e) e.innerHTML = ico(name, size); };
  set("#nd-new", "plus"); set("#nd-history-btn", "history"); set("#nd-save-note", "file");
  set("#nd-highlight-btn", "highlighter"); set("#nd-agent-btn", "bot"); set("#nd-prompt-btn", "sparkles");
  set("#nd-send", "send", 15); set("#nd-stop", "square", 14); set("#nd-close", "x");
  set("#nd-history-close", "x"); set(".nd-think-ico", "idea", 15);
}
function applyI18n() {
  $$("[data-i18n]").forEach((n) => (n.textContent = t(n.getAttribute("data-i18n"))));
  $$("[data-i18n-ph]").forEach((n) => n.setAttribute("placeholder", t(n.getAttribute("data-i18n-ph"))));
  $$("[data-i18n-title]").forEach((n) => n.setAttribute("title", t(n.getAttribute("data-i18n-title"))));
  renderPromptMenu();
  renderReasoningSelect();
}
// Build the reasoning-effort dropdown (in the Thinking modal) and mirror the
// current level onto the chat-bar button.
function renderReasoningSelect() {
  const levels = (NP && NP.REASONING_LEVELS) || ["default", "off", "low", "medium", "high"];
  const list = $("#nd-think-list");
  if (list) {
    list.innerHTML = "";
    for (const lv of levels) {
      const it = el("div", "nd-dd-item" + (state.reasoning === lv ? " nd-dd-item--sel" : ""));
      it.appendChild(el("span", "nd-dd-model", t("reasoning." + lv)));
      it.addEventListener("click", () => { state.reasoning = lv; NS.setReasoning(lv); closeThinkMenu(); renderReasoningSelect(); });
      list.appendChild(it);
    }
  }
  const lbl = $("#nd-think-lvl"); if (lbl) lbl.textContent = t("reasoning." + state.reasoning);
}
function openThinkMenu() { const m = $("#nd-think-menu"); if (!m) return; renderReasoningSelect(); m.hidden = false; }
function closeThinkMenu() { const m = $("#nd-think-menu"); if (m) m.hidden = true; }
function toggleThinkMenu() { const m = $("#nd-think-menu"); if (!m) return; if (m.hidden) openThinkMenu(); else closeThinkMenu(); }
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
  // "add a prompt" action — first, at the top
  const add = el("div", "nd-menu-item nd-menu-add");
  add.innerHTML = ico("plus", 14); add.appendChild(document.createTextNode(" " + t("prompt.addNew")));
  add.onclick = (e) => { e.stopPropagation(); openPromptModal(); };
  menu.appendChild(add);
  // user-defined prompts (right below Add), each with a delete button
  const custom = NS.getCustomPrompts ? NS.getCustomPrompts() : [];
  for (const cp of custom) {
    const item = el("div", "nd-menu-item nd-menu-item--custom");
    const txt = el("div", "nd-menu-txt");
    txt.appendChild(el("div", "nd-menu-title", cp.title || t("prompt.untitled")));
    txt.appendChild(el("div", "nd-menu-sub", cp.prompt));
    txt.onclick = () => { insertPrompt(cp.prompt); togglePromptMenu(false); };
    item.appendChild(txt);
    const del = el("button", "nd-menu-del"); del.innerHTML = ico("trash", 13); del.title = t("prompt.del");
    del.onclick = async (e) => { e.stopPropagation(); if (!(await showConfirm(t("prompt.delConfirm"), t("modal.delete")))) return; NS.removeCustomPrompt(cp.id); renderPromptMenu(); };
    item.appendChild(del);
    menu.appendChild(item);
  }
  // built-in templates
  for (const [lk, pk] of promptDefs()) {
    const item = el("div", "nd-menu-item");
    item.appendChild(el("div", "nd-menu-title", t(lk)));
    item.appendChild(el("div", "nd-menu-sub", t(pk)));
    item.onclick = () => { insertPrompt(t(pk)); togglePromptMenu(false); };
    menu.appendChild(item);
  }
}
function openPromptModal() {
  togglePromptMenu(false);
  $("#nd-prompt-title").value = ""; $("#nd-prompt-text").value = "";
  $("#nd-prompt-modal").hidden = false; $("#nd-prompt-title").focus();
}
function closePromptModal() { $("#nd-prompt-modal").hidden = true; }
function savePrompt() {
  const title = $("#nd-prompt-title").value.trim();
  const text = $("#nd-prompt-text").value.trim();
  if (!title || !text) { showToast(t("prompt.needBoth")); return; }
  NS.addCustomPrompt(title, text);
  closePromptModal();
  renderPromptMenu(); // rebuild so the new prompt shows next time the ✦ menu opens
  showToast(t("prompt.saved"));
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
  const clr = el("span", "nd-conv-del"); clr.innerHTML = ico("x", 13); clr.appendChild(document.createTextNode(" " + t("sel.clear"))); clr.style.float = "right"; clr.onclick = () => { state.selection = ""; showSelection(); renderPromptMenu(); };
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
  $("#nd-prompt-save").addEventListener("click", savePrompt);
  $("#nd-prompt-cancel").addEventListener("click", closePromptModal);
  $("#nd-prompt-modal").addEventListener("click", (e) => { if (e.target === $("#nd-prompt-modal")) closePromptModal(); });
  $("#nd-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); const v = $("#nd-input").value; $("#nd-input").value = ""; send(v); } });
  // dismiss the prompt menu on outside click
  document.addEventListener("click", (e) => { const menu = $("#nd-prompt-menu"); if (!menu || menu.hidden) return; if (!menu.contains(e.target) && !(e.target.closest && e.target.closest("#nd-prompt-btn"))) togglePromptMenu(false); });
  $("#nd-model-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleModelMenu(); });
  $("#nd-model-search").addEventListener("input", renderModelDropdown);
  $("#nd-model-search").addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", (e) => { const dd = $("#nd-model-dd"); if (dd && !dd.contains(e.target)) closeModelMenu(); });
  $("#nd-lang").addEventListener("change", (e) => { state.lang = e.target.value === "es" ? "es" : "en"; NS.setLang(state.lang); applyI18n(); renderMode(); });
  $("#nd-maxtokens").addEventListener("change", (e) => { const n = parseInt(e.target.value, 10); state.maxTokens = Number.isFinite(n) && n > 0 ? n : 8192; NS.setMaxTokens(state.maxTokens); e.target.value = state.maxTokens; });
  $("#nd-reasoning-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleThinkMenu(); });
  document.addEventListener("click", (e) => { const dd = $("#nd-think-dd"); if (dd && !dd.contains(e.target)) closeThinkMenu(); });
  $("#nd-new").addEventListener("click", () => startNewConversation());
  $("#nd-save-note").addEventListener("click", async () => {
    if (!(await showConfirm(t("confirm.saveNote"), t("modal.save"), { danger: false }))) return;
    saveConversationAsNote().catch((e) => { try { Zotero.logError(e); } catch (x) {} });
  });
  $("#nd-highlight-btn").addEventListener("click", async () => {
    if (!(await showConfirm(t("confirm.highlight"), t("modal.highlight"), { danger: false }))) return;
    autoHighlight().catch((e) => { try { Zotero.logError(e); } catch (x) {} });
  });
  $("#nd-hl-high").addEventListener("change", saveHlColors);
  $("#nd-hl-medium").addEventListener("change", saveHlColors);
  $("#nd-history-btn").addEventListener("click", openHistory);
  $("#nd-history-close").addEventListener("click", closeHistory);
  $("#nd-history-search").addEventListener("input", (e) => renderHistory(e.target.value));
  $("#nd-history-clear").addEventListener("click", async () => { if (await showConfirm(t("modal.delAll"))) { state.conversations = []; await NS.saveConversations([]); startNewConversation(); renderHistory(""); } });
  $("#nd-ctx-fulltext").addEventListener("change", saveContext);
  $("#nd-ctx-ideas").addEventListener("change", saveContext);
  $("#nd-ctx-corpus").addEventListener("change", saveContext);
  $("#nd-test").addEventListener("click", () => { NS.setManual($("#nd-port").value, $("#nd-token").value.trim()); connect().then(loadModelsForMode); });
  window.addEventListener("message", (e) => {
    if (!e.data || e.data.type !== "nodus-selection") return;
    state.selection = String(e.data.text || ""); state.selectionDraft = e.data.draft || null;
    switchTab("chat"); showSelection(); renderPromptMenu();
    if (e.data.action === "explain") send(t("p.explainSel"));
  });
  $("#nd-agent-btn").addEventListener("click", async () => {
    if (!state.agentEnabled) { if (!(await showConfirm(t("confirm.agentOn"), t("modal.enable"), { danger: false }))) return; }
    setAgentEnabled(!state.agentEnabled, true);
  });
  $("#nd-agent").addEventListener("change", (e) => setAgentEnabled(e.target.checked, true));
  $("#nd-agent-auto").addEventListener("change", async (e) => {
    if (e.target.checked) { const ok = await showConfirm(t("agent.autoConfirm"), t("agent.enable")); if (!ok) { e.target.checked = false; return; } }
    state.agentAuto = e.target.checked; NS.setAgentAuto(state.agentAuto);
  });
  registerNotifier();
  // Fallback poll ONLY for library list-selection, which Zotero exposes no
  // public event for. Tab switches and item edits arrive instantly via the
  // Notifier below, so this can be slow.
  state.pollTimer = setInterval(() => scheduleRefresh(false), 2000);
}
function saveContext() { NS.setContext({ useFulltext: $("#nd-ctx-fulltext").checked, useIdeas: $("#nd-ctx-ideas").checked, useCorpus: $("#nd-ctx-corpus").checked }); }
function saveHlColors() { state.hlColors = { high: $("#nd-hl-high").value || "#ff6666", medium: $("#nd-hl-medium").value || "#ffd400" }; NS.setHlColors(state.hlColors); }

// Coalesced refresh so a burst of Notifier events (e.g. during sync) triggers a
// single refreshItem. force=true re-resolves even when the item key is unchanged.
let refreshTimer = null, refreshForce = false;
function scheduleRefresh(force) {
  refreshForce = refreshForce || !!force;
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { const f = refreshForce; refreshTimer = null; refreshForce = false; refreshItem(f).catch(() => {}); }, 200);
}
// Event-driven refresh: 'select' (tab/collection change) refreshes if the item
// changed; 'modify'/'add'/'delete' force a re-resolve so the analysis badge and
// multi-selection summary stay current without constant polling.
function registerNotifier() {
  try {
    if (!Zotero.Notifier || !Zotero.Notifier.registerObserver) return;
    const observer = {
      notify(event) {
        if (event === "select") scheduleRefresh(false);
        else if (event === "modify" || event === "add" || event === "delete") scheduleRefresh(true);
      },
    };
    state.notifierID = Zotero.Notifier.registerObserver(observer, ["item", "tab", "collection"], "nodus-sidebar");
    window.addEventListener("unload", () => {
      try { if (state.notifierID) Zotero.Notifier.unregisterObserver(state.notifierID); } catch (e) {}
      try { if (state.pollTimer) clearInterval(state.pollTimer); } catch (e) {}
    });
  } catch (e) { try { Zotero.logError(e); } catch (x) {} }
}

async function boot() {
  state.mode = NS.getMode(); state.lang = NS.getLang();
  state.maxTokens = NS.getMaxTokens();
  state.reasoning = NS.getReasoning();
  state.hlColors = NS.getHlColors();
  const ctx = NS.getContext();
  wire();
  $("#nd-lang").value = state.lang;
  $("#nd-maxtokens").value = state.maxTokens;
  $("#nd-hl-high").value = state.hlColors.high; $("#nd-hl-medium").value = state.hlColors.medium;
  const m = NS.getManual(); $("#nd-port").value = m.port || ""; $("#nd-token").value = m.token || "";
  $("#nd-ctx-fulltext").checked = ctx.useFulltext; $("#nd-ctx-ideas").checked = ctx.useIdeas; $("#nd-ctx-corpus").checked = ctx.useCorpus;
  state.agentEnabled = NS.getAgent(); state.agentAuto = NS.getAgentAuto();
  $("#nd-agent").checked = state.agentEnabled; $("#nd-agent-auto").checked = state.agentAuto;
  $("#nd-agent-btn").classList.toggle("nd-iconbtn--active", state.agentEnabled);
  applyIcons();
  applyI18n();
  renderMode();
  state.conversations = await NS.loadConversations();
  startNewConversation();
  await connect();
  await loadModelsForMode();
  await refreshItem(true);
}
boot().catch((e) => { try { Zotero.logError(e); } catch (x) {} });
