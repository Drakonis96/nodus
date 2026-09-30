import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { getEventListeners } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
installRuntimeHooks(path.join(os.tmpdir(), 'nodus-zotero-item-presence-test'));
const require = createRequire(import.meta.url);
const zotero = require(path.join(repoRoot, 'electron/zotero/zoteroClient.ts'));

// Zotero's local API reports no deletions (/deleted answers 404) and leaves trashed items out of
// collection listings, so a sync that stops seeing an item has to ask about it directly.
async function presenceWith(respond) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return respond(String(url)); };
  try {
    return { presence: await zotero.itemPresence('0', 'ABCD1234'), seen };
  } finally {
    globalThis.fetch = original;
  }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Last-Modified-Version': '42' } });

test('an item Zotero still lists normally is present', async () => {
  const { presence, seen } = await presenceWith(() => json({ key: 'ABCD1234', data: { key: 'ABCD1234', title: 'A book' } }));
  assert.equal(presence, 'present');
  assert.match(seen[0], /\/users\/0\/items\/ABCD1234$/);
});

test('an item in Zotero\'s Trash is trashed', async () => {
  const { presence } = await presenceWith(() => json({ key: 'ABCD1234', data: { key: 'ABCD1234', title: 'A book', deleted: true } }));
  assert.equal(presence, 'trashed');
  const numeric = await presenceWith(() => json({ key: 'ABCD1234', data: { deleted: 1 } }));
  assert.equal(numeric.presence, 'trashed', 'the Web API writes deleted as 1');
});

test('an item Zotero no longer knows (the Trash was emptied) is gone', async () => {
  const { presence } = await presenceWith(url => url.endsWith('/items?limit=1') ? json([]) : new Response('Not found', { status: 404 }));
  assert.equal(presence, 'gone');
});

test('Zotero unreachable or failing is unknown, never gone', async () => {
  assert.equal((await presenceWith(() => new Response('boom', { status: 500 }))).presence, 'unknown');
  assert.equal((await presenceWith(() => { throw new TypeError('fetch failed'); })).presence, 'unknown');
});

test('a group item is asked for in its group library', async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); return json({ data: {} }); };
  try { await zotero.itemPresence('0', 'groups:5857421:V3HF3DBT'); } finally { globalThis.fetch = original; }
  assert.match(urls[0], /\/groups\/5857421\/items\/V3HF3DBT$/);
});

test('a missing source library is unknown, including groups and an unavailable API route', async () => {
  assert.equal((await presenceWith(() => new Response('Not found', { status: 404 }))).presence, 'unknown');
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('Not found', { status: 404 });
  try { assert.equal(await zotero.itemPresence('0', 'groups:42:ABCD1234'), 'unknown'); }
  finally { globalThis.fetch = original; }
});

test('a missing group item is gone only with a readable group library', async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return String(url).endsWith('/groups/42/items?limit=1') ? json([]) : new Response('Not found', { status: 404 });
  };
  try { assert.equal(await zotero.itemPresence('0', 'groups:42:ABCD1234'), 'gone'); }
  finally { globalThis.fetch = original; }
  assert.equal(urls.length, 2);
});

test('malformed deletion flags and invalid item bodies never authorize archiving', async () => {
  for (const body of [{}, null, { data: [] }, { data: { deleted: '1' } }, { data: { deleted: 2 } }]) {
    assert.equal((await presenceWith(() => json(body))).presence, 'unknown');
  }
  for (const deleted of [false, 0]) assert.equal((await presenceWith(() => json({ data: { deleted } }))).presence, 'present');
});

test('HTTP retries and source validation consume the same request budget', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('retry', { status: 503 }); };
  const session = { budget: { remaining: 2 }, libraries: new Map() };
  try {
    assert.equal((await zotero.itemPresenceDetails('0', 'ABCD1234', session)).presence, 'unknown');
    assert.equal(calls, 2);
    assert.equal(session.budget.remaining, 0);
    assert.equal((await zotero.itemPresenceDetails('0', 'SECOND01', session)).presence, 'unknown');
    assert.equal(calls, 2, 'no HTTP request after exhaustion');
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('missing', { status: 404 }); };
    assert.equal((await zotero.itemPresenceDetails('0', 'ABCD1234', { budget: { remaining: 1 }, libraries: new Map() })).presence, 'unknown');
    assert.equal(calls, 1, '404 without a budget to validate the source remains unknown');
  } finally { globalThis.fetch = original; }
});

test('completed HTTP retries remove their abort listeners from the shared batch signal', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('retry', { status: 503, headers: { 'Retry-After': '0' } });
  const signal = new AbortController().signal;
  const session = { budget: { remaining: 30 }, libraries: new Map(), signal };
  try {
    for (let i = 0; i < 10; i++) assert.equal((await zotero.itemPresenceDetails('0', 'RETRY001', session)).presence, 'unknown');
    assert.equal(getEventListeners(signal, 'abort').length, 0);
  } finally { globalThis.fetch = original; }
});
