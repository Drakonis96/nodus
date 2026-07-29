import { useEffect, useMemo, useState } from 'react';
import type { GazetteerPlace } from '@shared/types';
import type {
  PrimarySourceMapPoint,
  PrimarySourceMapWorkspace,
} from '@shared/primarySourcesTypes';
import { Icon } from '../components/ui';
import { EvidenceTraceList } from '../components/primarySources/EvidenceTraceList';
import { PrimarySourcesEvidenceMap } from '../components/primarySources/PrimarySourcesEvidenceMap';
import { t, tx } from '../i18n';
import { consumePrimarySourceAttention } from '../primarySourcesAttention';

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    creation: 'Lugar de creación',
    mentioned: 'Lugar mencionado',
    event: 'Lugar de evento',
    event_location: 'Localización de evento',
    route_origin: 'Origen de ruta',
    route_destination: 'Destino de ruta',
    custody: 'Custodia',
    repository: 'Repositorio',
    consultation: 'Consulta',
    physical_location: 'Ubicación física privada',
  };
  return t(labels[role] ?? role);
}

function layerLabel(layer: string): string {
  const labels: Record<string, string> = {
    mentions: 'Menciones',
    events: 'Eventos',
    movements: 'Movimientos',
    repositories: 'Repositorios',
    custody: 'Custodia',
    consultation: 'Consulta',
    physical: 'Ubicaciones físicas',
  };
  return t(labels[layer] ?? layer);
}

function precisionLabel(precision: string | null): string {
  const labels: Record<string, string> = {
    exact: 'Punto exacto',
    locality: 'Localidad',
    municipality: 'Municipio',
    region: 'Región aproximada',
  };
  return precision ? t(labels[precision] ?? precision) : '—';
}

function certaintyBucket(value: number | null): 'high' | 'medium' | 'low' | 'unknown' {
  if (value === null) return 'unknown';
  if (value >= 0.8) return 'high';
  if (value >= 0.5) return 'medium';
  return 'low';
}

function resolutionLabel(point: PrimarySourceMapPoint): string {
  if (point.sensitivity === 'highly_sensitive') return t('Oculto por sensibilidad');
  if (point.resolutionStatus === 'resolved' && point.latitude !== null) return t('Resuelto');
  if (point.resolutionStatus === 'proposed') return t('Propuesto');
  if (point.resolutionStatus === 'rejected') return t('Descartado');
  return t('Sin resolver');
}

export function PrimarySourcesMapView() {
  const [attention, setAttention] = useState(() => consumePrimarySourceAttention(['ambiguous_places']));
  const [workspace, setWorkspace] = useState<PrimarySourceMapWorkspace | null>(null);
  const [mode, setMode] = useState<'map' | 'table'>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [personId, setPersonId] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [eventId, setEventId] = useState('');
  const [certainty, setCertainty] = useState('');
  const [repository, setRepository] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [layer, setLayer] = useState('');
  const [role, setRole] = useState('');
  const [resolutionStatus, setResolutionStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showHypotheses, setShowHypotheses] = useState(false);
  const [showPhysical, setShowPhysical] = useState(false);
  const [gazetteerQuery, setGazetteerQuery] = useState('');
  const [candidates, setCandidates] = useState<GazetteerPlace[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [coordinatePrecision, setCoordinatePrecision] = useState('locality');
  const [historicalContext, setHistoricalContext] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.nodus.getPrimarySourceMapWorkspace()
      .then((data) => {
        if (cancelled) return;
        setWorkspace(data);
        setSelectedId(data.points.find((point) => !point.hypothesis)?.pointId ?? data.points[0]?.pointId ?? null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (workspace?.points ?? []).filter((point) => {
      if (attention?.targetIds.length && (!point.mentionId || !attention.targetIds.includes(point.mentionId))) return false;
      if (!showHypotheses && point.hypothesis) return false;
      if (!showPhysical && point.layer === 'physical') return false;
      if (sourceId && !point.sourceIds.includes(sourceId)) return false;
      if (personId && !point.personIds.includes(personId)) return false;
      if (sourceType && !point.sourceTypes.includes(sourceType)) return false;
      if (eventId && point.eventId !== eventId) return false;
      if (certainty && certaintyBucket(point.certainty) !== certainty) return false;
      if (repository && !point.repositoryNames.includes(repository)) return false;
      if (collectionId && !point.collectionIds.includes(collectionId)) return false;
      if (layer && point.layer !== layer) return false;
      if (role && point.role !== role) return false;
      if (resolutionStatus && point.resolutionStatus !== resolutionStatus) return false;
      if (from && point.dateEndSort && point.dateEndSort < from) return false;
      if (to && point.dateStartSort && point.dateStartSort > to) return false;
      if (!query) return true;
      return [
        point.originalLabel,
        point.normalizedName,
        point.historicalContext,
        point.role,
        ...point.evidence.map((trace) => `${trace.sourceTitle} ${trace.quote}`),
      ].filter(Boolean).some((value) => String(value).toLocaleLowerCase().includes(query));
    });
  }, [
    workspace, showHypotheses, showPhysical, sourceId, personId, sourceType,
    eventId, certainty, repository, collectionId, layer, role, resolutionStatus,
    from, to, search, attention,
  ]);

  const selected = (workspace?.points ?? []).find((point) => point.pointId === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    setGazetteerQuery(selected.originalLabel);
    setCandidates([]);
    setSelectedCandidateId('');
    setCoordinatePrecision(selected.coordinatePrecision ?? 'locality');
    setHistoricalContext(selected.historicalContext ?? '');
    setValidFrom(selected.validFromDisplay ?? '');
    setValidTo(selected.validToDisplay ?? '');
  }, [selected?.pointId]);

  const searchGazetteer = async () => {
    const query = gazetteerQuery.trim();
    if (!query) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await window.nodus.searchGazetteer(query, 8);
      setCandidates(rows);
      setSelectedCandidateId(rows[0]?.gazetteerId ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const acceptResolution = async () => {
    if (!selected) return;
    const candidate = candidates.find((row) => row.gazetteerId === selectedCandidateId);
    if (!candidate) return;
    setBusy(true);
    setError(null);
    try {
      const data = await window.nodus.resolvePrimarySourceToponym({
        placeId: selected.placeId,
        mentionId: selected.mentionId,
        selectedCandidate: candidate,
        alternatives: candidates,
        coordinatePrecision,
        historicalContext: historicalContext.trim() || null,
        validFromDisplay: validFrom.trim() || null,
        validToDisplay: validTo.trim() || null,
        rationale: 'Resolución aceptada desde el mapa documental.',
      });
      setWorkspace(data);
      setCandidates([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const revertResolution = async () => {
    if (!selected?.resolution) return;
    setBusy(true);
    setError(null);
    try {
      const data = await window.nodus.revertPrimarySourceToponymResolution(
        selected.resolution.resolutionId
      );
      setWorkspace(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="shrink-0 border-b border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        {attention && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-[10px] text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">
            <Icon name="filter" size={11} />{t(attention.label)}
            <button className="ml-auto font-medium hover:underline" onClick={() => setAttention(null)}>{t('Mostrar todo')}</button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t('Mapa documental')}</h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {t('Topónimos originales, roles geográficos, autoridad y precisión sin perder la ambigüedad.')}
            </p>
          </div>
          <div
            className="ml-auto flex rounded-lg border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-700 dark:bg-neutral-900"
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
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-8">
          <input className="input h-8 text-xs lg:col-span-2" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar lugar o evidencia…')} />
          <select className="input h-8 text-xs" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
            <option value="">{t('Todas las fuentes')}</option>
            {workspace?.sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
          </select>
          <select className="input h-8 text-xs" value={personId} onChange={(event) => setPersonId(event.target.value)}>
            <option value="">{t('Todas las personas')}</option>
            {workspace?.persons.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <select className="input h-8 text-xs" value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
            <option value="">{t('Todos los tipos de fuente')}</option>
            {workspace?.sourceTypes.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
          <select className="input h-8 text-xs" value={eventId} onChange={(event) => setEventId(event.target.value)}>
            <option value="">{t('Todos los eventos')}</option>
            {workspace?.events.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <select className="input h-8 text-xs" value={certainty} onChange={(event) => setCertainty(event.target.value)}>
            <option value="">{t('Toda certeza')}</option>
            <option value="high">{t('Alta')}</option>
            <option value="medium">{t('Media')}</option>
            <option value="low">{t('Baja')}</option>
            <option value="unknown">{t('Desconocida')}</option>
          </select>
          <select className="input h-8 text-xs" value={repository} onChange={(event) => setRepository(event.target.value)}>
            <option value="">{t('Toda procedencia')}</option>
            {workspace?.repositories.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <select className="input h-8 text-xs" value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
            <option value="">{t('Todas las colecciones')}</option>
            {workspace?.collections.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <select className="input h-8 text-xs" value={layer} onChange={(event) => setLayer(event.target.value)}>
            <option value="">{t('Todas las capas')}</option>
            {workspace?.layers.map((entry) => <option key={entry} value={entry}>{layerLabel(entry)}</option>)}
          </select>
          <select className="input h-8 text-xs" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">{t('Todos los roles')}</option>
            {workspace?.roles.map((entry) => <option key={entry} value={entry}>{roleLabel(entry)}</option>)}
          </select>
          <select className="input h-8 text-xs" value={resolutionStatus} onChange={(event) => setResolutionStatus(event.target.value)}>
            <option value="">{t('Toda resolución')}</option>
            <option value="resolved">{t('Resueltos')}</option>
            <option value="unresolved">{t('Sin resolver')}</option>
            <option value="proposed">{t('Propuestos')}</option>
          </select>
          <input className="input h-8 text-xs" type="date" aria-label={t('Desde')} value={from} onChange={(event) => setFrom(event.target.value)} />
          <input className="input h-8 text-xs" type="date" aria-label={t('Hasta')} value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <div className="mt-3 flex flex-wrap gap-5">
          <label className="inline-flex items-center gap-2 text-[11px] text-neutral-600 dark:text-neutral-300">
            <input type="checkbox" checked={showHypotheses} onChange={(event) => setShowHypotheses(event.target.checked)} />
            {t('Mostrar hipótesis sin evidencia')}
          </label>
          <label className="inline-flex items-center gap-2 text-[11px] text-neutral-600 dark:text-neutral-300">
            <input type="checkbox" checked={showPhysical} onChange={(event) => setShowPhysical(event.target.checked)} />
            {t('Mostrar ubicación física privada')}
          </label>
        </div>
      </header>

      {error && <div role="alert" className="mx-5 mt-3 rounded-lg bg-rose-100 p-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-200">{error}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_410px]">
        <main className="min-h-0 overflow-auto p-5">
          {!workspace && !error && <div role="status" aria-live="polite" className="text-sm text-neutral-500">{t('Cargando mapa…')}</div>}
          {workspace && mode === 'map' && (
            <PrimarySourcesEvidenceMap points={filtered} onSelect={setSelectedId} />
          )}
          {workspace && mode === 'table' && (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <table className="w-full text-left text-xs" data-testid="primary-sources-map-table">
                <thead className="bg-neutral-100 text-[10px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  <tr>
                    <th scope="col" className="px-3 py-2">{t('Forma original')}</th>
                    <th scope="col" className="px-3 py-2">{t('Nombre normalizado')}</th>
                    <th scope="col" className="px-3 py-2">{t('Rol geográfico')}</th>
                    <th scope="col" className="px-3 py-2">{t('Coordenadas y precisión')}</th>
                    <th scope="col" className="px-3 py-2">{t('Autoridad')}</th>
                    <th scope="col" className="px-3 py-2">{t('Evidencia')}</th>
                    <th scope="col" className="px-3 py-2">{t('Estado')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((point) => (
                    <tr
                      key={point.pointId}
                      tabIndex={0}
                      onClick={() => setSelectedId(point.pointId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedId(point.pointId);
                        }
                      }}
                      className="cursor-pointer border-t border-neutral-100 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-neutral-800 dark:hover:bg-indigo-950/30"
                    >
                      <td className="px-3 py-2 font-medium">“{point.originalLabel}”</td>
                      <td className="px-3 py-2">{point.normalizedName}</td>
                      <td className="px-3 py-2">{roleLabel(point.role)}</td>
                      <td className="px-3 py-2">{point.latitude !== null ? `${point.latitude}, ${point.longitude} · ${precisionLabel(point.coordinatePrecision)}` : '—'}</td>
                      <td className="px-3 py-2">{String(point.authority?.gazetteerId ?? '—')}</td>
                      <td className="px-3 py-2">{point.evidence.length}</td>
                      <td className="px-3 py-2">{point.hypothesis ? t('Hipótesis') : resolutionLabel(point)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>

        <aside className="min-h-0 overflow-auto border-l border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          {selected ? (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{roleLabel(selected.role)}</div>
              <h2 className="mt-1 text-lg font-semibold">{selected.normalizedName}</h2>
              <div className="mt-2 rounded-lg bg-neutral-100 p-3 dark:bg-neutral-900">
                <div className="text-[10px] uppercase tracking-wide text-neutral-500">{t('Forma exacta en la fuente')}</div>
                <div className="mt-1 font-serif text-base italic">“{selected.originalLabel}”</div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div><dt className="text-neutral-500">{t('Resolución')}</dt><dd className="mt-1 font-medium">{resolutionLabel(selected)}</dd></div>
                <div><dt className="text-neutral-500">{t('Precisión')}</dt><dd className="mt-1 font-medium">{precisionLabel(selected.coordinatePrecision)}</dd></div>
                <div><dt className="text-neutral-500">{t('Coordenadas')}</dt><dd className="mt-1 font-medium">{selected.latitude !== null ? `${selected.latitude}, ${selected.longitude}` : '—'}</dd></div>
                <div><dt className="text-neutral-500">{t('Autoridad')}</dt><dd className="mt-1 font-medium">{String(selected.authority?.gazetteerId ?? '—')}</dd></div>
              </dl>
              {selected.sensitivity !== 'normal' && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  {selected.sensitivity === 'highly_sensitive'
                    ? t('Las coordenadas se ocultan por la sensibilidad del lugar.')
                    : t('Las coordenadas se redondean para proteger un lugar sensible.')}
                </div>
              )}
              {selected.historicalContext && <p className="mt-4 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">{selected.historicalContext}</p>}
              {(selected.validFromDisplay || selected.validToDisplay) && (
                <p className="mt-2 text-[11px] text-neutral-500">{t('Vigencia')}: {selected.validFromDisplay ?? '…'} — {selected.validToDisplay ?? '…'}</p>
              )}

              <section className="mt-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold">{t('Resolver topónimo')}</h3>
                  {selected.resolution && (
                    <button type="button" disabled={busy} onClick={() => void revertResolution()} className="text-[10px] font-medium text-rose-600 hover:underline dark:text-rose-300">
                      {t('Revertir resolución')}
                    </button>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <input className="input h-8 min-w-0 flex-1 text-xs" value={gazetteerQuery} onChange={(event) => setGazetteerQuery(event.target.value)} placeholder={t('Buscar en el gacetero local…')} />
                  <button type="button" disabled={busy || !gazetteerQuery.trim()} onClick={() => void searchGazetteer()} className="btn btn-secondary h-8 px-3 text-xs">
                    {t('Buscar')}
                  </button>
                </div>
                {candidates.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {candidates.map((candidate) => (
                      <label key={candidate.gazetteerId} className="flex cursor-pointer items-start gap-2 rounded-lg border border-neutral-200 p-2 text-[11px] dark:border-neutral-700">
                        <input type="radio" name="gazetteer-candidate" checked={selectedCandidateId === candidate.gazetteerId} onChange={() => setSelectedCandidateId(candidate.gazetteerId)} />
                        <span><b>{candidate.name}</b><br /><span className="text-neutral-500">{[candidate.admin1, candidate.country].filter(Boolean).join(', ')} · {candidate.latitude}, {candidate.longitude}</span></span>
                      </label>
                    ))}
                    <select className="input h-8 w-full text-xs" value={coordinatePrecision} onChange={(event) => setCoordinatePrecision(event.target.value)}>
                      <option value="exact">{t('Punto exacto')}</option>
                      <option value="locality">{t('Localidad')}</option>
                      <option value="municipality">{t('Municipio')}</option>
                      <option value="region">{t('Región aproximada')}</option>
                    </select>
                    <textarea className="input min-h-16 w-full text-xs" value={historicalContext} onChange={(event) => setHistoricalContext(event.target.value)} placeholder={t('Jurisdicción y contexto histórico…')} />
                    <div className="grid grid-cols-2 gap-2">
                      <input className="input h-8 text-xs" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} placeholder={t('Válido desde')} />
                      <input className="input h-8 text-xs" value={validTo} onChange={(event) => setValidTo(event.target.value)} placeholder={t('Válido hasta')} />
                    </div>
                    <p className="text-[10px] text-neutral-500">
                      {tx('{n} alternativas se conservarán en la decisión.', { n: Math.max(0, candidates.length - 1) })}
                    </p>
                    <button type="button" disabled={busy || !selectedCandidateId} onClick={() => void acceptResolution()} className="btn btn-primary h-8 w-full text-xs">
                      {t('Aceptar resolución geográfica')}
                    </button>
                  </div>
                )}
              </section>

              <section className="mt-6">
                <h3 className="mb-2 text-xs font-semibold">{t('Evidencia del lugar')}</h3>
                <EvidenceTraceList evidence={selected.evidence} />
              </section>
            </>
          ) : (
            <div className="py-12 text-center text-sm text-neutral-500">{t('Selecciona un lugar para revisar su evidencia y resolución.')}</div>
          )}
        </aside>
      </div>
    </div>
  );
}
