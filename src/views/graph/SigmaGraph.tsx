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
  /** Spotlight a Tutor stop and keep it visible while the user moves the camera. */
  focusTutor: (nodeIds: string[], edgeId?: string | null) => boolean;
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

interface GraphPosition {
  x: number;
  y: number;
}

interface DragState {
  nodeId: string;
  /** Positions at the beginning of this gesture. They are the source of truth
   * for temporary collision offsets, so a drag cannot leave a widening hole. */
  origin: Map<string, GraphPosition>;
  /** The node being dragged plus its direct neighbours. This small local group
   * is translated as a unit, preserving the original edge geometry. */
  connectedIds: Set<string>;
  cellSize: number;
  cells: Map<string, string[]>;
  collisionRadius: number;
  target: GraphPosition | null;
  transientIds: Set<string>;
  frameId: number | null;
}

interface DragReleaseState {
  start: Map<string, GraphPosition>;
  target: Map<string, GraphPosition>;
  frameId: number | null;
  startedAt: number;
}

const DRAG_COLLISION_RADIUS_PX = 64;
const DRAG_COLLISION_RELEASE_MS = 190;

function dragCellKey(position: GraphPosition, cellSize: number): string {
  return `${Math.floor(position.x / cellSize)}:${Math.floor(position.y / cellSize)}`;
}

function stableDragDirection(a: string, b: string): GraphPosition {
  let hash = 2166136261;
  for (const char of `${a}:${b}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const angle = ((hash >>> 0) % 6283) / 1000;
  return { x: Math.cos(angle), y: Math.sin(angle) };
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
  const tutorFocusRef = useRef<{ nodeIds: string[]; edgeId?: string | null } | null>(null);
  const hoverRef = useRef<string | null>(null);
  const hoverLocalRef = useRef<{ neighbors: Set<string>; edges: Set<string> } | null>(null);
  const draggingRef = useRef<string | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const dragReleaseRef = useRef<DragReleaseState | null>(null);
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
    if (!focusRef.current.active && !hoverRef.current && !tutorFocusRef.current) return;
    focusRef.current = { active: false, local: null, edgeId: null };
    tutorFocusRef.current = null;
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
      // A focus (including the Tutor's active stop) refers to concrete detail
      // nodes. The aggregated overview has different ids, so switching to it
      // would make that focus appear to disappear while panning or zooming.
      if (next === 'overview' && focusRef.current.active) return;
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

  const focusTutor = useCallback(
    (nodeIds: string[], edgeId?: string | null): boolean => {
      const graph = detailGraphRef.current;
      if (!graph) return false;
      switchMode('detail');
      if (edgeId && graph.hasEdge(edgeId)) {
        tutorFocusRef.current = { nodeIds, edgeId };
        applyFocusForEdge(edgeId);
        return true;
      }
      const nodeId = nodeIds.find((id) => graph.hasNode(id));
      if (!nodeId) return false;
      tutorFocusRef.current = { nodeIds, edgeId };
      applyFocusForNode(nodeId);
      return true;
    },
    [applyFocusForEdge, applyFocusForNode, switchMode]
  );

  const onCameraUpdated = useCallback(() => {
    if (cameraRafRef.current != null) return;
    cameraRafRef.current = window.requestAnimationFrame(() => {
      cameraRafRef.current = null;
      const sigma = sigmaRef.current;
      if (!sigma) return;
      if (focusRef.current.active) {
        switchMode('detail');
        return;
      }
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
      tutorFocusRef.current = null;
      const attrs = g.getNodeAttributes(node);
      applyFocusForNode(node);
      onOpenNode(node, String(attrs.label ?? ''), String(attrs.kind ?? ''));
    });
    sigma.on('clickEdge', ({ edge }) => {
      if (modeRef.current === 'overview') return;
      tutorFocusRef.current = null;
      const g = sigmaRef.current?.getGraph();
      const attrs = g?.getEdgeAttributes(edge);
      applyFocusForEdge(edge);
      onOpenEdge(edge, String(attrs?.kind ?? ''));
    });
    sigma.on('clickStage', () => {
      if (tutorFocusRef.current) return;
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

    // Dragging has two distinct kinds of movement:
    // - the dragged node and its direct relations move as a rigid local group;
    // - nodes merely displaced to clear a path are temporary and settle back.
    // The previous implementation accumulated a push onto every nearby node on
    // every mouse event. That made the space vacated by a drag permanently grow.
    const finishDragRelease = () => {
      const release = dragReleaseRef.current;
      const g = sigmaRef.current?.getGraph();
      if (!release || !g) return;
      if (release.frameId != null) window.cancelAnimationFrame(release.frameId);
      release.target.forEach((position, id) => {
        if (g.hasNode(id)) g.mergeNodeAttributes(id, position);
      });
      dragReleaseRef.current = null;
      sigmaRef.current?.refresh();
    };

    const applyDragFrame = () => {
      const state = dragStateRef.current;
      const g = sigmaRef.current?.getGraph();
      if (!state || !g || !state.target || !g.hasNode(state.nodeId)) return;
      state.frameId = null;

      // Remove only the displacement from the preceding frame. The connected
      // group is written below from its original coordinates on every frame, so
      // neither its movement nor collision offsets can compound over time.
      for (const id of state.transientIds) {
        if (state.connectedIds.has(id) || !g.hasNode(id)) continue;
        const origin = state.origin.get(id);
        if (origin) g.mergeNodeAttributes(id, origin);
      }
      state.transientIds = new Set(state.connectedIds);

      const rootOrigin = state.origin.get(state.nodeId);
      if (!rootOrigin) return;
      const delta = {
        x: state.target.x - rootOrigin.x,
        y: state.target.y - rootOrigin.y,
      };

      // Preserve the original vectors between the active node and every direct
      // neighbour. This keeps linked nodes proportionally spaced while the
      // cluster is carried through the rest of the graph.
      for (const id of state.connectedIds) {
        const origin = state.origin.get(id);
        if (!origin || !g.hasNode(id)) continue;
        g.mergeNodeAttributes(id, { x: origin.x + delta.x, y: origin.y + delta.y });
      }

      // The grid is built from the gesture's stable starting positions. Looking
      // only in adjacent cells keeps collision work local even in large graphs.
      // Obstacles absorb the displacement; the connected group keeps its shape.
      for (const id of state.connectedIds) {
        if (!g.hasNode(id)) continue;
        const moving = g.getNodeAttributes(id);
        const position = { x: Number(moving.x), y: Number(moving.y) };
        const cx = Math.floor(position.x / state.cellSize);
        const cy = Math.floor(position.y / state.cellSize);

        for (let x = cx - 1; x <= cx + 1; x++) {
          for (let y = cy - 1; y <= cy + 1; y++) {
            const candidates = state.cells.get(`${x}:${y}`);
            if (!candidates) continue;
            for (const otherId of candidates) {
              if (state.connectedIds.has(otherId) || !g.hasNode(otherId)) continue;
              const other = g.getNodeAttributes(otherId);
              const otherPosition = { x: Number(other.x), y: Number(other.y) };
              let dx = otherPosition.x - position.x;
              let dy = otherPosition.y - position.y;
              let distance = Math.hypot(dx, dy);
              if (distance < 0.0001) {
                const direction = stableDragDirection(id, otherId);
                dx = direction.x;
                dy = direction.y;
                distance = 1;
              }
              if (distance >= state.collisionRadius) continue;
              const push = state.collisionRadius - distance + 0.001;
              g.mergeNodeAttributes(otherId, {
                x: otherPosition.x + (dx / distance) * push,
                y: otherPosition.y + (dy / distance) * push,
              });
              state.transientIds.add(otherId);
            }
          }
        }
      }
      sigmaRef.current?.refresh();
    };

    const scheduleDragFrame = () => {
      const state = dragStateRef.current;
      if (!state || state.frameId != null) return;
      state.frameId = window.requestAnimationFrame(applyDragFrame);
    };

    const releaseTemporaryNodes = (state: DragState) => {
      const g = sigmaRef.current?.getGraph();
      if (!g) return;
      const rootOrigin = state.origin.get(state.nodeId);
      if (!rootOrigin) return;
      const root = g.getNodeAttributes(state.nodeId);
      const delta = {
        x: Number(root.x) - rootOrigin.x,
        y: Number(root.y) - rootOrigin.y,
      };
      const groupPositions = [...state.connectedIds]
        .map((id) => state.origin.get(id))
        .filter((position): position is GraphPosition => Boolean(position))
        .map((position) => ({ x: position.x + delta.x, y: position.y + delta.y }));
      const start = new Map<string, GraphPosition>();
      const target = new Map<string, GraphPosition>();

      for (const id of state.transientIds) {
        if (state.connectedIds.has(id) || !g.hasNode(id)) continue;
        const origin = state.origin.get(id);
        if (!origin) continue;
        const current = g.getNodeAttributes(id);
        const from = { x: Number(current.x), y: Number(current.y) };
        const settled = { ...origin };

        // Restore each incidental obstacle to its source position unless the
        // relocated connected group now occupies it. In that case it retains
        // only the minimum offset needed to avoid an overlap.
        for (const groupPosition of groupPositions) {
          let dx = settled.x - groupPosition.x;
          let dy = settled.y - groupPosition.y;
          let distance = Math.hypot(dx, dy);
          if (distance < 0.0001) {
            const direction = stableDragDirection(state.nodeId, id);
            dx = direction.x;
            dy = direction.y;
            distance = 1;
          }
          if (distance < state.collisionRadius) {
            const push = state.collisionRadius - distance + 0.001;
            settled.x += (dx / distance) * push;
            settled.y += (dy / distance) * push;
          }
        }
        if (Math.hypot(from.x - settled.x, from.y - settled.y) > 0.01) {
          start.set(id, from);
          target.set(id, settled);
        }
      }
      if (target.size === 0) return;

      const release: DragReleaseState = {
        start,
        target,
        frameId: null,
        startedAt: performance.now(),
      };
      dragReleaseRef.current = release;
      const animateRelease = () => {
        const current = dragReleaseRef.current;
        const releaseGraph = sigmaRef.current?.getGraph();
        if (current !== release || !releaseGraph) return;
        const progress = Math.min(1, (performance.now() - release.startedAt) / DRAG_COLLISION_RELEASE_MS);
        const eased = 1 - (1 - progress) ** 3;
        release.target.forEach((position, id) => {
          const from = release.start.get(id);
          if (!from || !releaseGraph.hasNode(id)) return;
          releaseGraph.mergeNodeAttributes(id, {
            x: from.x + (position.x - from.x) * eased,
            y: from.y + (position.y - from.y) * eased,
          });
        });
        sigmaRef.current?.refresh();
        if (progress < 1) {
          release.frameId = window.requestAnimationFrame(animateRelease);
        } else {
          release.frameId = null;
          dragReleaseRef.current = null;
        }
      };
      release.frameId = window.requestAnimationFrame(animateRelease);
    };

    sigma.on('downNode', ({ node }) => {
      const g = sigmaRef.current?.getGraph();
      if (!g || !g.hasNode(node)) return;
      finishDragRelease();
      draggingRef.current = node;
      layoutRef.current?.stop();

      const origin = new Map<string, GraphPosition>();
      g.forEachNode((id, attrs) => {
        origin.set(id, { x: Number(attrs.x), y: Number(attrs.y) });
      });
      const root = origin.get(node);
      if (!root) return;
      const rootViewport = sigma.graphToViewport(root);
      const rim = sigma.viewportToGraph({ x: rootViewport.x + DRAG_COLLISION_RADIUS_PX, y: rootViewport.y });
      const collisionRadius = Math.max(0.0001, Math.hypot(rim.x - root.x, rim.y - root.y));
      const cellSize = collisionRadius * 2;
      const cells = new Map<string, string[]>();
      origin.forEach((position, id) => {
        const key = dragCellKey(position, cellSize);
        const bucket = cells.get(key) ?? [];
        bucket.push(id);
        cells.set(key, bucket);
      });
      const connectedIds = new Set<string>([node]);
      for (const neighbor of g.neighbors(node)) {
        if (g.hasNode(neighbor)) connectedIds.add(neighbor);
      }
      dragStateRef.current = {
        nodeId: node,
        origin,
        connectedIds,
        cellSize,
        cells,
        collisionRadius,
        target: null,
        transientIds: new Set(connectedIds),
        frameId: null,
      };
    });

    const mouse = sigma.getMouseCaptor();
    const onMouseMove = (e: any) => {
      const state = dragStateRef.current;
      if (!state) return;
      state.target = sigma.viewportToGraph(e);
      scheduleDragFrame();
      e.preventSigmaDefault();
      e.original.preventDefault();
      e.original.stopPropagation();
    };
    mouse.on('mousemovebody', onMouseMove);
    const endDrag = () => {
      const state = dragStateRef.current;
      if (!state) return;
      if (state.frameId != null) {
        window.cancelAnimationFrame(state.frameId);
        state.frameId = null;
        applyDragFrame();
      }
      dragStateRef.current = null;
      draggingRef.current = null;
      releaseTemporaryNodes(state);
    };
    mouse.on('mouseup', endDrag);
    sigma.getCamera().on('updated', onCameraUpdated);

    return () => {
      const drag = dragStateRef.current;
      if (drag?.frameId != null) window.cancelAnimationFrame(drag.frameId);
      const release = dragReleaseRef.current;
      if (release?.frameId != null) window.cancelAnimationFrame(release.frameId);
      dragStateRef.current = null;
      dragReleaseRef.current = null;
      draggingRef.current = null;
      mouse.removeListener('mousemovebody', onMouseMove);
      mouse.removeListener('mouseup', endDrag);
      sigma.getCamera().removeListener('updated', onCameraUpdated);
      sigma.kill();
      sigmaRef.current = null;
    };
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
      // A filter/data change can arrive while a node is being dragged or while
      // incidental obstacles are settling. Finalise that transient state before
      // taking the persistent position snapshot for the rebuilt graph.
      const drag = dragStateRef.current;
      if (drag) {
        if (drag.frameId != null) window.cancelAnimationFrame(drag.frameId);
        for (const id of drag.transientIds) {
          if (drag.connectedIds.has(id) || !existing.hasNode(id)) continue;
          const origin = drag.origin.get(id);
          if (origin) existing.mergeNodeAttributes(id, origin);
        }
        dragStateRef.current = null;
        draggingRef.current = null;
      }
      const release = dragReleaseRef.current;
      if (release) {
        if (release.frameId != null) window.cancelAnimationFrame(release.frameId);
        release.target.forEach((position, id) => {
          if (existing.hasNode(id)) existing.mergeNodeAttributes(id, position);
        });
        dragReleaseRef.current = null;
      }
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
      focusTutor,
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
  }, [onApiReady, applyFocusForNode, applyFocusForEdge, clearFocus, focusTutor, switchMode]);

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
