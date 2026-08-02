// Append-only mutation ledger, one NDJSON file per space.
//
// Not a key in state.json: `Store.save()` rewrites that entire file on every change, so a
// space accumulating tens of thousands of mutations would rewrite megabytes on each login.
// Append-only also means a crash mid-write costs at most the last line, and the sequence
// numbers a reader has already acknowledged can never move under it.

import fs from 'node:fs';
import path from 'node:path';

/** Ledger lines are only ever appended, so the id set can be rebuilt by reading once. */
const seenIds = new Map();

function loadIds(store, spaceId) {
  const cached = seenIds.get(spaceId);
  if (cached) return cached;
  const ids = new Set();
  for (const entry of readAll(store, spaceId)) ids.add(entry.id);
  seenIds.set(spaceId, ids);
  return ids;
}

export function readAll(store, spaceId) {
  const file = store.mutationsPath(spaceId);
  if (!fs.existsSync(file)) return [];
  const entries = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* a torn final line is simply skipped */ }
  }
  return entries;
}

export function nextSeq(store, spaceId) {
  const all = readAll(store, spaceId);
  return all.length === 0 ? 1 : Math.max(...all.map((entry) => Number(entry.seq) || 0)) + 1;
}

export function has(store, spaceId, id) {
  return loadIds(store, spaceId).has(id);
}

export function append(store, spaceId, entries) {
  if (entries.length === 0) return [];
  const file = store.mutationsPath(spaceId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let seq = nextSeq(store, spaceId);
  const stamped = entries.map((entry) => ({ ...entry, seq: seq++ }));
  fs.appendFileSync(file, `${stamped.map((entry) => JSON.stringify(entry)).join('\n')}\n`, { mode: 0o600 });
  const ids = loadIds(store, spaceId);
  for (const entry of stamped) ids.add(entry.id);
  return stamped;
}

export function since(store, spaceId, cursor, limit) {
  const all = readAll(store, spaceId).filter((entry) => Number(entry.seq) > Number(cursor || 0));
  all.sort((a, b) => Number(a.seq) - Number(b.seq));
  const slice = all.slice(0, limit);
  return {
    mutations: slice,
    cursor: slice.length ? Number(slice.at(-1).seq) : Number(cursor || 0),
    hasMore: all.length > slice.length,
  };
}

/**
 * Drop everything at or below `cursor` once the owner has applied it.
 *
 * Compaction is what keeps the file from growing without bound, and it is safe precisely
 * because the owner only acknowledges after its transaction has committed.
 */
export function compact(store, spaceId, cursor) {
  const remaining = readAll(store, spaceId).filter((entry) => Number(entry.seq) > Number(cursor || 0));
  const file = store.mutationsPath(spaceId);
  if (remaining.length === 0) {
    fs.rmSync(file, { force: true });
  } else {
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, `${remaining.map((entry) => JSON.stringify(entry)).join('\n')}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  }
  seenIds.delete(spaceId);
  return remaining.length;
}

export function pendingAssetHashes(store, spaceId) {
  const hashes = new Set();
  for (const entry of readAll(store, spaceId)) {
    for (const asset of Array.isArray(entry.assets) ? entry.assets : []) {
      if (typeof asset?.hash === 'string') hashes.add(asset.hash);
    }
  }
  return hashes;
}

export function forget(store, spaceId) {
  seenIds.delete(spaceId);
}
