// The parsed publications this process is holding, bounded by what they weigh.
//
// A snapshot is read from disk as gzip, expanded to one JSON string and parsed into an
// object that every REST and MCP endpoint reads. Parsing is around 900 ms for a large space,
// so it has to be cached; the object is also the largest thing this process ever holds, so
// the cache has to have a ceiling.
//
// It used to keep three of them, of any size. Three is a sensible number for a small vault
// and a catastrophic one for a large vault: measured on a real academic corpus of 1,214
// works, one publication is 99 MB of JSON and 331 MB of heap once parsed, so the old rule
// authorised a gigabyte for a server nobody had told about it. Meanwhile a server with eight
// small spaces evicted a snapshot it had room for a hundred times over.
//
// So the budget is bytes. It counts EXPANDED JSON, which is what the caller has in hand at
// the moment it decides — the parsed object's real footprint cannot be asked of V8 without
// walking it. The two are related by roughly 3.3x on the corpora this was measured against
// (99 MB of JSON to 331 MB of heap), and that ratio is the thing to reason with when setting
// the ceiling for a machine.

export class SnapshotCache {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.entries = new Map();
    this.heldBytes = 0;
  }

  /**
   * The parsed snapshot for a space, if the one held matches the file on disk.
   *
   * A hit moves the entry to the end of the Map, which is what makes the eviction order
   * least-recently-USED rather than least-recently-loaded. Without it, the space every
   * request touches is evicted ahead of one nobody has opened since boot, purely because it
   * was read first.
   */
  get(spaceId, mtimeMs) {
    const entry = this.entries.get(spaceId);
    if (!entry || entry.mtimeMs !== mtimeMs) return null;
    this.entries.delete(spaceId);
    this.entries.set(spaceId, entry);
    return entry.value;
  }

  set(spaceId, mtimeMs, value, bytes) {
    // Map.set on a key that already exists keeps its original position, so a re-read would
    // stay wherever it first landed in the eviction order. Delete first, always.
    this.delete(spaceId);
    this.entries.set(spaceId, { mtimeMs, value, bytes });
    this.heldBytes += bytes;
    this.evict(spaceId);
  }

  delete(spaceId) {
    const entry = this.entries.get(spaceId);
    if (!entry) return false;
    this.entries.delete(spaceId);
    this.heldBytes -= entry.bytes;
    return true;
  }

  /**
   * Drop least-recently-used entries until the budget is met, never the one named.
   *
   * `keep` is the snapshot the caller is about to serve. A space larger than the whole budget
   * therefore stays — evicting it would mean answering the request that just loaded it with
   * something the process no longer has, and re-reading it on every single request after
   * that. One space over budget is a server that needs a bigger ceiling; one space that
   * cannot be served at all is a server that is broken.
   */
  evict(keep) {
    for (const [spaceId, entry] of this.entries) {
      if (this.heldBytes <= this.maxBytes) return;
      if (spaceId === keep) continue;
      this.entries.delete(spaceId);
      this.heldBytes -= entry.bytes;
    }
  }

  get size() {
    return this.entries.size;
  }

  /** Least recently used first. For tests and for anything that reports on the process. */
  ids() {
    return [...this.entries.keys()];
  }
}
