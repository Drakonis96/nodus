import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AppSettings, ArgumentBlock, ArgumentMap, ArgumentRouteSuggestion, EdgeDetail, EdgeType, IdeaDetail, IdeaPickerItem, IdeaType } from '@shared/types';
import { EDGE_LABELS, NODE_COLORS, NODE_LABELS, Icon, Spinner } from '../components/ui';
import { SectionHeader } from '../components/SectionHeader';
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

export function ArgumentMapView({ settings }: { settings: AppSettings }) {
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

  // Reset the map when switching mode so the user lands on the right setup view.
  const switchMode = (next: 'auto' | 'ai') => {
    if (next === mode) return;
    setMode(next);
    setMap(null);
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
    return base;
  }, [suggestions, suggestionSearch, minConnections]);

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
  }, [seedId, model, mode]);

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
    <div className="h-full flex flex-col min-h-0">
      <SectionHeader
        icon="layers"
        title={t('Mapa de argumentos')}
        subtitle={t('El esqueleto argumental de tu corpus: qué idea apoya, refina o contradice a cuál, recorrido paso a paso.')}
      />

      {/* Setup */}
      <div className="border-b border-neutral-800 p-3 flex flex-wrap gap-2 items-end text-xs">
        {map && (
          <button
            className="btn btn-ghost text-xs gap-1.5 px-2.5 py-1.5 mr-1 border border-neutral-700"
            title={t('Volver al selector')}
            onClick={() => setMap(null)}
          >
            <Icon name="chevronLeft" size={12} /> {isAuto ? t('Recorridos') : t('Empezar de nuevo')}
          </button>
        )}
        <div className="flex rounded-lg overflow-hidden border border-neutral-700">
          <button
            className={`px-3 py-1.5 ${isAuto ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
            title={t('Detecta los recorridos por conectividad (sin IA)')}
            onClick={() => switchMode('auto')}
          >
            {t('Automático')}
          </button>
          <button
            className={`px-3 py-1.5 ${!isAuto ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
            title={t('La IA traza el esquema de argumentos desde una idea')}
            onClick={() => switchMode('ai')}
          >
            {t('IA')}
          </button>
        </div>

        {!isAuto && (
          <>
            <div className="flex flex-col gap-1 min-w-[260px] flex-1">
              <label className="text-neutral-500 uppercase tracking-wide">{t('Idea a investigar')}</label>
              <div className="relative" ref={seedSearchRef}>
                <input
                  className="input w-full"
                  placeholder={graphLoaded ? t('Busca una idea…') : t('Cargando ideas…')}
                  value={search}
                  onFocus={() => {
                    if (search.trim()) setSeedSearchOpen(true);
                  }}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSeedId('');
                    setSeedSearchOpen(Boolean(e.target.value.trim()));
                  }}
                  disabled={!graphLoaded}
                />
                {search && seedSearchOpen && (
                  <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto card bg-neutral-900 border border-neutral-700 shadow-xl">
                    {filteredIdeas.length === 0 && (
                      <div className="px-3 py-2 text-neutral-500">{t('Sin coincidencias')}</div>
                    )}
                    {filteredIdeas.map((n) => (
                      <button
                        key={n.global_id}
                        className="w-full text-left px-3 py-2 hover:bg-neutral-800 border-b border-neutral-800/60 last:border-0"
                        onClick={() => {
                          setSeedId(n.global_id);
                          setSearch(n.label);
                          setSeedSearchOpen(false);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: NODE_COLORS[n.type as IdeaType] ?? '#888' }} />
                          <span className="font-medium truncate">{n.label}</span>
                        </div>
                        {n.statement && <div className="text-neutral-500 text-[11px] mt-0.5 line-clamp-2">{n.statement}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {seedId && (
                <div className="text-[11px] text-indigo-400 flex items-center gap-1">
                  <Icon name="check" size={12} /> {t('Idea seleccionada')}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-neutral-500 uppercase tracking-wide">{t('Modelo')}</label>
              <ModelPicker settings={settings} value={model} onChange={setModel} compact />
            </div>
            <button
              className="btn btn-primary gap-1.5"
              onClick={() => build()}
              disabled={!seedId || building || !hasModel}
              title={!hasModel ? t('Configura un modelo de IA en Ajustes') : t('Trazar el mapa de argumentos')}
            >
              <Icon name="map" /> {building ? t('Trazando…') : t('Trazar mapa')}
            </button>
          </>
        )}

        {isAuto && (
          <div className="flex-1 flex items-end gap-2 flex-wrap">
            <span className="text-neutral-500">
              {suggestions.length > 0 ? tx('{a} de {b} recorridos', { a: filteredSuggestions.length, b: suggestions.length }) : t('Detectando recorridos…')}
            </span>
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Icon name="search" size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
              <input
                className="input input-with-leading-icon w-full py-1"
                placeholder={t('Buscar recorrido…')}
                value={suggestionSearch}
                onChange={(e) => setSuggestionSearch(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-1.5 text-neutral-400">
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
              className="btn btn-ghost gap-1.5"
              onClick={() => discoverRoutes(true)}
              disabled={suggestionsLoading}
            >
              <Icon name="sync" className={refreshing ? 'animate-spin' : ''} /> {t('Actualizar')}
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto p-4">
          {!isAuto && !hasModel && (
            <div className="card p-4 text-amber-400 text-sm flex items-center gap-2">
              <Icon name="alert" /> {t('Configura un modelo de IA en Ajustes para trazar mapas en modo IA, o usa el modo Automático.')}
            </div>
          )}
          {error && (
            <div className="card p-4 text-red-400 text-sm flex items-start gap-2">
              <Icon name="alert" /> <span>{error}</span>
            </div>
          )}
          {building && !map && (
            <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-3">
              <Spinner label={isAuto ? t('Construyendo el esquema…') : t('El modelo está trazando el esquema de argumentos…')} />
            </div>
          )}

          {/* Automatic mode: route picker when no map is built yet. */}
          {isAuto && !building && !map && (
            <div className="max-w-3xl mx-auto">
              {!error && suggestions.length === 0 && !suggestionsLoading && (
                <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-3 text-center max-w-md mx-auto py-10">
                  <Icon name="map" size={40} className="text-neutral-700" />
                  <div className="text-neutral-400">
                    {t('No hay ideas conectadas todavía. Analiza tus obras (escaneo profundo) para que el grafo genere conexiones entre ideas.')}
                  </div>
                </div>
              )}
              {suggestionsLoading && (
                <div className="flex items-center justify-center h-full text-neutral-500 gap-2">
                  <Icon name="sync" className="animate-spin" /> {t('Detectando recorridos…')}
                </div>
              )}
              <div className="space-y-2">
                {filteredSuggestions.length === 0 && !suggestionsLoading && suggestions.length > 0 && (
                  <div className="text-center text-neutral-500 text-sm py-8">
                    {t('Ningún recorrido coincide con los filtros actuales.')}
                  </div>
                )}
                {shownSuggestions.map((s, i) => (
                  <button
                    key={s.ideaId}
                    className="w-full text-left card p-3 hover:bg-neutral-800/80 transition-colors group"
                    onClick={() => build(s.ideaId)}
                    title={t('Trazar el esquema desde esta idea')}
                  >
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 w-7 h-7 rounded-full bg-neutral-800 flex items-center justify-center text-xs font-semibold text-neutral-400">
                        {i + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: NODE_COLORS[s.type as IdeaType] ?? '#888' }} />
                          <span className="font-medium text-sm text-neutral-100 truncate">{s.label}</span>
                          {s.debateCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400">{tx('{n} debate(s)', { n: s.debateCount })}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-neutral-500 flex-wrap">
                          <span>{tx('{n} conexiones', { n: s.degree })}</span>
                          <span>{t('conf media')} {s.avgConfidence.toFixed(2)}</span>
                          {s.topRelations.slice(0, 3).map((r) => (
                            <span key={r.type} className="text-neutral-400">
                              {t(EDGE_LABELS[r.type as EdgeType]) ?? r.type} ×{r.count}
                            </span>
                          ))}
                        </div>
                        {s.neighborLabels.length > 0 && (
                          <div className="text-[11px] text-neutral-600 mt-1 truncate">
                            ↳ {s.neighborLabels.join(' · ')}
                          </div>
                        )}
                      </div>
                      <Icon name="chevronRight" size={16} className="text-neutral-600 group-hover:text-neutral-300 mt-1" />
                    </div>
                  </button>
                ))}
                {hasMoreSuggestions && (
                  <div ref={suggestionsSentinelRef} className="pt-2 pb-6 text-center">
                    <button className="btn btn-ghost border border-neutral-700 text-xs" onClick={showMoreSuggestions}>
                      {t('Mostrar más')} ({filteredSuggestions.length - shownSuggestions.length})
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {!isAuto && !building && !map && !error && (
            <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-3 text-center max-w-md mx-auto">
              <Icon name="map" size={40} className="text-neutral-700" />
              <div className="text-neutral-400">
                {t('Selecciona una idea y traza su')} <span className="text-neutral-200">{t('mapa de argumentos')}</span>{t(': un esquema jerárquico de bloques que despliega progresivamente cómo se ramifica la argumentación desde esa idea, siguiendo las conexiones reales del grafo.')}
              </div>
            </div>
          )}
          {map && (
            <div className="max-w-4xl mx-auto">
              <div className="card p-4 mb-4 bg-neutral-900/60">
                <div className="flex items-center gap-2 text-xs text-neutral-500 mb-1 flex-wrap">
                  <Icon name="map" size={14} /> {t('Mapa desde')} <span className="text-neutral-300">{map.seedLabel}</span>
                  <span>· {tx('{n} ideas', { n: map.ideaCount })}</span>
                  {map.truncated && <span className="text-amber-500">· {t('subgrafo recortado')}</span>}
                  <span className="text-neutral-600">· {isAuto ? t('modo automático') : t('modo IA')}</span>
                </div>
                {map.overview && <p className="text-sm text-neutral-300 leading-relaxed">{map.overview}</p>}
              </div>
              <BlockTree
                block={map.root}
                depth={0}
                expanded={expanded}
                onToggle={toggleExpand}
                onSelect={selectBlock}
              />
            </div>
          )}
        </div>

        {(ideaDetail || edgeDetail || detailLoading) && (
          <NodeDetailPanel
            ideaDetail={ideaDetail}
            edgeDetail={edgeDetail}
            loading={detailLoading}
            width={detailWidth}
            fontSize={detailFontSize}
            onWidthChange={setDetailWidth}
            onFontChange={changeDetailFont}
            onClose={closeDetail}
          />
        )}
      </div>
    </div>
  );
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
