/** Saved with the conversation's context, never with global/Nodi settings. */
export interface ResearchSourceFilter {
  enabled: boolean;
  authorIds: string[];
  workIds: string[];
}

export interface ResearchContextSources {
  authors: Array<{ id: string; name: string; workIds: string[] }>;
  works: Array<{ id: string; title: string; authors: string[]; year: number | null }>;
}

export function normalizeResearchSourceFilter(value?: ResearchSourceFilter): ResearchSourceFilter {
  const ids = (items: unknown) => Array.isArray(items)
    ? [...new Set(items.filter((id): id is string => typeof id === 'string' && !!id.trim()))].sort() : [];
  return { enabled: value?.enabled === true, authorIds: ids(value?.authorIds), workIds: ids(value?.workIds) };
}

/** OR within each selector, AND between authors and works. Empty active filters
 * match nothing; they must never broaden a request to the entire vault. */
export function matchingResearchWorkIds(sources: ResearchContextSources, value: ResearchSourceFilter): string[] {
  const filter = normalizeResearchSourceFilter(value);
  if (!filter.enabled) return sources.works.map(work => work.id);
  if (!filter.authorIds.length && !filter.workIds.length) return [];
  const authors = new Set(filter.authorIds);
  const authored = new Set(sources.authors.filter(author => authors.has(author.id)).flatMap(author => author.workIds));
  const works = new Set(filter.workIds);
  return sources.works.filter(work => (!authors.size || authored.has(work.id)) && (!works.size || works.has(work.id))).map(work => work.id);
}
