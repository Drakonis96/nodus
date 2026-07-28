import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Place } from '@shared/types';
import { Icon } from './ui';
import { ViewportPopover } from './world/ViewportPopover';
import { t, tx } from '../i18n';

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

export interface PlaceSelection {
  placeId: string;
  name: string;
}

/**
 * Select an existing configured place or explicitly create a name-only provisional
 * one. Merely typing never creates data: the user must choose the Add row.
 */
export function ConfiguredPlacePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: PlaceSelection | null;
  onChange: (value: PlaceSelection | null) => void;
  disabled?: boolean;
}) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setPlaces(await window.nodus.listPlaces());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const options = useMemo(() => {
    const byId = new Map(places.map((place) => [place.placeId, place]));
    return places
      .map((place) => ({
        placeId: place.placeId,
        name: place.name,
        parentName: place.parentId ? byId.get(place.parentId)?.name ?? null : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || (a.parentName ?? '').localeCompare(b.parentName ?? ''));
  }, [places]);
  const normalizedQuery = normalize(query);
  const filtered = options.filter((place) =>
    !normalizedQuery || normalize(`${place.name} ${place.parentName ?? ''}`).includes(normalizedQuery)
  );
  const exactMatch = options.some((place) => normalize(place.name) === normalizedQuery);
  const canCreate = query.trim().length > 0 && query.trim().length <= 120 && !exactMatch;

  const choose = (place: PlaceSelection | null) => {
    onChange(place);
    setQuery('');
    setOpen(false);
  };

  const addPlace = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    try {
      const created = await window.nodus.findOrCreatePlace(query.trim());
      setPlaces((current) => current.some((place) => place.placeId === created.placeId)
        ? current
        : [...current, created]);
      choose({ placeId: created.placeId, name: created.name });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        className="input flex h-9 w-full items-center gap-2 px-2 text-left text-sm"
        aria-label={t('Lugar')}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (!busy) setOpen((current) => !current);
        }}
      >
        <Icon name="map" size={13} className="shrink-0 text-neutral-500" />
        <span className={`min-w-0 flex-1 truncate ${value ? 'text-neutral-200' : 'text-neutral-500'}`}>
          {value?.name ?? t('Sin lugar')}
        </span>
        <Icon name="chevronDown" size={13} className="shrink-0 text-neutral-500" />
      </button>
      <ViewportPopover
        anchorRef={rootRef}
        open={open}
        onDismiss={() => setOpen(false)}
        width={320}
        estimatedHeight={320}
        className="z-[130] flex flex-col overflow-hidden rounded-md border border-neutral-800 bg-neutral-950 p-2 shadow-2xl"
        testId="place-picker-popover"
      >
        <div className="relative mb-1.5 shrink-0">
          <Icon name="search" size={13} className="pointer-events-none absolute left-2 top-2.5 text-neutral-500" />
          <input
            className="input h-8 w-full text-xs"
            style={{ paddingLeft: '1.9rem' }}
            value={query}
            maxLength={120}
            autoFocus
            placeholder={t('Buscar o crear lugar…')}
            aria-label={t('Buscar lugar')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canCreate) {
                event.preventDefault();
                void addPlace();
              }
            }}
          />
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" role="listbox">
          {!normalizedQuery && (
            <button
              type="button"
              role="option"
              aria-selected={value == null}
              className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs ${
                value == null ? 'bg-indigo-950/60 text-indigo-200' : 'text-neutral-400 hover:bg-neutral-900'
              }`}
              onClick={() => choose(null)}
            >
              <Icon name="x" size={12} />
              {t('Sin lugar')}
            </button>
          )}
          {filtered.map((place) => (
            <button
              key={place.placeId}
              type="button"
              role="option"
              aria-selected={place.placeId === value?.placeId}
              className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs ${
                place.placeId === value?.placeId
                  ? 'bg-indigo-950/60 text-indigo-200'
                  : 'text-neutral-200 hover:bg-neutral-900'
              }`}
              onClick={() => choose(place)}
            >
              <Icon name="map" size={12} className="shrink-0 text-neutral-500" />
              <span className="min-w-0 flex-1 truncate">{place.name}</span>
              {place.parentName && <span className="shrink-0 truncate text-[10px] text-neutral-600">{place.parentName}</span>}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-indigo-300 hover:bg-indigo-950/50"
              disabled={busy}
              onClick={() => void addPlace()}
            >
              <Icon name="plus" size={13} />
              <span className="truncate">{tx('Añadir «{name}»', { name: query.trim() })}</span>
            </button>
          )}
          {filtered.length === 0 && !canCreate && (
            <p className="px-2 py-3 text-center text-xs text-neutral-600">{t('Sin coincidencias')}</p>
          )}
        </div>
        <p className="mt-1.5 shrink-0 border-t border-neutral-800 px-1 pt-1.5 text-[10px] text-neutral-600">
          {t('Los lugares nuevos se crean solo con el nombre para completarlos después.')}
        </p>
      </ViewportPopover>
    </div>
  );
}
