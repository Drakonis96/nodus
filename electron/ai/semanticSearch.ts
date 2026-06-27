// Meaning-based search over the embedded corpus. The text search in
// db/searchRepo.ts matches characters (LIKE); this one matches meaning by
// embedding the query and ranking ideas, passages and works by cosine
// similarity. Requires an embedding provider configured in Settings — when none
// is available `available:false` is returned so the UI can explain why.
import type {
  GlobalSearchResult,
  SearchResultKind,
  SemanticSearchOptions,
  SemanticSearchResponse,
} from '@shared/types';
import { getDb } from '../db/database';
import { findSimilarIdeas, getIdea } from '../db/ideasRepo';
import { findSimilarPassages } from '../db/passagesRepo';
import { findSimilarWorks } from '../db/workSummariesRepo';
import { embed } from './aiClient';

const DEFAULT_KINDS: SearchResultKind[] = ['idea', 'passage', 'work'];
const SEMANTIC_KINDS: SearchResultKind[] = ['idea', 'passage', 'work'];
const DEFAULT_LIMIT = 12;
const DEFAULT_MIN_SIMILARITY = 0.2;

function snippet(text: string | null | undefined, max = 200): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function parseAuthors(json: string | null): string[] {
  if (!json) return [];
  try {
    const value = JSON.parse(json);
    if (Array.isArray(value)) return value.map((a) => String(a)).filter(Boolean);
  } catch {
    /* ignore malformed author blobs */
  }
  return [];
}

function workSubtitle(authors: string[], year: number | null): string | null {
  return [authors.slice(0, 3).join('; ') || null, year ? String(year) : null].filter(Boolean).join(' · ') || null;
}

function rankByVector(
  vector: number[],
  kinds: Set<SearchResultKind>,
  limit: number,
  threshold: number,
  excludeIdeaIds: string[] = []
): GlobalSearchResult[] {
  const results: GlobalSearchResult[] = [];

  if (kinds.has('idea')) {
    for (const r of findSimilarIdeas(vector, threshold, limit, { excludeIds: excludeIdeaIds })) {
      results.push({
        kind: 'idea',
        id: r.global_id,
        title: r.label,
        snippet: snippet(r.statement),
        ideaType: r.type,
        similarity: r.similarity,
      });
    }
  }

  if (kinds.has('passage')) {
    for (const p of findSimilarPassages(vector, threshold, limit)) {
      const authors = parseAuthors(p.authors_json);
      const sub = workSubtitle(authors, p.year);
      results.push({
        kind: 'passage',
        id: p.passage_id,
        title: p.title || '(sin título)',
        subtitle: [sub, p.page_label ? `p. ${p.page_label}` : null].filter(Boolean).join(' · ') || null,
        snippet: snippet(p.text),
        nodusId: p.nodus_id,
        zoteroKey: p.zotero_key,
        pageLabel: p.page_label,
        similarity: p.similarity,
      });
    }
  }

  if (kinds.has('work')) {
    const hits = findSimilarWorks(vector, threshold, limit);
    if (hits.length) {
      const ids = hits.map((h) => h.nodus_id);
      const meta = new Map(
        (
          getDb()
            .prepare(
              `SELECT nodus_id, title, authors_json, year, zotero_key FROM works
                WHERE nodus_id IN (${ids.map(() => '?').join(',')}) AND archived = 0`
            )
            .all(...ids) as {
            nodus_id: string;
            title: string;
            authors_json: string | null;
            year: number | null;
            zotero_key: string | null;
          }[]
        ).map((row) => [row.nodus_id, row])
      );
      for (const h of hits) {
        const m = meta.get(h.nodus_id);
        if (!m) continue;
        results.push({
          kind: 'work',
          id: h.nodus_id,
          title: m.title || '(sin título)',
          subtitle: workSubtitle(parseAuthors(m.authors_json), m.year),
          snippet: snippet(h.summary),
          zoteroKey: m.zotero_key,
          similarity: h.similarity,
        });
      }
    }
  }

  return results;
}

export async function semanticSearch(
  query: string,
  options: SemanticSearchOptions = {}
): Promise<SemanticSearchResponse> {
  const q = query.trim();
  if (q.length < 2) return { available: true, results: [] };

  const vector = await embed(q);
  if (!vector) return { available: false, results: [] };

  const requested = (options.kinds?.length ? options.kinds : DEFAULT_KINDS).filter((k) =>
    SEMANTIC_KINDS.includes(k)
  );
  const kinds = new Set<SearchResultKind>(requested.length ? requested : DEFAULT_KINDS);
  const limit = options.limit ?? DEFAULT_LIMIT;
  const threshold = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;

  return { available: true, results: rankByVector(vector, kinds, limit, threshold) };
}

/** "Ideas parecidas a esta": rank ideas by similarity to one already-embedded idea. */
export async function findSimilarToIdea(globalId: string, limit = DEFAULT_LIMIT): Promise<SemanticSearchResponse> {
  const idea = getIdea(globalId);
  if (!idea?.embedding || idea.embedding.length === 0) return { available: false, results: [] };
  const results = rankByVector(idea.embedding, new Set(['idea']), limit, DEFAULT_MIN_SIMILARITY, [globalId]);
  return { available: true, results };
}
