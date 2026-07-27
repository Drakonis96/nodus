import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyWorldFilter,
  EMPTY_WORLD_FILTER,
  isFiltering,
  type FacetValues,
  type WorldFacetDef,
  type WorldFilterState,
} from '@shared/worldFilters';
import { Icon } from '../ui';
import { WorldFilterBar } from './WorldFilterBar';
import { t, tx } from '../../i18n';

/**
 * How a section presents its collection. The data decides, not taste: a cast is browsed
 * by face, a set of places by containment, a run of scenes by narrative order.
 */
export type WorldPresentation = 'grid' | 'tree' | 'list';

export interface WorldSectionDef<T> {
  /** Also the testid prefix: `${id}-grid` is the scroll container. */
  id: string;
  icon: string;
  title: string;
  searchPlaceholder: string;
  createLabel: string;
  /** Shown when the vault has none of these at all. */
  emptyLabel: string;
  /** Shown when the filters hid everything. */
  noMatchLabel: string;
  presentation: WorldPresentation;
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
  Sheet: React.ComponentType<{ item: T; onChanged: () => Promise<void>; onBack: () => void }>;
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
        <p className="py-12 text-center text-sm text-neutral-500">{t('Cargando…')}</p>
      ) : visible.length === 0 ? (
        <div className={split ? 'py-8 text-center' : 'py-16 text-center'}>
          {!split && <Icon name={section.icon} size={32} className="mx-auto mb-3 text-neutral-700" />}
          <p className="text-sm text-neutral-500">{filtering ? t(section.noMatchLabel) : t(section.emptyLabel)}</p>
          {!split &&
            (filtering ? (
              <button
                className="btn btn-ghost mt-3 border border-neutral-700 text-xs"
                onClick={() => setFilter(EMPTY_WORLD_FILTER)}
              >
                {t('Quitar los filtros')}
              </button>
            ) : (
              <button className="btn btn-primary mt-3 gap-1.5" onClick={() => setAdding(true)}>
                <Icon name="plus" size={14} /> {t('Crear el primero')}
              </button>
            ))}
        </div>
      ) : section.presentation === 'tree' ? (
        <WorldTree section={section} items={visible} selectedId={selectedId} onOpen={setSelectedId} />
      ) : (
        <ul
          className={
            section.presentation === 'list'
              ? 'space-y-1.5'
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
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-neutral-800 p-4">
        <div className="flex items-center gap-2">
          <Icon name={section.icon} size={20} className="text-indigo-300" />
          <h1 className="text-lg font-semibold">{t(section.title)}</h1>
          {/* Never present a filtered count as the total: that is the quickest way to make
              someone believe half their world has vanished. */}
          <span className="text-xs text-neutral-500">
            {filtering ? tx('{shown} de {total}', { shown: String(visible.length), total: String(items.length) }) : items.length}
          </span>
          <button className="btn btn-primary ml-auto h-9 gap-1.5" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {t(section.createLabel)}
          </button>
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
          <div className="flex w-72 shrink-0 flex-col border-r border-neutral-800">{collection}</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <section.Sheet
              key={section.idOf(selected)}
              item={selected}
              onChanged={reload}
              onBack={() => setSelectedId(null)}
            />
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

  const render = (parentId: string | null, depth: number, seen: Set<string>): React.ReactNode =>
    (children.get(parentId) ?? []).map((item) => {
      const id = section.idOf(item);
      // A cycle in the data would recurse forever; the write path rejects them, but the
      // renderer must not depend on that being true.
      if (seen.has(id)) return null;
      const nextSeen = new Set(seen).add(id);
      return (
        <li key={id}>
          <button
            onClick={() => onOpen(id)}
            style={{ paddingLeft: `${depth * 0.85 + 0.5}rem` }}
            className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm ${
              id === selectedId ? 'bg-indigo-600/20 text-indigo-100' : 'text-neutral-300 hover:bg-neutral-800/60'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{section.labelOf?.(item) ?? id}</span>
          </button>
          {children.has(id) && <ul>{render(id, depth + 1, nextSeen)}</ul>}
        </li>
      );
    });

  return <ul>{render(null, 0, new Set())}</ul>;
}
