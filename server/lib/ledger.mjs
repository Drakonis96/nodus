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

/**
 * The next sequence number for this space, never one already handed out.
 *
 * Seeded from the acknowledged cursor as well as from the file, because `compact` DELETES
 * the file once it empties. Reading only the file therefore restarted numbering at 1 after
 * a full compaction, and a client that had remembered "delivered up to 12" would then read
 * brand-new mutations 1..12 as already delivered. The cursor is the high-water mark of what
 * this space has ever issued; the file only holds what has not been acknowledged yet.
 */
export function nextSeq(store, spaceId) {
  const all = readAll(store, spaceId);
  const space = store.state.spaces.find((candidate) => candidate.id === spaceId);
  const acknowledged = Number(space?.mutationCursor || 0);
  const highest = all.length === 0 ? 0 : Math.max(...all.map((entry) => Number(entry.seq) || 0));
  return Math.max(highest, acknowledged) + 1;
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

/**
 * One page of undelivered mutations, bounded by count AND by bytes.
 *
 * Counting entries alone was safe only while an entry could not be large. It cannot survive a
 * bigger row cap: this response is built with JSON.stringify into a single string, and Node
 * refuses strings past 512 MiB, so 200 entries of a quarter-megabyte each is a response the
 * process may be unable to hold — in a process that may already be holding a parsed snapshot
 * of several hundred megabytes. The byte budget is the real bound; the count survives as a
 * cheap upper limit.
 *
 * The first entry is always returned even when it alone blows the budget. Skipping it would
 * be worse than a large response: the owner acknowledges by cursor, so an entry that is never
 * handed over is an entry that can never be acknowledged, and the ledger would stop draining
 * at that row forever. `hasMore` then carries the paging, which both clients already follow.
 */
export function since(store, spaceId, cursor, limit, maxBytes = Infinity) {
  const all = readAll(store, spaceId).filter((entry) => Number(entry.seq) > Number(cursor || 0));
  all.sort((a, b) => Number(a.seq) - Number(b.seq));
  const slice = [];
  let bytes = 0;
  for (const entry of all) {
    if (slice.length >= limit) break;
    bytes += Buffer.byteLength(JSON.stringify(entry));
    if (slice.length > 0 && bytes > maxBytes) break;
    slice.push(entry);
  }
  return {
    mutations: slice,
    cursor: slice.length ? Number(slice.at(-1).seq) : Number(cursor || 0),
    hasMore: all.length > slice.length,
  };
}

/**
 * How much undrained ledger this space is holding.
 *
 * The file size, not a sum over parsed entries: this is asked on every write to decide whether
 * to accept more, and re-reading the whole ledger to answer it would make each write cost the
 * size of every write before it.
 */
export function bytes(store, spaceId) {
  try { return fs.statSync(store.mutationsPath(spaceId)).size; } catch { return 0; }
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
