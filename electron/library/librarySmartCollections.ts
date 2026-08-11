import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  LibraryColumnId,
  LibrarySavedSearchRecord,
  LibrarySmartSearchCondition,
  LibrarySmartSearchGroup,
  LibrarySortField,
  LibraryViewPreferences,
} from '@shared/libraryTypes';
import { atomicWriteJson, readJsonFile } from './libraryPaths';

const COLUMNS = new Set<LibraryColumnId>(['title', 'creator', 'year', 'source', 'status', 'attachments', 'updatedAt']);
const SORT_FIELDS = new Set<LibrarySortField>(['title', 'creator', 'year', 'source', 'updatedAt', 'extraction', 'attachments']);
const GROUP_MODES = new Set(['all', 'any', 'not']);
const FIELDS = new Set(['title', 'abstract', 'creator', 'tag', 'date', 'year', 'source', 'itemType', 'collection', 'attachment', 'extraction', 'trash', 'vault', 'analysis']);
const OPERATORS = new Set(['contains', 'equals', 'not-equals', 'before', 'after', 'is-true', 'is-false']);

export const DEFAULT_LIBRARY_VIEW_PREFERENCES: LibraryViewPreferences = {
  visibleColumns: ['title', 'creator', 'year', 'source', 'status'],
  sort: [{ field: 'updatedAt', direction: 'desc' }, { field: 'title', direction: 'asc' }],
};

function isCondition(value: unknown): value is LibrarySmartSearchCondition {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && FIELDS.has(String(record.field)) && OPERATORS.has(String(record.operator));
}

export function validateLibrarySmartSearchGroup(value: unknown, depth = 0): value is LibrarySmartSearchGroup {
  if (!value || typeof value !== 'object' || depth > 5) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !GROUP_MODES.has(String(record.mode)) || !Array.isArray(record.rules) || record.rules.length > 50) return false;
  return record.rules.every((rule) => isCondition(rule) || validateLibrarySmartSearchGroup(rule, depth + 1));
}

function normalizePreferences(value: unknown): LibraryViewPreferences {
  if (!value || typeof value !== 'object') return DEFAULT_LIBRARY_VIEW_PREFERENCES;
  const record = value as Partial<LibraryViewPreferences>;
  const visibleColumns = Array.isArray(record.visibleColumns)
    ? [...new Set(record.visibleColumns.filter((entry): entry is LibraryColumnId => COLUMNS.has(entry as LibraryColumnId)))]
    : [];
  const sort = Array.isArray(record.sort) ? record.sort.filter((entry) => entry && SORT_FIELDS.has(entry.field)
    && (entry.direction === 'asc' || entry.direction === 'desc')).slice(0, 3) : [];
  return {
    visibleColumns: visibleColumns.length ? visibleColumns : DEFAULT_LIBRARY_VIEW_PREFERENCES.visibleColumns,
    sort: sort.length ? sort : DEFAULT_LIBRARY_VIEW_PREFERENCES.sort,
  };
}

export class LibrarySmartCollectionStore {
  private readonly searchesFile: string;
  private readonly preferencesFile: string;

  constructor(root: string) {
    this.searchesFile = path.join(root, '.nodus', 'saved-searches.json');
    this.preferencesFile = path.join(root, '.nodus', 'view-preferences.json');
  }

  list(): LibrarySavedSearchRecord[] {
    const records = readJsonFile<unknown>(this.searchesFile);
    if (!Array.isArray(records)) return [];
    return records.filter((value): value is LibrarySavedSearchRecord => {
      if (!value || typeof value !== 'object') return false;
      const record = value as Partial<LibrarySavedSearchRecord>;
      return record.format === 'nodus.library-saved-search' && record.formatVersion === 1
        && typeof record.id === 'string' && typeof record.name === 'string'
        && typeof record.createdAt === 'string' && typeof record.updatedAt === 'string'
        && validateLibrarySmartSearchGroup(record.query);
    }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  get(id: string): LibrarySavedSearchRecord | null {
    return this.list().find((record) => record.id === id) ?? null;
  }

  save(input: { id?: string; name: string; query: LibrarySmartSearchGroup }, now = new Date().toISOString()): LibrarySavedSearchRecord {
    const name = input.name.trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('La búsqueda guardada necesita un nombre.');
    if (!validateLibrarySmartSearchGroup(input.query)) throw new Error('La búsqueda guardada contiene reglas no válidas.');
    const records = this.list();
    const existing = input.id ? records.find((record) => record.id === input.id) : null;
    const record: LibrarySavedSearchRecord = {
      format: 'nodus.library-saved-search', formatVersion: 1,
      id: existing?.id ?? `saved-search:${randomUUID()}`, name, query: input.query,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    atomicWriteJson(this.searchesFile, [...records.filter((entry) => entry.id !== record.id), record]);
    return record;
  }

  delete(id: string): boolean {
    const records = this.list();
    const next = records.filter((record) => record.id !== id);
    if (next.length === records.length) return false;
    atomicWriteJson(this.searchesFile, next);
    return true;
  }

  preferences(): LibraryViewPreferences {
    return normalizePreferences(readJsonFile<unknown>(this.preferencesFile));
  }

  setPreferences(value: LibraryViewPreferences): LibraryViewPreferences {
    const preferences = normalizePreferences(value);
    atomicWriteJson(this.preferencesFile, preferences);
    return preferences;
  }
}
