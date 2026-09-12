/** Shared relevance scale: exact phrases lead, semantic matches complement partial text. */
export interface SearchableHit {
  kind: string;
  id: string;
  title: string;
  subtitle?: string | null;
  snippet?: string | null;
  similarity?: number | null;
  relevance?: number;
  /** Internal eligibility for deriving embeddings; literal local retrieval is independent. */
  semanticAllowed?: boolean;
}
export function foldSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}
export function literalRelevance(query: string, hit: Pick<SearchableHit, 'title' | 'subtitle' | 'snippet'>): number {
  const q = foldSearchText(query);
  if (!q) return 0;
  const title = foldSearchText(hit.title);
  const body = foldSearchText(`${hit.subtitle ?? ''} ${hit.snippet ?? ''}`);
  if (title === q) return 1;
  if (title.includes(q)) return 0.94;
  if (body.includes(q)) return 0.86;
  const terms = [...new Set(q.split(' ').filter(Boolean))];
  const coverage = terms.filter((term) => `${title} ${body}`.includes(term)).length / terms.length;
  return coverage ? 0.65 * coverage : 0;
}
/** Filter before merging and limiting, deduplicate by entity, then rank across kinds. */
export function mergeHybridResults<T extends SearchableHit>(
  query: string, literal: T[], semantic: T[], kinds?: ReadonlySet<string>, limit = 250,
): T[] {
  const unique = new Map<string, T>();
  for (const hit of [...literal, ...semantic]) {
    if (kinds && !kinds.has(hit.kind)) continue;
    const key = `${hit.kind}:${hit.id}`;
    const previous = unique.get(key);
    const similarity = Math.max(previous?.similarity ?? 0, hit.similarity ?? 0);
    // Preserve navigation metadata from the literal hit and prefer the matching excerpt.
    const combined = { ...hit, ...previous, similarity: similarity || undefined };
    const lexical = Math.max(literalRelevance(query, hit), hit.relevance ?? 0, previous?.relevance ?? 0);
    combined.relevance = Math.max(lexical, Math.max(0, Math.min(1, similarity)) * 0.85);
    unique.set(key, combined);
  }
  return [...unique.values()].sort((a, b) =>
    (b.relevance ?? 0) - (a.relevance ?? 0) || (b.similarity ?? 0) - (a.similarity ?? 0)
    || a.title.localeCompare(b.title) || `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
  ).slice(0, limit);
}

export interface VaultContentHit extends SearchableHit {
  databaseId?: string;
  sourceId?: string | null;
  personId?: string | null;
  factoidId?: string | null;
  deepLink?: string;
}
export interface VaultContentSearchResponse {
  hasMore?: boolean;
  results: VaultContentHit[];
  semanticAvailable: boolean;
}

/** A compact, query-centred excerpt; ranking always uses the complete source text. */
export function searchSnippet(text: string | null | undefined, query: string, max = 400): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const at = foldSearchText(clean).indexOf(foldSearchText(query));
  const start = Math.max(0, at - Math.floor(max / 3));
  return `${start ? '…' : ''}${clean.slice(start, start + max)}${start + max < clean.length ? '…' : ''}`;
}
