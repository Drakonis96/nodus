// The half of a gallery's cut that outlives the run.
//
// `viewSnapshots` keeps a section's whole shape in memory so that leaving it and
// coming back lands on the same cut. That store dies with the process, which is
// right for most of what it holds: a search term, an open report, a place in a
// list are all answers to "where was I", and on the next run there is no "was".
//
// Ordering, the read filter and grid-vs-list are not that. They are not where the
// reader was, they are how the reader wants the gallery to look — set once, kept
// for good, and re-set by hand on every launch when nothing remembers them. So
// those three, and only those three, are written to disk here and read back as the
// seed of the snapshot the section mounts with.
//
// What is deliberately not persisted:
//
//   * The search box. A query is asked once; restoring it a week later opens the
//     section on a near-empty gallery with no visible cause, and the reader has to
//     work out what is hiding their reports. It still survives inside a run, from
//     the in-memory snapshot.
//   * The place in a list and the open report. Both are a place, not a preference,
//     and both point at rows that may not exist by the next launch.
//   * Anything from the composer. An objective, a model and an outline are a draft
//     of work not yet asked for.
//
// Preferences are stored per vault, like the snapshots they seed: the galleries of
// two corpora are two different sets of reports, and a cut chosen for one is not a
// statement about the other.

/** The sections whose gallery preferences are remembered between runs. */
export type PreferenceView = 'deepResearch' | 'studyDeepResearch' | 'teachingUnits' | 'immersion';

export const PREFERENCE_VIEWS: readonly PreferenceView[] = [
  'deepResearch',
  'studyDeepResearch',
  'teachingUnits',
  'immersion',
];

/**
 * The three durable controls, shared by both galleries. Deep Research has all of
 * them; Inmersión has no read state and so never writes `readFilter`.
 */
export interface GalleryFilterPreferences {
  readFilter?: 'all' | 'read' | 'unread';
  sortKey?: 'recent' | 'oldest' | 'title';
  viewMode?: 'grid' | 'list';
}

const READ_FILTERS = new Set(['all', 'read', 'unread']);
const SORT_KEYS = new Set(['recent', 'oldest', 'title']);
const VIEW_MODES = new Set(['grid', 'list']);

const STORAGE_PREFIX = 'nodus.galleryFilters.';

const keyFor = (vaultId: string, view: PreferenceView) => `${STORAGE_PREFIX}${view}.${vaultId}`;

/**
 * Absent under `node --test`, which is where the store is exercised for real, and
 * unreachable in a renderer whose storage the user has disabled. Neither is an
 * error worth propagating: a missing preference means the section opens on its
 * defaults, which is exactly what it did before this file existed.
 */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Every field is validated against its own union rather than trusted. What is on
 * disk was written by an older version of this app, or by a hand editing the store,
 * and a `sortKey` of `"conexiones"` would put a select in a state it has no option
 * for — visibly empty, and unfixable except by choosing something else.
 */
function sanitize(raw: unknown): GalleryFilterPreferences {
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as Record<string, unknown>;
  const result: GalleryFilterPreferences = {};
  if (typeof value.readFilter === 'string' && READ_FILTERS.has(value.readFilter)) {
    result.readFilter = value.readFilter as GalleryFilterPreferences['readFilter'];
  }
  if (typeof value.sortKey === 'string' && SORT_KEYS.has(value.sortKey)) {
    result.sortKey = value.sortKey as GalleryFilterPreferences['sortKey'];
  }
  if (typeof value.viewMode === 'string' && VIEW_MODES.has(value.viewMode)) {
    result.viewMode = value.viewMode as GalleryFilterPreferences['viewMode'];
  }
  return result;
}

/** `{}` for a vault that has never set a preference, and for an unreadable store. */
export function readFilterPreferences(
  vaultId: string | null | undefined,
  view: PreferenceView,
): GalleryFilterPreferences {
  const store = storage();
  if (!vaultId || !store) return {};
  try {
    const raw = store.getItem(keyFor(vaultId, view));
    return raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/**
 * Merges the durable fields of a snapshot patch into what is on disk.
 *
 * A patch is not a full cut — the galleries report their filters on every keystroke
 * in the search box, and their placement separately — so a patch that mentions none
 * of the three, or repeats the values already stored, must not cost a write. That
 * is not only about I/O: `localStorage.setItem` is synchronous and lands on the same
 * thread that is painting the list being typed into.
 */
export function writeFilterPreferences(
  vaultId: string | null | undefined,
  view: PreferenceView,
  patch: GalleryFilterPreferences,
): void {
  const store = storage();
  if (!vaultId || !store) return;
  const incoming = sanitize(patch);
  if (Object.keys(incoming).length === 0) return;
  const current = readFilterPreferences(vaultId, view);
  const next = { ...current, ...incoming };
  if (
    next.readFilter === current.readFilter
    && next.sortKey === current.sortKey
    && next.viewMode === current.viewMode
  ) return;
  try {
    store.setItem(keyFor(vaultId, view), JSON.stringify(next));
  } catch {
    // A full or disabled store loses the preference, not the section.
  }
}

/** Drop every stored preference. For tests and for wiping a vault. */
export function clearFilterPreferences(vaultId?: string): void {
  const store = storage();
  if (!store) return;
  try {
    const doomed: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      if (vaultId && !key.endsWith(`.${vaultId}`)) continue;
      doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
  } catch {
    // Nothing to clear if the store cannot be walked.
  }
}
