import { useMemo, useState } from 'react';
import {
  activeFacetCount,
  distinctOptions,
  isFiltering,
  setFacet,
  toggleFacetValue,
  type FacetValues,
  type WorldFacetDef,
  type WorldFacetOption,
  type WorldFilterState,
} from '@shared/worldFilters';
import { Icon } from '../ui';
import { useDismissableLayer } from '../../hooks';
import { t, tx } from '../../i18n';

/**
 * The facet bar shared by every worldbuilding collection: one chip per dimension, each a
 * searchable multi-select, several active at once.
 *
 * Values for a `distinct` facet are computed from the WHOLE collection, not from what is
 * currently showing — a chip that only offers the values already selected is a trap you
 * cannot get out of without clearing everything.
 */
export function WorldFilterBar({
  facets,
  state,
  onChange,
  items,
}: {
  facets: WorldFacetDef[];
  state: WorldFilterState;
  onChange: (next: WorldFilterState) => void;
  /** The unfiltered collection's facet values, used to build the option lists. */
  items: FacetValues[];
}) {
  if (facets.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {facets.map((facet) => (
        <FacetChip
          key={facet.id}
          facet={facet}
          selected={state.facets[facet.id] ?? []}
          items={items}
          onToggle={(value) => onChange(toggleFacetValue(state, facet.id, value))}
          onClear={() => onChange(setFacet(state, facet.id, []))}
        />
      ))}
      {isFiltering(state) && activeFacetCount(state) > 0 && (
        <button
          className="btn btn-ghost h-7 gap-1 px-2 text-[11px] text-neutral-400 hover:text-neutral-200"
          onClick={() => onChange({ ...state, facets: {} })}
        >
          <Icon name="x" size={11} /> {t('Quitar filtros')}
        </button>
      )}
    </div>
  );
}

function FacetChip({
  facet,
  selected,
  items,
  onToggle,
  onClear,
}: {
  facet: WorldFacetDef;
  selected: string[];
  items: FacetValues[];
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const options = useMemo<WorldFacetOption[]>(() => {
    if (facet.source === 'vocabulary') return facet.vocabulary ?? [];
    return distinctOptions(items, facet.id);
  }, [facet, items]);

  // Counts are shown for every option, so an empty one is visibly empty rather than
  // simply absent — "there are no dragons yet" is information.
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const option of distinctOptions(items, facet.id)) map.set(option.id, option.count ?? 0);
    return map;
  }, [items, facet.id]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  const ref = useDismissableLayer<HTMLDivElement>({
    open,
    onDismiss: () => setOpen(false),
    group: 'world-facet',
  });

  if (options.length === 0) return null;

  const active = selected.length > 0;

  return (
    <div className="relative" ref={ref}>
      <button
        className={`btn h-7 gap-1 px-2 text-[11px] ${
          active ? 'border border-indigo-600 bg-indigo-600/20 text-indigo-200' : 'btn-ghost border border-neutral-700 text-neutral-300'
        }`}
        aria-expanded={open}
        onClick={() => {
          setQuery('');
          setOpen((value) => !value);
        }}
      >
        {t(facet.label)}
        {active && <span className="rounded-full bg-indigo-500/40 px-1.5">{selected.length}</span>}
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={10} className="opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-60 rounded-md border border-neutral-800 bg-neutral-950 p-2 shadow-xl">
          {options.length > 8 && (
            <input
              className="input mb-1.5 h-7 w-full text-xs"
              placeholder={t('Buscar…')}
              aria-label={t('Buscar…')}
              value={query}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {visible.length === 0 && <li className="px-1 py-2 text-[11px] text-neutral-600">{t('Sin coincidencias')}</li>}
            {visible.map((option) => (
              <li key={option.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-neutral-300 hover:bg-neutral-900">
                  <input type="checkbox" checked={selected.includes(option.id)} onChange={() => onToggle(option.id)} />
                  <span className="min-w-0 flex-1 truncate">{t(option.label)}</span>
                  <span className="shrink-0 text-[10px] text-neutral-600">{counts.get(option.id) ?? 0}</span>
                </label>
              </li>
            ))}
          </ul>
          {active && (
            <button className="mt-1.5 w-full text-left text-[10px] text-indigo-400 hover:text-indigo-300" onClick={onClear}>
              {tx('Quitar «{facet}»', { facet: t(facet.label) })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
