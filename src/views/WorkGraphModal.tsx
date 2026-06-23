// Per-work idea graph, shown in a modal from the Library.
//
// Seeds the graph with the ideas of one work and their connections to the rest
// of the corpus, then lets the reader expand outward by clicking ideas — even
// ideas from other works appear naturally as the neighbourhood grows. It reuses
// the same Sigma renderer as the main graph, feeding it a *growing subset* of
// the full graph instead of forking the renderer.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphData, EdgeDetail, IdeaDetail } from '@shared/types';
import { Icon } from '../components/ui';
import {
  NodeDetailPanel,
  loadNumber,
  type DetailLoading,
  DETAIL_WIDTH_KEY,
  DETAIL_FONT_KEY,
  DETAIL_MIN_WIDTH,
  DETAIL_MAX_WIDTH,
  DETAIL_DEFAULT_WIDTH,
  DETAIL_MIN_FONT,
  DETAIL_MAX_FONT,
  DETAIL_DEFAULT_FONT,
} from '../components/NodeDetailPanel';
import { SigmaGraph, type SigmaGraphApi } from './graph/SigmaGraph';
import { GraphErrorBoundary } from './graph/GraphErrorBoundary';
import { GRAPH_NODE_TYPES, EDGE_TYPE_COLORS, type GraphFilters } from './graph/model';
import { t, tx } from '../i18n';

// Wide-open filters: the modal controls visibility through the data subset it
// passes in, not through filters, so every node/edge type stays eligible.
const OPEN_FILTERS: GraphFilters = {
  search: '',
  nodeTypes: [...GRAPH_NODE_TYPES],
  edgeTypes: Object.keys(EDGE_TYPE_COLORS),
  theme: '',
  workIds: [],
  authors: [],
  yearMin: null,
  yearMax: null,
  readState: 'all',
  minConfidence: 0,
  basis: 'all',
};

const EMPTY_GRAPH: GraphData = { nodes: [], edges: [] };

function isIdeaNode(node: GraphData['nodes'][number]): boolean {
  return node.type !== 'theme' && node.type !== 'author';
}

export function WorkGraphModal({
  work,
  onClose,
}: {
  work: { nodus_id: string; title: string };
  onClose: () => void;
}) {
  const [fullData, setFullData] = useState<GraphData | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const apiRef = useRef<SigmaGraphApi | null>(null);

  const [ideaDetail, setIdeaDetail] = useState<IdeaDetail | null>(null);
  const [edgeDetail, setEdgeDetail] = useState<EdgeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<DetailLoading | null>(null);
  const [detailWidth, setDetailWidth] = useState(() =>
    loadNumber(DETAIL_WIDTH_KEY, DETAIL_DEFAULT_WIDTH, DETAIL_MIN_WIDTH, DETAIL_MAX_WIDTH)
  );
  const [detailFont, setDetailFont] = useState(() =>
    loadNumber(DETAIL_FONT_KEY, DETAIL_DEFAULT_FONT, DETAIL_MIN_FONT, DETAIL_MAX_FONT)
  );
  const detailRequestRef = useRef(0);

  useEffect(() => {
    let on = true;
    void window.nodus.getGraph('ideas').then((d) => {
      if (on) setFullData(d);
    });
    return () => {
      on = false;
    };
  }, []);

  // The ideas this work develops — the seeds of the ego graph.
  const seedIds = useMemo(() => {
    if (!fullData) return [] as string[];
    return fullData.nodes
      .filter((n) => isIdeaNode(n) && (n.workIds ?? []).includes(work.nodus_id))
      .map((n) => n.id);
  }, [fullData, work.nodus_id]);

  // Idea→idea adjacency over the whole graph, so expansion can reach beyond the
  // seed work. Theme membership ("contains") is excluded to keep the view a clean
  // map of ideas rather than dragging in giant theme hubs.
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!fullData) return map;
    const ideaIds = new Set(fullData.nodes.filter(isIdeaNode).map((n) => n.id));
    for (const edge of fullData.edges) {
      if (edge.type === 'contains') continue;
      if (!ideaIds.has(edge.source) || !ideaIds.has(edge.target)) continue;
      if (!map.has(edge.source)) map.set(edge.source, new Set());
      if (!map.has(edge.target)) map.set(edge.target, new Set());
      map.get(edge.source)!.add(edge.target);
      map.get(edge.target)!.add(edge.source);
    }
    return map;
  }, [fullData]);

  // Reset the reveal set to the seeds whenever the source graph (re)loads.
  useEffect(() => {
    setRevealed(new Set(seedIds));
  }, [seedIds]);

  // Visible subset = revealed ideas plus their direct neighbours.
  const subset = useMemo<GraphData>(() => {
    if (!fullData) return EMPTY_GRAPH;
    const visible = new Set<string>();
    for (const id of revealed) {
      visible.add(id);
      for (const other of adjacency.get(id) ?? []) visible.add(other);
    }
    const nodes = fullData.nodes.filter((n) => visible.has(n.id));
    const edges = fullData.edges.filter(
      (e) => e.type !== 'contains' && visible.has(e.source) && visible.has(e.target)
    );
    return { nodes, edges };
  }, [fullData, revealed, adjacency]);

  const reveal = useCallback((id: string) => {
    setRevealed((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const openNode = useCallback(
    (id: string, label: string, type: string) => {
      reveal(id);
      const requestId = ++detailRequestRef.current;
      setDetailLoading({ kind: 'idea', id, label, type });
      setEdgeDetail(null);
      void window.nodus.getIdeaDetail(id).then((d) => {
        if (requestId !== detailRequestRef.current) return;
        setIdeaDetail(d);
        setDetailLoading(null);
      });
    },
    [reveal]
  );

  const openEdge = useCallback((id: string, type: string) => {
    const requestId = ++detailRequestRef.current;
    setDetailLoading({ kind: 'edge', id, label: type });
    setIdeaDetail(null);
    void window.nodus.getEdgeDetail(id).then((d) => {
      if (requestId !== detailRequestRef.current) return;
      setEdgeDetail(d);
      setDetailLoading(null);
    });
  }, []);

  const closeDetail = useCallback(() => {
    detailRequestRef.current++;
    setIdeaDetail(null);
    setEdgeDetail(null);
    setDetailLoading(null);
    apiRef.current?.clearFocus();
  }, []);

  const resetToSeeds = useCallback(() => {
    setRevealed(new Set(seedIds));
    closeDetail();
    apiRef.current?.reset();
  }, [seedIds, closeDetail]);

  const changeFont = useCallback((delta: number) => {
    setDetailFont((current) => {
      const next = Math.min(DETAIL_MAX_FONT, Math.max(DETAIL_MIN_FONT, current + delta));
      localStorage.setItem(DETAIL_FONT_KEY, String(next));
      return next;
    });
  }, []);

  const changeWidth = useCallback((width: number) => {
    setDetailWidth(width);
    localStorage.setItem(DETAIL_WIDTH_KEY, String(width));
  }, []);

  // Esc closes the modal (unless a detail panel is open, which Esc closes first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (ideaDetail || edgeDetail || detailLoading) closeDetail();
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ideaDetail, edgeDetail, detailLoading, closeDetail, onClose]);

  const lightTheme = typeof document !== 'undefined' && document.documentElement.classList.contains('light');
  const detailOpen = Boolean(ideaDetail || edgeDetail || detailLoading);
  const ready = fullData != null;
  const empty = ready && seedIds.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={t('Grafo de la obra')}
      onClick={onClose}
    >
      <div
        className="card relative flex h-full w-full max-w-[1400px] flex-col overflow-hidden border border-neutral-700 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
          <Icon name="network" size={18} className="text-cyan-300" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{tx('Grafo de ideas · {title}', { title: work.title })}</h2>
            <p className="truncate text-xs text-neutral-500">
              {ready
                ? tx('{n} idea(s) de esta obra · haz clic en un nodo para expandir sus conexiones', { n: seedIds.length })
                : t('Cargando grafo…')}
            </p>
          </div>
          <div className="flex-1" />
          <button
            className="btn btn-ghost border border-neutral-700 gap-1.5 text-xs"
            title={t('Volver a las ideas de la obra')}
            onClick={resetToSeeds}
            disabled={!ready || empty}
          >
            <Icon name="refresh" size={13} /> {t('Reiniciar vista')}
          </button>
          <button
            className="btn btn-ghost border border-neutral-700 gap-1.5 text-xs"
            title={t('Ajustar a la pantalla')}
            onClick={() => apiRef.current?.fit()}
            disabled={!ready || empty}
          >
            <Icon name="fit" size={13} /> {t('Ajustar')}
          </button>
          <button className="ml-1 text-neutral-400 hover:text-white" title={t('Cerrar')} onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="relative flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-500">
                <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-cyan-400" />
                {t('Cargando grafo…')}
              </div>
            )}
            {empty && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center text-sm text-neutral-400">
                <Icon name="bulb" size={28} className="text-neutral-600" />
                <p>{t('Esta obra aún no tiene ideas extraídas.')}</p>
                <p className="text-xs text-neutral-500">{t('Ejecuta un análisis profundo de la obra para verla en el grafo.')}</p>
              </div>
            )}
            {ready && !empty && (
              <GraphErrorBoundary>
                <SigmaGraph
                  data={subset}
                  filters={OPEN_FILTERS}
                  lens="ideas"
                  preset="overview"
                  layoutMode="force"
                  highlightDepth={1}
                  lightTheme={lightTheme}
                  onOpenNode={openNode}
                  onOpenEdge={openEdge}
                  onClearFocus={closeDetail}
                  onApiReady={(api) => {
                    apiRef.current = api;
                  }}
                />
              </GraphErrorBoundary>
            )}
          </div>

          {detailOpen && (
            <NodeDetailPanel
              ideaDetail={ideaDetail}
              edgeDetail={edgeDetail}
              loading={detailLoading}
              width={detailWidth}
              fontSize={detailFont}
              onWidthChange={changeWidth}
              onFontChange={changeFont}
              onClose={closeDetail}
            />
          )}
        </div>
      </div>
    </div>
  );
}
