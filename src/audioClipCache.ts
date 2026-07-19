/**
 * Byte-bounded LRU for narrated audio clips.
 *
 * Clips are held as `data:` URLs — base64, so ~1.33x the encoded audio — and the
 * player's cache previously had no bound at all: it was only cleared when the
 * provider unmounted, and the provider wraps the whole app, so every clip ever
 * played stayed pinned in the renderer heap for the lifetime of the session.
 * Listening to a couple of long reports was enough to grow RSS by hundreds of
 * megabytes that never came back.
 *
 * Entries are capped by total size rather than by count because clip sizes vary
 * by orders of magnitude — a 3-second sentence and a 40-minute report should not
 * both count as "one entry".
 *
 * Evicting a clip that is currently playing is harmless: the `<audio>` element
 * holds its own copy of the `src` string, so dropping our reference does not
 * interrupt playback — it only means re-fetching that clip if it is replayed.
 */

/** Roughly 64 MB of base64 text. Comfortably holds a long listening session. */
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export class AudioClipCache {
  private readonly entries = new Map<string, string>();
  private bytes = 0;

  constructor(private readonly maxBytes: number = DEFAULT_MAX_BYTES) {}

  /** Current total size of everything held, in characters of data-URL text. */
  get size(): number {
    return this.bytes;
  }

  get count(): number {
    return this.entries.size;
  }

  /** Fetch and mark as most-recently-used. */
  get(id: string): string | undefined {
    const value = this.entries.get(id);
    if (value === undefined) return undefined;
    // Re-insert so Map iteration order tracks recency: oldest key is evicted first.
    this.entries.delete(id);
    this.entries.set(id, value);
    return value;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  set(id: string, value: string): void {
    const existing = this.entries.get(id);
    if (existing !== undefined) {
      this.bytes -= existing.length;
      this.entries.delete(id);
    }
    // A single clip larger than the whole budget is not worth evicting
    // everything else for; skip caching it rather than thrashing.
    if (value.length > this.maxBytes) return;
    this.entries.set(id, value);
    this.bytes += value.length;
    this.evictToFit();
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  private evictToFit(): void {
    for (const oldest of this.entries.keys()) {
      if (this.bytes <= this.maxBytes) return;
      const value = this.entries.get(oldest);
      this.entries.delete(oldest);
      this.bytes -= value?.length ?? 0;
    }
  }
}
