/* Nodus for Zotero — standalone provider client.
 * Talks directly to AI providers (same set as Nodus) using the user's own keys,
 * so the plugin works without Nodus running. Exposed as window.NodusProviders.
 */
/* eslint-disable no-undef */
(function () {
  "use strict";

  // kind: 'openai' = OpenAI-compatible chat/models; 'anthropic' = native; 'gemini' = OpenAI-compat chat + native model list.
  const PROVIDERS = [
    { id: "anthropic", label: "Anthropic", kind: "anthropic", needsKey: true },
    { id: "openai", label: "OpenAI", kind: "openai", needsKey: true, base: "https://api.openai.com/v1" },
    { id: "openrouter", label: "OpenRouter", kind: "openai", needsKey: true, base: "https://openrouter.ai/api/v1", listNoKey: true },
    { id: "groq", label: "Groq", kind: "openai", needsKey: true, base: "https://api.groq.com/openai/v1" },
    { id: "cerebras", label: "Cerebras", kind: "openai", needsKey: true, base: "https://api.cerebras.ai/v1" },
    { id: "deepseek", label: "DeepSeek", kind: "openai", needsKey: true, base: "https://api.deepseek.com" },
    { id: "gemini", label: "Google Gemini", kind: "gemini", needsKey: true, base: "https://generativelanguage.googleapis.com/v1beta/openai" },
    { id: "xiaomi", label: "Xiaomi MiMo", kind: "openai", needsKey: true, base: "https://api.xiaomimimo.com/v1" },
    { id: "opencode-go", label: "OpenCode Go", kind: "openai", needsKey: true, base: "https://opencode.ai/zen/go/v1", listNoKey: true },
    { id: "ollama", label: "Ollama", kind: "openai", needsKey: false, local: true, defaultBase: "http://localhost:11434" },
    { id: "lmstudio", label: "LM Studio", kind: "openai", needsKey: false, local: true, defaultBase: "http://localhost:1234" },
    // Subscription runtimes: only usable in Link mode (Nodus owns the OAuth/binary). Shown for info.
    { id: "codex", label: "ChatGPT · Codex", subscription: true, note: "codex" },
    { id: "github-copilot", label: "GitHub Copilot", subscription: true, note: "sub" },
  ];
  const byId = (id) => PROVIDERS.find((p) => p.id === id);

  function chatBase(provider, localBase) {
    const p = byId(provider);
    if (!p) throw new Error("Unknown provider " + provider);
    if (p.local) return (localBase || p.defaultBase).replace(/\/+$/, "") + "/v1";
    return p.base;
  }

  async function listModels(provider, opts) {
    opts = opts || {};
    const p = byId(provider);
    if (!p) return [];
    const key = opts.key || "";
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      });
      if (!res.ok) throw new Error("Anthropic /models HTTP " + res.status);
      const d = await res.json();
      return (d.data || []).map((m) => m.id).filter(Boolean).sort();
    }
    if (provider === "gemini") {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(key) + "&pageSize=1000");
      if (!res.ok) throw new Error("Gemini /models HTTP " + res.status);
      const d = await res.json();
      return (d.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => String(m.name || "").replace(/^models\//, ""))
        .filter(Boolean).sort();
    }
    if (provider === "ollama") {
      const base = (opts.localBase || p.defaultBase).replace(/\/+$/, "");
      const res = await fetch(base + "/api/tags");
      if (!res.ok) throw new Error("Ollama /api/tags HTTP " + res.status);
      const d = await res.json();
      return (d.models || []).map((m) => m.name).filter(Boolean).sort();
    }
    // OpenAI-compatible /models
    const base = chatBase(provider, opts.localBase);
    const url = provider === "deepseek" ? "https://api.deepseek.com/models" : base + "/models";
    const headers = {};
    if (key && !(p.listNoKey && !key)) headers.Authorization = "Bearer " + key;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(p.label + " /models HTTP " + res.status);
    const d = await res.json();
    return (d.data || []).map((m) => m.id).filter(Boolean).sort();
  }

  // messages: [{role:'user'|'assistant', content}]  system: string
  async function chatStream(modelRef, opts, onDelta, signal) {
    const provider = modelRef.provider;
    const model = modelRef.model;
    const p = byId(provider);
    if (!p) throw new Error("Unknown provider " + provider);
    if (p.subscription) throw new Error("Subscriptions (ChatGPT/Copilot) run in Link mode via Nodus.");
    const key = (opts && opts.key) || "";
    const system = (opts && opts.system) || "";
    const messages = (opts && opts.messages) || [];

    if (provider === "anthropic") {
      return anthropicStream(key, model, system, messages, onDelta, signal);
    }
    // OpenAI-compatible (incl. gemini openai-compat, local servers)
    const base = chatBase(provider, opts && opts.localBase);
    const url = provider === "deepseek" ? "https://api.deepseek.com/chat/completions" : base + "/chat/completions";
    const headers = { "Content-Type": "application/json" };
    if (key) headers.Authorization = "Bearer " + key;
    if (provider === "openrouter") { headers["HTTP-Referer"] = "https://github.com/Drakonis96/nodus"; headers["X-Title"] = "Nodus for Zotero"; }
    const body = { model, stream: true, messages: system ? [{ role: "system", content: system }, ...messages] : messages };
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!res.ok || !res.body) throw new Error(p.label + " chat HTTP " + res.status + (res.ok ? "" : " " + (await res.text()).slice(0, 200)));
    await readSSE(res.body, (json) => {
      const delta = json && json.choices && json.choices[0] && json.choices[0].delta;
      if (delta && typeof delta.content === "string") onDelta(delta.content);
    });
  }

  async function anthropicStream(key, model, system, messages, onDelta, signal) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-api-key": key,
        "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: 4096, stream: true, system: system || undefined, messages }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error("Anthropic chat HTTP " + res.status + " " + (res.ok ? "" : (await res.text()).slice(0, 200)));
    await readSSE(res.body, (json) => {
      if (json && json.type === "content_block_delta" && json.delta && typeof json.delta.text === "string") onDelta(json.delta.text);
    });
  }

  // Reads a text/event-stream, calling onJson for each `data: {json}` (ignores [DONE]).
  async function readSSE(stream, onJson) {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        let line = buf.slice(0, idx); buf = buf.slice(idx + 1);
        line = line.replace(/\r$/, "").trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let json; try { json = JSON.parse(payload); } catch (e) { continue; }
        onJson(json);
      }
    }
  }

  window.NodusProviders = { PROVIDERS, byId, chatBase, listModels, chatStream };
})();
