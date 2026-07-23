/* Nodus for Zotero — managed local multilingual-E5 embeddings.
 *
 * The heavyweight Transformer runs in a dedicated chrome worker.  This small
 * bridge owns request lifecycle, progress reporting, cancellation and recovery.
 */
/* eslint-disable no-undef */
(function () {
  "use strict";

  const MODEL = Object.freeze({
    id: "Xenova/multilingual-e5-small",
    revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
    dtype: "q8",
    dimensions: 384,
    fingerprint: "Xenova/multilingual-e5-small@761b726dd34fb83930e26aab4e9ac3899aa1fa78:q8:mean:l2:v1",
  });
  const WORKER_URL = "chrome://nodus/content/runtime/local-embedding-worker.js";

  let worker = null;
  let seq = 0;
  const pending = new Map();
  const progressListeners = new Set();

  function makeWorker() {
    if (worker) return worker;
    const WorkerImpl = typeof ChromeWorker !== "undefined" ? ChromeWorker : Worker;
    worker = new WorkerImpl(WORKER_URL);
    worker.addEventListener("message", (event) => {
      const message = event && event.data ? event.data : {};
      if (message.type === "progress") {
        for (const listener of progressListeners) {
          try { listener(message.progress || {}); } catch (e) {}
        }
        return;
      }
      const job = pending.get(String(message.id || ""));
      if (!job) return;
      pending.delete(String(message.id || ""));
      if (job.cleanup) job.cleanup();
      if (message.type === "error") job.reject(new Error(String(message.error || "local-embedding-failed")));
      else job.resolve(message.result);
    });
    worker.addEventListener("error", (event) => {
      const error = new Error(String(event && (event.message || event.error) || "local-embedding-worker-failed"));
      for (const job of pending.values()) {
        if (job.cleanup) job.cleanup();
        job.reject(error);
      }
      pending.clear();
      try { worker.terminate(); } catch (e) {}
      worker = null;
    });
    return worker;
  }

  function request(type, payload, signal) {
    if (signal && signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    const id = "le_" + Date.now() + "_" + (++seq);
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const job = pending.get(id);
        if (!job) return;
        pending.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const cleanup = signal ? () => signal.removeEventListener("abort", onAbort) : null;
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      pending.set(id, { resolve, reject, cleanup });
      try { makeWorker().postMessage({ id, type, ...(payload || {}) }); }
      catch (error) {
        pending.delete(id);
        if (cleanup) cleanup();
        reject(error);
      }
    });
  }

  function onProgress(listener) {
    if (typeof listener !== "function") return () => {};
    progressListeners.add(listener);
    return () => progressListeners.delete(listener);
  }

  async function embedPassages(values, opts) {
    return request("embed", { role: "passage", values: Array.isArray(values) ? values : [] }, opts && opts.signal);
  }
  async function embedQueries(values, opts) {
    return request("embed", { role: "query", values: Array.isArray(values) ? values : [] }, opts && opts.signal);
  }
  async function embedQuery(value, opts) {
    const vectors = await embedQueries([String(value || "")], opts);
    return vectors && vectors[0] ? vectors[0] : [];
  }
  async function warmup(opts) {
    return request("warmup", null, opts && opts.signal);
  }
  function reset() {
    if (worker) { try { worker.terminate(); } catch (e) {} }
    worker = null;
    for (const job of pending.values()) {
      if (job.cleanup) job.cleanup();
      job.reject(new Error("local-embedding-reset"));
    }
    pending.clear();
  }

  window.NodusLocalEmbeddings = {
    MODEL,
    embedPassages,
    embedQueries,
    embedQuery,
    warmup,
    onProgress,
    reset,
  };
})();
