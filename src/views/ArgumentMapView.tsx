import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AppSettings, ArgumentBlock, ArgumentMap, ArgumentRouteSuggestion, EdgeDetail, EdgeType, IdeaDetail, IdeaPickerItem, IdeaType } from '@shared/types';
import { EDGE_LABELS, NODE_COLORS, NODE_LABELS, Icon, Spinner } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import {
  NodeDetailPanel,
  loadNumber,
  DETAIL_WIDTH_KEY,
  DETAIL_FONT_KEY,
  DETAIL_MIN_WIDTH,
  DETAIL_MAX_WIDTH,
  DETAIL_DEFAULT_WIDTH,
  DETAIL_MIN_FONT,
  DETAIL_MAX_FONT,
  DETAIL_DEFAULT_FONT,
  type DetailLoading,
} from '../components/NodeDetailPanel';
import { useDismissableLayer, useIncrementalList } from '../hooks';
import { useFeatureModel } from '../hooks/useFeatureModel';
import { expandableIdsByDepth } from '../argumentMapTree';
import { t, tx } from '../i18n';

const RELATION_LABELS: Record<string, string> = {
  ...EDGE_LABELS,
  root: 'semilla',
  framing: 'encuadre',
  related: 'relacionada',
};

// Border accent per relation, so the branch structure reads at a glance.
const RELATION_ACCENT: Record<string, string> = {
  supports: '#22c55e',
  refutes: '#ef4444',
  contradicts: '#f97316',
  extends: '#3b82f6',
  refines: '#8b5cf6',
  applies_to: '#eab308',
  shares_method: '#06b6d4',
  precondition_of: '#f472b6',
  measures_same: '#14b8a6',
  variant_of: '#a78bfa',
  related: '#737373',
  framing: '#a78bfa',
  root: '#f97316',
};

function typeLabel(type: ArgumentBlock['type']): string {
  return type === 'framing' ? 'encuadre' : NODE_LABELS[type as Exclude<IdeaType, never>] ?? type;
}

function typeColor(type: ArgumentBlock['type']): string {
  return type === 'framing' ? '#a78bfa' : NODE_COLORS[type as IdeaType] ?? '#888';
}

// A well-connected corpus ranks thousands of routes. Painting them all at once is
// what froze the section; one screenful at a time is enough to scroll from.
const ROUTES_PAGE_SIZE = 40;
type ArgumentMapSurface = 'catalog' | 'map';
type RouteSortKey = 'label' | 'type' | 'connections' | 'debates' | 'confidence';
type OpenArgumentMap = { ideaId: string; label: string; mode: 'auto' | 'ai' };

export function ArgumentMapView({ settings }: { settings: AppSettings }) {
  const [surface, setSurface] = useState<ArgumentMapSurface>('catalog');
  const [openArgumentMap, setOpenArgumentMap] = useState<OpenArgumentMap | null>(null);
  const [ideaNodes, setIdeaNodes] = useState<IdeaPickerItem[]>([]);
  const [graphLoaded, setGraphLoaded] = useState(false);
  const [mode, setMode] = useState<'auto' | 'ai'>('auto');
  const [suggestions, setSuggestions] = useState<ArgumentRouteSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  // Only a click on «Actualizar» spins that button's icon. The automatic discovery
  // on entering the section has its own indicator, and spinning both at once read
  // as if the app were refreshing on its own.
  const [refreshing, setRefreshing] = useState(false);
  const [seedId, setSeedId] = useState('');
  const [search, setSearch] = useState('');
  const [seedSearchOpen, setSeedSearchOpen] = useState(false);
  const [suggestionSearch, setSuggestionSearch] = useState('');
  const [minConnections, setMinConnections] = useState(0);
  const [routeSort, setRouteSort] = useState<RouteSortKey>('connections');
  const [model, setModel] = useFeatureModel(settings, 'argumentMapModel');
  const [map, setMap] = useState<ArgumentMap | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Progressive unfold: the map opens one level per tick after it is built. The
  // expanded set is the single source of truth, so a manual toggle and the
  // automatic unfold can never disagree about what is on screen.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const revealTimerRef = useRef<number | null>(null);

  const [ideaDetail, setIdeaDetail] = useState<IdeaDetail | null>(null);
  const [edgeDetail, setEdgeDetail] = useState<EdgeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<DetailLoading | null>(null);
  const detailSeqRef = useRef(0);
  const [detailWidth, setDetailWidth] = useState(() => loadNumber(DETAIL_WIDTH_KEY, DETAIL_DEFAULT_WIDTH, DETAIL_MIN_WIDTH, DETAIL_MAX_WIDTH));
  const [detailFontSize, setDetailFontSize] = useState(() => loadNumber(DETAIL_FONT_KEY, DETAIL_DEFAULT_FONT, DETAIL_MIN_FONT, DETAIL_MAX_FONT));
  const seedSearchRef = useDismissableLayer<HTMLDivElement>({
    open: seedSearchOpen,
    onDismiss: () => setSeedSearchOpen(false),
  });

  // The seed picker shows at most 60 ideas and searches their label and statement.
  // It used to get that list by loading the entire ideas graph — 9,721 nodes and
  // 34,531 edges, none of the edges ever read — which cost ~170 ms of blocked main
  // process and a multi-megabyte IPC message every time this view opened.
  //
  // Only the IA mode has a seed picker, and the section opens in automatic mode, so
  // the query waits until the user actually switches: entering the section then
  // costs one blocking main-process round trip instead of two.
  const pickerRequested = useRef(false);
  useEffect(() => {
    if (mode !== 'ai' || pickerRequested.current) return;
    pickerRequested.current = true;
    void window.nodus.listPickerIdeas().then((ideas) => {
      setIdeaNodes(ideas);
      setGraphLoaded(true);
    });
  }, [mode]);

  // Discover ranked idea hubs for the automatic mode. Cheap (local DB, no AI),
  // so we run it on mount and whenever the user (re)enters automatic mode.
  const discoverRoutes = useCallback(async (manual = false) => {
    setSuggestionsLoading(true);
    if (manual) setRefreshing(true);
    setError(null);
    try {
      const raw = await window.nodus.discoverArgumentRoutes();
      setSuggestions([...raw].sort((a, b) => b.degree - a.degree));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggestionsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'auto' && suggestions.length === 0 && !suggestionsLoading) {
      void discoverRoutes();
    }
  }, [mode, suggestions.length, suggestionsLoading, discoverRoutes]);

  // Switching the catalogue mode resets only its picker. An already-open map
  // remains mounted in its tab, just like an author dossier does.
  const switchMode = (next: 'auto' | 'ai') => {
    if (next === mode) return;
    setMode(next);
    setError(null);
    setSeedId('');
    setSearch('');
  };

  useEffect(() => {
    localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidth));
  }, [detailWidth]);
  useEffect(() => {
    localStorage.setItem(DETAIL_FONT_KEY, String(detailFontSize));
  }, [detailFontSize]);

  const filteredIdeas = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? ideaNodes.filter((n) => n.label.toLowerCase().includes(q) || (n.statement ?? '').toLowerCase().includes(q))
      : ideaNodes;
    return base.slice(0, 60);
  }, [ideaNodes, search]);

  const filteredSuggestions = useMemo(() => {
    const q = suggestionSearch.trim().toLowerCase();
    let base = suggestions;
    if (q) base = base.filter((s) => s.label.toLowerCase().includes(q) || s.statement.toLowerCase().includes(q));
    if (minConnections > 1) base = base.filter((s) => s.degree >= minConnections);
    return [...base].sort((a, b) => {
      if (routeSort === 'label') return a.label.localeCompare(b.label);
      if (routeSort === 'type') return a.type.localeCompare(b.type) || a.label.localeCompare(b.label);
      if (routeSort === 'debates') return b.debateCount - a.debateCount || b.degree - a.degree;
      if (routeSort === 'confidence') return b.avgConfidence - a.avgConfidence || b.degree - a.degree;
      return b.degree - a.degree || b.debateCount - a.debateCount;
    });
  }, [suggestions, suggestionSearch, minConnections, routeSort]);

  const {
    visible: shownSuggestions,
    hasMore: hasMoreSuggestions,
    sentinelRef: suggestionsSentinelRef,
    showMore: showMoreSuggestions,
  } = useIncrementalList<ArgumentRouteSuggestion>(filteredSuggestions, ROUTES_PAGE_SIZE);

  const stopReveal = useCallback(() => {
    if (revealTimerRef.current != null) {
      window.clearInterval(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  }, []);

  // Drive the progressive unfold once a map is built: open the root, then one
  // deeper level per tick. Stops as soon as the last level is open.
  useEffect(() => {
    stopReveal();
    if (!map) {
      setExpanded(new Set());
      return;
    }
    const levels = expandableIdsByDepth(map.root);
    setExpanded(new Set(levels[0] ?? []));
    if (levels.length <= 1) return;
    let level = 1;
    revealTimerRef.current = window.setInterval(() => {
      const ids = levels[level++] ?? [];
      setExpanded((cur) => {
        const next = new Set(cur);
        for (const id of ids) next.add(id);
        return next;
      });
      if (level >= levels.length) stopReveal();
    }, 260);
    return stopReveal;
  }, [map, stopReveal]);

  const build = useCallback(async (explicitSeed?: string) => {
    const sid = explicitSeed ?? seedId;
    if (!sid) return;
    const candidate = suggestions.find((entry) => entry.ideaId === sid);
    const pickerIdea = ideaNodes.find((entry) => entry.global_id === sid);
    const label = (candidate?.label ?? pickerIdea?.label ?? search.trim()) || t('Idea');
    setOpenArgumentMap({ ideaId: sid, label, mode });
    setSurface('map');
    setBuilding(true);
    setError(null);
    setMap(null);
    setIdeaDetail(null);
    setEdgeDetail(null);
    setDetailLoading(null);
    try {
      const result = await window.nodus.buildArgumentMap({ seedIdeaId: sid, model, mode });
      // The unfold effect seeds `expanded` from the new map.
      setMap(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  }, [ideaNodes, mode, model, search, seedId, suggestions]);

  const closeMapTab = useCallback(() => {
    stopReveal();
    setSurface('catalog');
    setOpenArgumentMap(null);
    setMap(null);
    setError(null);
    detailSeqRef.current++;
    setIdeaDetail(null);
    setEdgeDetail(null);
    setDetailLoading(null);
  }, [stopReveal]);

  const selectBlock = useCallback((block: ArgumentBlock) => {
    if (!block.ideaId) return;
    detailSeqRef.current++;
    setIdeaDetail(null);
    setEdgeDetail(null);
    setDetailLoading({ kind: 'idea', id: block.ideaId, label: block.label, type: block.type });
    const seq = detailSeqRef.current;
    void window.nodus.getIdeaDetail(block.ideaId).then(
      (d) => {
        if (seq !== detailSeqRef.current) return;
        setIdeaDetail(d);
        setDetailLoading(null);
      },
      () => {
        if (seq !== detailSeqRef.current) return;
        setDetailLoading(null);
      }
    );
  }, []);

  // A manual toggle hands control to the user: the automatic unfold stops so it
  // cannot reopen a branch the user just collapsed.
  const toggleExpand = useCallback((id: string) => {
    stopReveal();
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [stopReveal]);

  const closeDetail = () => {
    detailSeqRef.current++;
    setIdeaDetail(null);
    setEdgeDetail(null);
    setDetailLoading(null);
  };

  const changeDetailFont = (delta: number) => {
    setDetailFontSize((v) => Math.min(DETAIL_MAX_FONT, Math.max(DETAIL_MIN_FONT, v + delta)));
  };

  const hasModel = !!model;
  const isAuto = mode === 'auto';

  return (
    <div data-testid="argument-map-workspace" className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="shrink-0 border-b border-neutral-200 px-5 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-300">
            <Icon name="layers" size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">{t('Mapa de argumentos')}</h1>
            <p className="text-[11px] text-neutral-500">
              {suggestions.length > 0 ? tx('{a} de {b} recorridos', { a: filteredSuggestions.length, b: suggestions.length }) : t('Detectando recorridos…')}
            </p>
          </div>
        </div>

        <div data-testid="argument-map-tabs" className="flex min-w-0 items-end gap-1 overflow-x-auto">
          <button
            data-testid="argument-tab-catalog"
            className={`flex h-9 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs ${surface === 'catalog' ? 'border-neutral-300 bg-neutral-50 text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100' : 'border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900/60 dark:hover:text-neutral-300'}`}
            onClick={() => setSurface('catalog')}
          >
            <Icon name="list" size={13} /> {t('Ideas')}
          </button>
          {openArgumentMap && (
            <div className={`flex h-9 min-w-0 shrink-0 items-center rounded-t-lg border border-b-0 ${surface === 'map' ? 'border-neutral-300 bg-neutral-50 text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100' : 'border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900/60 dark:hover:text-neutral-300'}`}>
              <button data-testid="argument-tab-map" className="flex h-full max-w-72 min-w-0 items-center gap-2 px-3 text-xs" onClick={() => setSurface('map')}>
                <Icon name="layers" size={13} /><span className="truncate">{openArgumentMap.label}</span>
              </button>
              <button className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-800" aria-label={t('Cerrar')} onClick={closeMapTab}>
                <Icon name="x" size={11} />
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1">
        <section className={surface === 'catalog' ? 'flex h-full min-h-0 flex-col' : 'hidden'}>
          {/* Header / setup */}
          <div className="shrink-0 border-b border-neutral-200 p-3 text-xs dark:border-neutral-800">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
                <button
                  className={`px-3 py-1.5 ${isAuto ? 'bg-indigo-600 text-white' : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'}`}
                  title={t('Detecta los recorridos por conectividad (sin IA)')}
                  onClick={() => switchMode('auto')}
                >
                  {t('Automático')}
                </button>
                <button
                  className={`px-3 py-1.5 ${!isAuto ? 'bg-indigo-600 text-white' : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'}`}
                  title={t('La IA traza el esquema de argumentos desde una idea')}
                  onClick={() => switchMode('ai')}
                >
                  {t('IA')}
                </button>
              </div>

              {isAuto ? (
                <>
                  <div className="relative min-w-[240px] flex-1">
                    <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                    <input
                      data-testid="argument-routes-search"
                      className="input input-with-leading-icon w-full"
                      placeholder={t('Buscar recorrido…')}
                      value={suggestionSearch}
                      onChange={(e) => setSuggestionSearch(e.target.value)}
                    />
                  </div>
                  <label className="flex items-center gap-1.5 text-neutral-500">
                    {t('Mín. conexiones')}
                    <input
                      type="number"
                      className="input w-16 py-1 text-center"
                      min={0}
                      value={minConnections}
                      onChange={(e) => setMinConnections(Math.max(0, Number(e.target.value)))}
                    />
                  </label>
                  <button
                    data-testid="argument-routes-refresh"
                    className="btn btn-ghost gap-1.5 border border-neutral-300 dark:border-neutral-700"
                    onClick={() => discoverRoutes(true)}
                    disabled={suggestionsLoading}
                  >
                    <Icon name="sync" className={refreshing ? 'animate-spin' : ''} /> {t('Actualizar')}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex min-w-[260px] flex-1 flex-col gap-1">
                    <label className="uppercase tracking-wide text-neutral-500">{t('Idea a investigar')}</label>
                    <div className="relative" ref={seedSearchRef}>
                      <input
                        className="input w-full"
                        placeholder={graphLoaded ? t('Busca una idea…') : t('Cargando ideas…')}
                        value={search}
                        onFocus={() => { if (search.trim()) setSeedSearchOpen(true); }}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setSeedId('');
                          setSeedSearchOpen(Boolean(e.target.value.trim()));
                        }}
                        disabled={!graphLoaded}
                      />
                      {search && seedSearchOpen && (
                        <div className="card absolute z-20 mt-1 max-h-72 w-full overflow-y-auto border border-neutral-300 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
                          {filteredIdeas.length === 0 && <div className="px-3 py-2 text-neutral-500">{t('Sin coincidencias')}</div>}
                          {filteredIdeas.map((n) => (
                            <button
                              key={n.global_id}
                              className="w-full border-b border-neutral-200 px-3 py-2 text-left last:border-0 hover:bg-neutral-100 dark:border-neutral-800/60 dark:hover:bg-neutral-800"
                              onClick={() => { setSeedId(n.global_id); setSearch(n.label); setSeedSearchOpen(false); }}
                            >
                              <div className="flex items-center gap-2">
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: NODE_COLORS[n.type as IdeaType] ?? '#888' }} />
                                <span className="truncate font-medium">{n.label}</span>
                              </div>
                              {n.statement && <div className="mt-0.5 line-clamp-2 text-[11px] text-neutral-500">{n.statement}</div>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="uppercase tracking-wide text-neutral-500">{t('Modelo')}</label>
                    <ModelPicker settings={settings} value={model} onChange={setModel} compact />
                  </div>
                  <button className="btn btn-primary gap-1.5" onClick={() => build()} disabled={!seedId || building || !hasModel} title={!hasModel ? t('Configura un modelo de IA en Ajustes') : t('Trazar el mapa de argumentos')}>
                    <Icon name="map" /> {building ? t('Trazando…') : t('Trazar mapa')}
                  </button>
                </>
              )}
            </div>
            {!isAuto && seedId && <div className="mt-1 flex items-center gap-1 text-[11px] text-indigo-500 dark:text-indigo-400"><Icon name="check" size={12} /> {t('Idea seleccionada')}</div>}
          </div>

          {!isAuto ? (
            <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
              <div className="max-w-md text-center text-neutral-500">
                {!hasModel && <div className="card mb-4 flex items-center gap-2 p-4 text-left text-sm text-amber-600 dark:text-amber-400"><Icon name="alert" /> {t('Configura un modelo de IA en Ajustes para trazar mapas en modo IA, o usa el modo Automático.')}</div>}
                <Icon name="map" size={40} className="mx-auto text-neutral-300 dark:text-neutral-700" />
                <p className="mt-3 text-sm">{t('Selecciona una idea y traza su')} <span className="text-neutral-700 dark:text-neutral-200">{t('mapa de argumentos')}</span>{t(': un esquema jerárquico de bloques que despliega progresivamente cómo se ramifica la argumentación desde esa idea, siguiendo las conexiones reales del grafo.')}</p>
              </div>
            </div>
          ) : (
            <div data-testid="argument-routes-table" className="min-h-0 flex-1 overflow-auto">
              {error && <div className="m-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-400"><Icon name="alert" /> <span>{error}</span></div>}
              {suggestionsLoading && suggestions.length === 0 ? (
                <div className="grid h-48 place-items-center text-neutral-500"><Spinner label={t('Detectando recorridos…')} /></div>
              ) : suggestions.length === 0 && !error ? (
                <div className="grid h-48 place-items-center p-8 text-center text-sm text-neutral-500"><div><Icon name="map" size={32} className="mx-auto text-neutral-300 dark:text-neutral-700" /><p className="mt-3">{t('No hay ideas conectadas todavía. Analiza tus obras (escaneo profundo) para que el grafo genere conexiones entre ideas.')}</p></div></div>
              ) : (
                <div className="min-w-[1120px]">
                  <div className="grid h-10 items-center border-b border-neutral-200 px-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:text-neutral-600" style={{ gridTemplateColumns: 'minmax(260px,2fr) 7rem 7rem 6rem 7rem minmax(190px,1.25fr) minmax(230px,1.5fr) 2.5rem' }}>
                    <RouteSortHeader label="Idea" sort="label" active={routeSort} onSort={setRouteSort} />
                    <RouteSortHeader label="Tipo" sort="type" active={routeSort} onSort={setRouteSort} />
                    <RouteSortHeader label="Nº de conexiones" sort="connections" active={routeSort} onSort={setRouteSort} />
                    <RouteSortHeader label="Debates" sort="debates" active={routeSort} onSort={setRouteSort} />
                    <RouteSortHeader label="Confianza" sort="confidence" active={routeSort} onSort={setRouteSort} />
                    <span>{t('Relaciones')}</span><span>{t('Ideas')}</span><span />
                  </div>
                  {filteredSuggestions.length === 0 ? (
                    <div className="grid h-48 place-items-center text-sm text-neutral-500">{t('Ningún recorrido coincide con los filtros actuales.')}</div>
                  ) : (
                    <>
                      {shownSuggestions.map((s) => (
                        <button
                          key={s.ideaId}
                          data-testid={`argument-route-${s.ideaId}`}
                          className="grid min-h-[76px] w-full items-center border-b border-neutral-100 px-4 text-left text-xs transition-colors hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/55"
                          style={{ gridTemplateColumns: 'minmax(260px,2fr) 7rem 7rem 6rem 7rem minmax(190px,1.25fr) minmax(230px,1.5fr) 2.5rem' }}
                          onClick={() => build(s.ideaId)}
                          title={t('Trazar el esquema desde esta idea')}
                        >
                          <div className="min-w-0 pr-4">
                            <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: NODE_COLORS[s.type as IdeaType] ?? '#888' }} /><span className="truncate font-medium text-neutral-800 dark:text-neutral-100">{s.label}</span></div>
                            {s.statement && <p className="mt-1 line-clamp-2 pl-4 text-[11px] leading-relaxed text-neutral-500">{s.statement}</p>}
                          </div>
                          <span className="text-neutral-600 dark:text-neutral-400">{t(NODE_LABELS[s.type as IdeaType]) ?? s.type}</span>
                          <span className="tabular-nums text-neutral-600 dark:text-neutral-400">{s.degree}</span>
                          <span className={s.debateCount > 0 ? 'font-medium tabular-nums text-red-600 dark:text-red-400' : 'tabular-nums text-neutral-400 dark:text-neutral-600'}>{s.debateCount}</span>
                          <span className="tabular-nums text-neutral-600 dark:text-neutral-400">{s.avgConfidence.toFixed(2)}</span>
                          <div className="flex min-w-0 flex-wrap gap-1 pr-3">{s.topRelations.slice(0, 3).map((relation) => <span key={relation.type} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{t(EDGE_LABELS[relation.type as EdgeType]) ?? relation.type} ×{relation.count}</span>)}</div>
                          <span className="truncate pr-3 text-[11px] text-neutral-500">{s.neighborLabels.join(' · ') || '—'}</span>
                          <Icon name="chevronRight" size={15} className="text-neutral-400 dark:text-neutral-600" />
                        </button>
                      ))}
                    </>
                  )}
                  {hasMoreSuggestions && <div ref={suggestionsSentinelRef} className="py-4 text-center"><button className="btn btn-ghost border border-neutral-300 text-xs dark:border-neutral-700" onClick={showMoreSuggestions}>{t('Mostrar más')} ({filteredSuggestions.length - shownSuggestions.length})</button></div>}
                </div>
              )}
            </div>
          )}
        </section>

        {openArgumentMap && (
          <section className={surface === 'map' ? 'flex h-full min-h-0' : 'hidden'}>
            <div className="min-w-0 flex-1 overflow-y-auto p-4">
              {error && <div className="card flex items-start gap-2 p-4 text-sm text-red-400"><Icon name="alert" /> <span>{error}</span></div>}
              {building && !map && <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-500"><Spinner label={openArgumentMap.mode === 'auto' ? t('Construyendo el esquema…') : t('El modelo está trazando el esquema de argumentos…')} /></div>}
              {map && (
                <div className="mx-auto max-w-4xl">
                  <div className="card mb-4 bg-neutral-900/60 p-4">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                      <Icon name="map" size={14} /> {t('Mapa desde')} <span className="text-neutral-300">{map.seedLabel}</span>
                      <span>· {tx('{n} ideas', { n: map.ideaCount })}</span>
                      {map.truncated && <span className="text-amber-500">· {t('subgrafo recortado')}</span>}
                      <span className="text-neutral-600">· {openArgumentMap.mode === 'auto' ? t('modo automático') : t('modo IA')}</span>
                    </div>
                    {map.overview && <p className="text-sm leading-relaxed text-neutral-300">{map.overview}</p>}
                  </div>
                  <BlockTree block={map.root} depth={0} expanded={expanded} onToggle={toggleExpand} onSelect={selectBlock} />
                </div>
              )}
            </div>
            {(ideaDetail || edgeDetail || detailLoading) && <NodeDetailPanel ideaDetail={ideaDetail} edgeDetail={edgeDetail} loading={detailLoading} width={detailWidth} fontSize={detailFontSize} onWidthChange={setDetailWidth} onFontChange={changeDetailFont} onClose={closeDetail} />}
          </section>
        )}
      </main>
    </div>
  );
}

function RouteSortHeader({ label, sort, active, onSort }: { label: string; sort: RouteSortKey; active: RouteSortKey; onSort: (sort: RouteSortKey) => void }) {
  return <button className={`flex items-center gap-1 text-left hover:text-neutral-800 dark:hover:text-neutral-300 ${active === sort ? 'text-indigo-600 dark:text-indigo-300' : ''}`} onClick={() => onSort(sort)}>{t(label)}{active === sort && <Icon name="chevronDown" size={10} />}</button>;
}

function BlockTree({
  block,
  depth,
  expanded,
  onToggle,
  onSelect,
}: {
  block: ArgumentBlock;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (block: ArgumentBlock) => void;
}) {
  const isExpanded = expanded.has(block.id);
  const hasChildren = block.children.length > 0;
  const accent = RELATION_ACCENT[block.relation] ?? '#737373';

  return (
    <div className="relative">
      <div
        className="group relative rounded-lg border bg-neutral-900/80 hover:bg-neutral-800/80 transition-colors cursor-pointer"
        style={{ borderLeftColor: accent, borderLeftWidth: 4 }}
        onClick={() => onSelect(block)}
      >
        <div className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span
                  className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: `${typeColor(block.type)}22`, color: typeColor(block.type) }}
                >
                  {t(typeLabel(block.type))}
                </span>
                {block.relation !== 'root' && (
                  <span className="text-[10px] text-neutral-500 flex items-center gap-1">
                    <span style={{ color: accent }}><Icon name="arrowUp" size={10} className="rotate-90" /></span>
                    {t(RELATION_LABELS[block.relation as EdgeType]) ?? block.relation}
                  </span>
                )}
              </div>
              <div className="font-medium text-sm text-neutral-100">{block.label}</div>
              {block.summary && <div className="text-xs text-neutral-400 mt-1 leading-relaxed">{block.summary}</div>}
              {block.statement && depth === 0 && (
                <div className="text-xs text-neutral-500 mt-1.5 leading-relaxed">{block.statement}</div>
              )}
              {/* A hub has far more links than a readable map can draw. Saying how
                  many were left out keeps the map from reading as the whole story. */}
              {!!block.hiddenChildren && (
                <div className="text-[11px] text-neutral-600 mt-1.5">
                  {tx('+{n} conexiones no dibujadas', { n: block.hiddenChildren })}
                </div>
              )}
            </div>
            {hasChildren && (
              <button
                className="shrink-0 p-1 rounded hover:bg-neutral-700 text-neutral-400"
                title={isExpanded ? t('Contraer rama') : t('Desplegar rama')}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(block.id);
                }}
              >
                <Icon name={isExpanded ? 'minus' : 'plus'} size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Only the children wrapper animates. A `layout` animation on the block
          itself scale-corrects its own text, which left collapsed cards stretched
          to the height the whole branch used to occupy. */}
      <AnimatePresence initial={false}>
        {hasChildren && isExpanded && (
          <motion.div
            key="children"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="ml-3 pl-4 border-l border-neutral-800 mt-1 space-y-1.5">
              {block.children.map((child) => (
                <BlockTree
                  key={child.id}
                  block={child}
                  depth={depth + 1}
                  expanded={expanded}
                  onToggle={onToggle}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
