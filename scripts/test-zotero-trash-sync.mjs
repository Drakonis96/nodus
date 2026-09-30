// A work whose Zotero item was trashed or deleted is archived by the next full sync. Zotero's
// local API reports no deletions and leaves trashed items out of collection listings, so the sync
// asks Zotero about the works it stopped seeing (electron/sync/zoteroRemoval.ts).
//
// Runs the real module against a fully migrated scratch database under Electron-as-Node
// (better-sqlite3 ABI), like test-library-integrity-fixes.mjs, with Zotero's replies faked.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks as installSharedRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const marker = '--electron-zotero-trash-sync-test';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-zotero-trash-sync-'));
installSharedRuntimeHooks(root);
const Module = require('node:module');
const sharedResolve = Module._resolveFilename;
const databaseStub = path.join(root, 'stub-database.cjs');
fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__zoteroTrashDb;\nexports.setVectorScanQuery = () => {};\nexports.withDatabaseContext = (_db, work) => work();\n');
Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  const resolved = sharedResolve.call(this, request, parent, isMain, options);
  return resolved === path.join(repoRoot, 'electron/db/database.ts') ? databaseStub : resolved;
};

try {
  const Database = require('better-sqlite3');
  const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const db = new Database(path.join(root, 'library.sqlite'));
  runMigrations(db);
  globalThis.__zoteroTrashDb = db;
  const { archiveWorksRemovedFromZotero, unobservedUnmonitoredWorks } = require(path.join(repoRoot, 'electron/sync/zoteroRemoval.ts'));

  const work = (id, key, archived = 0) => db.prepare(
    `INSERT INTO works (nodus_id, zotero_key, zotero_version, title, authors_json, year, item_type, doi, read_tag, archived)
     VALUES (?, ?, 1, ?, '[]', NULL, 'book', NULL, 0, ?)`).run(id, key, `Work ${id}`, archived);
  const inCollection = (id, collection) => db.prepare('INSERT INTO work_collections (nodus_id, collection_key) VALUES (?, ?)').run(id, collection);
  work('kept', 'KEPT0001'); inCollection('kept', 'MONITOR1');          // still in the monitored collection
  work('trashed', 'TRASH001'); inCollection('trashed', 'GROUPCOL');     // left it: trashed in Zotero
  work('deleted', 'groups:42:GONE0001');                                // a group item deleted outright
  work('seen', 'SEEN0001');                                             // outside, but the sync saw it this pass
  work('moved', 'MOVED001');                                            // moved out of the monitored collections
  work('offline', 'OFFLINE1');                                          // Zotero could not answer about it
  work('local', 'nodus-library:abc');                                   // not a Zotero work
  work('old', 'OLD00001', 1);                                           // already archived

  // Selection: unseen works outside every monitored collection, bounded.
  const observed = new Map([['SEEN0001', new Set(['OTHER'])]]);
  const candidates = unobservedUnmonitoredWorks(observed, ['MONITOR1'], 300).sort();
  assert.deepEqual(candidates, ['deleted', 'moved', 'offline', 'trashed']);
  assert.equal(unobservedUnmonitoredWorks(observed, ['MONITOR1'], 2).length, 2, 'the probe count is bounded');
  assert.deepEqual(unobservedUnmonitoredWorks(observed, [], 300), [], 'no monitored collection, no probing');

  // Decision: Zotero says trashed or unknown-to-it → archived; present or unreachable → kept.
  const original = globalThis.fetch;
  const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Last-Modified-Version': '42' } });
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/items?limit=1')) return json([]);
    if (u.endsWith('/users/0/items/TRASH001')) return json({ data: { key: 'TRASH001', deleted: true } });
    if (u.endsWith('/groups/42/items/GONE0001')) return new Response('Not found', { status: 404 });
    if (u.endsWith('/users/0/items/MOVED001')) return new Response(JSON.stringify({ data: { key: 'MOVED001' } }), { status: 200 });
    if (u.endsWith('/users/0/items/OFFLINE1')) return new Response('down', { status: 500 });
    throw new Error(`unexpected request ${u}`);
  };
  let archived;
  try { archived = await archiveWorksRemovedFromZotero('0', ['trashed', 'deleted', 'moved', 'offline', 'local', 'old']); }
  finally { globalThis.fetch = original; }
  assert.equal(archived, 2);
  const state = Object.fromEntries(db.prepare('SELECT nodus_id, archived FROM works').all().map((row) => [row.nodus_id, row.archived]));
  assert.deepEqual(state, { kept: 0, trashed: 1, deleted: 1, seen: 0, moved: 0, offline: 0, local: 0, old: 1 });
  console.log('OK: trashed and deleted Zotero items are archived; moved, unreachable, local and seen works are kept.');
} finally {
  await rm(root, { recursive: true, force: true });
}
