import { useEffect, useMemo, useState } from 'react';
import type {
  PrimarySourceMapPoint,
  PrimarySourceMapWorkspace,
} from '@shared/primarySourcesTypes';
import { Icon } from '../components/ui';
import { PrimarySourcesEvidenceMap } from '../components/primarySources/PrimarySourcesEvidenceMap';
import { t, tx } from '../i18n';

function precisionLabel(precision: string | null): string {
  const labels: Record<string, string> = {
    exact: 'Punto exacto',
    locality: 'Localidad',
    municipality: 'Municipio',
    region: 'Región aproximada',
  };
  return precision ? t(labels[precision] ?? precision) : '—';
}

function authorityLabel(point: PrimarySourceMapPoint): string {
  return String(
    point.authority?.name
    ?? point.authority?.gazetteerId
    ?? point.authority?.provider
    ?? '—'
  );
}

export function PrimarySourcesMapView() {
  const [workspace, setWorkspace] = useState<PrimarySourceMapWorkspace | null>(null);
  const [mode, setMode] = useState<'map' | 'table'>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [repository, setRepository] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.nodus.getPrimarySourceMapWorkspace()
      .then((data) => {
        if (cancelled) return;
        setWorkspace(data);
        setSelectedId(data.points[0]?.pointId ?? null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (workspace?.points ?? []).filter((point) => {
      if (sourceId && !point.sourceIds.includes(sourceId)) return false;
      if (repository && !point.repositoryNames.includes(repository)) return false;
      if (collectionId && !point.collectionIds.includes(collectionId)) return false;
      if (!query) return true;
      return [
        point.sourceTitle,
        point.normalizedName,
        point.dateDisplay,
        point.historicalContext,
        ...point.repositoryNames,
      ].filter(Boolean).some((value) => String(value).toLocaleLowerCase().includes(query));
    });
  }, [workspace, sourceId, repository, collectionId, search]);

  const selected = (workspace?.points ?? []).find((point) => point.pointId === selectedId) ?? null;

  useEffect(() => {
    if (selected && filtered.some((point) => point.pointId === selected.pointId)) return;
    setSelectedId(filtered[0]?.pointId ?? null);
  }, [filtered, selected]);

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid="primary-sources-provenance-map-view"
    >
      <header className="shrink-0 border-b border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
                <Icon name="map" size={17} />
              </span>
              <div>
                <h1 className="text-lg font-semibold">{t('Mapa de procedencia')}</h1>
                <p className="mt-0.5 max-w-3xl text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                  {t('Cada punto muestra el lugar de procedencia elegido en la ficha de una fuente. Las ciudades mencionadas en su contenido no aparecen en este mapa.')}
                </p>
              </div>
            </div>
          </div>
          <div
            className="flex rounded-lg border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-700 dark:bg-neutral-900"
            role="group"
            aria-label={t('Modo de vista')}
          >
            {(['map', 'table'] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setMode(entry)}
                aria-pressed={mode === entry}
                className={[
                  'flex items-center gap-1 rounded-md px-3 py-1.5 text-[11px] font-medium',
                  mode === entry
                    ? 'bg-white text-indigo-700 shadow-sm dark:bg-neutral-800 dark:text-indigo-300'
                    : 'text-neutral-500 dark:text-neutral-400',
                ].join(' ')}
              >
                <Icon name={(entry === 'map' ? 'map' : 'table') as never} size={12} />
                {t(entry === 'map' ? 'Mapa' : 'Tabla accesible')}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1.5fr)_minmax(180px,1fr)_minmax(170px,1fr)_minmax(170px,1fr)]">
          <div className="relative">
            <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-neutral-400" />
            <input
              className="input h-9 w-full text-xs"
              style={{ paddingLeft: '2rem' }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('Buscar fuente o lugar de procedencia…')}
            />
          </div>
          <select className="input h-9 text-xs" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
            <option value="">{t('Todas las fuentes')}</option>
            {workspace?.sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
          </select>
          <select className="input h-9 text-xs" value={repository} onChange={(event) => setRepository(event.target.value)}>
            <option value="">{t('Todos los repositorios')}</option>
            {workspace?.repositories.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <select className="input h-9 text-xs" value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
            <option value="">{t('Todas las colecciones')}</option>
            {workspace?.collections.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </div>

        {workspace && workspace.unassignedSources.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
            <span>
              {tx('{n} fuentes todavía no tienen lugar de procedencia. Asígnalo desde su ficha documental para que aparezcan en el mapa.', {
                n: workspace.unassignedSources.length,
              })}
            </span>
          </div>
        )}
      </header>

      {error && (
        <div role="alert" className="mx-5 mt-3 rounded-lg bg-rose-100 p-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-200">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-h-0 overflow-auto p-5">
          {!workspace && !error && (
            <div role="status" aria-live="polite" className="text-sm text-neutral-500">{t('Cargando mapa…')}</div>
          )}
          {workspace && mode === 'map' && (
            <PrimarySourcesEvidenceMap points={filtered} onSelect={setSelectedId} />
          )}
          {workspace && mode === 'table' && (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <table className="w-full text-left text-xs" data-testid="primary-sources-map-table">
                <thead className="bg-neutral-100 text-[10px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  <tr>
                    <th scope="col" className="px-3 py-2">{t('Fuente')}</th>
                    <th scope="col" className="px-3 py-2">{t('Lugar de procedencia')}</th>
                    <th scope="col" className="px-3 py-2">{t('Fecha')}</th>
                    <th scope="col" className="px-3 py-2">{t('Repositorio')}</th>
                    <th scope="col" className="px-3 py-2">{t('Coordenadas y precisión')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((point) => (
                    <tr
                      key={point.pointId}
                      tabIndex={0}
                      data-testid={`primary-source-provenance-point-${point.sourceIds[0]}`}
                      onClick={() => setSelectedId(point.pointId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedId(point.pointId);
                        }
                      }}
                      className="cursor-pointer border-t border-neutral-100 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-neutral-800 dark:hover:bg-indigo-950/30"
                    >
                      <td className="px-3 py-2 font-medium">{point.sourceTitle}</td>
                      <td className="px-3 py-2">{point.normalizedName}</td>
                      <td className="px-3 py-2">{point.dateDisplay || '—'}</td>
                      <td className="px-3 py-2">{point.repositoryNames.join(', ') || '—'}</td>
                      <td className="px-3 py-2">
                        {point.latitude !== null
                          ? `${point.latitude}, ${point.longitude} · ${precisionLabel(point.coordinatePrecision)}`
                          : t('Sin coordenadas')}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-neutral-500">{t('No hay procedencias que cumplan los filtros.')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </main>

        <aside className="min-h-0 overflow-auto border-l border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          {selected ? (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{t('Fuente')}</div>
              <h2 className="mt-1 text-lg font-semibold leading-snug">{selected.sourceTitle}</h2>
              <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/30">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-indigo-600 shadow-sm dark:bg-indigo-950 dark:text-indigo-300">
                    <Icon name="mapPin" size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-indigo-500 dark:text-indigo-300">{t('Lugar de procedencia')}</div>
                    <div className="mt-1 font-semibold">{selected.normalizedName}</div>
                    {selected.historicalContext && <p className="mt-1 text-[11px] leading-4 text-neutral-600 dark:text-neutral-300">{selected.historicalContext}</p>}
                  </div>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 text-xs">
                <div><dt className="text-neutral-500">{t('Fecha')}</dt><dd className="mt-1 font-medium">{selected.dateDisplay || '—'}</dd></div>
                <div><dt className="text-neutral-500">{t('Repositorio')}</dt><dd className="mt-1 font-medium">{selected.repositoryNames.join(', ') || '—'}</dd></div>
                <div><dt className="text-neutral-500">{t('Coordenadas')}</dt><dd className="mt-1 font-medium">{selected.latitude !== null ? `${selected.latitude}, ${selected.longitude}` : '—'}</dd></div>
                <div><dt className="text-neutral-500">{t('Precisión')}</dt><dd className="mt-1 font-medium">{precisionLabel(selected.coordinatePrecision)}</dd></div>
                <div className="col-span-2"><dt className="text-neutral-500">{t('Autoridad geográfica')}</dt><dd className="mt-1 font-medium">{authorityLabel(selected)}</dd></div>
              </dl>
              {selected.sensitivity !== 'normal' && (
                <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  {selected.sensitivity === 'highly_sensitive'
                    ? t('Las coordenadas se ocultan por la sensibilidad del lugar.')
                    : t('Las coordenadas se redondean para proteger un lugar sensible.')}
                </div>
              )}
              <p className="mt-6 border-t border-neutral-200 pt-4 text-[11px] leading-5 text-neutral-500 dark:border-neutral-800">
                {t('Este lugar se edita desde la ficha documental de la fuente. Las menciones geográficas del texto se conservan como evidencia, pero no modifican este mapa.')}
              </p>
            </>
          ) : (
            <div className="py-12 text-center text-sm text-neutral-500">{t('Selecciona una fuente para consultar su procedencia.')}</div>
          )}
        </aside>
      </div>
    </div>
  );
}
