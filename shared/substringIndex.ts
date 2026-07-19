/**
 * Counts, for each of many patterns, how many haystacks contain it as a
 * substring — in one pass over the haystacks rather than one pass per pattern.
 *
 * The reading path scores every work against every row of `external_refs`,
 * asking `ref.includes(author) || ref.includes(title)`. That is
 * O(works x refs) substring searches: 3,000 works against 60,000 references
 * measured 13 s of blocked main process, and the handler is synchronous.
 *
 * This is Aho-Corasick, which is used specifically because it preserves
 * `includes` semantics exactly — a token or word index would be faster still
 * but would stop matching patterns that occur inside a longer word, silently
 * changing the ranking users see.
 *
 * Build once for all patterns, then stream the haystacks through it. Cost is
 * O(total pattern length + total haystack length + matches) instead of the
 * product of the two collections.
 */

interface Node {
  /** Character -> child index. */
  next: Map<string, number>;
  /** Longest proper suffix of this node's string that is also a prefix of some pattern. */
  fail: number;
  /** Pattern ids ending exactly at this node. */
  outputs: number[];
  /** Nearest ancestor-by-fail-link that has outputs, or -1. Collapses the report walk. */
  dictLink: number;
}

export class SubstringIndex {
  private readonly nodes: Node[] = [{ next: new Map(), fail: 0, outputs: [], dictLink: -1 }];
  /** Deduplicated patterns, in insertion order. */
  private readonly patterns: string[] = [];
  private readonly idByPattern = new Map<string, number>();
  private built = false;

  /**
   * Register a pattern and return its id. Empty patterns are rejected with -1:
   * every string trivially contains "", which is never a useful answer here.
   * Repeated patterns share an id, so callers can add freely without deduping.
   */
  add(pattern: string): number {
    if (!pattern) return -1;
    const existing = this.idByPattern.get(pattern);
    if (existing !== undefined) return existing;
    if (this.built) throw new Error('SubstringIndex: cannot add patterns after building');

    const id = this.patterns.length;
    this.patterns.push(pattern);
    this.idByPattern.set(pattern, id);

    let node = 0;
    for (const char of pattern) {
      let child = this.nodes[node].next.get(char);
      if (child === undefined) {
        child = this.nodes.length;
        this.nodes.push({ next: new Map(), fail: 0, outputs: [], dictLink: -1 });
        this.nodes[node].next.set(char, child);
      }
      node = child;
    }
    this.nodes[node].outputs.push(id);
    return id;
  }

  /** Wire the failure links. Called automatically on first count(). */
  build(): void {
    if (this.built) return;
    this.built = true;
    const queue: number[] = [];
    for (const child of this.nodes[0].next.values()) {
      this.nodes[child].fail = 0;
      queue.push(child);
    }
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      const node = this.nodes[current];
      const failNode = this.nodes[node.fail];
      node.dictLink = failNode.outputs.length > 0 ? node.fail : failNode.dictLink;
      for (const [char, child] of node.next) {
        let fallback = node.fail;
        // Walk the failure chain until the character is matchable or we hit the root.
        while (fallback !== 0 && !this.nodes[fallback].next.has(char)) fallback = this.nodes[fallback].fail;
        const candidate = this.nodes[fallback].next.get(char);
        this.nodes[child].fail = candidate !== undefined && candidate !== child ? candidate : 0;
        queue.push(child);
      }
    }
  }

  /**
   * How many of the given haystacks contain each pattern.
   *
   * A pattern occurring several times in one haystack counts once, matching the
   * `haystacks.filter(h => h.includes(p)).length` it replaces.
   *
   * @returns counts indexed by the id returned from `add`.
   */
  countContainingHaystacks(haystacks: Iterable<string>): number[] {
    return this.scan(haystacks, null, this.patterns.length);
  }

  /**
   * How many haystacks match *any* pattern of each group.
   *
   * Groups exist because the caller asks a union question — "does this
   * reference mention the author OR the title of this work" — and a reference
   * matching both must still count once. Summing per-pattern counts would
   * double it.
   *
   * @param groupsByPattern for each pattern id, the groups it belongs to.
   *   Patterns are deduplicated, so one pattern can serve several groups.
   */
  countContainingHaystacksByGroup(
    haystacks: Iterable<string>,
    groupsByPattern: ReadonlyArray<readonly number[]>,
    groupCount: number
  ): number[] {
    return this.scan(haystacks, groupsByPattern, groupCount);
  }

  private scan(
    haystacks: Iterable<string>,
    groupsByPattern: ReadonlyArray<readonly number[]> | null,
    bucketCount: number
  ): number[] {
    this.build();
    const counts = new Array<number>(bucketCount).fill(0);
    if (this.patterns.length === 0 || bucketCount === 0) return counts;
    // Which bucket was already credited for the haystack being scanned, so a
    // pattern occurring twice in one haystack still counts once.
    const seenIn = new Int32Array(bucketCount).fill(-1);
    let haystackIndex = 0;

    for (const haystack of haystacks) {
      let node = 0;
      for (const char of haystack) {
        while (node !== 0 && !this.nodes[node].next.has(char)) node = this.nodes[node].fail;
        node = this.nodes[node].next.get(char) ?? 0;
        // Report this node's outputs, then every shorter pattern ending here.
        for (let cursor = node; cursor !== -1; cursor = this.nodes[cursor].dictLink) {
          for (const id of this.nodes[cursor].outputs) {
            const buckets = groupsByPattern ? groupsByPattern[id] : null;
            if (buckets === null) {
              if (seenIn[id] === haystackIndex) continue;
              seenIn[id] = haystackIndex;
              counts[id] += 1;
              continue;
            }
            for (const bucket of buckets) {
              if (seenIn[bucket] === haystackIndex) continue;
              seenIn[bucket] = haystackIndex;
              counts[bucket] += 1;
            }
          }
        }
      }
      haystackIndex += 1;
    }
    return counts;
  }
}
