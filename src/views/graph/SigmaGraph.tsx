// WebGL graph renderer (Sigma + graphology) with worker layout and LOD.
//
// This is the new rendering core that replaces the Cytoscape canvas renderer.
// Responsibilities:
//  • build a graphology graph from the renderer-agnostic model,
//  • lay it out with ForceAtlas2 in a Web Worker (non-blocking),
//  • render with Sigma (WebGL) — pan/zoom/labels are GPU-driven,
//  • collapse to community super-nodes when zoomed out (LOD),
//  • highlight a tapped node's local graph via display reducers.
//
// Sigma reserves the `type` display attribute to pick the drawing program, so
// the *semantic* node/edge type is stored under `kind`.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import type { GraphData, GraphNodeType } from '@shared/types';
import { NODE_COLORS } from '../../components/ui';
import type { GraphPresetId } from '../../navigation';
import { buildGraphModel, EDGE_TYPE_COLORS, clampUnit, type GraphFilters, type GraphLens } from './model';
import { buildGraphIndex, collectLocalGraph, type GraphIndex, type LocalGraph } from './focus';
import { WorkerLayout, seedMissingPositions, scatterPositions } from './layout';
import { computeClusters, type AggregatedGraph } from './lod';

export interface SigmaGraphApi {
  fit: () => void;
  zoomBy: (factor: number) => void;
  focusNode: (id: string) => boolean;
  focusEdge: (id: string) => boolean;
  clearFocus: () => void;
  /** Re-scatter, re-run the layout from scratch and reset the camera. */
  reset: () => void;
}

interface SigmaGraphProps {
  data: GraphData;
  filters: GraphFilters;
  lens: GraphLens;
  preset: GraphPresetId;
  highlightDepth: number | null;
  lightTheme: boolean;
  onOpenNode: (id: string, label: string, type: string) => void;
  onOpenEdge: (id: string, type: string) => void;
  onClearFocus: () => void;
  onApiReady?: (api: SigmaGraphApi | null) => void;
}

// Camera ratio above which we show the aggregated overview instead of every node.
const OVERVIEW_RATIO = 0.6;

function nodeColor(type: string): string {
  if (type === 'author') return '#a3a3a3';
  return NODE_COLORS[type as Exclude<GraphNodeType, 'author'>] ?? '#888';
}

interface FocusState {
  active: boolean;
  local: LocalGraph | null;
  edgeId: string | null;
}

export function SigmaGraph({
  data,
  filters,
  lens,
  preset,
  highlightDepth,
  lightTheme,
  onOpenNode,
  onOpenEdge,
  onClearFocus,
  onApiReady,
}: SigmaGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const detailGraphRef = useRef<Graph | null>(null);
  const overviewGraphRef = useRef<Graph | null>(null);
  const layoutRef = useRef<WorkerLayout | null>(null);
  const indexRef = useRef<GraphIndex | null>(null);
  const clustersRef = useRef<AggregatedGraph | null>(null);
  const prevPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const modeRef = useRef<'detail' | 'overview'>('detail');
  const focusRef = useRef<FocusState>({ active: false, local: null, edgeId: null });
  const hoverRef = useRef<string | null>(null);
  const hoverLocalRef = useRef<{ neighbors: Set<string>; edges: Set<string> } | null>(null);
  const draggingRef = useRef<string | null>(null);
  const cameraRafRef = useRef<number | null>(null);
  const clusterTimerRef = useRef<number | null>(null);

  const model = useMemo(() => buildGraphModel(data, filters, lens, preset), [data, filters, lens, preset]);

  const fadeNode = lightTheme ? '#d8d8d8' : '#2b2b2b';

  // ── Build the graphology detail graph from the current model ────────────────
  const buildDetailGraph = useCallback((): Graph => {
    const graph = new Graph({ multi: true, type: 'directed' });
    const edgeFaint = lightTheme ? '#e3e3e3' : '#242424';
    for (const n of model.nodes) {
      graph.addNode(n.id, {
        label: n.label,
        kind: n.type,
        size: Math.max(4, n.size / 2.4),
        color: nodeColor(n.type),
        degree: n.degree,
        labelRank: n.labelRank,
        read: n.read,
        // No x/y here on purpose: seedMissingPositions() scatters new nodes on a
        // spiral (and restores prior positions) so ForceAtlas2 has a valid,
        // non-coincident starting layout.
      });
    }
    for (const e of model.edges) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
      // Non-layout edges contribute no attraction so the physics stays readable.
      const weight = e.layoutEdge ? Math.max(0.05, e.confidence) : 0;
      graph.addEdgeWithKey(e.id, e.source, e.target, {
        kind: e.type,
        basis: e.basis,
        confidence: e.confidence,
        layoutEdge: e.layoutEdge,
        weight,
        size: 0.4 + e.confidence * 0.5,
        // Default edges are uniform and faint (Obsidian-style) so the overview
        // reads as nodes-with-links; the semantic edge-type colour is revealed on
        // focus. Must be hex — Sigma's WebGL edge program mis-renders rgba().
        color: edgeFaint,
      });
    }
    return graph;
  }, [model, lightTheme]);

  // ── Reducers: focus / hover styling driven by refs (no React re-render) ─────
  const nodeReducer = useCallback(
    (node: string, dataAttrs: { [k: string]: unknown }) => {
      // Sigma replaces (not merges) node display data with the reducer's return,
      // so we must spread the original attributes — otherwise x/y/size/label are
      // lost and Sigma throws "could not find a valid position".
      const res: { [k: string]: unknown } = { ...dataAttrs };
      const focus = focusRef.current;
      const hover = hoverRef.current;
      if (focus.active && focus.local) {
        const { primaryNodes, secondaryNodes, contextNodes, center } = focus.local;
        if (node === center || primaryNodes.has(node)) {
          res.zIndex = 3;
          res.forceLabel = true;
        } else if (secondaryNodes.has(node)) {
          res.zIndex = 2;
        } else if (contextNodes.has(node)) {
          res.zIndex = 1;
          res.color = nodeColor(String(dataAttrs.kind));
        } else {
          res.color = fadeNode;
          res.label = '';
          res.zIndex = 0;
        }
      }
      // Hover augment: highlight the hovered node and its neighbours over the
      // top of any active focus (so you can peek at another node's relations
      // without losing the clicked selection). forceLabel — not `highlighted` —
      // because Sigma's highlight draws a light box that hides white-on-dark text.
      if (hover && (node === hover || hoverLocalRef.current?.neighbors.has(node))) {
        res.color = nodeColor(String(dataAttrs.kind));
        res.label = dataAttrs.label;
        res.forceLabel = true;
        res.zIndex = 6;
      }
      return res;
    },
    [fadeNode]
  );

  const edgeReducer = useCallback(
    (edge: string, dataAttrs: { [k: string]: unknown }) => {
      const res: { [k: string]: unknown } = { ...dataAttrs };
      const focus = focusRef.current;
      // All hex — Sigma's WebGL edge program mis-renders rgba() (shows white).
      const faded = lightTheme ? '#ededed' : '#161616';
      if (focus.active && focus.local) {
        const { primaryEdges, secondaryEdges, contextEdges } = focus.local;
        if (primaryEdges.has(edge) || edge === focus.edgeId) {
          // Reveal the semantic edge-type colour on the focused path.
          res.color = EDGE_TYPE_COLORS[String(dataAttrs.kind)] ?? (lightTheme ? '#475569' : '#cbd5e1');
          res.zIndex = 3;
          res.size = Math.max(1.4, Number(dataAttrs.size ?? 1) * 2.2);
        } else if (secondaryEdges.has(edge)) {
          res.color = lightTheme ? '#b6b6b6' : '#3f3f46';
          res.zIndex = 2;
        } else if (contextEdges.has(edge)) {
          res.color = lightTheme ? '#d6b36a' : '#5a4520';
          res.zIndex = 1;
        } else {
          res.color = faded;
          res.zIndex = 0;
        }
      }
      // Hover augment: light up the hovered node's edges over any focus state.
      if (hoverRef.current && hoverLocalRef.current?.edges.has(edge)) {
        res.color = EDGE_TYPE_COLORS[String(dataAttrs.kind)] ?? (lightTheme ? '#475569' : '#cbd5e1');
        res.zIndex = 6;
        res.size = Math.max(1.4, Number(dataAttrs.size ?? 1) * 2.2);
      }
      return res;
    },
    [lightTheme]
  );

  // ── Focus helpers ───────────────────────────────────────────────────────────
  const applyFocusForNode = useCallback(
    (nodeId: string) => {
      const index = indexRef.current;
      if (!index) return;
      focusRef.current = { active: true, local: collectLocalGraph(nodeId, index, highlightDepth), edgeId: null };
      sigmaRef.current?.refresh({ skipIndexation: true });
    },
    [highlightDepth]
  );

  const applyFocusForEdge = useCallback(
    (edgeId: string) => {
      const index = indexRef.current;
      const graph = detailGraphRef.current;
      if (!index || !graph || !graph.hasEdge(edgeId)) return;
      const source = graph.source(edgeId);
      const target = graph.target(edgeId);
      const a = collectLocalGraph(source, index, highlightDepth);
      const b = collectLocalGraph(target, index, highlightDepth);
      const merged: LocalGraph = {
        center: source,
        primaryNodes: new Set([...a.primaryNodes, ...b.primaryNodes]),
        primaryEdges: new Set([...a.primaryEdges, ...b.primaryEdges, edgeId]),
        secondaryNodes: new Set([...a.secondaryNodes, ...b.secondaryNodes]),
        secondaryEdges: new Set([...a.secondaryEdges, ...b.secondaryEdges]),
        contextNodes: new Set([...a.contextNodes, ...b.contextNodes]),
        contextEdges: new Set([...a.contextEdges, ...b.contextEdges]),
      };
      focusRef.current = { active: true, local: merged, edgeId };
      sigmaRef.current?.refresh({ skipIndexation: true });
    },
    [highlightDepth]
  );

  const clearFocus = useCallback(() => {
    if (!focusRef.current.active && !hoverRef.current) return;
    focusRef.current = { active: false, local: null, edgeId: null };
    hoverRef.current = null;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, []);

  // ── LOD: build the aggregated overview graph from clusters ──────────────────
  const buildOverviewGraph = useCallback(
    (agg: AggregatedGraph): Graph => {
      const graph = new Graph({ multi: false, type: 'undirected' });
      for (const c of agg.clusters) {
        graph.addNode(c.id, {
          label: c.label,
          kind: 'cluster',
          size: c.size / 3,
          color: nodeColor(c.dominantType),
          x: c.x,
          y: c.y,
        });
      }
      for (const e of agg.edges) {
        if (!graph.hasNode(e.source) || !graph.hasNode(e.target) || graph.hasEdge(e.source, e.target)) continue;
        graph.addEdge(e.source, e.target, {
          size: 0.5 + Math.min(4, Math.log2(e.weight + 1)),
          color: lightTheme ? 'rgba(120,120,120,0.4)' : 'rgba(150,150,150,0.3)',
        });
      }
      return graph;
    },
    [lightTheme]
  );

  const ensureClusters = useCallback(() => {
    const detail = detailGraphRef.current;
    if (!detail) return;
    clustersRef.current = computeClusters(detail);
    overviewGraphRef.current = buildOverviewGraph(clustersRef.current);
  }, [buildOverviewGraph]);

  const switchMode = useCallback(
    (next: 'detail' | 'overview') => {
      const sigma = sigmaRef.current;
      if (!sigma || modeRef.current === next) return;
      if (next === 'overview') {
        if (!overviewGraphRef.current) ensureClusters();
        if (!overviewGraphRef.current) return;
        modeRef.current = 'overview';
        sigma.setGraph(overviewGraphRef.current);
      } else {
        const detail = detailGraphRef.current;
        if (!detail) return;
        modeRef.current = 'detail';
        sigma.setGraph(detail);
      }
      sigma.refresh();
    },
    [ensureClusters]
  );

  const onCameraUpdated = useCallback(() => {
    if (cameraRafRef.current != null) return;
    cameraRafRef.current = window.requestAnimationFrame(() => {
      cameraRafRef.current = null;
      const sigma = sigmaRef.current;
      if (!sigma) return;
      const ratio = sigma.getCamera().ratio;
      // Only collapse to the (still-rough) overview for very large corpora where
      // the full graph genuinely can't be drawn legibly. Below this, always show
      // the complete graph — WebGL handles a few thousand nodes fine.
      const enoughToCluster = (clustersRef.current?.clusters.length ?? 0) >= 2 && model.nodes.length > 3000;
      if (enoughToCluster && ratio >= OVERVIEW_RATIO) switchMode('overview');
      else switchMode('detail');
    });
  }, [model.nodes.length, switchMode]);

  // ── Create the Sigma instance once ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || sigmaRef.current) return;
    const graph = new Graph({ multi: true, type: 'directed' });
    detailGraphRef.current = graph;
    const sigma = new Sigma(graph, containerRef.current, {
      allowInvalidContainer: true,
      renderLabels: true,
      labelColor: { color: lightTheme ? '#171717' : '#ededed' },
      labelSize: 12,
      labelWeight: '600',
      // Higher threshold + lower density + larger grid → only prominent nodes
      // get labels at overview; more reveal as you zoom in (semantic zoom). This
      // is what kills the "label soup".
      labelRenderedSizeThreshold: 11,
      labelDensity: 0.25,
      labelGridCellSize: 220,
      defaultEdgeColor: lightTheme ? '#e3e3e3' : '#242424',
      zIndex: true,
      minCameraRatio: 0.05,
      maxCameraRatio: 3,
      nodeReducer,
      edgeReducer,
    });
    sigmaRef.current = sigma;

    sigma.on('clickNode', ({ node }) => {
      const g = sigmaRef.current?.getGraph();
      if (!g) return;
      if (modeRef.current === 'overview') {
        // Drill into the clicked cluster: recenter + zoom past the LOD threshold.
        const attrs = g.getNodeAttributes(node);
        sigma.getCamera().animate({ x: 0.5, y: 0.5, ratio: OVERVIEW_RATIO * 0.6 }, { duration: 320 });
        void attrs;
        return;
      }
      const attrs = g.getNodeAttributes(node);
      applyFocusForNode(node);
      onOpenNode(node, String(attrs.label ?? ''), String(attrs.kind ?? ''));
    });
    sigma.on('clickEdge', ({ edge }) => {
      if (modeRef.current === 'overview') return;
      const g = sigmaRef.current?.getGraph();
      const attrs = g?.getEdgeAttributes(edge);
      applyFocusForEdge(edge);
      onOpenEdge(edge, String(attrs?.kind ?? ''));
    });
    sigma.on('clickStage', () => {
      clearFocus();
      onClearFocus();
    });
    sigma.on('enterNode', ({ node }) => {
      if (draggingRef.current) return;
      hoverRef.current = node;
      const idx = indexRef.current;
      const neighbors = new Set<string>();
      const edges = new Set<string>();
      for (const a of idx?.adjacency.get(node) ?? []) {
        neighbors.add(a.other);
        edges.add(a.edgeId);
      }
      hoverLocalRef.current = { neighbors, edges };
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on('leaveNode', () => {
      if (hoverRef.current == null) return;
      hoverRef.current = null;
      hoverLocalRef.current = null;
      sigma.refresh({ skipIndexation: true });
    });

    // Drag: freeze the worker (so it can't overwrite the position → no snap-back,
    // and the graph stops drifting), then move the node and shove nearby nodes
    // aside on the main thread so they "open a path", like the old renderer.
    sigma.on('downNode', ({ node }) => {
      draggingRef.current = node;
      layoutRef.current?.stop();
    });
    const mouse = sigma.getMouseCaptor();
    mouse.on('mousemovebody', (e) => {
      const node = draggingRef.current;
      const g = sigmaRef.current?.getGraph();
      if (!node || !g || !g.hasNode(node)) return;
      const pos = sigma.viewportToGraph(e);
      g.setNodeAttribute(node, 'x', pos.x);
      g.setNodeAttribute(node, 'y', pos.y);
      // Pixel-based push radius (~70px) so it stays consistent regardless of the
      // layout's coordinate scale or current zoom.
      const rim = sigma.viewportToGraph({ x: e.x + 70, y: e.y });
      const radius = Math.hypot(rim.x - pos.x, rim.y - pos.y);
      g.forEachNode((other, a) => {
        if (other === node) return;
        const ox = Number(a.x);
        const oy = Number(a.y);
        const dx = ox - pos.x;
        const dy = oy - pos.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.0001 && dist < radius) {
          const push = (radius - dist) * 0.5; // soft, settles within a few frames
          g.setNodeAttribute(other, 'x', ox + (dx / dist) * push);
          g.setNodeAttribute(other, 'y', oy + (dy / dist) * push);
        }
      });
      e.preventSigmaDefault();
      e.original.preventDefault();
      e.original.stopPropagation();
    });
    const endDrag = () => {
      draggingRef.current = null;
    };
    mouse.on('mouseup', endDrag);
    sigma.getCamera().on('updated', onCameraUpdated);

    return () => {
      sigma.getCamera().removeListener('updated', onCameraUpdated);
      sigma.kill();
      sigmaRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep reducers fresh (they capture theme + depth via closures).
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.setSettings({
      nodeReducer,
      edgeReducer,
      labelColor: { color: lightTheme ? '#171717' : '#ededed' },
    });
  }, [nodeReducer, edgeReducer, lightTheme]);

  // ── Rebuild the graph whenever the model changes ────────────────────────────
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;

    // Persist current positions so re-filtering / growth is incremental.
    const existing = detailGraphRef.current;
    if (existing) {
      existing.forEachNode((id, attrs) => {
        if (typeof attrs.x === 'number' && typeof attrs.y === 'number') {
          prevPositionsRef.current.set(id, { x: attrs.x, y: attrs.y });
        }
      });
    }

    layoutRef.current?.kill();
    const graph = buildDetailGraph();
    seedMissingPositions(graph, prevPositionsRef.current);
    detailGraphRef.current = graph;
    indexRef.current = buildGraphIndex(model.nodes, model.edges);
    clustersRef.current = null;
    overviewGraphRef.current = null;
    focusRef.current = { active: false, local: null, edgeId: null };
    hoverRef.current = null;
    modeRef.current = 'detail';

    sigma.setGraph(graph);
    sigma.refresh();

    if (clusterTimerRef.current != null) window.clearTimeout(clusterTimerRef.current);
    if (graph.order > 0) {
      const layout = new WorkerLayout(graph);
      layoutRef.current = layout;
      // Bounded settle, then freeze: the graph organises for a few seconds and
      // then stops so it doesn't drift/jitter forever. Dragging re-activates a
      // light main-thread repulsion (see the drag handlers), not the worker.
      const settleMs = Math.min(8000, 2500 + graph.order * 1.5);
      layout.start({ durationMs: settleMs });
      // Precompute LOD clusters once settled, so a future zoom-out is instant.
      clusterTimerRef.current = window.setTimeout(() => {
        clusterTimerRef.current = null;
        ensureClusters();
      }, settleMs + 300);
    } else {
      layoutRef.current = null;
    }
  }, [buildDetailGraph, ensureClusters, model]);

  // ── Imperative API for the toolbar / navigation ─────────────────────────────
  useEffect(() => {
    if (!onApiReady) return;
    const api: SigmaGraphApi = {
      fit: () => {
        sigmaRef.current?.getCamera().animatedReset({ duration: 320 });
      },
      zoomBy: (factor) => {
        const camera = sigmaRef.current?.getCamera();
        if (!camera) return;
        camera.animate({ ratio: camera.getBoundedRatio(camera.ratio / factor) }, { duration: 180 });
      },
      focusNode: (id) => {
        const g = detailGraphRef.current;
        if (!g || !g.hasNode(id)) return false;
        switchMode('detail');
        applyFocusForNode(id);
        const attrs = g.getNodeAttributes(id);
        const view = sigmaRef.current?.graphToViewport({ x: Number(attrs.x), y: Number(attrs.y) });
        if (view) sigmaRef.current?.getCamera().animate({ ratio: 0.35 }, { duration: 320 });
        return true;
      },
      focusEdge: (id) => {
        const g = detailGraphRef.current;
        if (!g || !g.hasEdge(id)) return false;
        switchMode('detail');
        applyFocusForEdge(id);
        return true;
      },
      clearFocus,
      reset: () => {
        const g = detailGraphRef.current;
        prevPositionsRef.current.clear();
        focusRef.current = { active: false, local: null, edgeId: null };
        hoverRef.current = null;
        hoverLocalRef.current = null;
        modeRef.current = 'detail';
        if (clusterTimerRef.current != null) window.clearTimeout(clusterTimerRef.current);
        const sigma = sigmaRef.current;
        if (g && g.order > 0) {
          if (sigma && sigma.getGraph() !== g) sigma.setGraph(g);
          scatterPositions(g);
          layoutRef.current?.kill();
          const layout = new WorkerLayout(g);
          layoutRef.current = layout;
          layout.start({ durationMs: Math.min(8000, 2500 + g.order * 1.5) });
        }
        sigma?.refresh();
        sigma?.getCamera().animatedReset({ duration: 320 });
      },
    };
    onApiReady(api);
    return () => onApiReady(null);
  }, [onApiReady, applyFocusForNode, applyFocusForEdge, clearFocus, switchMode]);

  // Final teardown.
  useEffect(() => {
    return () => {
      if (cameraRafRef.current != null) window.cancelAnimationFrame(cameraRafRef.current);
      if (clusterTimerRef.current != null) window.clearTimeout(clusterTimerRef.current);
      layoutRef.current?.kill();
      layoutRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0" />;
}
