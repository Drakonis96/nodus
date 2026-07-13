/**
 * Filtering + sorting for the evidence archive's item list (the "upload sources"
 * window). Pure and dependency-free so the matching/sorting logic is unit-tested
 * without a database; the repo assembles FilterableArchiveItem[] and calls these.
 *
 * Multi-select filters (tags, linked persons) support two match modes, Notion-style:
 * 'any' (the item has at least one of the selected values — the default) or 'all'
 * (the item has every selected value). Single-valued fields (document type, file
 * kind) are always "any of" — a document only has one type, so "all" could never
 * match more than one selection. Every filter category combines with AND.
 */

import { docTypeFacets, type FacetDimensionId } from './archiveDocTypes';

export type ArchiveMatchMode = 'any' | 'all';

/** Heritage-dimension facets: OR within a dimension, AND across dimensions. Resolved
 *  from the item's document TYPE (not the item itself), so an item matches a facet
 *  filter when its doc type carries the selected value. */
export type ArchiveFacetFilter = Partial<Record<FacetDimensionId, string[]>>;

export interface ArchiveFilterState {
  docTypes?: string[];
  kinds?: string[];
  tags?: string[];
  tagsMode?: ArchiveMatchMode;
  personIds?: string[];
  personsMode?: ArchiveMatchMode;
  facets?: ArchiveFacetFilter;
  yearFrom?: number | null;
  yearTo?: number | null;
  search?: string;
}

export interface FilterableArchiveItem {
  title: string;
  docType: string | null;
  kind: string;
  tags: string[];
  linkedPersonIds: string[];
  year: number | null;
  extractedText: string | null;
  description: string | null;
  metadata: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

function matchesMulti(itemValues: string[], selected: string[] | undefined, mode: ArchiveMatchMode | undefined): boolean {
  if (!selected || selected.length === 0) return true;
  const owned = new Set(itemValues);
  return mode === 'all' ? selected.every((v) => owned.has(v)) : selected.some((v) => owned.has(v));
}

function matchesSingle(value: string | null, selected: string[] | undefined): boolean {
  if (!selected || selected.length === 0) return true;
  return value != null && selected.includes(value);
}

/** Total selected facet VALUES across all dimensions (for the active-filter count). */
export function countActiveFacets(facets: ArchiveFacetFilter | undefined): number {
  if (!facets) return 0;
  return Object.values(facets).reduce((n, sel) => n + (sel?.length ?? 0), 0);
}

/** Whether the item's document type satisfies every selected facet dimension. */
function matchesFacets(docType: string | null, facets: ArchiveFacetFilter | undefined): boolean {
  if (!facets) return true;
  const active = Object.entries(facets).filter(([, sel]) => sel && sel.length > 0) as [FacetDimensionId, string[]][];
  if (active.length === 0) return true;
  const f = docTypeFacets(docType);
  if (!f) return false; // unclassified items can't match a facet filter
  for (const [dim, sel] of active) {
    if (dim === 'genealogia') {
      if (!f.genealogia) return false;
      continue;
    }
    const owned = f[dim] as string[];
    if (!sel.some((v) => owned.includes(v))) return false;
  }
  return true;
}

function matchesSearch(item: FilterableArchiveItem, search: string | undefined): boolean {
  const q = (search ?? '').trim().toLowerCase();
  if (!q) return true;
  const haystacks = [item.title, item.extractedText, item.description, item.metadata ? JSON.stringify(item.metadata) : null];
  return haystacks.some((h) => h?.toLowerCase().includes(q));
}

export function matchesArchiveFilter(item: FilterableArchiveItem, filter: ArchiveFilterState): boolean {
  if (!matchesSingle(item.docType, filter.docTypes)) return false;
  if (!matchesSingle(item.kind, filter.kinds)) return false;
  if (!matchesMulti(item.tags, filter.tags, filter.tagsMode)) return false;
  if (!matchesMulti(item.linkedPersonIds, filter.personIds, filter.personsMode)) return false;
  if (!matchesFacets(item.docType, filter.facets)) return false;
  if (filter.yearFrom != null && (item.year == null || item.year < filter.yearFrom)) return false;
  if (filter.yearTo != null && (item.year == null || item.year > filter.yearTo)) return false;
  if (!matchesSearch(item, filter.search)) return false;
  return true;
}

export function applyArchiveFilters<T extends FilterableArchiveItem>(items: T[], filter: ArchiveFilterState): T[] {
  return items.filter((item) => matchesArchiveFilter(item, filter));
}

/** Whether any filter is actually narrowing the result set — drives a "clear filters" affordance. */
export function isArchiveFilterActive(filter: ArchiveFilterState): boolean {
  return Boolean(
    filter.docTypes?.length ||
      filter.kinds?.length ||
      filter.tags?.length ||
      filter.personIds?.length ||
      countActiveFacets(filter.facets) > 0 ||
      filter.yearFrom != null ||
      filter.yearTo != null ||
      filter.search?.trim()
  );
}

export type ArchiveSortKey =
  | 'updatedDesc'
  | 'updatedAsc'
  | 'createdDesc'
  | 'createdAsc'
  | 'titleAsc'
  | 'titleDesc'
  | 'yearAsc'
  | 'yearDesc'
  | 'docTypeAsc';

export const ARCHIVE_SORT_OPTIONS: { id: ArchiveSortKey; label: string }[] = [
  { id: 'updatedDesc', label: 'Modificado: más reciente' },
  { id: 'updatedAsc', label: 'Modificado: más antiguo' },
  { id: 'createdDesc', label: 'Añadido: más reciente' },
  { id: 'createdAsc', label: 'Añadido: más antiguo' },
  { id: 'titleAsc', label: 'Título (A–Z)' },
  { id: 'titleDesc', label: 'Título (Z–A)' },
  { id: 'yearAsc', label: 'Año del documento (ascendente)' },
  { id: 'yearDesc', label: 'Año del documento (descendente)' },
  { id: 'docTypeAsc', label: 'Tipo de documento' },
];

export function sortArchiveItems<T extends FilterableArchiveItem>(items: T[], sortKey: ArchiveSortKey = 'updatedDesc'): T[] {
  const sorted = [...items];
  switch (sortKey) {
    case 'updatedAsc':
      sorted.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      break;
    case 'createdDesc':
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case 'createdAsc':
      sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
    case 'titleAsc':
      sorted.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));
      break;
    case 'titleDesc':
      sorted.sort((a, b) => b.title.localeCompare(a.title, 'es', { sensitivity: 'base' }));
      break;
    case 'yearAsc':
      // Undated items sort last regardless of direction.
      sorted.sort((a, b) => {
        if (a.year == null) return b.year == null ? 0 : 1;
        if (b.year == null) return -1;
        return a.year - b.year;
      });
      break;
    case 'yearDesc':
      sorted.sort((a, b) => {
        if (a.year == null) return b.year == null ? 0 : 1;
        if (b.year == null) return -1;
        return b.year - a.year;
      });
      break;
    case 'docTypeAsc':
      // Undated/untyped items sort last.
      sorted.sort((a, b) => {
        if (a.docType == null) return b.docType == null ? 0 : 1;
        if (b.docType == null) return -1;
        return a.docType.localeCompare(b.docType);
      });
      break;
    case 'updatedDesc':
    default:
      sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      break;
  }
  return sorted;
}
