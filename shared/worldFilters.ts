/**
 * Faceted filtering for the worldbuilding collections (characters, places, groups,
 * scenes).
 *
 * The BEHAVIOUR is the archive's facet bar: a chip per dimension, each a searchable
 * multi-select, several active at once. The MODEL is the databases vault's
 * `FilterCondition` with `isAnyOf`, so saved views and an advanced condition builder can
 * be added later without migrating anything a writer has already set up.
 *
 * The combination rule is the one a writer expects when they click two values in one chip
 * and one in another: **AND between dimensions, OR within a dimension**. "Role:
 * protagonist or antagonist" AND "Culture: Vael". Getting this backwards produces a
 * filter that silently returns almost everything, which reads as a broken filter.
 *
 * Pure and dependency-free: all of it is unit-tested without a database.
 */

export interface WorldFacetOption {
  id: string;
  label: string;
  /** How many items in the unfiltered collection carry this value. */
  count?: number;
}

export interface WorldFacetDef {
  id: string;
  label: string;
  /**
   * `vocabulary` — a fixed catalogue (narrative role, place kind).
   * `distinct` — whatever values the vault actually contains. A world with three species
   * must not be offered a list of thirty.
   */
  source: 'vocabulary' | 'distinct';
  vocabulary?: WorldFacetOption[];
  /** True when an item may carry SEVERAL values at once (affiliations, tags). */
  multiValue?: boolean;
}

export interface WorldFilterState {
  search: string;
  /** dimension id → selected values. An absent or empty entry means "do not filter". */
  facets: Record<string, string[]>;
}

export const EMPTY_WORLD_FILTER: WorldFilterState = { search: '', facets: {} };

/** True when anything at all is narrowing the collection. */
export function isFiltering(state: WorldFilterState): boolean {
  return Boolean(state.search.trim()) || Object.values(state.facets).some((values) => values.length > 0);
}

/** How many dimensions are active — what the "clear" button badges. */
export function activeFacetCount(state: WorldFilterState): number {
  return Object.values(state.facets).filter((values) => values.length > 0).length;
}

export function setFacet(state: WorldFilterState, facetId: string, values: string[]): WorldFilterState {
  const facets = { ...state.facets };
  // Deleting rather than storing an empty array keeps `isFiltering` honest and keeps the
  // state comparable, so a cleared facet does not look like an active one with no values.
  if (values.length) facets[facetId] = values;
  else delete facets[facetId];
  return { ...state, facets };
}

export function toggleFacetValue(state: WorldFilterState, facetId: string, value: string): WorldFilterState {
  const current = state.facets[facetId] ?? [];
  return setFacet(
    state,
    facetId,
    current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]
  );
}

export function clearFilters(state: WorldFilterState): WorldFilterState {
  return { search: state.search, facets: {} };
}

/** Strip accents and case so "Vaël" matches "vael". */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * One item's values for each facet. `null`/`[]` means the item has no value there — which
 * is NOT the same as matching everything: an item with no culture must not appear under
 * "Culture: Vael".
 */
export type FacetValues = Record<string, string | string[] | null | undefined>;

function valuesOf(item: FacetValues, facetId: string): string[] {
  const raw = item[facetId];
  if (raw == null) return [];
  return Array.isArray(raw) ? raw.filter(Boolean) : [raw];
}

/** Does this item pass the facets? Search is applied separately, by the caller. */
export function matchesFacets(item: FacetValues, state: WorldFilterState): boolean {
  for (const [facetId, selected] of Object.entries(state.facets)) {
    if (!selected.length) continue;
    const values = valuesOf(item, facetId);
    // OR within the dimension, AND across dimensions.
    if (!values.some((value) => selected.includes(value))) return false;
  }
  return true;
}

/**
 * Build the option list for a `distinct` facet from the collection itself, with counts.
 *
 * Counts come from the collection BEFORE filtering by this dimension, so opening a chip
 * always shows every value that exists rather than only the ones already selected — the
 * behaviour that makes a facet bar usable instead of a trap.
 */
export function distinctOptions(items: FacetValues[], facetId: string): WorldFacetOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const value of valuesOf(item, facetId)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: id, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Apply the whole filter: the facets, then a free-text search over the fields the caller
 * declares searchable.
 */
export function applyWorldFilter<T>(
  items: T[],
  state: WorldFilterState,
  accessors: { facets: (item: T) => FacetValues; searchText: (item: T) => string[] }
): T[] {
  const needle = normalizeForSearch(state.search);
  return items.filter((item) => {
    if (!matchesFacets(accessors.facets(item), state)) return false;
    if (!needle) return true;
    return accessors.searchText(item).some((text) => normalizeForSearch(text ?? '').includes(needle));
  });
}
