import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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
  const { presence } = await presenceWith(() => new Response('Not found', { status: 404 }));
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
