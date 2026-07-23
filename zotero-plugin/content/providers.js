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

  const DEFAULT_MAX_TOKENS = 8192;
  function clampMaxTokens(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_TOKENS;
    return Math.min(200000, Math.max(256, Math.floor(n)));
  }

  // Reasoning/thinking control (per model, if it supports it). Levels:
  //   'default' — send nothing, let the model/provider decide
  //   'off'     — ask the model NOT to reason (faster/cheaper)
  //   'low'|'medium'|'high' — reasoning effort
  const REASONING_LEVELS = ["default", "off", "low", "medium", "high"];
  const THINK_BUDGET = { low: 1024, medium: 4096, high: 8192 };

  // Body fragment for OpenAI-compatible chat. OpenRouter exposes a unified
  // `reasoning` object (verified against gemini/deepseek/mimo); other
  // OpenAI-compatible endpoints use the standard `reasoning_effort`. 'off' has
  // no portable "disable" on plain OpenAI-compat, so we simply don't request it.
  function reasoningBody(provider, level) {
    if (!level || level === "default") return {};
    if (provider === "openrouter") {
      return level === "off" ? { reasoning: { enabled: false } } : { reasoning: { effort: level } };
    }
    if (level === "off") return {};
    return { reasoning_effort: level };
  }

  function imageParts(images) {
    const out = [];
    for (const image of images || []) {
      if (!image) continue;
      if (typeof image === "string" && /^data:image\//i.test(image)) out.push({ url: image, label: "" });
      else if (image.dataUrl && /^data:image\//i.test(image.dataUrl)) out.push({ url: image.dataUrl, label: String(image.label || "") });
      else if (image.mimeType && image.data) out.push({ url: "data:" + image.mimeType + ";base64," + image.data, label: String(image.label || "") });
    }
    return out.slice(0, 6);
  }
  function withOpenAiImages(messages, images) {
    const normalized = (messages || []).map((m) => ({ role: m.role, content: m.content }));
    const visuals = imageParts(images);
    if (!visuals.length) return normalized;
    let i = normalized.length - 1;
    while (i >= 0 && normalized[i].role !== "user") i--;
    if (i < 0) { normalized.push({ role: "user", content: "" }); i = normalized.length - 1; }
    const original = normalized[i].content;
    const content = [{ type: "text", text: typeof original === "string" ? original : JSON.stringify(original || "") }];
    for (const visual of visuals) {
      if (visual.label) content.push({ type: "text", text: visual.label });
      content.push({ type: "image_url", image_url: { url: visual.url, detail: "high" } });
    }
    normalized[i] = { ...normalized[i], content };
    return normalized;
  }
  function withAnthropicImages(messages, images) {
    const normalized = (messages || []).map((m) => ({ role: m.role, content: m.content }));
    const visuals = imageParts(images);
    if (!visuals.length) return normalized;
    let i = normalized.length - 1;
    while (i >= 0 && normalized[i].role !== "user") i--;
    if (i < 0) { normalized.push({ role: "user", content: "" }); i = normalized.length - 1; }
    const original = normalized[i].content;
    const content = [{ type: "text", text: typeof original === "string" ? original : JSON.stringify(original || "") }];
    for (const visual of visuals) {
      const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(visual.url);
      if (!match) continue;
      if (visual.label) content.push({ type: "text", text: visual.label });
      content.push({ type: "image", source: { type: "base64", media_type: match[1].toLowerCase(), data: match[2] } });
    }
    normalized[i] = { ...normalized[i], content };
    return normalized;
  }

  function embeddingBase(provider, localBase) {
    return chatBase(provider, localBase);
  }
  async function embed(modelRef, inputs, opts, signal) {
    opts = opts || {};
    const provider = modelRef && modelRef.provider;
    const model = modelRef && modelRef.model;
    const p = byId(provider);
    if (!p) throw new Error("Unknown provider " + provider);
    if (p.subscription || provider === "anthropic") throw new Error(p.label + " does not expose compatible embeddings.");
    const values = (Array.isArray(inputs) ? inputs : [inputs]).map((v) => String(v || ""));
    if (!values.length) return [];
    const base = embeddingBase(provider, opts.localBase);
    const headers = { "Content-Type": "application/json" };
    if (opts.key) headers.Authorization = "Bearer " + opts.key;
    if (provider === "openrouter") {
      headers["HTTP-Referer"] = "https://github.com/Drakonis96/nodus";
      headers["X-Title"] = "Nodus for Zotero";
    }
    const res = await fetch(base + "/embeddings", {
      method: "POST", headers,
      body: JSON.stringify({ model, input: values, encoding_format: "float" }),
      signal,
    });
    if (!res.ok) throw new Error(p.label + " embeddings HTTP " + res.status + " " + (await res.text()).slice(0, 200));
    const json = await res.json();
    const rows = Array.isArray(json && json.data) ? json.data.slice().sort((a, b) => Number(a.index) - Number(b.index)) : [];
    if (rows.length !== values.length || rows.some((r) => !Array.isArray(r.embedding))) throw new Error("Invalid embeddings response");
    return rows.map((r) => r.embedding.map(Number));
  }

  // Pure body builder for the Anthropic Messages API (unit-tested). `max_tokens`
  // is required by the API and was hardcoded to 4096, truncating long answers;
  // it is now configurable via opts.maxTokens. When reasoning is low/medium/high
  // we enable extended thinking and make room for it above max_tokens (Anthropic
  // counts thinking tokens toward max_tokens and requires max_tokens > budget).
  function buildAnthropicBody(model, system, messages, maxTokens, reasoning) {
    const body = { model, max_tokens: clampMaxTokens(maxTokens), stream: true, system: system || undefined, messages };
    const budget = THINK_BUDGET[reasoning];
    if (budget) {
      body.thinking = { type: "enabled", budget_tokens: budget };
      if (body.max_tokens <= budget) body.max_tokens = budget + clampMaxTokens(maxTokens);
    }
    return body;
  }

  function isProbablyTruncated(text, finishReason) {
    const value = String(text || "").trim();
    if (["length", "content_filter", "error"].includes(String(finishReason || "").toLowerCase())) return true;
    if (!value || value.length > 240) return false;
    if (/[.!?。！？…)\]}'"»”’]$/.test(value)) return false;
    return value.length >= 20 && value.split(/\s+/).length >= 4;
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
    const images = (opts && opts.images) || [];
    const maxTokens = opts && opts.maxTokens;
    const reasoning = (opts && opts.reasoning) || "default";

    if (provider === "anthropic") {
      return anthropicStream(key, model, system, withAnthropicImages(messages, images), maxTokens, reasoning, onDelta, signal);
    }
    // OpenAI-compatible (incl. gemini openai-compat, local servers)
    const base = chatBase(provider, opts && opts.localBase);
    const url = provider === "deepseek" ? "https://api.deepseek.com/chat/completions" : base + "/chat/completions";
    const headers = { "Content-Type": "application/json" };
    if (key) headers.Authorization = "Bearer " + key;
    if (provider === "openrouter") { headers["HTTP-Referer"] = "https://github.com/Drakonis96/nodus"; headers["X-Title"] = "Nodus for Zotero"; }
    const visualMessages = withOpenAiImages(messages, images);
    const body = { model, stream: true, messages: system ? [{ role: "system", content: system }, ...visualMessages] : visualMessages };
    // Only cap when the user configured a limit: omitting it lets the model use
    // its own (usually larger) default instead of an arbitrary ceiling.
    if (maxTokens) body.max_tokens = clampMaxTokens(maxTokens);
    Object.assign(body, reasoningBody(provider, reasoning));
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!res.ok || !res.body) throw new Error(p.label + " chat HTTP " + res.status + (res.ok ? "" : " " + (await res.text()).slice(0, 200)));
    let finishReason = "";
    await readSSE(res.body, (json) => {
      if (json && json.error) throw new Error(p.label + " stream error: " + String(json.error.message || json.error.code || "unknown"));
      const delta = json && json.choices && json.choices[0] && json.choices[0].delta;
      if (delta && typeof delta.content === "string") onDelta(delta.content);
      const reason = json && json.choices && json.choices[0] && json.choices[0].finish_reason;
      if (reason) finishReason = String(reason);
    });
    return { finishReason };
  }

  async function anthropicStream(key, model, system, messages, maxTokens, reasoning, onDelta, signal) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-api-key": key,
        "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(buildAnthropicBody(model, system, messages, maxTokens, reasoning)),
      signal,
    });
    if (!res.ok || !res.body) throw new Error("Anthropic chat HTTP " + res.status + " " + (res.ok ? "" : (await res.text()).slice(0, 200)));
    let finishReason = "";
    await readSSE(res.body, (json) => {
      if (json && json.type === "error") throw new Error("Anthropic stream error: " + String(json.error && json.error.message || "unknown"));
      if (json && json.type === "content_block_delta" && json.delta && typeof json.delta.text === "string") onDelta(json.delta.text);
      if (json && json.type === "message_delta" && json.delta && json.delta.stop_reason) finishReason = String(json.delta.stop_reason);
    });
    return { finishReason };
  }

  // Reads a text/event-stream, calling onJson for each `data: {json}` (ignores [DONE]).
  async function readSSE(stream, onJson) {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const processLine = (raw) => {
      const line = String(raw || "").replace(/\r$/, "").trim();
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      let json; try { json = JSON.parse(payload); } catch (e) { return; }
      onJson(json);
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        processLine(buf.slice(0, idx)); buf = buf.slice(idx + 1);
      }
    }
    buf += dec.decode();
    if (buf.trim()) processLine(buf);
  }

  window.NodusProviders = {
    PROVIDERS, byId, chatBase, listModels, chatStream, embed,
    buildAnthropicBody, withOpenAiImages, withAnthropicImages, imageParts,
    clampMaxTokens, DEFAULT_MAX_TOKENS, reasoningBody, REASONING_LEVELS, isProbablyTruncated,
  };
})();
