import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppSettings, GraphData, IdeaType, IdeaDetail, EdgeDetail, GraphNodeType, TutorStop } from '@shared/types';
import { NODE_COLORS, NODE_LABELS, EDGE_LABELS, Icon } from '../components/ui';
import { NodeDetailPanel, loadNumber, DETAIL_WIDTH_KEY, DETAIL_FONT_KEY, DETAIL_MIN_WIDTH, DETAIL_MAX_WIDTH, DETAIL_DEFAULT_WIDTH, DETAIL_MIN_FONT, DETAIL_MAX_FONT, DETAIL_DEFAULT_FONT, type RelationRow } from '../components/NodeDetailPanel';
import { useDataRefresh, useScanComplete } from '../hooks';
import { ThemesModal } from './ThemesModal';
import { IdeaDuplicatesModal } from './IdeaDuplicatesModal';
import { EdgeAuditModal } from './EdgeAuditModal';
import { TutorPanel } from './TutorPanel';
import { SigmaGraph, type SigmaGraphApi, type GraphViewLevel } from './graph/SigmaGraph';
import { buildThemeConstellation, buildThemeBackbone, buildPresetAtlas, EDGE_TYPE_COLORS } from './graph/model';
import { GraphErrorBoundary } from './graph/GraphErrorBoundary';
import type { GraphNavigationTarget, GraphPresetId } from '../navigation';
import { t, tx } from '../i18n';
import { academicKnowledgeViewSource, type KnowledgeViewSource } from './knowledgeViewSource';

const EMPTY_GRAPH_DATA: GraphData = { nodes: [], edges: [] };

const IDEA_TYPES: IdeaType[] = ['claim', 'finding', 'construct', 'method', 'framework'];
const GRAPH_NODE_TYPES: Exclude<GraphNodeType, 'author'>[] = ['theme', ...IDEA_TYPES];
const EDGE_TYPES = Object.keys(EDGE_LABELS);
type GraphLens = 'ideas' | 'authors';
interface GraphSceneRequest {
  key: string;
  kind: 'overview' | 'theme' | 'full';
  lens: GraphLens;
  theme?: string;
  cap?: number;
}
const DEFAULT_LOCAL_GRAPH_DEPTH = 1;
const LEGEND_COLLAPSED_KEY = 'nodus.graph.legendCollapsed';

interface Filters {
  search: string;
  nodeTypes: string[];
  edgeTypes: string[];
  theme: string;
  workIds: string[];
  authors: string[];
  yearMin: number | null;
  yearMax: number | null;
  readState: 'all' | 'read' | 'unread';
  minConfidence: number;
  basis: 'all' | 'explicit';
}

const DEFAULT_FILTERS: Filters = {
  search: '',
  nodeTypes: [...GRAPH_NODE_TYPES],
  edgeTypes: [...EDGE_TYPES],
  theme: '',
  workIds: [],
  authors: [],
  yearMin: null,
  yearMax: null,
  readState: 'all',
  minConfidence: 0,
  basis: 'all',
};

const GRAPH_PRESETS: {
  id: GraphPresetId;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    id: 'overview',
    label: 'Panorama',
    icon: 'layers',
    description: 'Toda la red de ideas y temas.',
  },
  {
    id: 'contradictions',
    label: 'Contradicciones',
    icon: 'gap',
    description: 'Refutaciones y tensiones explícitas o inferidas.',
  },
  {
    id: 'gaps',
    label: 'Huecos',
    icon: 'search',
    description: 'Ideas abiertas, limitaciones y zonas por conectar.',
  },
  {
    id: 'reading',
    label: 'Lectura',
    icon: 'book',
    description: 'Contexto de una obra o ruta de lectura.',
  },
  {
    id: 'unread',
    label: 'Por leer',
    icon: 'route',
    description: 'Nodos vinculados a obras sin tag de lectura.',
  },
  {
    id: 'authors',
    label: 'Autores',
    icon: 'graduation',
    description: 'Relaciones entre autores del corpus.',
  },
];

const FILTER_KEY = 'nodus.graph.filters';
const FILTER_VERSION_KEY = 'nodus.graph.filters.version';
const FILTER_VERSION = '4';
const LENS_KEY = 'nodus.graph.lens';
const LOCAL_GRAPH_DEPTH_KEY = 'nodus.graph.localDepth.v2';

function cloneFilters(filters: Filters): Filters {
  return {
    ...filters,
    nodeTypes: [...filters.nodeTypes],
    edgeTypes: [...filters.edgeTypes],
    workIds: [...filters.workIds],
    authors: [...filters.authors],
  };
}

function defaultFilters(): Filters {
  return cloneFilters(DEFAULT_FILTERS);
}

function graphPreset(id: GraphPresetId, target?: GraphNavigationTarget): { lens: GraphLens; filters: Filters; depth: number | null } {
  const base = defaultFilters();
  const withTarget = {
    ...base,
    search: target?.search ?? '',
    theme: target?.theme ?? '',
    workIds: target?.workId ? [target.workId] : [],
  };
  switch (id) {
    case 'contradictions':
      return {
        lens: 'ideas',
        filters: {
          ...withTarget,
          edgeTypes: ['contradicts', 'refutes', 'contains'],
          minConfidence: 0.1,
        },
        depth: 2,
      };
    case 'gaps':
      return {
        lens: 'ideas',
        filters: {
          ...withTarget,
          nodeTypes: ['theme', 'finding', 'claim', 'construct', 'framework'],
          edgeTypes: ['extends', 'refines', 'applies_to', 'shares_method', 'measures_same', 'variant_of', 'contains'],
          minConfidence: 0,
        },
        depth: 2,
      };
    case 'reading':
      return {
        lens: 'ideas',
        // A direct link to one work keeps all of that work's context. The plain
        // preset instead maps knowledge grounded only in completed reading.
        filters: target?.workId ? withTarget : { ...withTarget, readState: 'read' },
        depth: 1,
      };
    case 'unread':
      return {
        lens: 'ideas',
        filters: { ...withTarget, readState: 'unread' },
        depth: 1,
      };
    case 'authors':
      return {
        lens: 'authors',
        filters: withTarget,
        depth: 1,
      };
    case 'overview':
    default:
      return {
        lens: 'ideas',
        filters: withTarget,
        depth: 1,
      };
  }
}

function sourceStorageKey(base: string, sourceKey: string): string {
  return sourceKey === academicKnowledgeViewSource.key ? base : `${base}.${sourceKey}`;
}

function loadFilters(storageKey = FILTER_KEY, versionKey = FILTER_VERSION_KEY): Filters {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<Filters>;
    const merged = { ...defaultFilters(), ...parsed };
    const isLegacyFilters = localStorage.getItem(versionKey) !== FILTER_VERSION;
    const nodeTypes = new Set((merged.nodeTypes ?? []).filter((type) => GRAPH_NODE_TYPES.includes(type as any)));
    if (isLegacyFilters) nodeTypes.add('theme');
    merged.nodeTypes = GRAPH_NODE_TYPES.filter((type) => nodeTypes.has(type));
    // Ensure 'contains' edge type is always available (structural edges).
    merged.edgeTypes = Array.from(new Set([...(merged.edgeTypes ?? []), 'contains']));
    merged.workIds = Array.isArray(merged.workIds) ? merged.workIds : [];
    merged.authors = Array.isArray(merged.authors) ? merged.authors : [];
    return merged;
  } catch {
    return defaultFilters();
  }
}

function loadLens(storageKey = LENS_KEY): GraphLens {
  return localStorage.getItem(storageKey) === 'authors' ? 'authors' : 'ideas';
}

function loadHighlightDepth(storageKey = LOCAL_GRAPH_DEPTH_KEY): number | null {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return DEFAULT_LOCAL_GRAPH_DEPTH;
  if (raw === 'unlimited') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LOCAL_GRAPH_DEPTH;
  return Math.min(8, Math.max(1, Math.round(parsed)));
}

function navigationNotice(target: GraphNavigationTarget, preset: GraphPresetId): string {
  if (target.label) return target.label;
  if (target.workTitle) return `${t('Lectura:')} ${target.workTitle}`;
  if (target.edgeId) return t('Relación enfocada desde otra pantalla');
  if (target.nodeId) return t('Idea enfocada desde otra pantalla');
  if (target.theme) return `${t('Tema:')} ${target.theme}`;
  return t(GRAPH_PRESETS.find((p) => p.id === preset)?.description ?? '') || t('Contexto aplicado');
}

// Semantic-zoom navigation state for the Sigma engine's overview preset:
//   corpus → constellation of themes · theme → that theme's backbone ·
//   full → the classic idea graph (used when a deep-link focuses a node/edge).
type GraphLevelState = { level: 'corpus' } | { level: 'theme'; theme: string } | { level: 'full' };

export function GraphView({
  settings,
  onSettingsChange,
  target,
  dataSource = academicKnowledgeViewSource,
  scopeControl,
  testId,
}: {
  settings: AppSettings;
  onSettingsChange: () => void;
  target?: GraphNavigationTarget | null;
  dataSource?: KnowledgeViewSource;
  scopeControl?: ReactNode;
  testId?: string;
}) {
  const filterStorageKey = sourceStorageKey(FILTER_KEY, dataSource.key);
  const filterVersionStorageKey = sourceStorageKey(FILTER_VERSION_KEY, dataSource.key);
  const lensStorageKey = sourceStorageKey(LENS_KEY, dataSource.key);
  const legendStorageKey = sourceStorageKey(LEGEND_COLLAPSED_KEY, dataSource.key);
  const depthStorageKey = sourceStorageKey(LOCAL_GRAPH_DEPTH_KEY, dataSource.key);
  const clearFocusRef = useRef<() => void>(() => {});
  const focusByIdRef = useRef<(nodeIds: string[], edgeId?: string | null) => void>(() => {});
  const pendingNavigationRef = useRef<GraphNavigationTarget | null>(null);
  const lastNavigationNonceRef = useRef<number | null>(null);
  const [lens, setLens] = useState<GraphLens>(() => dataSource.capabilities.authors ? loadLens(lensStorageKey) : 'ideas');
  const [themesModalOpen, setThemesModalOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [ideaDupesOpen, setIdeaDupesOpen] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [data, setData] = useState<GraphData>(EMPTY_GRAPH_DATA);
  const [overviewData, setOverviewData] = useState<GraphData>(EMPTY_GRAPH_DATA);
  const [themeScene, setThemeScene] = useState<{ theme: string; data: GraphData } | null>(null);
  const [themes, setThemes] = useState<string[]>([]);
  const [themesLoaded, setThemesLoaded] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(() => loadFilters(filterStorageKey, filterVersionStorageKey));
  const [activePreset, setActivePreset] = useState<GraphPresetId>(() => (dataSource.capabilities.authors && loadLens(lensStorageKey) === 'authors' ? 'authors' : 'overview'));
  const [graphLevel, setGraphLevel] = useState<GraphLevelState>({ level: 'corpus' });
  // How many of a theme's most-connected ideas the backbone (level 2) shows.
  const [backboneCap, setBackboneCap] = useState(90);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [legendCollapsed, setLegendCollapsed] = useState(() => localStorage.getItem(legendStorageKey) === '1');
  const [contextNotice, setContextNotice] = useState<string | null>(null);
  const [contextZoteroKey, setContextZoteroKey] = useState<string | null>(null);
  const [ideaDetail, setIdeaDetail] = useState<IdeaDetail | null>(null);
  const [edgeDetail, setEdgeDetail] = useState<EdgeDetail | null>(null);
  // Optimistic detail placeholder: shown instantly on tap so the sidebar opens
  // before the (async) detail fetch resolves. Previously the panel only appeared
  // after `await getIdeaDetail`, which made every tap feel frozen for seconds.
  const [detailLoading, setDetailLoading] = useState<{ kind: 'idea' | 'edge'; id: string; label: string; type?: string } | null>(null);
  // Monotonic token so a stale async detail (e.g. the user tapped another node)
  // never overwrites the currently-shown one.
  const detailSeqRef = useRef(0);
  const [detailWidth, setDetailWidth] = useState(() => loadNumber(DETAIL_WIDTH_KEY, DETAIL_DEFAULT_WIDTH, DETAIL_MIN_WIDTH, DETAIL_MAX_WIDTH));
  const [detailFontSize, setDetailFontSize] = useState(() => loadNumber(DETAIL_FONT_KEY, DETAIL_DEFAULT_FONT, DETAIL_MIN_FONT, DETAIL_MAX_FONT));
  const [highlightDepth, setHighlightDepth] = useState<number | null>(() => loadHighlightDepth(depthStorageKey));
  const sigmaApiRef = useRef<SigmaGraphApi | null>(null);
  const lensRef = useRef<GraphLens>(lens);
  const graphLoadSeqRef = useRef(0);
  const graphRequestPendingRef = useRef(false);
  const graphSceneCacheRef = useRef(new Map<string, GraphData>());
  const graphSceneRequestRef = useRef<GraphSceneRequest>({ key: 'overview', kind: 'overview', lens: 'ideas' });
  const graphLoadStateRef = useRef({ running: false, queued: false, force: false });
  const dataSourceRef = useRef(dataSource);
  const graphReloadTimerRef = useRef<number | null>(null);

  useEffect(() => { dataSourceRef.current = dataSource; }, [dataSource]);

  useEffect(() => {
    localStorage.setItem(filterStorageKey, JSON.stringify(filters));
    localStorage.setItem(filterVersionStorageKey, FILTER_VERSION);
  }, [filterStorageKey, filterVersionStorageKey, filters]);

  useEffect(() => {
    lensRef.current = lens;
    localStorage.setItem(lensStorageKey, lens);
  }, [lens, lensStorageKey]);

  useEffect(() => {
    localStorage.setItem(legendStorageKey, legendCollapsed ? '1' : '0');
  }, [legendCollapsed, legendStorageKey]);

  useEffect(() => {
    localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidth));
  }, [detailWidth]);

  useEffect(() => {
    localStorage.setItem(DETAIL_FONT_KEY, String(detailFontSize));
  }, [detailFontSize]);

  useEffect(() => {
    localStorage.setItem(depthStorageKey, highlightDepth == null ? 'unlimited' : String(highlightDepth));
  }, [depthStorageKey, highlightDepth]);

  const progressiveOverview =
    lens === 'ideas' && activePreset === 'overview' && !filters.search.trim() && filters.workIds.length === 0;
  const requestedTheme = graphLevel.level === 'theme'
    ? graphLevel.theme
    : graphLevel.level === 'corpus' && filters.theme
      ? filters.theme
      : null;
  const graphSceneRequest = useMemo<GraphSceneRequest>(() => {
    if (!progressiveOverview || graphLevel.level === 'full') {
      return { key: `${dataSource.key}:full:${lens}`, kind: 'full' as const, lens };
    }
    if (requestedTheme) {
      return {
        key: `${dataSource.key}:theme:${requestedTheme.trim().toLowerCase()}:${Math.min(250, backboneCap)}`,
        kind: 'theme' as const,
        lens,
        theme: requestedTheme,
        cap: backboneCap,
      };
    }
    return { key: `${dataSource.key}:overview`, kind: 'overview' as const, lens };
  }, [backboneCap, dataSource.key, graphLevel.level, lens, progressiveOverview, requestedTheme]);
  graphSceneRequestRef.current = graphSceneRequest;

  const applyGraphScene = useCallback((request: GraphSceneRequest, nextData: GraphData) => {
    if (graphSceneRequestRef.current.key !== request.key) return;
    setData(nextData);
    if (request.kind === 'overview') {
      setOverviewData(nextData);
      setThemeScene(null);
      setThemes(nextData.nodes
        .filter((node) => node.type === 'theme')
        .map((node) => node.themes[0] ?? node.label));
    } else if (request.kind === 'theme' && request.theme) {
      setThemeScene({ theme: request.theme, data: nextData });
    }
    setThemesLoaded(true);
  }, []);

  const loadCurrentGraphScene = useCallback((force = false) => {
    const state = graphLoadStateRef.current;
    state.queued = true;
    state.force ||= force;
    if (state.running) return;
    state.running = true;
    void (async () => {
      try {
        while (state.queued) {
          const runForce = state.force;
          state.queued = false;
          state.force = false;
          const request = graphSceneRequestRef.current;
          if (runForce) graphSceneCacheRef.current.clear();
          let nextData = graphSceneCacheRef.current.get(request.key);
          if (!nextData) {
            const seq = ++graphLoadSeqRef.current;
            graphRequestPendingRef.current = true;
            setGraphLoading(true);
            nextData = request.kind === 'overview'
              ? await dataSource.getGraphOverview()
              : request.kind === 'theme'
                ? await dataSource.getGraphTheme(request.theme ?? '', request.cap)
                : await dataSource.getGraph(request.lens);
            if (seq !== graphLoadSeqRef.current && graphSceneRequestRef.current.key !== request.key) {
              state.queued = true;
              continue;
            }
            graphSceneCacheRef.current.set(request.key, nextData);
          }
          graphRequestPendingRef.current = false;
          applyGraphScene(request, nextData);
        }
      } catch (error) {
        console.error('[graph] load failed', error);
        graphRequestPendingRef.current = false;
        setGraphLoading(false);
      } finally {
        state.running = false;
        if (state.queued) loadCurrentGraphScene(state.force);
      }
    })();
  }, [applyGraphScene, dataSource]);

  const reload = useCallback(() => {
    if (graphReloadTimerRef.current != null) window.clearTimeout(graphReloadTimerRef.current);
    graphReloadTimerRef.current = window.setTimeout(() => {
      graphReloadTimerRef.current = null;
      loadCurrentGraphScene(true);
    }, 80);
  }, [loadCurrentGraphScene]);

  useEffect(() => () => {
    if (graphReloadTimerRef.current != null) window.clearTimeout(graphReloadTimerRef.current);
  }, []);

  useEffect(() => {
    loadCurrentGraphScene(false);
  }, [graphSceneRequest.key, loadCurrentGraphScene]);

  // Refresh the graph when scans finish so freshly analysed works appear without
  // having to leave and re-open the view.
  useDataRefresh(reload);
  useScanComplete(reload);
  useEffect(() => dataSource.subscribe?.(reload), [dataSource, reload]);

  // ── Semantic-zoom levels (Sigma engine, overview preset) ────────────────────
  // Levels only apply to the plain idea overview. Search and work-scoped views
  // keep the classic full graph so those flows behave exactly as before.
  const levelsActive = progressiveOverview;
  const activeThemeLabel = !levelsActive
    ? null
    : graphLevel.level === 'theme'
      ? graphLevel.theme
      : graphLevel.level === 'corpus' && filters.theme
        ? filters.theme
        : null;
  const constellationModel = useMemo(
    () => (levelsActive ? buildThemeConstellation(overviewData) : null),
    [levelsActive, overviewData]
  );
  const backboneModel = useMemo(
    () => (levelsActive && activeThemeLabel && themeScene
      && themeScene.theme.trim().toLowerCase() === activeThemeLabel.trim().toLowerCase()
      ? buildThemeBackbone(themeScene.data, activeThemeLabel, backboneCap)
      : null),
    [levelsActive, activeThemeLabel, themeScene, backboneCap]
  );
  // Total ideas in the active theme (for the "showing N of M" control at level 2).
  const activeThemeTotal = useMemo(() => {
    if (!activeThemeLabel || !constellationModel) return 0;
    const key = activeThemeLabel.trim().toLowerCase();
    return constellationModel.nodes.find((n) => (n.label ?? '').trim().toLowerCase() === key)?.workCount ?? 0;
  }, [activeThemeLabel, constellationModel]);
  const backboneShown = backboneModel?.nodes.filter((node) => !node.bridge).length ?? 0;
  const maximumThemeIdeas = Math.min(250, activeThemeTotal);
  const semanticOverrideModel = !levelsActive || graphLevel.level === 'full'
    ? null
    : activeThemeLabel
      ? backboneModel ?? constellationModel
      : constellationModel;
  const presetAtlasModel = useMemo(
    () => (!levelsActive && !filters.search.trim()
      ? buildPresetAtlas(data, filters, lens, activePreset)
      : null),
    [activePreset, data, filters, lens, levelsActive]
  );
  const graphOverrideModel = semanticOverrideModel ?? presetAtlasModel;
  const graphViewLevel: GraphViewLevel =
    presetAtlasModel ? 'atlas'
      : !levelsActive || graphLevel.level === 'full' ? 'full'
        : activeThemeLabel && backboneModel ? 'theme' : 'corpus';
  const visibleGraphNodeCount = graphOverrideModel?.nodes.length ?? data.nodes.length;
  const visibleGraphEdgeCount = graphOverrideModel?.edges.length ?? data.edges.length;
  const activePresetDefinition = GRAPH_PRESETS.find((preset) => preset.id === activePreset);

  const drillIntoTheme = useCallback((_nodeId: string, label: string) => {
    setIdeaDetail(null);
    setEdgeDetail(null);
    setDetailLoading(null);
    setBackboneCap(90);
    setGraphLevel({ level: 'theme', theme: label });
  }, []);
  const backToCorpus = useCallback(() => {
    setGraphLevel({ level: 'corpus' });
    setFilters((f) => (f.theme ? { ...f, theme: '' } : f));
  }, []);

  const zoomBy = (factor: number) => sigmaApiRef.current?.zoomBy(factor);
  const fitGraph = () => sigmaApiRef.current?.fit();
  const changeDetailFont = (delta: number) => {
    setDetailFontSize((value) => Math.min(DETAIL_MAX_FONT, Math.max(DETAIL_MIN_FONT, value + delta)));
  };

  // ── Renderer bridge ─────────────────────────────────────────────────────────
  const onSigmaOpenNode = useCallback((id: string, label: string, type: string) => {
    const seq = ++detailSeqRef.current;
    setEdgeDetail(null);
    const isIdea = lensRef.current === 'ideas' && !id.startsWith('theme:');
    if (!isIdea) {
      setIdeaDetail(null);
      setDetailLoading(null);
      return;
    }
    setIdeaDetail(null);
    setDetailLoading({ kind: 'idea', id, label, type });
    void dataSourceRef.current.getIdeaDetail(id).then(
      (d) => {
        if (seq === detailSeqRef.current) {
          setIdeaDetail(d);
          setDetailLoading(null);
        }
      },
      () => {
        if (seq === detailSeqRef.current) setDetailLoading(null);
      }
    );
  }, []);
  const onSigmaOpenEdge = useCallback((id: string, type: string) => {
    const seq = ++detailSeqRef.current;
    setIdeaDetail(null);
    setEdgeDetail(null);
    setDetailLoading({ kind: 'edge', id, label: type });
    void dataSourceRef.current.getEdgeDetail(id).then(
      (d) => {
        if (seq === detailSeqRef.current) {
          setEdgeDetail(d);
          setDetailLoading(null);
        }
      },
      () => {
        if (seq === detailSeqRef.current) setDetailLoading(null);
      }
    );
  }, []);
  const onSigmaClear = useCallback(() => {
    detailSeqRef.current++;
    setIdeaDetail(null);
    setEdgeDetail(null);
    setDetailLoading(null);
  }, []);

  // ── Idea relations (for the navigable "Conectada con" list) ─────────────────
  const nodeById = useMemo(() => {
    const map = new Map<string, GraphData['nodes'][number]>();
    for (const node of data.nodes) map.set(node.id, node);
    return map;
  }, [data]);

  // Every typed relation of the open idea — from the FULL edge set, so cross-theme
  // links surface here even while the graph view is scoped to one theme.
  const ideaRelations = useMemo<RelationRow[]>(() => {
    const idea = ideaDetail?.idea;
    if (!idea) return [];
    const id = idea.global_id;
    const norm = (s: string) => s.trim().toLowerCase();
    const themeKey = activeThemeLabel ? norm(activeThemeLabel) : null;
    const rows: (RelationRow & { conf: number })[] = [];
    const seen = new Set<string>();
    for (const edge of data.edges) {
      if (edge.type === 'contains') continue;
      const other = edge.source === id ? edge.target : edge.target === id ? edge.source : null;
      if (!other) continue;
      const pairKey = `${other}|${edge.type}`;
      if (seen.has(pairKey)) continue;
      const neighbor = nodeById.get(other);
      if (!neighbor || neighbor.type === 'theme') continue;
      seen.add(pairKey);
      const neighborThemes = neighbor.themes ?? [];
      const isBridge = themeKey != null && !neighborThemes.some((l) => norm(l) === themeKey);
      // Only label the theme when it adds information: for a bridge, the theme it
      // reaches into; at the full graph, the neighbour's theme as context. A
      // same-theme neighbour needs no label.
      const themeLabel = isBridge
        ? neighborThemes.find((l) => themeKey == null || norm(l) !== themeKey) ?? neighborThemes[0]
        : themeKey == null
          ? neighborThemes[0]
          : undefined;
      rows.push({
        id: other,
        label: neighbor.label,
        relLabel: t(EDGE_LABELS[edge.type as keyof typeof EDGE_LABELS]) ?? edge.type,
        relColor: EDGE_TYPE_COLORS[edge.type] ?? '#888',
        themeLabel,
        isBridge,
        conf: edge.confidence,
      });
    }
    // Surface cross-theme bridges first, then by confidence.
    rows.sort((a, b) => Number(b.isBridge) - Number(a.isBridge) || b.conf - a.conf);
    return rows.slice(0, 40).map(({ conf: _conf, ...row }) => row);
  }, [ideaDetail, data, nodeById, activeThemeLabel]);

  const openRelatedIdea = useCallback((ideaId: string) => {
    const neighbor = nodeById.get(ideaId);
    onSigmaOpenNode(ideaId, neighbor?.label ?? '', neighbor?.type ?? '');
    sigmaApiRef.current?.focusNode(ideaId);
  }, [nodeById, onSigmaOpenNode]);

  // Tutor stop → frame the node on the graph and open its info in the right sidebar so
  // it can be read alongside the narration. A sequence token avoids a stale async detail
  // landing after the user has already advanced to the next stop.
  const tutorDetailSeq = useRef(0);
  const showTutorStop = useCallback(async (stop: TutorStop) => {
    focusByIdRef.current(stop.nodeIds, stop.edgeId);
    const seq = ++tutorDetailSeq.current;
    // Invalidate any in-flight tap fetch so it can't overwrite the tutor's panel.
    detailSeqRef.current++;
    setDetailLoading(null);
    const apply = (idea: IdeaDetail | null, edge: EdgeDetail | null) => {
      if (seq !== tutorDetailSeq.current) return;
      setIdeaDetail(idea);
      setEdgeDetail(edge);
    };
    if (stop.kind === 'connection' && stop.edgeId) {
      setIdeaDetail(null);
      apply(null, await dataSourceRef.current.getEdgeDetail(stop.edgeId));
      return;
    }
    const ideaId = stop.nodeIds.find((id) => !id.startsWith('theme:'));
    if (ideaId) {
      setEdgeDetail(null);
      apply(await dataSourceRef.current.getIdeaDetail(ideaId), null);
      return;
    }
    apply(null, null); // theme stop — no dedicated detail panel
  }, []);

  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const toggleIn = (key: 'nodeTypes' | 'edgeTypes' | 'authors', val: string) =>
    setFilters((f) => {
      const arr = f[key];
      return { ...f, [key]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
    });
  const setLocalGraphDepth = (value: string) => {
    if (value === 'unlimited') {
      setHighlightDepth(null);
      return;
    }
    const parsed = Number(value);
    setHighlightDepth(Number.isFinite(parsed) ? Math.min(8, Math.max(1, Math.round(parsed))) : DEFAULT_LOCAL_GRAPH_DEPTH);
  };
  const selectLens = (nextLens: GraphLens) => {
    if (nextLens === lens) return;
    setGraphLoading(true);
    setLens(nextLens);
    setActivePreset(nextLens === 'authors' ? 'authors' : 'overview');
  };
  const applyPreset = useCallback((id: GraphPresetId, navigationTarget?: GraphNavigationTarget) => {
    const next = graphPreset(id, navigationTarget);
    setGraphLoading(true);
    setActivePreset(id);
    setLens(next.lens);
    setFilters(next.filters);
    setHighlightDepth(next.depth);
    setFiltersOpen(false);
    // A plain preset switch (no deep-link) re-enters the graph at the theme
    // overview; deep-link targets set their own level in the navigation effect.
    if (!navigationTarget) setGraphLevel(next.filters.theme ? { level: 'theme', theme: next.filters.theme } : { level: 'corpus' });
    if (id !== 'reading' || !navigationTarget?.workId) {
      setContextNotice(null);
      setContextZoteroKey(null);
    }
  }, []);

  // Reset the graph to its original state: default preset/filters, fresh layout
  // and framed camera.
  const resetGraph = useCallback(() => {
    applyPreset(lensRef.current === 'authors' ? 'authors' : 'overview');
    sigmaApiRef.current?.reset();
    onSigmaClear();
  }, [applyPreset, onSigmaClear]);

  const playGraphHistory = useCallback(() => {
    sigmaApiRef.current?.playHistory();
  }, []);

  useEffect(() => {
    if (!target || target.nonce === lastNavigationNonceRef.current) return;
    lastNavigationNonceRef.current = target.nonce;
    const preset = target.preset ?? (target.edgeId ? 'contradictions' : target.workId ? 'reading' : 'overview');
    applyPreset(preset, target);
    // Keep the semantic-zoom level consistent with the deep-link: a focused node,
    // edge or work needs the full graph; a theme link opens that theme's backbone.
    if (target.nodeId || target.edgeId || target.workId) setGraphLevel({ level: 'full' });
    else if (target.theme) setGraphLevel({ level: 'theme', theme: target.theme });
    else setGraphLevel({ level: 'corpus' });
    if (target.openTutor) setTutorOpen(true);
    setContextNotice(navigationNotice(target, preset));
    setContextZoteroKey(target.zoteroKey ?? null);
    pendingNavigationRef.current = target;
  }, [applyPreset, target]);

  const focusPendingNavigation = useCallback(() => {
    const current = pendingNavigationRef.current;
    const api = sigmaApiRef.current;
    if (!current || !api) return false;

    let handled = false;
    if (current.edgeId) {
      handled = api.focusEdge(current.edgeId);
      if (handled) {
        const edge = data.edges.find((candidate) => candidate.id === current.edgeId);
        onSigmaOpenEdge(current.edgeId, edge?.type ?? '');
      }
    } else if (current.nodeId) {
      handled = api.focusNode(current.nodeId);
      if (handled) {
        const node = nodeById.get(current.nodeId);
        onSigmaOpenNode(current.nodeId, node?.label ?? current.label ?? '', node?.type ?? '');
      }
    } else if (current.workId || current.theme || current.search) {
      api.fit();
      handled = true;
    }

    if (handled) pendingNavigationRef.current = null;
    return handled;
  }, [data.edges, nodeById, onSigmaOpenEdge, onSigmaOpenNode]);

  const handleSigmaApiReady = useCallback((api: SigmaGraphApi | null) => {
    sigmaApiRef.current = api;
    clearFocusRef.current = () => api?.clearFocus();
    focusByIdRef.current = (nodeIds, edgeId) => api?.focusTutor(nodeIds, edgeId);
  }, []);

  const handleGraphReady = useCallback(() => {
    graphRequestPendingRef.current = false;
    setGraphLoading(false);
    focusPendingNavigation();
  }, [focusPendingNavigation]);

  useEffect(() => {
    if (!themesLoaded) return;
    setFilters((f) => (f.theme && !themes.includes(f.theme) ? { ...f, theme: '' } : f));
  }, [themes, themesLoaded]);

  // Escape clears the current graph selection: closes the detail panel and drops
  // the highlight, mirroring the panel's close button. Ignored while typing so it
  // doesn't fight the search box or the filter selects.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only defer to real form controls (e.g. the graph search box) so typing
      // isn't hijacked. The detail panel's rich-text body is contentEditable and
      // auto-focuses on open, so guarding on that would block the very case this
      // shortcut exists for — closing the open panel.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!ideaDetail && !edgeDetail && !detailLoading) {
        clearFocusRef.current();
        return;
      }
      detailSeqRef.current++;
      setIdeaDetail(null);
      setEdgeDetail(null);
      setDetailLoading(null);
      clearFocusRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ideaDetail, edgeDetail, detailLoading]);

  return (
    <div className="nodus-graph-view h-full flex flex-col min-h-0" data-testid={testId}>
      {/* Filter bar */}
      <div className="nodus-graph-toolbar border-b border-neutral-800 p-2 text-xs">
        <div className="flex flex-wrap gap-2 items-center">
          {scopeControl}
          <div className="flex flex-wrap gap-1">
            {GRAPH_PRESETS.filter((preset) => dataSource.capabilities.authors || preset.id !== 'authors').filter((preset) => dataSource.capabilities.readingState || (preset.id !== 'reading' && preset.id !== 'unread')).map((preset) => (
              <button
                key={preset.id}
                className={`btn gap-1.5 py-1 ${activePreset === preset.id ? 'btn-primary' : 'btn-ghost border border-neutral-700'}`}
                title={t(preset.description)}
                onClick={() => applyPreset(preset.id)}
              >
                <Icon name={preset.icon} size={13} /> {t(preset.label)}
              </button>
            ))}
          </div>
          <input
            className="input min-w-44"
            placeholder={t('Buscar en el grafo...')}
            value={filters.search}
            onChange={(e) => setF({ search: e.target.value })}
          />
          <button
            className={`btn border border-neutral-700 gap-1.5 ${filtersOpen ? 'bg-neutral-800 text-neutral-100' : 'btn-ghost'}`}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
          >
            <Icon name="search" /> {t('Filtros')}
          </button>
          {contextNotice && (
            <div className="inline-flex items-center gap-1.5 rounded-md border border-indigo-900/70 bg-indigo-950/20 px-2 py-1 text-indigo-200">
              <Icon name="fit" size={12} />
              <span className="max-w-60 truncate">{contextNotice}</span>
              <button
                className="text-indigo-300 hover:text-white"
                title={t('Quitar contexto')}
                onClick={() => applyPreset('overview')}
              >
                <Icon name="x" size={12} />
              </button>
              {contextZoteroKey && (
                <button
                  className="text-indigo-300 hover:text-white"
                  title={t('Abrir lectura en Zotero')}
                  onClick={() => void window.nodus.openInZotero(contextZoteroKey)}
                >
                  <Icon name="external" size={12} />
                </button>
              )}
            </div>
          )}
          {lens === 'ideas' && dataSource.capabilities.tutor && (
            <button
              className={`btn border border-neutral-700 gap-1.5 ${tutorOpen ? 'bg-indigo-600 text-white' : 'btn-ghost'}`}
              title={t('Recorrido guiado por la IA a través de tus ideas y conexiones')}
              onClick={() => setTutorOpen((v) => !v)}
            >
              <Icon name="compass" /> {t('Modo Tutor')}
            </button>
          )}
          {lens === 'ideas' && dataSource.capabilities.manageThemes && (
            <button
              className="btn btn-ghost border border-neutral-700 gap-1.5"
              title={t('Gestionar los temas principales y reprocesar las conexiones de los nodos')}
              onClick={() => setThemesModalOpen(true)}
            >
              <Icon name="tag" /> {t('Temas')}
            </button>
          )}
          {lens === 'ideas' && dataSource.capabilities.audit && (
            <button
              className="btn btn-ghost border border-neutral-700 gap-1.5"
              title={t('Ver y deshacer tus veredictos sobre relaciones (confirmadas y rechazadas)')}
              onClick={() => setAuditOpen(true)}
            >
              <Icon name="check" /> {t('Auditoría')}
            </button>
          )}
          {lens === 'ideas' && dataSource.capabilities.duplicates && (
            <button
              className="btn btn-ghost border border-neutral-700 gap-1.5"
              title={t('Buscar y fusionar ideas duplicadas para limpiar el grafo y el listado')}
              onClick={() => setIdeaDupesOpen(true)}
            >
              <Icon name="copy" /> {t('Duplicados')}
            </button>
          )}
          <div className="flex-1" />
          <span className="text-neutral-500">{tx('{n} nodos', { n: visibleGraphNodeCount })}</span>
        </div>

        {filtersOpen && (
          <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-900/55 p-2 flex flex-wrap gap-2 items-center">
            <div className="flex rounded-lg overflow-hidden border border-neutral-700">
              <button className={`px-3 py-1 ${lens === 'ideas' ? 'bg-indigo-600 text-white' : ''}`} onClick={() => selectLens('ideas')}>
                {t('Ideas')}
              </button>
              {dataSource.capabilities.authors && <button className={`px-3 py-1 ${lens === 'authors' ? 'bg-indigo-600 text-white' : ''}`} onClick={() => selectLens('authors')}>
                {t('Autores')}
              </button>}
            </div>
            {lens === 'ideas' && (
              <div className="flex flex-wrap gap-1">
                {GRAPH_NODE_TYPES.map((nt) => (
                  <button
                    key={nt}
                    onClick={() => toggleIn('nodeTypes', nt)}
                    className="px-2 py-0.5 rounded flex items-center gap-1"
                    style={{
                      backgroundColor: filters.nodeTypes.includes(nt) ? NODE_COLORS[nt] : (settings.theme === 'light' ? '#e5e7eb' : '#262626'),
                      color: filters.nodeTypes.includes(nt) ? 'white' : (settings.theme === 'light' ? '#525252' : '#a3a3a3'),
                    }}
                  >
                    {t(NODE_LABELS[nt])}
                  </button>
                ))}
              </div>
            )}
            {lens === 'ideas' && (
              <select className="input" value={filters.theme} onChange={(e) => setF({ theme: e.target.value })}>
                <option value="">{t('Todos los temas')}</option>
                {themes.map((themeName) => (
                  <option key={themeName} value={themeName}>
                    {themeName}
                  </option>
                ))}
              </select>
            )}
            {dataSource.capabilities.readingState && <select className="input" value={filters.readState} onChange={(e) => setF({ readState: e.target.value as any })}>
              <option value="all">{t('Leído + no leído')}</option>
              <option value="read">{t('Solo leído')}</option>
              <option value="unread">{t('Solo no leído')}</option>
            </select>}
            {lens === 'ideas' && (
              <select className="input" value={filters.basis} onChange={(e) => setF({ basis: e.target.value as any })}>
                <option value="all">{t('Explícito + inferido')}</option>
                <option value="explicit">{t('Solo explícito')}</option>
              </select>
            )}
            <label className="flex items-center gap-1 text-neutral-400">
              {t('conf')} ≥ {filters.minConfidence.toFixed(1)}
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={filters.minConfidence}
                onChange={(e) => setF({ minConfidence: parseFloat(e.target.value) })}
              />
            </label>
            <label className="flex items-center gap-1 text-neutral-400" title={t('Profundidad de la ruta local al clicar un nodo')}>
              {t('Ruta')}
              <select
                className="input w-24"
                value={highlightDepth == null ? 'unlimited' : String(highlightDepth)}
                onChange={(e) => setLocalGraphDepth(e.target.value)}
              >
                <option value="1">{tx('{n} salto', { n: 1 })}</option>
                <option value="2">{tx('{n} saltos', { n: 2 })}</option>
                <option value="3">{tx('{n} saltos', { n: 3 })}</option>
                <option value="4">{tx('{n} saltos', { n: 4 })}</option>
                <option value="unlimited">{t('Sin límite')}</option>
              </select>
            </label>
            {dataSource.capabilities.readingState && <input
              className="input w-16"
              placeholder={t('año≥')}
              value={filters.yearMin ?? ''}
              onChange={(e) => setF({ yearMin: e.target.value ? +e.target.value : null })}
            />}
            {dataSource.capabilities.readingState && <input
              className="input w-16"
              placeholder={t('año≤')}
              value={filters.yearMax ?? ''}
              onChange={(e) => setF({ yearMax: e.target.value ? +e.target.value : null })}
            />}
            <button className="btn btn-ghost border border-neutral-700" onClick={() => applyPreset(lens === 'authors' ? 'authors' : 'overview')}>
              {t('Limpiar')}
            </button>
          </div>
        )}
      </div>

      <div className="nodus-graph-workspace flex-1 flex min-h-0 relative">
        {lens === 'ideas' && dataSource.capabilities.tutor && tutorOpen && (
          <TutorPanel
            settings={settings}
            onFocusStop={(stop) => void showTutorStop(stop)}
            onClearFocus={() => {
              clearFocusRef.current();
              setIdeaDetail(null);
              setEdgeDetail(null);
            }}
            onClose={() => setTutorOpen(false)}
          />
        )}
        <div className="nodus-graph-stage flex-1 min-w-0 relative overflow-hidden">
          <GraphErrorBoundary>
            <SigmaGraph
              data={data}
              filters={filters}
              lens={lens}
              preset={activePreset}
              highlightDepth={highlightDepth}
              lightTheme={typeof document !== 'undefined' && document.documentElement.classList.contains('light')}
              overrideModel={graphOverrideModel}
              viewLevel={graphViewLevel}
              onDrillDown={drillIntoTheme}
              onOpenNode={onSigmaOpenNode}
              onOpenEdge={onSigmaOpenEdge}
              onClearFocus={onSigmaClear}
              onReady={handleGraphReady}
              onApiReady={handleSigmaApiReady}
            />
          </GraphErrorBoundary>

          {graphLoading && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-neutral-950/10">
              <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white/95 px-3 py-2 text-sm text-neutral-700 shadow-lg dark:border-neutral-800 dark:bg-neutral-900/95 dark:text-neutral-300">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-indigo-500 dark:border-neutral-600 dark:border-t-indigo-400" />
                {t('Cargando grafo…')}
              </div>
            </div>
          )}

          {/* Semantic atlas HUD: progressive overview + compact preset scenes. */}
          {(levelsActive || presetAtlasModel) && (
            <div
              className="nodus-graph-atlas-hud absolute top-4 left-4 z-10 flex max-w-[72%] flex-col gap-2"
              data-testid="knowledge-atlas-hud"
              data-preset={activePreset}
            >
              <div className="nodus-graph-atlas-card">
                <div className="nodus-graph-atlas-eyebrow">
                  <span className="nodus-graph-atlas-mark"><Icon name={activePresetDefinition?.icon ?? 'layers'} size={12} /></span>
                  <span>NODUS · {t('Grafo')}</span>
                </div>
                {presetAtlasModel ? (
                  <>
                    <div className="nodus-graph-atlas-title">{t(activePresetDefinition?.label ?? activePreset)}</div>
                    <div className="nodus-graph-atlas-description">
                      {t(activePresetDefinition?.description ?? '')}
                    </div>
                  </>
                ) : graphViewLevel === 'corpus' ? (
                  <div className="nodus-graph-atlas-title">
                    {tx('{n} temas · haz clic para explorar', { n: themes.length })}
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-xs">
                  <button
                    className="nodus-graph-atlas-back"
                    onClick={backToCorpus}
                    title={t('Volver a los temas del corpus')}
                  >
                    <Icon name="chevronLeft" size={13} />
                    {t('Corpus')}
                  </button>
                  {graphViewLevel === 'theme' && activeThemeLabel && (
                    <>
                      <span className="text-neutral-600">/</span>
                      <span className="max-w-[280px] truncate px-1 font-medium text-neutral-100" title={activeThemeLabel}>
                        {activeThemeLabel}
                      </span>
                    </>
                  )}
                  {graphViewLevel === 'full' && (
                    <span className="px-1 text-neutral-400">{t('Idea enfocada')}</span>
                  )}
                  </div>
                )}
                <div className="nodus-graph-atlas-metrics">
                  <span>{tx('{n} nodos', { n: visibleGraphNodeCount })}</span>
                  <span aria-hidden="true">·</span>
                  <span>{tx('{n} relaciones', { n: visibleGraphEdgeCount })}</span>
                </div>
              </div>

              {/* Level-2 density control: how many of the theme's ideas to show. */}
              {graphViewLevel === 'theme' && activeThemeTotal > 0 && (
                <div className="nodus-graph-density-card flex items-center gap-2.5 text-xs text-neutral-300">
                  <span className="whitespace-nowrap tabular-nums text-neutral-400">
                    {backboneCap >= maximumThemeIdeas && activeThemeTotal <= 250
                      ? tx('Todas · {n} ideas', { n: activeThemeTotal })
                      : tx('{n} de {m} más conectadas', { n: backboneShown, m: activeThemeTotal })}
                  </span>
                  <input
                    type="range"
                    min={20}
                    max={Math.min(250, Math.max(90, activeThemeTotal))}
                    step={10}
                    value={Math.min(backboneCap, Math.min(250, Math.max(90, activeThemeTotal)))}
                    onChange={(e) => setBackboneCap(parseInt(e.target.value, 10))}
                    className="h-1 w-28 cursor-pointer accent-indigo-400"
                    title={t('Cuántas ideas mostrar (por conectividad)')}
                    aria-label={t('Número de ideas a mostrar')}
                  />
                  <button
                    className={`rounded px-1.5 py-0.5 font-medium ${backboneCap >= maximumThemeIdeas ? 'bg-indigo-500/25 text-indigo-200' : 'text-neutral-400 hover:bg-neutral-800'}`}
                    onClick={() => setBackboneCap((c) => (c >= maximumThemeIdeas ? 90 : maximumThemeIdeas))}
                    title={t(activeThemeTotal > 250 ? 'Mostrar hasta 250 ideas del tema' : 'Mostrar todas las ideas del tema')}
                  >
                    {activeThemeTotal > 250 ? t('Hasta 250') : t('Todas')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Zoom / fit controls */}
          <div className="nodus-graph-viewport-controls absolute top-4 right-4 z-10 flex flex-col gap-1">
            <button className="nodus-graph-viewport-button" title={t('Acercar')} onClick={() => zoomBy(1.25)}>
              <Icon name="plus" size={16} />
            </button>
            <button className="nodus-graph-viewport-button" title={t('Alejar')} onClick={() => zoomBy(0.8)}>
              <Icon name="minus" size={16} />
            </button>
            <button className="nodus-graph-viewport-button" title={t('Ajustar a la pantalla')} onClick={fitGraph}>
              <Icon name="fit" size={16} />
            </button>
            {lens === 'ideas' && (
              <button
                className="nodus-graph-viewport-button"
                title={t('Animar la evolución del grafo por fecha de creación')}
                onClick={playGraphHistory}
              >
                <Icon name="play" size={16} />
              </button>
            )}
            <button
              className="nodus-graph-viewport-button"
              title={t('Reiniciar grafo (vista y disposición originales)')}
              onClick={resetGraph}
            >
              <Icon name="refresh" size={16} />
            </button>
          </div>

          {/* Legend */}
          <div className="nodus-graph-legend absolute bottom-4 left-4 z-10 max-w-[220px] p-2.5 text-[10px]">
            <div className="flex items-center gap-2">
              <span className="font-medium text-neutral-300">{t('Leyenda')}</span>
              <button
                className="ml-auto rounded p-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                title={legendCollapsed ? t('Mostrar leyenda') : t('Minimizar leyenda')}
                onClick={() => setLegendCollapsed((v) => !v)}
              >
                <Icon name={legendCollapsed ? 'chevronRight' : 'chevronLeft'} size={12} />
              </button>
            </div>
            {!legendCollapsed && (
              <div className="mt-1 space-y-1">
                {lens === 'authors' ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
                      {t('Autores')}
                    </div>
                    <div className="text-neutral-500">{t('Relaciones entre autores del corpus.')}</div>
                  </>
                ) : GRAPH_NODE_TYPES.map((nt) => (
                    <div key={nt} className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: NODE_COLORS[nt] }} />
                      {t(NODE_LABELS[nt])}
                    </div>
                  ))}
                <div className="pt-1 border-t border-neutral-800 text-neutral-500">{t('○ borde punteado: no leída')}</div>
                {lens === 'ideas' && (
                  <div className="pt-1 border-t border-neutral-800 space-y-0.5">
                    {Object.entries(EDGE_TYPE_COLORS).filter(([et]) => et !== 'contains').map(([type, color]) => (
                      <div key={type} className="flex items-center gap-1.5 text-neutral-400">
                        <span className="w-3 h-0.5 rounded" style={{ backgroundColor: color }} />
                        {t(EDGE_LABELS[type as keyof typeof EDGE_LABELS]) ?? type}
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-neutral-500">{t('— sólida: explícita · ·· punteada: inferida')}</div>
              </div>
            )}
          </div>
        </div>

        {/* Detail panel — opens instantly with a loading skeleton while the
            detail fetch resolves, so taps never feel frozen. */}
        {(ideaDetail || edgeDetail || detailLoading) && (
          <NodeDetailPanel
            ideaDetail={ideaDetail}
            edgeDetail={edgeDetail}
            loading={detailLoading}
            width={detailWidth}
            fontSize={detailFontSize}
            onWidthChange={setDetailWidth}
            onFontChange={changeDetailFont}
            relations={ideaRelations}
            onOpenIdea={openRelatedIdea}
            onOpenEvidence={dataSource.openEvidence}
            showEdgeAudit={dataSource.capabilities.audit}
            onSaveIdea={dataSource.saveIdea}
            onSaveEdge={dataSource.saveEdge}
            onEdgeFeedback={(verdict) => {
              // A rejected relation vanishes from the graph: refresh and close its detail.
              if (verdict === 'rejected') {
                detailSeqRef.current++;
                setEdgeDetail(null);
                setDetailLoading(null);
                clearFocusRef.current();
              }
              reload();
            }}
            onClose={() => {
              detailSeqRef.current++;
              setIdeaDetail(null);
              setEdgeDetail(null);
              setDetailLoading(null);
              clearFocusRef.current();
            }}
          />
        )}
      </div>

      {dataSource.capabilities.manageThemes && themesModalOpen && (
        <ThemesModal
          settings={settings}
          onSettingsChange={onSettingsChange}
          onReprocessed={reload}
          onClose={() => {
            setThemesModalOpen(false);
            reload();
          }}
        />
      )}
      {dataSource.capabilities.duplicates && ideaDupesOpen && (
        <IdeaDuplicatesModal
          onClose={() => {
            setIdeaDupesOpen(false);
            reload();
          }}
        />
      )}
      {dataSource.capabilities.audit && auditOpen && (
        <EdgeAuditModal
          onClose={() => setAuditOpen(false)}
          onChanged={() => {
            // An undone rejection puts the edge back: refresh the live graph.
            reload();
          }}
        />
      )}
    </div>
  );
}
