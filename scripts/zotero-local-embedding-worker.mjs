/*
 * Bundled into the Zotero XPI by build-zotero-xpi.mjs.  The worker keeps the
 * transformer and ONNX runtime away from Zotero's UI thread. Model weights are
 * downloaded once and persisted in a small IndexedDB-backed custom cache.
 *
 * Do not use Firefox Cache Storage here. Zotero 9.0.6 can segfault in its native
 * DOMCacheThread while committing the quantised ONNX response. IndexedDB keeps
 * the same one-time-download behaviour without touching that unstable path.
 */
import { env, pipeline } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/multilingual-e5-small';
const MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
const MODEL_DTYPE = 'q8';
const MODEL_DIMENSIONS = 384;
const MODEL_FINGERPRINT = `${MODEL_ID}@${MODEL_REVISION}:${MODEL_DTYPE}:mean:l2:v1`;
const WASM_ROOT = 'chrome://nodus/content/runtime/';
const CACHE_DB = 'nodus-local-embedding-models-v1';
const CACHE_STORE = 'responses';

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = false;
env.useFSCache = false;
env.useCustomCache = true;
env.customCache = createIndexedDbCache();
env.backends.onnx.wasm.wasmPaths = WASM_ROOT;
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.numThreads = Math.max(
  1,
  Math.min(4, Number(globalThis.navigator?.hardwareConcurrency) || 2),
);

let extractorPromise = null;
let backendUsed = null;

function createIndexedDbCache() {
  let dbPromise = null;

  function cacheKey(value) {
    return typeof value === 'string' ? value : String(value && value.url || value);
  }

  function openDatabase() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(CACHE_DB, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
        };
        request.onerror = () => reject(request.error || new Error('local-model-cache-open-failed'));
        request.onblocked = () => reject(new Error('local-model-cache-blocked'));
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            dbPromise = null;
          };
          resolve(db);
        };
      }).catch((error) => {
        dbPromise = null;
        throw error;
      });
    }
    return dbPromise;
  }

  async function read(key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(key);
      request.onerror = () => reject(request.error || new Error('local-model-cache-read-failed'));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function write(key, value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE, 'readwrite');
      transaction.onerror = () => reject(transaction.error || new Error('local-model-cache-write-failed'));
      transaction.onabort = () => reject(transaction.error || new Error('local-model-cache-write-aborted'));
      transaction.oncomplete = () => resolve();
      transaction.objectStore(CACHE_STORE).put(value, key);
    });
  }

  return {
    async match(request) {
      const record = await read(cacheKey(request));
      if (!record || !record.body) return undefined;
      return new Response(record.body, {
        status: Number(record.status) || 200,
        statusText: String(record.statusText || ''),
        headers: Array.isArray(record.headers) ? record.headers : [],
      });
    },
    async put(request, response) {
      const body = await response.blob();
      await write(cacheKey(request), {
        body,
        status: response.status,
        statusText: response.statusText,
        headers: Array.from(response.headers.entries()),
        savedAt: Date.now(),
      });
    },
  };
}

function progressCallback(progress) {
  const safe = progress && typeof progress === 'object'
    ? {
        status: String(progress.status || ''),
        file: String(progress.file || ''),
        progress: Number(progress.progress) || 0,
        loaded: Number(progress.loaded) || 0,
        total: Number(progress.total) || 0,
      }
    : { status: String(progress || '') };
  globalThis.postMessage({ type: 'progress', progress: safe });
}

async function extractor() {
  if (!extractorPromise) {
    extractorPromise = createExtractor().catch((error) => {
      extractorPromise = null;
      throw error;
    });
  }
  return extractorPromise;
}

// WebGPU is much faster than WASM for this model when it's actually available
// and stable, but Zotero runs on Firefox's engine where WebGPU support in
// ChromeWorkers varies by platform/version. Probe for navigator.gpu first and
// fall back to WASM on any failure so indexing never hard-fails because of it.
async function createExtractor() {
  const canTryWebgpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  if (canTryWebgpu) {
    try {
      const model = await pipeline('feature-extraction', MODEL_ID, {
        revision: MODEL_REVISION,
        dtype: MODEL_DTYPE,
        device: 'webgpu',
        progress_callback: progressCallback,
      });
      backendUsed = 'webgpu';
      globalThis.postMessage({ type: 'backend', backend: backendUsed });
      return model;
    } catch (error) {
      // Fall through to WASM below.
    }
  }
  const model = await pipeline('feature-extraction', MODEL_ID, {
    revision: MODEL_REVISION,
    dtype: MODEL_DTYPE,
    device: 'wasm',
    progress_callback: progressCallback,
  });
  backendUsed = 'wasm';
  globalThis.postMessage({ type: 'backend', backend: backendUsed });
  return model;
}

function prefix(role, value) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return `${role === 'query' ? 'query' : 'passage'}: ${text}`;
}

async function embed(role, values) {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) return [];
  const model = await extractor();
  const output = await model(list.map((value) => prefix(role, value)), {
    pooling: 'mean',
    normalize: true,
  });
  const vectors = output.tolist();
  if (
    !Array.isArray(vectors)
    || vectors.length !== list.length
    || vectors.some((vector) => !Array.isArray(vector) || vector.length !== MODEL_DIMENSIONS)
  ) {
    throw new Error('local-embedding-shape-mismatch');
  }
  return vectors;
}

globalThis.addEventListener('message', async (event) => {
  const message = event && event.data ? event.data : {};
  const id = String(message.id || '');
  try {
    if (message.type === 'info') {
      globalThis.postMessage({
        type: 'result',
        id,
        result: {
          model: MODEL_ID,
          revision: MODEL_REVISION,
          dtype: MODEL_DTYPE,
          dimensions: MODEL_DIMENSIONS,
          fingerprint: MODEL_FINGERPRINT,
          backend: backendUsed,
        },
      });
      return;
    }
    if (message.type === 'warmup') {
      await extractor();
      globalThis.postMessage({ type: 'result', id, result: { ready: true, backend: backendUsed } });
      return;
    }
    if (message.type !== 'embed') throw new Error('unknown-local-embedding-message');
    const result = await embed(message.role === 'query' ? 'query' : 'passage', message.values);
    globalThis.postMessage({ type: 'result', id, result });
  } catch (error) {
    globalThis.postMessage({
      type: 'error',
      id,
      error: String(error && (error.stack || error.message) || error),
    });
  }
});
