/* Nodus for Zotero — persistence. Small settings/keys in Zotero prefs; the
 * conversation history in a JSON file in the Zotero profile. window.NodusStore.
 *
 * Note: API keys are stored in Zotero's prefs (plain text in the profile), the
 * same trade-off other Zotero AI plugins make. They never leave this machine
 * except in the request to the provider you configured.
 */
/* eslint-disable no-undef */
(function () {
  "use strict";
  const { Zotero } = ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs");

  const P = (k, d) => { try { const v = Zotero.Prefs.get("nodus." + k); return v == null ? d : v; } catch (e) { return d; } };
  const S = (k, v) => { try { Zotero.Prefs.set("nodus." + k, v); } catch (e) {} };
  const PJSON = (k, d) => { try { return JSON.parse(P(k, "")) || d; } catch (e) { return d; } };
  const SJSON = (k, v) => S(k, JSON.stringify(v));

  // ---- settings ----
  function getMode() { return P("mode", "connected") === "standalone" ? "standalone" : "connected"; }
  function setMode(m) { S("mode", m === "standalone" ? "standalone" : "connected"); }
  function getLang() { return P("lang", "en") === "es" ? "es" : "en"; }
  function setLang(l) { S("lang", l); }
  function getModel(mode) { return PJSON("model." + mode, null); }
  function setModel(mode, ref) { SJSON("model." + mode, ref); }
  function getMaxTokens() { const n = Number(P("maxTokens", 0)); return Number.isFinite(n) && n > 0 ? n : 8192; }
  function setMaxTokens(v) { const n = Number(v); S("maxTokens", Number.isFinite(n) && n > 0 ? Math.floor(n) : 8192); }
  const REASONING = ["default", "off", "low", "medium", "high"];
  function getReasoning() { const v = P("reasoning", "default"); return REASONING.includes(v) ? v : "default"; }
  function setReasoning(v) { S("reasoning", REASONING.includes(v) ? v : "default"); }
  // Auto-highlight colors: high = MUY IMPORTANTE, medium = IMPORTANTE.
  function getHlColors() { const c = PJSON("hlColors", null); return { high: (c && c.high) || "#ff6666", medium: (c && c.medium) || "#ffd400" }; }
  function setHlColors(c) { SJSON("hlColors", { high: (c && c.high) || "#ff6666", medium: (c && c.medium) || "#ffd400" }); }
  function getContext() {
    const strategy = P("ctx.strategy", "auto");
    const ocr = P("ctx.ocr", "off");
    const repair = P("ctx.repair", "auto");
    const rounds = Number(P("ctx.agenticRounds", 1));
    const threshold = Number(P("ctx.fullTextThreshold", 48000));
    return {
      useIdeas: P("ctx.ideas", "1") !== "0",
      useCorpus: P("ctx.corpus", "1") !== "0",
      useFulltext: P("ctx.fulltext", "1") !== "0",
      strategy: ["auto", "retrieval", "full"].includes(strategy) ? strategy : "auto",
      ocr: ["off", "ondemand", "always"].includes(ocr) ? ocr : "off",
      repair: ["auto", "off", "always"].includes(repair) ? repair : "auto",
      agenticRounds: Number.isFinite(rounds) ? Math.max(0, Math.min(2, Math.floor(rounds))) : 1,
      fullTextThreshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 48000,
    };
  }
  function setContext(c) {
    S("ctx.ideas", c.useIdeas ? "1" : "0"); S("ctx.corpus", c.useCorpus ? "1" : "0"); S("ctx.fulltext", c.useFulltext ? "1" : "0");
    S("ctx.strategy", ["auto", "retrieval", "full"].includes(c.strategy) ? c.strategy : "auto");
    S("ctx.ocr", ["off", "ondemand", "always"].includes(c.ocr) ? c.ocr : "off");
    S("ctx.repair", ["auto", "off", "always"].includes(c.repair) ? c.repair : "auto");
    const rounds = Number(c.agenticRounds);
    S("ctx.agenticRounds", String(Number.isFinite(rounds) ? Math.max(0, Math.min(2, Math.floor(rounds))) : 1));
    const threshold = Number(c.fullTextThreshold);
    S("ctx.fullTextThreshold", String(Number.isFinite(threshold) && threshold > 0 ? threshold : 48000));
  }
  // ---- providers ----
  function getKey(provider) { return P("key." + provider, "") || ""; }
  function setKey(provider, v) { S("key." + provider, v || ""); }
  function getLocalBase(provider) { return P("localbase." + provider, "") || ""; }
  function setLocalBase(provider, v) { S("localbase." + provider, v || ""); }
  function getPinned() { const a = PJSON("pinned", []); return Array.isArray(a) ? a : []; }
  function setPinned(arr) { SJSON("pinned", arr); }
  function isPinned(ref) { return getPinned().some((m) => m.provider === ref.provider && m.model === ref.model); }
  function togglePinned(ref) {
    const arr = getPinned();
    const i = arr.findIndex((m) => m.provider === ref.provider && m.model === ref.model);
    if (i >= 0) arr.splice(i, 1); else arr.push(ref);
    setPinned(arr);
    return arr;
  }

  // ---- custom prompts (user-defined templates for the ✦ menu) ----
  function getCustomPrompts() { const a = PJSON("customPrompts", []); return Array.isArray(a) ? a : []; }
  function setCustomPrompts(arr) { SJSON("customPrompts", Array.isArray(arr) ? arr : []); }
  function addCustomPrompt(title, prompt) {
    const a = getCustomPrompts();
    a.push({ id: "up_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6), title: String(title || "").trim(), prompt: String(prompt || "").trim() });
    setCustomPrompts(a); return a;
  }
  function removeCustomPrompt(id) { setCustomPrompts(getCustomPrompts().filter((p) => p.id !== id)); }

  // ---- agent mode ----
  function getAgent() { return P("agent", "0") === "1"; }
  function setAgent(v) { S("agent", v ? "1" : "0"); }
  function getAgentAuto() { return P("agentAuto", "0") === "1"; }
  function setAgentAuto(v) { S("agentAuto", v ? "1" : "0"); }

  // ---- conversation manual (nodus) connection override (advanced) ----
  function getManual() { return { port: Number(P("port", 0)) || 0, token: P("token", "") || "" }; }
  function setManual(port, token) { S("port", Number(port) || 0); S("token", token || ""); }

  // ---- conversations (file) ----
  function convPath() {
    const dir = Services.dirsvc.get("ProfD", Components.interfaces.nsIFile).path;
    return PathUtils.join(dir, "nodus-zotero-conversations.json");
  }
  function compactAudit(audit) {
    if (!audit || typeof audit !== "object") return audit || null;
    return {
      total: Number(audit.total) || 0,
      covered: Number(audit.covered) || 0,
      weak: Number(audit.weak) || 0,
      missing: Number(audit.missing) || 0,
      coverage: Number(audit.coverage) || 0,
      repairAttempted: !!audit.repairAttempted,
      invalidCitations: Array.isArray(audit.invalidCitations)
        ? audit.invalidCitations.map((citation) => ({
          id: String(citation && citation.id || ""),
          token: String(citation && citation.token || ""),
        }))
        : [],
      claims: Array.isArray(audit.claims)
        ? audit.claims.map((claim) => ({
          text: String(claim && claim.text || ""),
          citationIds: Array.isArray(claim && claim.citationIds) ? claim.citationIds.map(String) : [],
          status: ["covered", "weak", "missing"].includes(claim && claim.status) ? claim.status : "missing",
          support: Number(claim && claim.support) || 0,
        }))
        : [],
    };
  }
  function compactConversations(list) {
    if (!Array.isArray(list)) return [];
    return list.map((conversation) => ({
      ...conversation,
      messages: Array.isArray(conversation && conversation.messages)
        ? conversation.messages.map((message) => ({
          ...message,
          audit: message && message.audit ? compactAudit(message.audit) : null,
        }))
        : [],
    }));
  }
  async function loadConversations() {
    try { const raw = await IOUtils.readUTF8(convPath()); return compactConversations(JSON.parse(raw)); }
    catch (e) { return []; }
  }
  async function saveConversations(list) {
    try { await IOUtils.writeUTF8(convPath(), JSON.stringify(compactConversations(list))); } catch (e) { try { Zotero.logError(e); } catch (x) {} }
  }
  const EVIDENCE_CACHE_VERSION = 1;
  let evidenceDbPromise = null;

  function legacyIndexDir() {
    const dir = Services.dirsvc.get("ProfD", Components.interfaces.nsIFile).path;
    return PathUtils.join(dir, "nodus-zotero-indexes");
  }
  function legacyIndexPath(libraryID, attachmentKey) {
    const safe = String(libraryID) + "-" + String(attachmentKey || "").replace(/[^A-Za-z0-9_-]/g, "_");
    return PathUtils.join(legacyIndexDir(), safe + ".json");
  }
  function evidenceDir() {
    const dir = Services.dirsvc.get("ProfD", Components.interfaces.nsIFile).path;
    return PathUtils.join(dir, "nodus-zotero-evidence");
  }
  function evidenceDbPath() {
    return PathUtils.join(evidenceDir(), "nodus-evidence.sqlite");
  }
  function evidenceStem(libraryID, attachmentKey) {
    return String(libraryID) + "-" + String(attachmentKey || "").replace(/[^A-Za-z0-9_-]/g, "_");
  }
  function evidenceDataPath(libraryID, attachmentKey) {
    return PathUtils.join(evidenceDir(), evidenceStem(libraryID, attachmentKey) + ".json.gz");
  }
  function evidenceVectorPath(libraryID, attachmentKey) {
    return PathUtils.join(evidenceDir(), evidenceStem(libraryID, attachmentKey) + ".f32");
  }
  async function gzipText(value) {
    const bytes = new TextEncoder().encode(String(value || ""));
    if (typeof CompressionStream === "undefined") throw new Error("gzip-unavailable");
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function gunzipText(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("gunzip-unavailable");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }
  function detachEmbeddings(index) {
    const copy = { ...(index || {}) };
    const chunks = [];
    let totalFloats = 0;
    for (const source of Array.isArray(index && index.chunks) ? index.chunks : []) {
      const chunk = { ...source };
      const vector = Array.isArray(source.embedding) ? source.embedding : null;
      if (vector && vector.length) {
        chunk.embeddingOffset = totalFloats;
        chunk.embeddingLength = vector.length;
        totalFloats += vector.length;
      } else {
        delete chunk.embeddingOffset;
        delete chunk.embeddingLength;
      }
      chunk.embedding = null;
      chunks.push(chunk);
    }
    copy.chunks = chunks;
    const vectors = new Float32Array(totalFloats);
    let cursor = 0;
    for (const source of Array.isArray(index && index.chunks) ? index.chunks : []) {
      if (!Array.isArray(source.embedding) || !source.embedding.length) continue;
      vectors.set(source.embedding.map(Number), cursor);
      cursor += source.embedding.length;
    }
    copy.cache = {
      schema: EVIDENCE_CACHE_VERSION,
      vectorFormat: "float32-le",
      vectorCount: totalFloats,
    };
    return { index: copy, bytes: new Uint8Array(vectors.buffer) };
  }
  function attachEmbeddings(index, bytes) {
    const copy = index || {};
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    const raw = source.byteLength ? new Uint8Array(source).buffer : new ArrayBuffer(0);
    const vectors = new Float32Array(raw);
    for (const chunk of Array.isArray(copy.chunks) ? copy.chunks : []) {
      const offset = Number(chunk.embeddingOffset);
      const length = Number(chunk.embeddingLength);
      if (Number.isInteger(offset) && Number.isInteger(length) && offset >= 0 && length > 0 && offset + length <= vectors.length) {
        chunk.embedding = Array.from(vectors.subarray(offset, offset + length));
      } else {
        chunk.embedding = null;
      }
    }
    return copy;
  }
  async function evidenceDb() {
    if (evidenceDbPromise) return evidenceDbPromise;
    evidenceDbPromise = (async () => {
      await IOUtils.makeDirectory(evidenceDir(), { ignoreExisting: true });
      const db = new Zotero.DBConnection(evidenceDbPath());
      await db.queryAsync(
        "CREATE TABLE IF NOT EXISTS evidence_indexes (" +
        "library_id INTEGER NOT NULL, attachment_key TEXT NOT NULL, item_key TEXT NOT NULL, " +
        "signature TEXT NOT NULL, index_version INTEGER NOT NULL, embedding_model TEXT, " +
        "total_pages INTEGER NOT NULL, total_chars INTEGER NOT NULL, data_path TEXT NOT NULL, " +
        "vector_path TEXT NOT NULL, updated_at INTEGER NOT NULL, " +
        "PRIMARY KEY (library_id, attachment_key))"
      );
      await db.queryAsync("CREATE INDEX IF NOT EXISTS evidence_indexes_updated ON evidence_indexes(updated_at)");
      return db;
    })().catch((error) => {
      evidenceDbPromise = null;
      throw error;
    });
    return evidenceDbPromise;
  }
  async function loadEvidenceIndex(libraryID, attachmentKey) {
    let dataPath = evidenceDataPath(libraryID, attachmentKey);
    let vectorPath = evidenceVectorPath(libraryID, attachmentKey);
    try {
      const db = await evidenceDb();
      const row = await db.rowQueryAsync(
        "SELECT data_path, vector_path FROM evidence_indexes WHERE library_id=? AND attachment_key=?",
        [Number(libraryID), String(attachmentKey || "")]
      );
      if (row) {
        dataPath = String(row.data_path);
        vectorPath = String(row.vector_path);
      }
    } catch (e) { try { Zotero.logError(e); } catch (x) {} }
    // The sidecars remain independently recoverable if SQLite metadata was
    // interrupted after the atomic file move.
    try {
      const packed = await IOUtils.read(dataPath);
      const vectors = await IOUtils.read(vectorPath);
      return attachEmbeddings(JSON.parse(await gunzipText(packed)), vectors);
    } catch (e) {}
    // One-way lazy migration from the v0.1 JSON cache.  The old file is left in
    // place until the new cache has been written successfully.
    try {
      const legacy = JSON.parse(await IOUtils.readUTF8(legacyIndexPath(libraryID, attachmentKey)));
      if (legacy) await saveEvidenceIndex(legacy);
      return legacy;
    } catch (e) { return null; }
  }
  async function saveEvidenceIndex(index) {
    try {
      await IOUtils.makeDirectory(evidenceDir(), { ignoreExisting: true });
      const target = evidenceDataPath(index.libraryID, index.attachmentKey);
      const vectorsTarget = evidenceVectorPath(index.libraryID, index.attachmentKey);
      const packed = detachEmbeddings(index);
      const dataBytes = await gzipText(JSON.stringify(packed.index));
      const dataTmp = target + ".tmp";
      const vectorsTmp = vectorsTarget + ".tmp";
      await IOUtils.write(dataTmp, dataBytes);
      await IOUtils.write(vectorsTmp, packed.bytes);
      await IOUtils.move(dataTmp, target, { noOverwrite: false });
      await IOUtils.move(vectorsTmp, vectorsTarget, { noOverwrite: false });
      const db = await evidenceDb();
      await db.queryAsync(
        "INSERT INTO evidence_indexes " +
        "(library_id, attachment_key, item_key, signature, index_version, embedding_model, total_pages, total_chars, data_path, vector_path, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(library_id, attachment_key) DO UPDATE SET " +
        "item_key=excluded.item_key, signature=excluded.signature, index_version=excluded.index_version, " +
        "embedding_model=excluded.embedding_model, total_pages=excluded.total_pages, total_chars=excluded.total_chars, " +
        "data_path=excluded.data_path, vector_path=excluded.vector_path, updated_at=excluded.updated_at",
        [
          Number(index.libraryID), String(index.attachmentKey || ""), String(index.itemKey || ""),
          String(index.signature || ""), Number(index.version) || 0, String(index.embeddingModel || ""),
          Number(index.totalPages) || 0, Number(index.totalChars) || 0,
          target, vectorsTarget, Number(index.updatedAt) || Date.now(),
        ]
      );
      return target;
    } catch (e) { try { Zotero.logError(e); } catch (x) {} return null; }
  }
  async function deleteEvidenceIndex(libraryID, attachmentKey) {
    try {
      await IOUtils.remove(evidenceDataPath(libraryID, attachmentKey), { ignoreAbsent: true });
      await IOUtils.remove(evidenceVectorPath(libraryID, attachmentKey), { ignoreAbsent: true });
      const db = await evidenceDb();
      await db.queryAsync("DELETE FROM evidence_indexes WHERE library_id=? AND attachment_key=?", [Number(libraryID), String(attachmentKey || "")]);
      return true;
    } catch (e) { return false; }
  }
  async function evidenceCacheStats() {
    try {
      const db = await evidenceDb();
      const row = await db.rowQueryAsync(
        "SELECT COUNT(*) AS documents, COALESCE(SUM(total_pages),0) AS pages, COALESCE(SUM(total_chars),0) AS chars FROM evidence_indexes"
      );
      return {
        path: evidenceDir(),
        database: evidenceDbPath(),
        documents: Number(row && row.documents) || 0,
        pages: Number(row && row.pages) || 0,
        chars: Number(row && row.chars) || 0,
      };
    } catch (e) {
      return { path: evidenceDir(), database: evidenceDbPath(), documents: 0, pages: 0, chars: 0 };
    }
  }
  function newId() { return "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8); }

  window.NodusStore = {
    getMode, setMode, getLang, setLang, getModel, setModel, getMaxTokens, setMaxTokens, getReasoning, setReasoning, getHlColors, setHlColors, getContext, setContext,
    getKey, setKey, getLocalBase, setLocalBase, getPinned, setPinned, isPinned, togglePinned,
    getCustomPrompts, setCustomPrompts, addCustomPrompt, removeCustomPrompt,
    getAgent, setAgent, getAgentAuto, setAgentAuto,
    getManual, setManual, loadConversations, saveConversations, compactAudit, compactConversations,
    EVIDENCE_CACHE_VERSION, gzipText, gunzipText, detachEmbeddings, attachEmbeddings,
    loadEvidenceIndex, saveEvidenceIndex, deleteEvidenceIndex, evidenceCacheStats, newId,
  };
})();
