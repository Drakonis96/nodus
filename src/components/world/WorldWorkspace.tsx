import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyWorldFilter,
  EMPTY_WORLD_FILTER,
  isFiltering,
  type FacetValues,
  type WorldFacetDef,
  type WorldFilterState,
} from '@shared/worldFilters';
import { alphaBucket } from '@shared/worldEncyclopedia';
import { Icon } from '../ui';
import { WorldFilterBar } from './WorldFilterBar';
import { WorldAnchorProvider, type WorldAnchor } from './questionCapture';
import { useDataRefresh } from '../../hooks';
import { t, tx } from '../../i18n';

/**
 * How a section presents its collection. The data decides, not taste: a cast is browsed
 * by face, a set of places by containment, a run of scenes by narrative order.
 */
export type WorldPresentation = 'grid' | 'tree' | 'list' | 'index';

export interface WorldSectionDef<T> {
  /** Also the testid prefix: `${id}-grid` is the scroll container. */
  id: string;
  icon: string;
  title: string;
  searchPlaceholder: string;
  /** Only for a section you can add to. Continuity is a reading of the world, not a
   *  collection you append to, so it has neither this nor a create modal. */
  createLabel?: string;
  /** Shown when the vault has none of these at all. */
  emptyLabel: string;
  /** Shown when the filters hid everything. */
  noMatchLabel: string;
  presentation: WorldPresentation;
  /** A grid can become a reading rail when an item opens. Cards that turn horizontal in
   *  that rail need the whole row; squeezing two of them into 288 px makes their labels
   *  unreadable. */
  compactPresentation?: 'grid' | 'list';
  load: () => Promise<T[]>;
  idOf: (item: T) => string;
  /** Tree only: which item this one hangs from. */
  parentOf?: (item: T) => string | null;
  /** Tree only: label for the row. */
  labelOf?: (item: T) => string;
  facets: WorldFacetDef[];
  facetValues: (item: T) => FacetValues;
  searchText: (item: T) => string[];
  Card: React.ComponentType<{ item: T; compact: boolean; onOpen: () => void }>;
  /** `onSelect` opens another item of the same collection — what an internal link needs. */
  Sheet: React.ComponentType<{
    item: T;
    onChanged: () => Promise<void>;
    onBack: () => void;
    onSelect: (id: string) => void;
  }>;
  /** Rendered under the collection. The encyclopedia offers its full-text search here, so
   *  the instant, client-side search above stays free of an IPC round-trip per keystroke. */
  Footer?: React.ComponentType<{ filter: WorldFilterState; onOpen: (id: string) => void }>;
  /** Rendered in the header, left of the create button — section-wide actions. */
  HeaderActions?: React.ComponentType;
  /** Replaces the generic "nothing here yet" text. Continuity uses it to say what it
   *  actually checked, which is the only reason to reopen a screen that found nothing. */
  EmptyState?: React.ComponentType;
  /** How this item is addressed by the encyclopedia. Declaring it is what lets every prose
   *  field of the sheet offer «convertir en pregunta abierta» with its anchor and its field
   *  already filled in — one line per section instead of one prop per field. */
  anchorOf?: (item: T) => WorldAnchor | null;
}

/**
 * The shell every worldbuilding collection shares: a header with search and facets, the
 * collection itself, and a detail sheet.
 *
 * The layout answers two different jobs with one component. With nothing selected the
 * collection takes the FULL width — that is what makes a cast feel like a world rather
 * than a table. Select something and it shrinks to a left rail with the sheet beside it,
 * which is what you want when you are working through a dozen entries in a row.
 *
 * Filtering happens client-side over the loaded collection on purpose: it keeps the facet
 * counts honest (they are computed from everything, not from what survived the filter)
 * and a world is thousands of rows, not millions.
 */
export function WorldWorkspace<T>({
  section,
  createModal,
  onCreated,
}: {
  section: WorldSectionDef<T>;
  /** Rendered when the create action is triggered; the section owns its own form. */
  createModal?: (close: () => void, created: (id: string) => Promise<void>) => React.ReactNode;
  onCreated?: (id: string) => void;
}) {
  const [items, setItems] = useState<T[]>([]);
  const [filter, setFilter] = useState<WorldFilterState>(EMPTY_WORLD_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setItems(await section.load());
    setLoading(false);
  }, [section]);

  useEffect(() => {
    void reload();
  }, [reload]);
  // A cross-cutting change (accepting a proposal, a sync merge) refreshes the collection
  // in place, keeping the filters and the open item — remounting would close the sheet.
  useDataRefresh(reload);

  const visible = useMemo(
    () => applyWorldFilter(items, filter, { facets: section.facetValues, searchText: section.searchText }),
    [items, filter, section]
  );

  const selected = useMemo(
    () => items.find((item) => section.idOf(item) === selectedId) ?? null,
    [items, selectedId, section]
  );

  // An item that was open and then filtered out (renamed, restatused) would leave the
  // sheet showing a stale copy, so the selection is dropped when it stops existing.
  // Note the list: `items`, not `visible`. A filter narrowing the collection must NOT
  // close what is open — in a reading pane, typing in the search box while reading an
  // entry would otherwise slam the page shut mid-paragraph.
  useEffect(() => {
    if (selectedId && !loading && !items.some((item) => section.idOf(item) === selectedId)) {
      setSelectedId(null);
    }
  }, [items, selectedId, loading, section]);

  const filtering = isFiltering(filter);
  const facetItems = useMemo(() => items.map(section.facetValues), [items, section]);
  const split = Boolean(selected);

  const collection = (
    <div
      data-testid={`${section.id}-grid`}
      className={`min-h-0 flex-1 overflow-y-auto ${split ? 'p-2' : 'p-4'}`}
    >
      {loading ? (
        <p className="py-12 text-center text-sm text-neutral-600 dark:text-neutral-500">{t('Cargando…')}</p>
      ) : visible.length === 0 ? (
        <div className={split ? 'py-8 text-center' : 'py-16 text-center'}>
          {!split && <Icon name={section.icon} size={32} className="mx-auto mb-3 text-neutral-400 dark:text-neutral-700" />}
          {filtering || !section.EmptyState ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-500">{filtering ? t(section.noMatchLabel) : t(section.emptyLabel)}</p>
          ) : (
            <section.EmptyState />
          )}
          {!split &&
            (filtering ? (
              <button
                className="btn btn-ghost mt-3 border border-neutral-300 text-xs dark:border-neutral-700"
                onClick={() => setFilter(EMPTY_WORLD_FILTER)}
              >
                {t('Quitar los filtros')}
              </button>
            ) : (
              createModal && (
                <button className="btn btn-primary mt-3 gap-1.5" onClick={() => setAdding(true)}>
                  <Icon name="plus" size={14} /> {t('Crear el primero')}
                </button>
              )
            ))}
        </div>
      ) : section.presentation === 'tree' ? (
        <WorldTree section={section} items={visible} selectedId={selectedId} onOpen={setSelectedId} />
      ) : section.presentation === 'index' ? (
        <WorldAlphaIndex section={section} items={visible} selectedId={selectedId} onOpen={setSelectedId} split={split} />
      ) : (
        <ul
          className={
            section.presentation === 'list'
              ? 'space-y-1.5'
              : split && section.compactPresentation === 'list'
                ? 'space-y-2'
              : `grid gap-3 ${split ? '[grid-template-columns:repeat(auto-fill,minmax(7rem,1fr))]' : '[grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]'}`
          }
        >
          {visible.map((item) => (
            <li key={section.idOf(item)}>
              <section.Card item={item} compact={split} onOpen={() => setSelectedId(section.idOf(item))} />
            </li>
          ))}
        </ul>
      )}
      {section.Footer && !loading && <section.Footer filter={filter} onOpen={setSelectedId} />}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <Icon name={section.icon} size={20} className="text-indigo-700 dark:text-indigo-300" />
          <h1 className="text-lg font-semibold">{t(section.title)}</h1>
          {/* Never present a filtered count as the total: that is the quickest way to make
              someone believe half their world has vanished. */}
          <span className="text-xs text-neutral-600 dark:text-neutral-500">
            {filtering ? tx('{shown} de {total}', { shown: String(visible.length), total: String(items.length) }) : items.length}
          </span>
          <span className="ml-auto flex items-center gap-2">
            {section.HeaderActions && <section.HeaderActions />}
          </span>
          {/* The create button exists only where creating is a thing. The four collections
              pass a modal and are unchanged; Continuity passes none and simply has no
              button, rather than one that opens an empty form. */}
          {createModal && (
            <button className="btn btn-primary h-9 gap-1.5" onClick={() => setAdding(true)}>
              <Icon name="plus" /> {t(section.createLabel ?? 'Crear')}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input h-9 min-w-56 flex-1 text-sm"
            placeholder={t(section.searchPlaceholder)}
            value={filter.search}
            onChange={(event) => setFilter((current) => ({ ...current, search: event.target.value }))}
          />
          <WorldFilterBar facets={section.facets} state={filter} onChange={setFilter} items={facetItems} />
        </div>
      </div>

      {split && selected ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-72 shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800">{collection}</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <WorldAnchorProvider anchor={section.anchorOf?.(selected) ?? null}>
              <section.Sheet
                key={section.idOf(selected)}
                item={selected}
                onChanged={reload}
                onBack={() => setSelectedId(null)}
                onSelect={setSelectedId}
              />
            </WorldAnchorProvider>
          </div>
        </div>
      ) : (
        collection
      )}

      {adding &&
        createModal?.(
          () => setAdding(false),
          async (id) => {
            setAdding(false);
            // Clear the filters so something created while one was active does not vanish
            // the moment it is saved.
            setFilter(EMPTY_WORLD_FILTER);
            await reload();
            setSelectedId(id);
            onCreated?.(id);
          }
        )}
    </div>
  );
}

/**
 * The alphabetical presentation, for a collection you READ rather than browse.
 *
 * It renders the section's own `Card` like the grid does — an index row is just a card
 * shaped like a line — so a section gets the A–Z for the cost of a `presentation` value
 * and nothing else. What it adds is the two things a grid cannot give you: a sticky letter
 * as you scroll, and a jump strip that only offers the letters this world actually uses.
 */
function WorldAlphaIndex<T>({
  section,
  items,
  selectedId,
  onOpen,
  split,
}: {
  section: WorldSectionDef<T>;
  items: T[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  split: boolean;
}) {
  const buckets = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const letter = alphaBucket(section.labelOf?.(item) ?? '');
      map.set(letter, [...(map.get(letter) ?? []), item]);
    }
    // `#` last: digits and symbols are the tail of an index, not its head, however they
    // happen to sort in ASCII.
    return [...map.entries()].sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)));
  }, [items, section]);

  const headingId = (letter: string) => `${section.id}-letter-${letter === '#' ? 'sym' : letter}`;

  return (
    <div>
      {!split && buckets.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-0.5">
          {buckets.map(([letter]) => (
            <button
              key={letter}
              onClick={() => document.getElementById(headingId(letter))?.scrollIntoView({ block: 'start' })}
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100 hover:text-indigo-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-indigo-300"
            >
              {letter}
            </button>
          ))}
        </div>
      )}
      {buckets.map(([letter, entries]) => (
        <section key={letter}>
          <h3
            id={headingId(letter)}
            className={`sticky top-0 z-10 mb-1 bg-white/95 py-1 text-xs font-semibold uppercase tracking-wider text-neutral-600 backdrop-blur dark:bg-neutral-950/95 dark:text-neutral-500 ${
              section.id === 'encyclopedia' ? 'encyclopedia-letter-heading' : ''
            }`}
          >
            {letter}
          </h3>
          <ul className="mb-3 space-y-1">
            {entries.map((item) => (
              <li key={section.idOf(item)} data-selected={section.idOf(item) === selectedId ? 'true' : undefined}>
                <section.Card item={item} compact={split} onOpen={() => onOpen(section.idOf(item))} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * The hierarchical presentation. Roots are the items whose parent is absent FROM THE
 * FILTERED SET, not merely null: filtering to "cities" must still show them, even though
 * their countries were filtered away and would otherwise leave them orphaned and invisible.
 */
function WorldTree<T>({
  section,
  items,
  selectedId,
  onOpen,
}: {
  section: WorldSectionDef<T>;
  items: T[];
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const byId = useMemo(() => new Map(items.map((item) => [section.idOf(item), item])), [items, section]);
  const children = useMemo(() => {
    const map = new Map<string | null, T[]>();
    for (const item of items) {
      const parent = section.parentOf?.(item) ?? null;
      const key = parent && byId.has(parent) ? parent : null;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [items, byId, section]);

  const render = (parentId: string | null, depth: number, seen: Set<string>): React.ReactNode => {
    const entries = children.get(parentId) ?? [];
    return entries.map((item, index) => {
      const id = section.idOf(item);
      // A cycle in the data would recurse forever; the write path rejects them, but the
      // renderer must not depend on that being true.
      if (seen.has(id)) return null;
      const nextSeen = new Set(seen).add(id);
      return (
        <li key={id} className="relative">
          {depth > 0 && (
            <>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -left-2 top-0 h-4 w-2 rounded-bl-sm border-b border-l border-neutral-300 dark:border-neutral-700/80"
              />
              {index < entries.length - 1 && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -left-2 bottom-0 top-4 border-l border-neutral-300 dark:border-neutral-700/80"
                />
              )}
            </>
          )}
          <button
            onClick={() => onOpen(id)}
            className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm ${
              id === selectedId
                ? 'bg-indigo-100 text-indigo-900 dark:bg-violet-950/30 dark:text-indigo-100'
                : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/60'
            }`}
          >
            {depth > 0 && (
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  id === selectedId ? 'bg-indigo-500 dark:bg-indigo-300' : 'bg-neutral-400 dark:bg-neutral-600'
                }`}
              />
            )}
            <span className="min-w-0 flex-1 truncate">{section.labelOf?.(item) ?? id}</span>
          </button>
          {children.has(id) && <ul className="ml-3 pl-2">{render(id, depth + 1, nextSeen)}</ul>}
        </li>
      );
    });
  };

  return <ul data-testid={`${section.id}-tree`} className="space-y-0.5">{render(null, 0, new Set())}</ul>;
}
