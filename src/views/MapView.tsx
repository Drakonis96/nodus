import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MapPlacePoint } from '@shared/types';
import { pointsYearRange, filterPointsByYear } from '@shared/mapProjection';
import { PlacesMap } from '../components/PlacesMap';
import { PersonDossierModal } from '../components/PersonDossierModal';
import { Icon } from '../components/ui';
import { useDismissableLayer } from '../hooks';
import { t, tx } from '../i18n';

// The general map: every located person-place, filterable by person (all / one /
// several) and swept by a chronological slider. Portrait thumbnails, per-person
// migration routes and an auto-fitting basemap all come from <PlacesMap>. Selecting
// no one shows the whole family; the view scales from a village to a world map.

interface PersonOption {
  personId: string;
  personName: string;
}

export function MapView() {
  const [allPoints, setAllPoints] = useState<MapPlacePoint[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // empty = all
  const [year, setYear] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [dossierId, setDossierId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setAllPoints(await window.nodus.mapPoints());
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  // The people who actually have located places (dedup, sorted).
  const personOptions = useMemo<PersonOption[]>(() => {
    const byId = new Map<string, PersonOption>();
    for (const p of allPoints) if (!byId.has(p.personId)) byId.set(p.personId, { personId: p.personId, personName: p.personName });
    return [...byId.values()].sort((a, b) => a.personName.localeCompare(b.personName));
  }, [allPoints]);

  const personFiltered = useMemo(
    () => (selected.size === 0 ? allPoints : allPoints.filter((p) => selected.has(p.personId))),
    [allPoints, selected]
  );

  const yearRange = useMemo(() => pointsYearRange(personFiltered), [personFiltered]);

  // Keep the slider valid as the filter changes; default to the latest year (all shown).
  useEffect(() => {
    if (!yearRange) {
      setYear(null);
      return;
    }
    setYear((y) => (y == null || y < yearRange.min || y > yearRange.max ? yearRange.max : y));
  }, [yearRange?.min, yearRange?.max]);

  // Play sweeps the slider forward once, then stops at the end.
  useEffect(() => {
    if (!playing || !yearRange) return;
    const id = window.setInterval(() => {
      setYear((y) => {
        const next = (y ?? yearRange.min) + 1;
        if (next >= yearRange.max) {
          setPlaying(false);
          return yearRange.max;
        }
        return next;
      });
    }, 550);
    return () => window.clearInterval(id);
  }, [playing, yearRange?.min, yearRange?.max]);

  const shownPoints = useMemo(() => filterPointsByYear(personFiltered, year), [personFiltered, year]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="relative z-20 flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-950 p-4"
        data-testid="map-toolbar"
      >
        <Icon name="map" size={20} className="text-indigo-300" />
        <h1 className="text-lg font-semibold">{t('Mapa')}</h1>

        <PersonFilter options={personOptions} selected={selected} onToggle={toggle} onClear={() => setSelected(new Set())} />

        {yearRange && (
          <div className="flex items-center gap-2">
            <button
              className="btn btn-ghost h-8 w-8 border border-neutral-700 p-0"
              title={playing ? t('Pausa') : t('Reproducir la línea temporal')}
              onClick={() => setPlaying((v) => !v)}
              disabled={yearRange.min === yearRange.max}
            >
              <Icon name={playing ? 'pause' : 'play'} size={13} />
            </button>
            <input
              type="range"
              min={yearRange.min}
              max={yearRange.max}
              value={year ?? yearRange.max}
              onChange={(e) => {
                setPlaying(false);
                setYear(Number(e.target.value));
              }}
              className="w-40"
              title={t('Línea cronológica')}
            />
            <span className="w-24 text-xs tabular-nums text-neutral-400">
              {year != null && year < yearRange.max ? tx('hasta {y}', { y: year }) : t('todo')}
            </span>
          </div>
        )}

        <span className="ml-auto text-xs text-neutral-500">
          {tx('{n} ubicaciones', { n: shownPoints.length })}
        </span>
      </div>

      <div className="relative z-0 flex min-h-0 flex-1 flex-col p-4">
        {allPoints.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Icon name="map" size={30} className="text-neutral-600" />
            <p className="max-w-md text-sm text-neutral-500">
              {t('Ningún lugar localizado todavía. Abre la ficha de una persona y añade sus lugares (municipio, estado, país); aparecerán aquí sobre el mapa.')}
            </p>
          </div>
        ) : (
          <PlacesMap points={shownPoints} fitPoints={personFiltered} showRoutes onPersonClick={setDossierId} />
        )}
      </div>
      {dossierId && <PersonDossierModal personId={dossierId} onClose={() => setDossierId(null)} onChanged={reload} />}
    </div>
  );
}

function PersonFilter({
  options,
  selected,
  onToggle,
  onClear,
}: {
  options: PersonOption[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useDismissableLayer<HTMLDivElement>({ open, onDismiss: () => setOpen(false) });

  const label =
    selected.size === 0
      ? t('Todas las personas')
      : selected.size === 1
        ? options.find((o) => selected.has(o.personId))?.personName ?? tx('{n} seleccionadas', { n: 1 })
        : tx('{n} seleccionadas', { n: selected.size });

  const filtered = q.trim() ? options.filter((o) => o.personName.toLowerCase().includes(q.trim().toLowerCase())) : options;

  return (
    <div className="relative" ref={ref} data-testid="map-person-filter">
      <button className="btn btn-ghost h-9 gap-1.5 border border-neutral-700 text-sm" onClick={() => setOpen((v) => !v)}>
        <Icon name="users" size={14} /> <span className="max-w-[12rem] truncate">{label}</span>
        <Icon name="chevronDown" size={13} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-64 rounded-md border border-neutral-800 bg-neutral-950 p-2 shadow-xl" data-testid="map-person-filter-dropdown">
          <input
            className="input mb-1.5 h-8 w-full text-sm"
            placeholder={t('Buscar persona…')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${selected.size === 0 ? 'text-indigo-300' : 'text-neutral-300 hover:bg-neutral-800'}`}
            onClick={onClear}
          >
            <Icon name={selected.size === 0 ? 'check' : 'minus'} size={13} /> {t('Todas las personas')}
          </button>
          <div className="max-h-56 overflow-y-auto">
            {filtered.map((o) => (
              <button
                key={o.personId}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                onClick={() => onToggle(o.personId)}
              >
                <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${selected.has(o.personId) ? 'border-indigo-500 bg-indigo-600' : 'border-neutral-600'}`}>
                  {selected.has(o.personId) && <Icon name="check" size={10} className="text-white" />}
                </span>
                <span className="truncate">{o.personName}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="px-2 py-2 text-center text-xs text-neutral-600">{t('Sin coincidencias')}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
