import { api, ApiError } from '../api';
import type { JsonRecord, PageResponse } from '../types';
import type {
  AdvancedAuthor,
  AdvancedAuthorDossier,
  AdvancedGraphResponse,
  AdvancedIdea,
  AdvancedIdeaDetail,
  AdvancedPage,
} from './types';

export type IdeasQuery = {
  offset?: number;
  limit?: number;
  q?: string;
  type?: string;
  sort?: 'label' | 'type' | 'works' | 'connections' | 'confidence';
};

export type AuthorsQuery = {
  offset?: number;
  limit?: number;
  q?: string;
  synthesis?: 'all' | 'with' | 'without';
  sort?: 'name' | 'surname' | 'works' | 'ideas' | 'connections';
};

function page<T>(source: PageResponse, key: string): AdvancedPage<T> {
  const values = source[key];
  const items = Array.isArray(values) ? values as T[] : Array.isArray(source.items) ? source.items as T[] : [];
  return {
    items,
    total: Number(source.total ?? items.length),
    offset: Number(source.offset ?? 0),
    limit: Number(source.limit ?? items.length),
    hasMore: Boolean(source.hasMore),
    revision: typeof source.revision === 'string' ? source.revision : undefined,
  };
}

function queryParams(values: Record<string, string | number | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]));
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* ApiError below carries the status. */ }
  if (!response.ok) {
    const error = body as { error_description?: string; error?: string } | null;
    throw new ApiError(error?.error_description || error?.error || `Request failed (${response.status})`, response.status, error?.error);
  }
  return body as T;
}

function encoded(value: string): string { return encodeURIComponent(value); }

/** Read-only REST adapter for the Advanced Server academic surfaces. */
export const advancedRest = {
  ideas: (spaceId: string, query: IdeasQuery = {}) => api.collection(spaceId, 'ideas', queryParams({
    surface: 'workspace', offset: query.offset ?? 0, limit: query.limit ?? 80, q: query.q, type: query.type, sort: query.sort ?? 'label',
  })).then((response) => page<AdvancedIdea>(response, 'ideas')),
  idea: (spaceId: string, ideaId: string) => api.detail(spaceId, 'ideas', ideaId).then((response) => response as AdvancedIdeaDetail),
  ideaGraph: (spaceId: string, ideaId: string, depth = 2, limit = 200) => getJson<AdvancedGraphResponse>(`/api/v1/spaces/${encoded(spaceId)}/ideas/${encoded(ideaId)}/graph?depth=${Math.max(1, Math.min(3, depth))}&limit=${Math.max(1, Math.min(200, limit))}`),
  authors: (spaceId: string, query: AuthorsQuery = {}) => api.collection(spaceId, 'authors', queryParams({
    surface: 'workspace', offset: query.offset ?? 0, limit: query.limit ?? 80, q: query.q, synthesis: query.synthesis ?? 'all', sort: query.sort ?? 'surname',
  })).then((response) => page<AdvancedAuthor>(response, 'authors')),
  authorDossier: (spaceId: string, authorId: string) => getJson<{ dossier: AdvancedAuthorDossier; revision?: string }>(`/api/v1/spaces/${encoded(spaceId)}/authors/${encoded(authorId)}/dossier`).then((response) => response.dossier),
  /** Matrix/routes remain available to a future surface without widening this UI's contract. */
  authorDetail: (spaceId: string, authorId: string) => api.detail(spaceId, 'authors', authorId).then((response) => response as JsonRecord),
};
