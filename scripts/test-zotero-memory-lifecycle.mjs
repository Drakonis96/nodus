import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

function loadContentScript(relativePath, extraGlobals = {}) {
  const sandbox = {
    window: {},
    Zotero: { logError() {} },
    ChromeUtils: { importESModule: () => ({ Zotero: { logError() {} } }) },
    console,
    ...extraGlobals,
  };
  vm.createContext(sandbox);
  vm.runInContext(readSource(relativePath), sandbox, { filename: relativePath });
  return sandbox.window;
}

test('evidence cache compaction removes coordinate-heavy duplicate maps', () => {
  const { NodusStore: store } = loadContentScript('zotero-plugin/content/store.js');
  const index = {
    pages: [{ text: 'alpha', rawText: 'alpha', spans: [{ start: 0, end: 5, rect: [1, 2, 3, 4], text: 'alpha' }] }],
    chunks: [{ text: 'alpha', positions: [{ start: 0, end: 5, rect: [1, 2, 3, 4], text: 'alpha' }] }],
  };

  assert.equal(store.compactEvidenceIndex(index), true);
  assert.equal(index.pages[0].rawText, undefined);
  assert.equal(index.pages[0].spans, undefined);
  assert.equal(index.chunks[0].positions, undefined);
  assert.equal(index.pages[0].text, 'alpha');
  assert.equal(store.compactEvidenceIndex(index), false);
});

test('embedding worker terminates after idle and on sidebar unload', async () => {
  const workers = [];
  const timers = new Map();
  let nextTimer = 0;
  let unload = null;

  class FakeWorker {
    constructor() { this.listeners = {}; this.terminated = false; workers.push(this); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    postMessage(message) { this.message = message; }
    terminate() { this.terminated = true; }
    reply(result) { this.listeners.message({ data: { type: 'result', id: this.message.id, result } }); }
  }

  const fakeWindow = {
    addEventListener(type, listener) { if (type === 'unload') unload = listener; },
  };
  const { NodusLocalEmbeddings: embeddings } = loadContentScript('zotero-plugin/content/local-embeddings.js', {
    window: fakeWindow,
    ChromeWorker: FakeWorker,
    DOMException,
    setTimeout(listener, ms) { const id = ++nextTimer; timers.set(id, { listener, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });

  const completed = embeddings.embedPassages(['alpha']);
  workers[0].reply([[0.1, 0.2]]);
  await completed;
  const idle = [...timers.values()].find((timer) => timer.ms === 5 * 60 * 1000);
  assert.ok(idle);
  idle.listener();
  assert.equal(workers[0].terminated, true);

  const pending = embeddings.warmup();
  unload();
  await assert.rejects(pending, /local-embedding-reset/);
  assert.equal(workers[1].terminated, true);
});

test('library identity sync does not load every full index a second time', () => {
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  const start = sidebar.indexOf('async function syncLibraryIdentityBeforeSend()');
  const end = sidebar.indexOf('\nfunction availableContextTokens()', start);
  const body = sidebar.slice(start, end);
  assert.ok(body.includes('NS.listEvidenceRecords'));
  assert.ok(!body.includes('buildSelectedIndexes'));
});

test('sidebar and bootstrap release long-lived resources on unload', () => {
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  const bootstrap = readSource('zotero-plugin/bootstrap.js');
  assert.match(sidebar, /if \(NL && NL\.reset\) NL\.reset\(\)/);
  assert.match(sidebar, /NS\.closeEvidenceDb\(\)/);
  assert.match(sidebar, /clearTimeout\(refreshTimer\)/);
  assert.match(bootstrap, /_popupMods = null/);
});
