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
  function getContext() {
    return { useIdeas: P("ctx.ideas", "1") !== "0", useCorpus: P("ctx.corpus", "1") !== "0", useFulltext: P("ctx.fulltext", "1") !== "0" };
  }
  function setContext(c) { S("ctx.ideas", c.useIdeas ? "1" : "0"); S("ctx.corpus", c.useCorpus ? "1" : "0"); S("ctx.fulltext", c.useFulltext ? "1" : "0"); }

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
  async function loadConversations() {
    try { const raw = await IOUtils.readUTF8(convPath()); const a = JSON.parse(raw); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  async function saveConversations(list) {
    try { await IOUtils.writeUTF8(convPath(), JSON.stringify(list)); } catch (e) { try { Zotero.logError(e); } catch (x) {} }
  }
  function newId() { return "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8); }

  window.NodusStore = {
    getMode, setMode, getLang, setLang, getModel, setModel, getContext, setContext,
    getKey, setKey, getLocalBase, setLocalBase, getPinned, setPinned, isPinned, togglePinned,
    getAgent, setAgent, getAgentAuto, setAgentAuto,
    getManual, setManual, loadConversations, saveConversations, newId,
  };
})();
