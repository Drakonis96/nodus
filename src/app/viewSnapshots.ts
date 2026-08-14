// What a section remembers when you leave it and come back.
//
// Changing `view` swaps the whole element at App.tsx's single render point, so React
// unmounts the previous section and every `useState` inside it dies. That is on
// purpose — the alternative, keeping sections mounted and hidden, would leave the
// heavy lists resident and their effects and timers alive. What it costs is the
// user's place: the filters, the ordering and the open tab all reset to their
// defaults, and returning to a section means rebuilding the cut of the corpus by
// hand.
//
// So the sections stay disposable and their *shape* is kept out here instead, above
// the render point, in a store that outlives them. This is the generalisation of
// what `toolkitPage` already does in App.tsx for the Toolkit's inner page.
//
// Three rules define what belongs in a snapshot:
//
//   1. A handful of values per view, not the whole state. What hurts to lose is the
//      cut: filters, ordering, the active tab. GlobalLibraryView alone holds 91
//      `useState` calls; 90 of them should die with the view.
//   2. Nothing ephemeral. Open modals, spinners, in-flight errors, unapplied input
//      drafts and export selections are gone on the way out, and should be.
//   3. Page and scroll are one value, never two. See `ListPlacement`.
//   4. Nothing that costs an action to restore. A snapshot puts the reader back
//      where they were; it does not re-run work on their behalf. This is why the
//      argument map's open tab is not kept: redrawing it means rebuilding it, and
//      in AI mode that would spend a model call for the act of entering a section.
//
// The store is deliberately NOT React state. It is read once when a view mounts and
// written on every filter change; as state it would re-render the whole shell on
// every keystroke in a search box, and this repo has paid for that before.
import type { View } from '../navigation';
import type { LibraryCatalogItem, LibraryItemSource, LibraryItemType } from '@shared/libraryTypes';
// Type-only, so the lazy view chunks are not pulled in: the unions stay declared
// once, where the selects that produce them live.
import type { SortKey as AuthorsSortKey, SynthFilter as AuthorsSynthFilter } from '../views/AuthorsView';
import type { SortKey as IdeasSortKey } from '../views/IdeasView';
import type { RouteSortKey as ArgumentRouteSortKey } from '../views/ArgumentMapView';
import type { WorkspaceItemKind } from '../views/WorkspaceView';
import type { IdeaType, WorkFilter } from '@shared/types';
import type { SortState } from '../views/Library';

/** An open inner tab: enough to redraw the tab strip and refetch its contents. */
export interface OpenEntityTab {
  id: string;
  label: string;
}

/**
 * The reader's place inside a list — one value, never two.
 *
 * Page and scroll only mean something together. A restored page without its scroll
 * position puts the reader in front of row 201 with no context: neither where they
 * were nor a clean start, which is worse than restoring nothing. So both live in
 * this one field, and it is written and read as a unit.
 *
 * The place is an id, not a pixel offset. Row heights change with the window width
 * and with the content, and virtualised lists do not even have the rows measured
 * until they are near the viewport, so a stored `scrollTop` points somewhere else on
 * the next visit. An id still means the same row.
 *
 * `pageOffset` is a hint, not the answer: it says which page the row was on so the
 * anchor can be found in one request instead of walking every page from the start.
 * If the anchor is not on that page — the corpus changed, the row was deleted — the
 * list falls back to the first page and the top. It never keeps half a placement.
 */
export interface ListPlacement {
  /** The row that was at the top of the viewport. */
  anchorId: string;
  /**
   * Which page it was on, so the anchor is reachable in one request. Absent for the
   * lists that page inside the renderer, where "load until this id appears" is the
   * whole of it and there is no page to hint at.
   */
  pageOffset?: number;
}

export interface AuthorsSnapshot {
  /** 'author' is only reachable with `openAuthor` set; the pair travels together. */
  surface: 'catalog' | 'author' | 'matrix';
  openAuthor: OpenEntityTab | null;
  matrixOpen: boolean;
  query: string;
  sortBy: AuthorsSortKey;
  synthFilter: AuthorsSynthFilter;
  savedOnly: boolean;
  filtersOpen: boolean;
  placement: ListPlacement | null;
}

export interface IdeasSnapshot {
  surface: 'catalog' | 'idea';
  openIdea: OpenEntityTab | null;
  search: string;
  typeFilter: IdeaType | '';
  sortKey: IdeasSortKey;
  filtersOpen: boolean;
  placement: ListPlacement | null;
}

/**
 * Notes, folders and their open editors. The tree's expanded folders are part of the
 * cut: collapsing back to the root loses the reader's route to what they were
 * reading just as surely as dropping the filter does.
 */
export interface WorkspaceSnapshot {
  scope: WorkspaceScope;
  expanded: string[];
  search: string;
  kindFilter: WorkspaceItemKind | '';
  selectedTags: string[];
  openIds: string[];
  activeId: string | null;
  placement: ListPlacement | null;
}

/** Mirrors WorkspaceView's `Scope`: the collection or pseudo-collection on show. */
export type WorkspaceScope =
  | { kind: 'all' }
  | { kind: 'unfiled' }
  | { kind: 'trash' }
  | { kind: 'collection'; id: string };

/**
 * The route catalogue only. The open map tab is deliberately absent: it holds no
 * data of its own, so redrawing it means rebuilding it, and in AI mode that would
 * spend a model call on the act of walking back into the section. Reopening a map
 * stays a thing the reader asks for.
 */
export interface ArgumentSnapshot {
  mode: 'auto' | 'ai';
  seedId: string;
  suggestionSearch: string;
  minConnections: number;
  routeSort: ArgumentRouteSortKey;
  placement: ListPlacement | null;
}

/**
 * The seven facets as one unit, because that is how a reader thinks of them: the
 * cut is kept or it is dropped, never half of it.
 */
export interface LibraryFacetsSnapshot {
  source: LibraryItemSource | '';
  extraction: LibraryCatalogItem['extractionStatus'] | '';
  itemType: LibraryItemType | '';
  yearFrom: string;
  yearTo: string;
  facetTag: string;
  facetVault: string;
  attachmentFilter: '' | 'with' | 'without';
}

/**
 * Sorting and visible columns are absent on purpose: the global catalogue already
 * persists those to disk through `setGlobalLibraryViewPreferences`. Only what
 * nothing else keeps belongs here.
 */
export interface LibraryGlobalSnapshot {
  search: string;
  selectedCollection: string | null;
  selectedSavedSearch: string | null;
  filters: LibraryFacetsSnapshot;
  filtersOpen: boolean;
  placement: ListPlacement | null;
}

/** The vault-scoped library states its whole cut as one `WorkFilter`. */
export interface LibraryVaultSnapshot {
  filter: WorkFilter;
  sort: SortState | null;
  filtersOpen: boolean;
  advancedFiltersOpen: boolean;
  placement: ListPlacement | null;
}

/**
 * One section, two engines: the Biblioteca entry renders the vault library or the
 * global catalogue depending on the scope switch, and each keeps its own cut so
 * that flipping the switch does not blend two unrelated sets of filters. The scope
 * itself is not here — it already lives in settings.
 */
export interface LibrarySnapshot {
  vault?: LibraryVaultSnapshot;
  global?: LibraryGlobalSnapshot;
}

/** One optional entry per section that has opted in. Keys are `View` members. */
export interface ViewSnapshots {
  authors?: AuthorsSnapshot;
  ideas?: IdeasSnapshot;
  library?: LibrarySnapshot;
  workspace?: WorkspaceSnapshot;
  /**
   * The same view under the name the non-academic vaults give it. They are separate
   * sections of the app and only one of them exists at a time, so they keep separate
   * cuts rather than sharing one.
   */
  notes?: WorkspaceSnapshot;
  argument?: ArgumentSnapshot;
}

export type SnapshotView = keyof ViewSnapshots;

/** Adding a key that is not a section of the app stops this file compiling. */
type AssertKeysAreViews = SnapshotView extends View ? true : never;
const _keysAreViews: AssertKeysAreViews = true;
void _keysAreViews;

/**
 * Exactly one vault's snapshots exist at a time. Switching vault discards them
 * rather than indexing them: the whole app assumes a single active vault, and a
 * second surviving set would be a second answer to "where was I".
 */
let slot: { vaultId: string; values: ViewSnapshots } | null = null;

/**
 * Undefined for a different vault, and for no vault at all — same contract as
 * `getVaultQueryCache`. The vault check lives in the read, not in an effect, so a
 * view that mounts in the same commit as a vault change cannot see the old cut.
 */
export function readViewSnapshot<K extends SnapshotView>(
  vaultId: string | null | undefined,
  view: K,
): ViewSnapshots[K] | undefined {
  if (!vaultId || slot?.vaultId !== vaultId) return undefined;
  return slot.values[view];
}

/**
 * Merges a partial update into the section's snapshot. Partial because a section's
 * state is not all in one component: in Autores the tab strip lives in AuthorsView
 * and the filters in its AuthorsCatalog child, and each reports only its own half.
 */
export function patchViewSnapshot<K extends SnapshotView>(
  vaultId: string | null | undefined,
  view: K,
  patch: Partial<NonNullable<ViewSnapshots[K]>>,
): void {
  if (!vaultId) return;
  if (slot?.vaultId !== vaultId) slot = { vaultId, values: {} };
  const current = slot.values[view];
  slot.values[view] = { ...(current ?? {}), ...patch } as ViewSnapshots[K];
}

/** Drop everything. For vault deletion, imports and tests. */
export function clearViewSnapshots(): void {
  slot = null;
}

/** What the shell hands to the registry, with the active vault already bound in. */
export interface ViewSnapshotAccess {
  read<K extends SnapshotView>(view: K): ViewSnapshots[K] | undefined;
  patch<K extends SnapshotView>(view: K, patch: Partial<NonNullable<ViewSnapshots[K]>>): void;
}

/**
 * Binding the vault once, here, is why a view never receives it for this purpose:
 * a section cannot read another vault's snapshot by mistake because it never holds
 * the key to one.
 */
export function viewSnapshotAccess(vaultId: string | null | undefined): ViewSnapshotAccess {
  return {
    read: (view) => readViewSnapshot(vaultId, view),
    patch: (view, patch) => patchViewSnapshot(vaultId, view, patch),
  };
}
