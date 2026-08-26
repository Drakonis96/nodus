import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/ui';
import { CompassFilters } from '../components/compass/CompassFilters';
import { CompassHistoryPanel } from '../components/compass/CompassHistoryPanel';
import { CompassImportDialog } from '../components/compass/CompassImportDialog';
import { CompassProviderStatus } from '../components/compass/CompassProviderStatus';
import { CompassResultList } from '../components/compass/CompassResultList';
import { CompassSearchBar } from '../components/compass/CompassSearchBar';
import { useCompassModal } from '../components/compass/useCompassModal';
import { compassT } from '../i18n.compass';
import {
  EMPTY_COMPASS_FILTERS, EMPTY_COMPASS_SNAPSHOT, getCompassApi,
  type CompassFilters as Filters, type CompassImportEvent, type CompassProviderId, type CompassResult, type CompassSearchResponse, type CompassSession, type CompassSnapshot,
} from '../components/compass/types';

function uniqueResults(items: CompassResult[]): CompassResult[] {
  const seen = new Set<string>();
  return items.filter((item) => item && !seen.has(item.canonicalKey) && seen.add(item.canonicalKey));
}

function responseResults(response: CompassSearchResponse | null): CompassResult[] {
  return response?.results ? uniqueResults(response.results) : [];
}

function reasonLabel(reason: CompassResult['reasons'][number]): string {
  const labels: Record<CompassResult['reasons'][number]['code'], string> = {
    'matched-concept': 'Coincide con los conceptos de la consulta',
    'phrase-match': 'Coincide con una frase exacta',
    'author-match': 'Coincide con el autor solicitado',
    'language-match': 'Coincide con el idioma solicitado',
    'type-match': 'Coincide con el tipo de publicación',
    'date-match': 'Coincide con el intervalo de fechas',
    'open-access': 'Tiene acceso abierto verificado',
    'provider-route': 'Procede de una fuente adecuada para la consulta',
    'citation-related': 'Está relacionado por citas',
    'semantic-similarity': 'Tiene similitud semántica local',
  };
  return `${compassT(labels[reason.code])}${reason.value ? ` · ${reason.value}` : ''}`;
}
function typeLabel(type: CompassResult['type']): string { return compassT(({ article: 'Artículo', book: 'Libro', chapter: 'Capítulo', thesis: 'Tesis', report: 'Informe', dataset: 'Conjunto de datos', preprint: 'Prepublicación', other: 'Otro' } as const)[type]); }

export function CompassView({ snapshot, onSnapshotChange }: { snapshot?: CompassSnapshot; onSnapshotChange?: (patch: Partial<CompassSnapshot>) => void }) {
  const api = getCompassApi();
  const initial = snapshot ?? EMPTY_COMPASS_SNAPSHOT;
  const [query, setQuery] = useState(initial.query);
  const [filters, setFilters] = useState<Filters>(initial.filters ?? EMPTY_COMPASS_FILTERS);
  const [sort, setSort] = useState<NonNullable<Filters['sort']>>(initial.filters?.sort ?? 'relevance');
  const [searchId, setSearchId] = useState<string | null>(initial.searchId);
  const [results, setResults] = useState<CompassResult[]>([]);
  const [session, setSession] = useState<CompassSession | null>(null);
  const [providers, setProviders] = useState<CompassSession['providers']>([]);
  const [status, setStatus] = useState<CompassSession['state']>('complete');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(initial.selectedCanonicalKeys ?? []));
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [savedResults, setSavedResults] = useState<CompassResult[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<CompassSession[]>([]);
  const [selectedItem, setSelectedItem] = useState<CompassResult | null>(null);
  const [importProgress, setImportProgress] = useState<CompassImportEvent | null>(null);
  const [aiInterpret, setAiInterpret] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [lastPageKeys, setLastPageKeys] = useState<string[]>([]);
  const [lastResponseOffset, setLastResponseOffset] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine);
  const generation = useRef(0);
  const requestId = useRef('');
  const activeSearchId = useRef<string | null>(initial.searchId);
  const hydratedSearchId = useRef<string | null>(null);
  const searchStarted = useRef(Boolean(initial.searchId));
  const selectionVersion = useRef(0);
  const anchorId = initial.scrollAnchor?.key ?? null;
  const detailsModal = useCompassModal(!!selectedItem, () => setSelectedItem(null));

  const patchSnapshot = useCallback((patch: Partial<CompassSnapshot>) => onSnapshotChange?.(patch), [onSnapshotChange]);

  const applyResponse = useCallback((response: CompassSearchResponse, replace = true) => {
    const nextResults = responseResults(response);
    setSession(response.session);
    setSearchId(response.session.searchId);
    hydratedSearchId.current = response.session.searchId;
    activeSearchId.current = response.session.searchId;
    setStatus(response.session.state);
    setProviders(response.session.providers ?? []);
    requestId.current = response.session.requestId;
    generation.current = response.session.generation;
    const offset = response.resultsOffset ?? 0;
    setLastResponseOffset(offset);
    setLastPageKeys(nextResults.map((item) => item.canonicalKey));
    setHasMore(response.hasMore ?? (response.session.resultCount > offset + nextResults.length || response.session.providers.some((provider) => !!provider.nextCursor)));
    setResults((current) => {
      if (replace) return nextResults.length || current.length === 0 ? nextResults : current;
      const prefix = current.slice(0, offset); const suffix = current.slice(offset + nextResults.length);
      return uniqueResults([...prefix, ...nextResults, ...suffix]);
    });
    const providerCursors = Object.fromEntries(response.session.providers.filter((provider) => provider.nextCursor).map((provider) => [provider.provider, provider.nextCursor])) as Partial<Record<CompassProviderId, string>>;
    patchSnapshot({ searchId: response.session.searchId, providerCursors, filters: response.session.filters, query: response.session.query });
  }, [patchSnapshot]);

  const startSearch = useCallback(async (nextQuery = query) => {
    const clean = nextQuery.trim();
    if (!clean) return;
    generation.current += 1;
    const currentGeneration = generation.current;
    const id = crypto.randomUUID();
    requestId.current = id;
    searchStarted.current = true;
    if (activeSearchId.current) void api.cancelCompassSearch(activeSearchId.current).catch(() => undefined);
    activeSearchId.current = null;
    selectionVersion.current += 1;
    setStatus('interpreting'); setResults([]); setProviders([]); setHasMore(false); setLastPageKeys([]); setSelected(new Set()); patchSnapshot({ selectedCanonicalKeys: [] }); setSelectedItem(null);
    try {
      const response = await api.startCompassSearch({ requestId: id, generation: currentGeneration, query: clean, filters: { ...filters, sort }, interpretWithLlm: aiInterpret });
      if (requestId.current !== id || generation.current !== currentGeneration) return;
      setQuery(clean); applyResponse(response);
    } catch (error) {
      if (requestId.current !== id || generation.current !== currentGeneration) return;
      setStatus('error'); setSession(null); setResults([]); setProviders([]);
      console.warn('[compass] search failed', error);
    }
  }, [aiInterpret, api, applyResponse, filters, query, sort]);

  const loadMore = useCallback(async () => {
    const moreAvailable = hasMore || (session?.resultCount ?? 0) > results.length || session?.providers.some((provider) => !!provider.nextCursor);
    if (!searchId || status === 'searching' || status === 'partial' || status === 'interpreting' || !moreAvailable) return;
    const id = requestId.current || crypto.randomUUID();
    requestId.current = id;
    const currentGeneration = generation.current;
    setStatus('searching');
    try {
      const response = await api.loadMoreCompass(searchId, id, currentGeneration, results.length);
      if (!response || requestId.current !== id || generation.current !== currentGeneration) return;
      applyResponse(response, false);
    } catch (error) { console.warn('[compass] load more failed', error); setStatus('error'); }
  }, [api, applyResponse, results.length, searchId, session?.providers, status]);

  useEffect(() => {
    if (!initial.searchId || hydratedSearchId.current === initial.searchId) return;
    hydratedSearchId.current = initial.searchId;
    let active = true;
    void api.getCompassSearch(initial.searchId).then((response) => { if (active && response) applyResponse(response); }).catch(() => undefined);
    return () => { active = false; };
  }, [api, applyResponse, initial.searchId]);

  useEffect(() => {
    if (!searchStarted.current || !query.trim()) return;
    const timer = window.setTimeout(() => { void startSearch(query); }, 220);
    return () => window.clearTimeout(timer);
  }, [filters, sort]);

  useEffect(() => {
    let active = true;
    void api.listCompassHistory(30).then((entries) => { if (active) setHistory(entries); }).catch(() => undefined);
    void api.listCompassSavedCandidates(100).then((entries) => { if (active) { setSavedResults(entries); setSaved(new Set(entries.map((entry) => entry.canonicalKey))); } }).catch(() => undefined);
    return () => { active = false; };
  }, [api, status]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  useEffect(() => {
    const unsubscribe = api.onCompassSearchProgress((event) => {
      if (event.requestId !== requestId.current || event.generation !== generation.current) return;
      // The first progress packet can race the start response. Bind the search id
      // from that packet, then reject every later generation/search as stale.
      if (activeSearchId.current && event.searchId !== activeSearchId.current) return;
      if (!activeSearchId.current) { activeSearchId.current = event.searchId; setSearchId(event.searchId); }
      setStatus(event.state); setProviders(event.providers ?? []);
      if (event.summaries) setResults((current) => {
        const offset = event.resultsOffset ?? 0;
        return uniqueResults([...current.slice(0, offset), ...event.summaries, ...current.slice(offset + event.summaries.length)]);
      });
      setHasMore(event.providers.some((provider) => !!provider.nextCursor));
      if (event.done) {
        setStatus(event.state);
        void api.getCompassSearch(event.searchId).then((response) => { if (response && requestId.current === event.requestId && generation.current === event.generation) applyResponse(response, false); }).catch(() => undefined);
      }
    });
    return unsubscribe;
  }, [api, applyResponse]);

  useEffect(() => {
    const unsubscribe = api.onCompassImportProgress(setImportProgress);
    return unsubscribe;
  }, [api]);

  useEffect(() => {
    if (!searchId) return;
    let active = true;
    const version = selectionVersion.current;
    void api.getCompassSelection(searchId).then((keys) => {
      if (active && selectionVersion.current === version) { setSelected(new Set(keys)); patchSnapshot({ selectedCanonicalKeys: keys }); }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [api, patchSnapshot, searchId]);

  const updateFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next); patchSnapshot({ filters: next });
  };
  const toggleSelected = (item: CompassResult) => setSelected((current) => {
    selectionVersion.current += 1;
    const next = new Set(current); if (next.has(item.canonicalKey)) next.delete(item.canonicalKey); else if (next.size < 10000) next.add(item.canonicalKey);
    patchSnapshot({ selectedCanonicalKeys: [...next] });
    if (searchId) void api.setCompassSelection(searchId, [...next], session?.revision ?? 0).catch(() => undefined);
    return next;
  });
  const selectPage = () => {
    const pageKeys = lastPageKeys.filter((key) => !dismissed.has(key));
    setSelected((current) => {
      selectionVersion.current += 1;
      const next = new Set(current); pageKeys.forEach((key) => next.add(key));
      patchSnapshot({ selectedCanonicalKeys: [...next] });
      if (searchId) void api.setCompassSelection(searchId, [...next], session?.revision ?? 0).catch(() => undefined);
      return next;
    });
  };
  const saveCandidate = async (item: CompassResult) => {
    if (!searchId) return;
    try { await api.saveCompassCandidate(searchId, item.canonicalKey); setSaved((current) => new Set(current).add(item.canonicalKey)); setSavedResults((current) => uniqueResults([item, ...current])); } catch { /* provider state remains visible */ }
  };
  const dismissCandidate = async (item: CompassResult) => {
    if (!searchId) return;
    const isDismissed = dismissed.has(item.canonicalKey);
    try { await (isDismissed ? api.restoreCompassCandidate : api.dismissCompassCandidate)(searchId, item.canonicalKey); setDismissed((current) => { const next = new Set(current); if (isDismissed) next.delete(item.canonicalKey); else next.add(item.canonicalKey); return next; }); } catch { /* no optimistic state on failure */ }
  };
  const findSimilar = async (item: CompassResult) => {
    try {
      const nextRequestId = crypto.randomUUID();
      generation.current += 1;
      requestId.current = nextRequestId;
      activeSearchId.current = null;
      selectionVersion.current += 1;
      setSelected(new Set());
      patchSnapshot({ selectedCanonicalKeys: [] });
      const response = await api.startCompassSearch({ requestId: nextRequestId, generation: generation.current, query: item.title, filters: { sort: 'relevance' }, interpretWithLlm: aiInterpret });
      applyResponse(response); setQuery(item.title);
    } catch { /* keep current results */ }
  };
  const importSelection = async () => {
    if (!searchId || !selected.size) return;
    try {
      const job = await api.startCompassImport({ searchId, selectionRevision: session?.revision ?? 0, canonicalKeys: [...selected] });
      const progress = await api.getCompassImport(job.jobId);
      if (progress) setImportProgress(progress);
    } catch { /* dialog opens only after a valid job */ }
  };
  const selectHistory = async (entry: CompassSession) => {
    setQuery(entry.query); setSearchId(entry.searchId); activeSearchId.current = entry.searchId; requestId.current = entry.requestId; generation.current = entry.generation; searchStarted.current = true;
    try { const response = await api.getCompassSearch(entry.searchId); if (response) applyResponse(response); } catch { /* history remains available */ }
  };

  const statusText = !online ? compassT('Sin conexión') : status === 'interpreting' ? compassT('Interpretando consulta…') : status === 'searching' ? compassT('Buscando…') : status === 'partial' ? compassT('Resultados parciales') : status === 'complete' ? compassT('Búsqueda completa') : status === 'canceled' ? compassT('Búsqueda cancelada') : status === 'error' ? compassT('Error en la búsqueda') : '';
  const canLoadMore = hasMore || (session?.resultCount ?? 0) > results.length || providers.some((provider) => !!provider.nextCursor);
  const recoverableProviderFailure = providers.some((provider) => provider.state === 'error' || provider.state === 'rate-limited');
  const detailsAuthors = selectedItem?.authors.map((author) => author.name).join(', ');
  const visibleResults = useMemo(() => results.filter((item) => !dismissed.has(item.canonicalKey)), [dismissed, results]);

  return <div data-testid="compass-view" data-loaded-results={results.length} data-last-response-offset={lastResponseOffset} className="relative flex h-full flex-col overflow-hidden bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
    <header className="shrink-0 border-b border-neutral-200 bg-white px-6 py-5 dark:border-neutral-800 dark:bg-neutral-950 max-md:px-4">
      <div className="mx-auto max-w-6xl"><div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/20"><Icon name="compass" size={22} /></span><div className="min-w-0 flex-1"><h1 className="text-xl font-semibold tracking-tight">{compassT('Nodus Compass')}</h1><p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{compassT('Descubre literatura académica en fuentes abiertas.')}</p></div></div>
        <div className="mt-4"><CompassSearchBar value={query} busy={status === 'interpreting' || status === 'searching'} onSearch={(value) => { setQuery(value); void startSearch(value); }} onCancel={() => { const canceledRequestId = requestId.current; generation.current += 1; requestId.current = crypto.randomUUID(); const canceledSearchId = activeSearchId.current ?? searchId ?? undefined; activeSearchId.current = null; void api.cancelCompassSearch(canceledSearchId, canceledRequestId).catch(() => undefined); setStatus('canceled'); }} ai={aiInterpret} onAiChange={setAiInterpret} /></div>
        <p className="mt-2 text-[11px] text-neutral-500">{compassT('Esta consulta se enviará a las fuentes seleccionadas.')} {compassT('La interpretación con IA es opcional.')}</p>
        <div className="mt-3"><CompassFilters filters={filters} open={filtersOpen} onToggle={() => setFiltersOpen((value) => !value)} onClear={() => { setFilters(EMPTY_COMPASS_FILTERS); patchSnapshot({ filters: EMPTY_COMPASS_FILTERS }); }} onChange={updateFilters} /></div>
      </div>
    </header>
    <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 gap-4 p-5 max-md:flex-col max-md:p-4">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-3 text-xs text-neutral-500">{statusText && <span role="status">{statusText}</span>}{session && <span>{session.resultCount} {compassT('resultados')}</span>}{(recoverableProviderFailure || !online || status === 'error') && query.trim() && <button type="button" className="text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => void startSearch(query)}>{compassT('Reintentar búsqueda')}</button>}</div><div className="flex items-center gap-2"><label className="sr-only" htmlFor="compass-sort">{compassT('Ordenar')}</label><select id="compass-sort" className="input h-8 text-xs" value={sort} onChange={(event) => { const next = event.target.value as NonNullable<Filters['sort']>; setSort(next); updateFilters({ sort: next }); }}><option value="relevance">{compassT('Relevancia')}</option><option value="date">{compassT('Fecha')}</option><option value="citations">{compassT('Citas')}</option></select><CompassProviderStatus providers={providers} /></div></div>
        {visibleResults.length > 0 && <div className="flex items-center gap-2 text-xs"><button type="button" className="btn btn-ghost h-8 text-xs" onClick={selectPage}>{compassT('Seleccionar página')}</button>{selected.size > 0 && <button type="button" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100" onClick={() => { selectionVersion.current += 1; setSelected(new Set()); patchSnapshot({ selectedCanonicalKeys: [] }); if (searchId) void api.setCompassSelection(searchId, [], session?.revision ?? 0).catch(() => undefined); }}>{compassT('Limpiar selección')}</button>}</div>}
        {results.length === 0 && status === 'complete' && !query ? <div className="grid min-h-[18rem] place-items-center rounded-xl border border-dashed border-neutral-300 p-8 text-sm text-neutral-500 dark:border-neutral-700"><div className="text-center"><Icon name="compass" size={25} className="mx-auto mb-2" /><p>{compassT('Escribe una consulta para empezar.')}</p></div></div> : <CompassResultList results={visibleResults} selected={selected} saved={saved} dismissed={dismissed} onToggle={toggleSelected} onOpen={setSelectedItem} onSave={(item) => void saveCandidate(item)} onDismiss={(item) => void dismissCandidate(item)} onSimilar={(item) => void findSimilar(item)} anchorId={anchorId} onAnchorChange={(id) => patchSnapshot({ scrollAnchor: id ? { key: id, offset: 0 } : undefined })} />}
        {canLoadMore && <button type="button" data-testid="compass-load-more" disabled={status === 'searching' || status === 'partial' || status === 'interpreting'} className="btn btn-ghost h-9 shrink-0 self-center text-xs" onClick={() => void loadMore()}><Icon name="download" size={14} /> {status === 'searching' || status === 'partial' || status === 'interpreting' ? compassT('Cargando…') : compassT('Cargar más')}</button>}
      </section>
      <aside className="w-56 shrink-0 max-md:w-full"><CompassHistoryPanel entries={history} saved={savedResults} onSelect={(entry) => void selectHistory(entry)} onSavedSelect={setSelectedItem} onDelete={(id) => void api.deleteCompassHistory(id).then(() => setHistory((items) => items.filter((item) => item.searchId !== id)))} onClear={() => void api.clearCompassHistory().then(() => setHistory([]))} />{selected.size > 0 && <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-500/10"><p className="text-xs font-medium text-indigo-800 dark:text-indigo-200">{compassT('{n} seleccionados', { n: selected.size })}</p><button type="button" className="btn btn-primary mt-2 h-8 w-full gap-1 text-xs bg-indigo-600 text-white" onClick={() => void importSelection()}><Icon name="download" size={13} /> {compassT('Importar selección')}</button></div>}</aside>
    </main>
    {selectedItem && <div ref={detailsModal.dialogRef} tabIndex={-1} onKeyDown={detailsModal.onKeyDown} className="fixed inset-0 z-40 grid place-items-center bg-black/25 p-4" role="dialog" aria-modal="true" aria-labelledby="compass-details-title" onClick={() => setSelectedItem(null)}><div className="max-h-[min(44rem,90vh)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-indigo-600">{typeLabel(selectedItem.type)}</p><h2 id="compass-details-title" className="mt-1 text-lg font-semibold">{selectedItem.title}</h2></div><button type="button" className="icon-btn" aria-label={compassT('Cerrar')} onClick={() => setSelectedItem(null)}><Icon name="x" size={16} /></button></div><p className="mt-2 text-sm text-neutral-500">{detailsAuthors}{selectedItem.issuedYear ? ` · ${selectedItem.issuedYear}` : ''}</p><div className="mt-4 flex flex-wrap gap-2 text-xs text-neutral-500">{selectedItem.openAccess && <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{compassT('Acceso abierto')}</span>}{selectedItem.citationCount != null && <span>{selectedItem.citationCount} {compassT('Citas')}</span>}{selectedItem.identifiers.map((identifier) => <span key={`${identifier.scheme}:${identifier.value}`} className="rounded bg-neutral-100 px-2 py-1 dark:bg-neutral-800">{identifier.scheme}: {identifier.value}</span>)}</div>{selectedItem.reasons.length > 0 && <section className="mt-5" aria-label={compassT('Por qué se recomienda')}><h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{compassT('Por qué se recomienda')}</h3><ul className="mt-2 space-y-1 text-sm">{selectedItem.reasons.map((reason, index) => <li key={`${reason.code}:${reason.value ?? ''}:${index}`} className="flex gap-2"><span aria-hidden="true">•</span><span>{reasonLabel(reason)}</span></li>)}</ul></section>}<div className="mt-5 flex flex-wrap gap-2"><button type="button" className="btn btn-primary h-8 gap-1 text-xs bg-indigo-600 text-white" onClick={() => void saveCandidate(selectedItem)}><Icon name="bookmark" size={13} /> {compassT('Guardar')}</button>{selectedItem.landingUrl && <a className="btn btn-ghost h-8 gap-1 text-xs" href={selectedItem.landingUrl} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> {compassT('Abrir fuente')}</a>}</div><div className="mt-5 space-y-1 text-xs text-neutral-500">{selectedItem.provenance.map((source) => <p key={`${source.provider}:${source.providerId}`}><span className="font-medium">{source.provider}</span>{source.attribution ? ` · ${source.attribution}` : ''}{source.metadataLicense ? ` · ${source.metadataLicense}` : ''}</p>)}</div></div></div>}
    <CompassImportDialog progress={importProgress} onCancel={() => { if (importProgress) void api.cancelCompassImport(importProgress.job.jobId); }} onRetry={() => { if (importProgress) void api.retryCompassImport(importProgress.job.jobId).then((job) => api.getCompassImport(job.jobId).then((next) => { if (next) setImportProgress(next); })); }} onClose={() => setImportProgress(null)} />
  </div>;
}
