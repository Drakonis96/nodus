// Saved searches: a user-pinned query plus its mode and kind filters, so a
// recurring search ("everything semantic about X, ideas + passages only") can be
// re-run with one click instead of being re-typed and re-configured each time.
import { randomUUID } from 'node:crypto';
import type { SaveSearchInput, SavedSearch, SearchMode, SearchResultKind } from '@shared/types';
import { getDb } from './database';

interface SavedSearchRow {
  id: string;
  name: string;
  query: string;
  mode: string;
  kinds_json: string;
  created_at: string;
}

function parseKinds(json: string): SearchResultKind[] {
  try {
    const value = JSON.parse(json);
    if (Array.isArray(value)) return value.map((k) => String(k) as SearchResultKind);
  } catch {
    /* ignore malformed kinds blob */
  }
  return [];
}

function rowToSavedSearch(row: SavedSearchRow): SavedSearch {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    mode: (row.mode === 'text' ? 'text' : 'semantic') as SearchMode,
    kinds: parseKinds(row.kinds_json),
    created_at: row.created_at,
  };
}

export function listSavedSearches(): SavedSearch[] {
  const rows = getDb()
    .prepare('SELECT id, name, query, mode, kinds_json, created_at FROM saved_searches ORDER BY created_at DESC')
    .all() as SavedSearchRow[];
  return rows.map(rowToSavedSearch);
}

export function saveSearch(input: SaveSearchInput): SavedSearch {
  const id = randomUUID();
  const created_at = new Date().toISOString();
  const name = input.name.trim() || input.query.trim() || 'Búsqueda';
  const mode: SearchMode = input.mode === 'text' ? 'text' : 'semantic';
  getDb()
    .prepare('INSERT INTO saved_searches (id, name, query, mode, kinds_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, input.query.trim(), mode, JSON.stringify(input.kinds ?? []), created_at);
  return { id, name, query: input.query.trim(), mode, kinds: input.kinds ?? [], created_at };
}

export function deleteSavedSearch(id: string): void {
  getDb().prepare('DELETE FROM saved_searches WHERE id = ?').run(id);
}
