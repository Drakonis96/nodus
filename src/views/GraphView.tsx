import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';
import type { AppSettings, GraphData, IdeaType, IdeaDetail, EdgeDetail, GraphNodeType, TutorStop } from '@shared/types';
import { NODE_COLORS, NODE_LABELS, EDGE_LABELS, Icon } from '../components/ui';
import { NodeDetailPanel, loadNumber, DETAIL_WIDTH_KEY, DETAIL_FONT_KEY, DETAIL_MIN_WIDTH, DETAIL_MAX_WIDTH, DETAIL_DEFAULT_WIDTH, DETAIL_MIN_FONT, DETAIL_MAX_FONT, DETAIL_DEFAULT_FONT } from '../components/NodeDetailPanel';
import { useScanComplete } from '../hooks';
import { ThemesModal } from './ThemesModal';
import { TutorPanel } from './TutorPanel';
import type { GraphNavigationTarget, GraphPresetId } from '../navigation';

const IDEA_TYPES: IdeaType[] = ['claim', 'finding', 'construct', 'method', 'framework'];
const GRAPH_NODE_TYPES: Exclude<GraphNodeType, 'author'>[] = ['theme', ...IDEA_TYPES];
const EDGE_TYPES = Object.keys(EDGE_LABELS);
type GraphLens = 'ideas' | 'authors';
const DEFAULT_LOCAL_GRAPH_DEPTH = 1;
const LAYOUT_THEME_LINKS_PER_THEME = 28;
const LAYOUT_THEME_LINKS_GLOBAL_MAX = 520;
const LAYOUT_AUTHOR_LINKS_PER_AUTHOR = 8;
const LAYOUT_AUTHOR_LINKS_GLOBAL_MAX = 360;
const DRAG_COLLISION_MAX_ACTIVE = 44;
const DRAG_COLLISION_CELL_SIZE = 96;
const DRAG_INFLUENCE_MAX = 140;
const FOCUS_CACHE_LIMIT = 260;
const INITIAL_FORCE_LAYOUT_DELAY_MS = 90;
const INITIAL_FORCE_LAYOUT_MAX_ITER = 96;
const DRAG_TAP_SUPPRESSION_MS = 260;
const DRAG_MOVEMENT_THRESHOLD = 3;

function physicalLayoutElements(cy: Core) {
  return cy.nodes().filter((node) => !node.isParent()).union(
    cy.edges().filter((edge) => edge.data('layoutEdge') !== false)
  );
}

function createForceLayoutOptions(cy: Core, randomize: boolean, stop?: () => void, overrides: Record<string, unknown> = {}) {
  const nodeCount = Math.max(1, cy.nodes().filter((node) => !node.isParent()).length);
  const layoutEdgeCount = Math.max(1, cy.edges().filter((edge) => edge.data('layoutEdge') !== false).length);
  const authorNodeCount = cy.nodes().filter((node) => !node.isParent() && node.data('type') === 'author').length;
  const isAuthorGraph = authorNodeCount > 0 && authorNodeCount >= nodeCount * 0.55;
  const padding = Math.round(Math.min(80, 40 + Math.sqrt(nodeCount) * 1.8));
  const densityScale = Math.min(isAuthorGraph ? 1.35 : 1.7, 1 + Math.sqrt(nodeCount + layoutEdgeCount) / 68);
  const iterationBudget = randomize
    ? Math.max(260, Math.min(680, 760 - nodeCount * 0.58))
    : Math.max(110, Math.min(280, 320 - nodeCount * 0.22));

  return {
    name: 'cose',
    eles: physicalLayoutElements(cy),
    animate: false,
    fit: randomize,
    padding,
    nodeDimensionsIncludeLabels: false,
    randomize,
    refresh: randomize ? 18 : 28,
    componentSpacing: Math.round((isAuthorGraph ? 196 : 122) * densityScale),
    nodeOverlap: isAuthorGraph ? 8 : 24,
    nodeRepulsion: (node: any) => {
      const type = node.data('type') as GraphNodeType | 'community-guide' | 'community';
      const degree = Math.max(0, Number(node.data('degree') ?? 0));
      const size = Math.max(18, Number(node.data('size') ?? 28));
      if (type === 'theme') return Math.round((12200 + size * 150 + Math.sqrt(degree) * 1120) * densityScale);
      if (type === 'author') return Math.round((22000 + size * 420 + Math.sqrt(degree) * 2100) * densityScale);
      return Math.round((7600 + size * 92 + Math.sqrt(degree) * 820) * densityScale);
    },
    idealEdgeLength: (edge: any) => {
      const confidence = clampUnit(Number(edge.data('confidence') ?? 0.5));
      const type = edge.data('type') as string;
      const isAuthorEdge = edge.source?.().data('type') === 'author' || edge.target?.().data('type') === 'author';
      if (isAuthorEdge) return Math.round(250 + (1 - confidence) * 96 + densityScale * 42);
      if (type === 'contains') return Math.round(245 + (1 - confidence) * 86 + densityScale * 34);
      if (type === 'contradicts' || type === 'refutes') return Math.round(205 + (1 - confidence) * 70);
      if (type === 'shares_method' || type === 'measures_same' || type === 'variant_of') return Math.round(168 + (1 - confidence) * 54);
      return Math.round(154 + (1 - confidence) * 62);
    },
    edgeElasticity: (edge: any) => {
      const confidence = clampUnit(Number(edge.data('confidence') ?? 0.5));
      return edge.data('type') === 'contains'
        ? Math.round(220 + (1 - confidence) * 130)
        : Math.round(52 + (1 - confidence) * 38);
    },
    nestingFactor: 1.2,
    gravity: randomize ? 0.2 : 0.11,
    numIter: Math.round(iterationBudget),
    initialTemp: randomize ? 760 : 170,
    coolingFactor: randomize ? 0.985 : 0.965,
    minTemp: 1.4,
    animationThreshold: 220,
    stop,
    ...overrides,
  } as any;
}

// Color palette for edge types — distinct hues for quick visual discrimination.
const EDGE_TYPE_COLORS: Record<string, string> = {
  supports: '#22c55e',        // green — positive
  refutes: '#ef4444',         // red — negative
  contradicts: '#f97316',     // orange — conflicting
  extends: '#3b82f6',         // blue — expansion
  refines: '#8b5cf6',         // violet — refinement
  applies_to: '#eab308',      // yellow — application
  shares_method: '#06b6d4',   // cyan — methodological
  precondition_of: '#f472b6', // pink — causal
  measures_same: '#14b8a6',   // teal — measurement
  variant_of: '#a78bfa',      // light purple — variant
  contains: '#3f3f46',        // dark gray — structural
};
const ZOOM_LABEL_THRESHOLD = 0.52;   // below this, hide all idea labels
const ZOOM_LABEL_DETAIL_THRESHOLD = 1.18;
const ZOOM_LABEL_FULL_THRESHOLD = 1.72;

const LAYOUT_KEY = 'nodus.graph.layout';
const DRAG_ELASTIC_DEPTH_PULL = [0.62, 0.30, 0.14];
const DRAG_ELASTIC_MAX_STEP = 32;

interface DragInfluence {
  id: string;
  weight: number;
}

interface DragInteractionState {
  nodeId: string;
  influences: DragInfluence[];
  collisionIds: string[];
  lastPosition: { x: number; y: number };
  pendingDx: number;
  pendingDy: number;
  totalDx: number;
  totalDy: number;
  moved: boolean;
  frameId: number | null;
}

interface FocusCollections {
  center: any;
  primary: any;
  secondary: any;
  context: any;
}

interface FocusClassState {
  primary: any;
  secondary: any;
  context: any;
  spotlight: any;
}

function edgeElasticFactor(edge: any): number {
  const confidence = Math.min(1, Math.max(0.15, Number(edge.data('confidence') ?? 0.5)));
  const structuralDamping = edge.data('type') === 'contains' ? (edge.data('layoutEdge') ? 0.42 : 0.08) : 1;
  return (0.35 + confidence * 0.65) * structuralDamping;
}

function buildDragInfluences(root: any): DragInfluence[] {
  const seenDepth = new Map<string, number>([[root.id(), 0]]);
  const weights = new Map<string, number>();
  let frontier = [{ node: root, strength: 1, depth: 0 }];

  while (frontier.length > 0) {
    const next: Array<{ node: any; strength: number; depth: number }> = [];
    for (const item of frontier) {
      if (item.depth >= DRAG_ELASTIC_DEPTH_PULL.length) continue;
      item.node.connectedEdges().forEach((edge: any) => {
        const factor = edgeElasticFactor(edge);
        edge.connectedNodes().forEach((neighbor: any) => {
          if (neighbor.id() === item.node.id() || neighbor.id() === root.id()) return;
          const depth = item.depth + 1;
          const weight = Math.min(0.7, item.strength * DRAG_ELASTIC_DEPTH_PULL[item.depth] * factor);
          if (weight <= 0.01) return;
          weights.set(neighbor.id(), Math.max(weight, weights.get(neighbor.id()) ?? 0));
          const previousDepth = seenDepth.get(neighbor.id());
          if (previousDepth == null || depth < previousDepth) {
            seenDepth.set(neighbor.id(), depth);
            next.push({ node: neighbor, strength: weight, depth });
          }
        });
      });
    }
    frontier = next;
  }

  return [...weights.entries()]
    .map(([id, weight]) => ({ id, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, DRAG_INFLUENCE_MAX);
}

function collisionRadius(node: any): number {
  const type = node.data('type') as GraphNodeType | 'community' | 'community-guide';
  const size = Math.max(18, Number(node.data('size') ?? 28));
  if (type === 'theme') return size / 2 + 28;
  if (type === 'community' || type === 'community-guide') return size / 2 + 22;
  return size / 2 + 18;
}

function applyLocalCollisionRepulsion(cy: Core, activeIds: string[]): void {
  if (activeIds.length === 0) return;

  const nodes = cy.nodes().filter((node) => !node.isParent()).toArray() as any[];
  if (nodes.length < 2) return;

  const cells = new Map<string, any[]>();
  const cellKey = (x: number, y: number) => `${Math.floor(x / DRAG_COLLISION_CELL_SIZE)}:${Math.floor(y / DRAG_COLLISION_CELL_SIZE)}`;
  for (const node of nodes) {
    const p = node.position();
    const key = cellKey(p.x, p.y);
    const list = cells.get(key) ?? [];
    list.push(node);
    cells.set(key, list);
  }

  const activeSet = new Set(activeIds.slice(0, DRAG_COLLISION_MAX_ACTIVE));
  for (const id of activeSet) {
    const active = cy.getElementById(id);
    if (active.empty() || active.isParent()) continue;
    const ap = active.position();
    const ax = Math.floor(ap.x / DRAG_COLLISION_CELL_SIZE);
    const ay = Math.floor(ap.y / DRAG_COLLISION_CELL_SIZE);
    const ar = collisionRadius(active);

    for (let gx = ax - 1; gx <= ax + 1; gx++) {
      for (let gy = ay - 1; gy <= ay + 1; gy++) {
        const bucket = cells.get(`${gx}:${gy}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other.id() === id || other.isParent()) continue;
          const op = other.position();
          const dx = op.x - ap.x || stableUnit(`${id}|${other.id()}`) - 0.5;
          const dy = op.y - ap.y || stableUnit(`${other.id()}|${id}`) - 0.5;
          const distance = Math.max(0.1, Math.hypot(dx, dy));
          const minDistance = ar + collisionRadius(other);
          if (distance >= minDistance) continue;

          const push = Math.min(18, (minDistance - distance) * 0.42);
          const ux = dx / distance;
          const uy = dy / distance;
          if (!other.grabbed() && !other.locked()) {
            other.position({ x: op.x + ux * push, y: op.y + uy * push });
          }
          if (!active.grabbed() && !active.locked()) {
            active.position({ x: ap.x - ux * push * 0.24, y: ap.y - uy * push * 0.24 });
          }
        }
      }
    }
  }
}

function nodeLabelScore(node: GraphData['nodes'][number], degree: number): number {
  const workCount = Number(node.workCount ?? 0);
  const confidence = Number(node.maxConfidence ?? 0);
  if (node.type === 'theme') return 1000 + workCount * 10 + degree * 12;
  if (node.type === 'author') return degree * 12 + workCount * 4 + confidence * 2;
  return degree * 14 + workCount * 3 + confidence * 6;
}

function themeNodeSize(workCount: number): number {
  return 22 + Math.min(12, Math.sqrt(Math.max(0, workCount)) * 2.55);
}

function ideaNodeSize(degree: number): number {
  return 11 + Math.min(12, Math.sqrt(Math.max(0, degree)) * 2.75);
}

function authorNodeSize(workCount: number, degree: number): number {
  return 10 + Math.min(10, Math.sqrt(Math.max(0, workCount)) * 1.35 + Math.sqrt(Math.max(0, degree)) * 0.95);
}

function graphNodeSize(node: GraphData['nodes'][number], degree: number): number {
  if (node.type === 'theme') return themeNodeSize(node.workCount);
  if (node.type === 'author') return authorNodeSize(node.workCount, degree);
  return ideaNodeSize(degree);
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clampUnit((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mix(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function snapshotNodePositions(cy: Core): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  cy.nodes().forEach((node) => {
    if (node.isParent()) return;
    const position = node.position();
    positions.set(node.id(), { x: position.x, y: position.y });
  });
  return positions;
}

/**
 * Deterministic radial layout: theme hubs sit in a compact regular polygon and
 * each theme's ideas form a local spiral cluster just outside its hub. This keeps
 * the graph readable without turning each theme into a rigid straight branch.
 * Ideas with no theme go on an outer ring. Returns a positions map, or null when
 * there are no theme nodes (caller falls back to a force layout).
 */
function computeRadialPositions(cy: Core): Record<string, { x: number; y: number }> | null {
  const themeNodes = cy.nodes().filter((n) => n.data('type') === 'theme');
  const N = themeNodes.length;
  if (N === 0) return null;

  const ideaNodes = cy.nodes().filter((n) => n.data('type') !== 'theme');
  const pos: Record<string, { x: number; y: number }> = {};
  const themeAngle: Record<string, number> = {};

  const Rt = N === 1 ? 0 : Math.min(1040, 320 + N * 44);
  themeNodes.forEach((t, i) => {
    const ang = ((-90 + (i * 360) / N) * Math.PI) / 180;
    themeAngle[t.id()] = ang;
    pos[t.id()] = { x: Rt * Math.cos(ang), y: Rt * Math.sin(ang) };
  });

  // Which themes contain each idea (theme→idea "contains" edges).
  const ideaThemes: Record<string, string[]> = {};
  cy.edges().forEach((e) => {
    if (e.data('type') !== 'contains') return;
    const src = cy.getElementById(e.data('source'));
    const tgt = cy.getElementById(e.data('target'));
    if (src.nonempty() && src.data('type') === 'theme' && tgt.nonempty() && tgt.data('type') !== 'theme') {
      (ideaThemes[tgt.id()] ??= []).push(src.id());
    }
  });

  const groups: Record<string, string[]> = {};
  themeNodes.forEach((t) => {
    groups[t.id()] = [];
  });
  const orphans: string[] = [];
  ideaNodes.forEach((n) => {
    const ts = (ideaThemes[n.id()] || []).filter((id) => themeAngle[id] !== undefined);
    if (ts.length) groups[ts[0]].push(n.id());
    else orphans.push(n.id());
  });

  const hashUnit = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
  };
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const clusterStep = 134;
  let maxR = Rt + 220;

  for (const [themeId, list] of Object.entries(groups)) {
    const A = themeAngle[themeId];
    const themePos = pos[themeId];
    const clusterDistance = 360 + Math.min(420, Math.sqrt(list.length) * 76);
    const cx = themePos.x + clusterDistance * Math.cos(A);
    const cy0 = themePos.y + clusterDistance * Math.sin(A);
    for (let m = 0; m < list.length; m++) {
      const id = list[m];
      const jitter = (hashUnit(id) - 0.5) * 0.7;
      const r = list.length === 1 ? 0 : 42 + clusterStep * Math.sqrt(m + 1);
      const ang = A + m * goldenAngle + jitter;
      pos[id] = { x: cx + r * Math.cos(ang), y: cy0 + r * Math.sin(ang) };
      maxR = Math.max(maxR, Math.hypot(pos[id].x, pos[id].y));
    }
  }

  if (orphans.length) {
    const startR = maxR + 340;
    for (let m = 0; m < orphans.length; m++) {
      const r = startR + 58 * Math.sqrt(m);
      const ang = m * goldenAngle;
      pos[orphans[m]] = { x: r * Math.cos(ang), y: r * Math.sin(ang) };
    }
  }

  relaxRelatedIdeaEdges(cy, pos);
  separateLabelBoxes(cy, pos);
  return pos;
}

/**
 * Deterministic author layout for dense author graphs. The force layout can use
 * this as a stable seed, and the explicit radial mode uses it directly.
 */
function computeAuthorRadialPositions(cy: Core): Record<string, { x: number; y: number }> | null {
  const authorNodes = cy.nodes().filter((n) => n.data('type') === 'author');
  if (authorNodes.empty()) return null;

  const nodes = authorNodes
    .map((node) => {
      const degree = Math.max(0, Number(node.data('degree') ?? 0));
      const workCount = Math.max(0, Number(node.data('_workCount') ?? 0));
      return {
        id: node.id(),
        score: degree * 5 + workCount * 2 + Number(node.data('labelRank') ?? 0),
      };
    })
    .sort((a, b) => b.score - a.score || stableUnit(a.id) - stableUnit(b.id));

  const pos: Record<string, { x: number; y: number }> = {};
  if (nodes.length === 1) {
    pos[nodes[0].id] = { x: 0, y: 0 };
    return pos;
  }

  let index = 0;
  if (nodes.length >= 12) {
    pos[nodes[index].id] = { x: 0, y: 0 };
    index++;
  }

  const spacing = nodes.length > 140 ? 132 : nodes.length > 80 ? 150 : 172;
  const ringGap = nodes.length > 140 ? 176 : nodes.length > 80 ? 198 : 224;
  let ring = 1;

  while (index < nodes.length) {
    const radius = 230 + (ring - 1) * ringGap;
    const capacity = Math.max(8 + ring * 4, Math.floor((2 * Math.PI * radius) / spacing));
    const take = Math.min(capacity, nodes.length - index);
    const offset = stableUnit(`author-ring:${ring}:${nodes.length}`) * Math.PI * 2;
    for (let slot = 0; slot < take; slot++) {
      const id = nodes[index + slot].id;
      const angle = offset + (slot / take) * Math.PI * 2;
      const jitter = (stableUnit(`author-jitter:${id}`) - 0.5) * Math.min(26, spacing * 0.16);
      pos[id] = {
        x: (radius + jitter) * Math.cos(angle),
        y: (radius + jitter) * Math.sin(angle),
      };
    }
    index += take;
    ring++;
  }

  separateLabelBoxes(cy, pos);
  return pos;
}

function computeSeedPositions(cy: Core, lens: GraphLens): Record<string, { x: number; y: number }> | null {
  return lens === 'authors' ? computeAuthorRadialPositions(cy) : computeRadialPositions(cy);
}

/**
 * Keep theme hubs as the visual scaffold, then let idea→idea relations pull their
 * endpoints together. This gives an Obsidian-like local density without turning
 * the whole graph into an unreadable hairball.
 */
function relaxRelatedIdeaEdges(cy: Core, pos: Record<string, { x: number; y: number }>): void {
  const links = cy
    .edges()
    .filter((edge) => {
      if (edge.data('type') === 'contains') return false;
      const source = cy.getElementById(edge.data('source'));
      const target = cy.getElementById(edge.data('target'));
      return source.nonempty() && target.nonempty() && source.data('type') !== 'theme' && target.data('type') !== 'theme';
    })
    .map((edge) => ({
      source: edge.data('source') as string,
      target: edge.data('target') as string,
      type: edge.data('type') as string,
      confidence: Number(edge.data('confidence') ?? 0.5),
    }));

  if (links.length === 0) return;

  const strengthByType: Record<string, number> = {
    contradicts: 0.42,
    refutes: 0.42,
    supports: 0.38,
    extends: 0.34,
    applies_to: 0.3,
    shares_method: 0.26,
    measures_same: 0.26,
    precondition_of: 0.3,
  };

  for (let iter = 0; iter < 70; iter++) {
    for (const link of links) {
      const a = pos[link.source];
      const b = pos[link.target];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const confidence = Math.min(1, Math.max(0.1, link.confidence));
      const ideal = link.type === 'contradicts' || link.type === 'refutes' ? 190 : 145 + (1 - confidence) * 70;
      const pull = ((distance - ideal) / distance) * (strengthByType[link.type] ?? 0.24) * confidence * 0.045;
      const moveX = dx * pull;
      const moveY = dy * pull;
      a.x += moveX;
      a.y += moveY;
      b.x -= moveX;
      b.y -= moveY;
    }
  }
}

function separateLabelBoxes(cy: Core, pos: Record<string, { x: number; y: number }>): void {
  const nodes = cy.nodes().toArray();
  if (nodes.length < 2 || nodes.length > 900) return;

  const boxes = nodes
    .map((node) => {
      const p = pos[node.id()];
      if (!p) return null;
      const type = node.data('type') as GraphNodeType;
      const size = Number(node.data('size') ?? 32);
      const font = type === 'theme' ? 13 : type === 'author' ? 9.5 : 10;
      const maxWidth = type === 'theme' ? 190 : type === 'author' ? 118 : 150;
      const label = String(node.data('label') ?? '');
      const charsPerLine = Math.max(8, Math.floor(maxWidth / (font * 0.55)));
      const wrapped = wrapEstimate(label, charsPerLine);
      const lines = Math.max(1, wrapped.lines);
      const labelWidth = Math.min(maxWidth, Math.max(44, wrapped.maxLineLength * font * 0.58));
      const labelHeight = lines * (font + 4);
      return {
        id: node.id(),
        type,
        width: Math.max(size + 34, labelWidth + 42),
        height: size + labelHeight + 34,
        nodeRadius: size / 2,
        labelHeight,
        nodeBias: type === 'theme' ? 0.28 : type === 'author' ? 0.82 : 0.5,
      };
    })
    .filter((box): box is NonNullable<typeof box> => !!box);

  const boxFor = (box: (typeof boxes)[number]) => {
    const p = pos[box.id];
    return {
      left: p.x - box.width / 2,
      right: p.x + box.width / 2,
      top: p.y - box.nodeRadius - 10,
      bottom: p.y + box.nodeRadius + box.labelHeight + 24,
    };
  };

  const iterations = nodes.length > 450 ? 80 : 150;
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      const pa = pos[a.id];
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j];
        const pb = pos[b.id];
        const ba = boxFor(a);
        const bb = boxFor(b);
        const overlapX = Math.min(ba.right, bb.right) - Math.max(ba.left, bb.left);
        const overlapY = Math.min(ba.bottom, bb.bottom) - Math.max(ba.top, bb.top);
        if (overlapX <= 0 || overlapY <= 0) continue;

        const dx = pb.x - pa.x || stableUnit(`${a.id}|${b.id}`) - 0.5;
        const dy = pb.y - pa.y || stableUnit(`${b.id}|${a.id}`) - 0.5;
        if (overlapX < overlapY) {
          const dir = dx >= 0 ? 1 : -1;
          const push = Math.min(72, overlapX / 2 + 12);
          pa.x -= dir * push * a.nodeBias;
          pb.x += dir * push * b.nodeBias;
        } else {
          const dir = dy >= 0 ? 1 : -1;
          const push = Math.min(72, overlapY / 2 + 12);
          pa.y -= dir * push * a.nodeBias;
          pb.y += dir * push * b.nodeBias;
        }
        moved = true;
      }
    }
    if (!moved) return;
  }
}

function wrapEstimate(label: string, charsPerLine: number): { lines: number; maxLineLength: number } {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines: 1, maxLineLength: 1 };
  let lines = 1;
  let current = 0;
  let maxLineLength = 0;
  for (const word of words) {
    const length = word.length;
    if (current === 0) {
      current = length;
    } else if (current + 1 + length <= charsPerLine) {
      current += 1 + length;
    } else {
      maxLineLength = Math.max(maxLineLength, current);
      lines += Math.max(1, Math.ceil(length / charsPerLine));
      current = length % charsPerLine || Math.min(length, charsPerLine);
    }
  }
  maxLineLength = Math.max(maxLineLength, Math.min(current, charsPerLine));
  return { lines, maxLineLength };
}

function stableUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

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
  nodeTypes: GRAPH_NODE_TYPES.filter((t) => t !== 'theme'),
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
const FILTER_VERSION = '3';
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

function graphPreset(id: GraphPresetId, target?: GraphNavigationTarget): { lens: GraphLens; filters: Filters; depth: number | null; layoutMode: 'force' | 'radial' } {
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
        layoutMode: 'force',
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
        layoutMode: 'force',
      };
    case 'reading':
      return {
        lens: 'ideas',
        filters: withTarget,
        depth: 1,
        layoutMode: 'radial',
      };
    case 'unread':
      return {
        lens: 'ideas',
        filters: { ...withTarget, readState: 'unread' },
        depth: 1,
        layoutMode: 'force',
      };
    case 'authors':
      return {
        lens: 'authors',
        filters: withTarget,
        depth: 1,
        layoutMode: 'force',
      };
    case 'overview':
    default:
      return {
        lens: 'ideas',
        filters: withTarget,
        depth: 1,
        layoutMode: 'force',
      };
  }
}

function loadFilters(): Filters {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}') as Partial<Filters>;
    const merged = { ...defaultFilters(), ...parsed };
    const isLegacyFilters = localStorage.getItem(FILTER_VERSION_KEY) !== FILTER_VERSION;
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

function loadHighlightDepth(): number | null {
  const raw = localStorage.getItem(LOCAL_GRAPH_DEPTH_KEY);
  if (!raw) return DEFAULT_LOCAL_GRAPH_DEPTH;
  if (raw === 'unlimited') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LOCAL_GRAPH_DEPTH;
  return Math.min(8, Math.max(1, Math.round(parsed)));
}

function navigationNotice(target: GraphNavigationTarget, preset: GraphPresetId): string {
  if (target.label) return target.label;
  if (target.workTitle) return `Lectura: ${target.workTitle}`;
  if (target.edgeId) return 'Relación enfocada desde otra pantalla';
  if (target.nodeId) return 'Idea enfocada desde otra pantalla';
  if (target.theme) return `Tema: ${target.theme}`;
  return GRAPH_PRESETS.find((p) => p.id === preset)?.description ?? 'Contexto aplicado';
}

function collectLocalGraph(startNode: any, maxDepth: number | null): { center: any; primary: any; secondary: any; context: any } {
  const cy = startNode.cy();
  const startId = startNode.id();
  const center = cy.collection(startNode);

  // Build a Cytoscape collection from id sets in one pass. Repeatedly calling
  // collection.union() inside the BFS below was O(N·E) — each union copies the
  // whole collection — and the single biggest cause of the multi-second freeze
  // when tapping a node on a large graph.
  const buildCollection = (nodeIds: Set<string>, edgeIds: Set<string>) => {
    const els: any[] = [];
    for (const id of nodeIds) {
      const n = cy.getElementById(id);
      if (n.nonempty()) els.push(n);
    }
    for (const id of edgeIds) {
      const e = cy.getElementById(id);
      if (e.nonempty()) els.push(e);
    }
    return els.length ? cy.collection(els) : cy.collection();
  };

  if (startNode.data('type') === 'theme') {
    const memberNodeIds = new Set<string>();
    const memberEdgeIds = new Set<string>();
    startNode.connectedEdges().forEach((edge: any) => {
      if (edge.data('type') !== 'contains') return;
      memberEdgeIds.add(edge.id());
      edge.connectedNodes().forEach((n: any) => {
        if (n.id() !== startId) memberNodeIds.add(n.id());
      });
    });
    // Links between members (non-contains edges whose both endpoints are members).
    const memberLinkEdgeIds = new Set<string>();
    cy.edges().forEach((edge: any) => {
      if (edge.data('type') === 'contains') return;
      if (memberNodeIds.has(edge.data('source')) && memberNodeIds.has(edge.data('target'))) {
        memberLinkEdgeIds.add(edge.id());
      }
    });
    const primaryNodeIds = new Set<string>([startId, ...memberNodeIds]);
    return {
      center,
      primary: buildCollection(primaryNodeIds, memberEdgeIds),
      secondary: buildCollection(new Set(), memberLinkEdgeIds),
      context: cy.collection(),
    };
  }

  const primaryNodeIds = new Set<string>([startId]);
  const primaryEdgeIds = new Set<string>();
  const secondaryNodeIds = new Set<string>();
  const secondaryEdgeIds = new Set<string>();
  const visited = new Set<string>([startId]);
  let frontier: any[] = [startNode];
  let depth = 0;

  while (frontier.length > 0 && (maxDepth == null || depth < maxDepth)) {
    const next: any[] = [];
    for (const node of frontier) {
      node
        .connectedEdges()
        .filter((edge: any) => edge.data('type') !== 'contains')
        .forEach((edge: any) => {
          edge.connectedNodes().forEach((neighbor: any) => {
            if (neighbor.id() === node.id() || neighbor.data('type') === 'theme') return;
            if (depth === 0) {
              primaryNodeIds.add(neighbor.id());
              primaryEdgeIds.add(edge.id());
            } else {
              secondaryNodeIds.add(neighbor.id());
              secondaryEdgeIds.add(edge.id());
            }
            if (!visited.has(neighbor.id())) {
              visited.add(neighbor.id());
              next.push(neighbor);
            }
          });
        });
    }
    frontier = next;
    depth += 1;
  }

  // Context: theme hubs linked to the focused ideas via "contains" edges.
  const ideaNodeIds = new Set<string>([...primaryNodeIds, ...secondaryNodeIds]);
  const contextNodeIds = new Set<string>();
  const contextEdgeIds = new Set<string>();
  for (const id of ideaNodeIds) {
    const node = cy.getElementById(id);
    if (node.empty() || node.data('type') === 'theme') continue;
    node.connectedEdges().forEach((edge: any) => {
      if (edge.data('type') !== 'contains') return;
      const eid = edge.id();
      if (primaryEdgeIds.has(eid) || secondaryEdgeIds.has(eid)) return;
      contextEdgeIds.add(eid);
      edge.connectedNodes().forEach((n: any) => {
        if (n.data('type') === 'theme') contextNodeIds.add(n.id());
      });
    });
  }
  // The original implementation did context.difference(primary ∪ secondary); we
  // replicate that by dropping overlapping ids here (cheaper than a set diff on
  // full collections).
  for (const id of primaryNodeIds) contextNodeIds.delete(id);
  for (const id of secondaryNodeIds) contextNodeIds.delete(id);
  for (const id of primaryEdgeIds) contextEdgeIds.delete(id);
  for (const id of secondaryEdgeIds) contextEdgeIds.delete(id);

  return {
    center,
    primary: buildCollection(primaryNodeIds, primaryEdgeIds),
    secondary: buildCollection(secondaryNodeIds, secondaryEdgeIds),
    context: buildCollection(contextNodeIds, contextEdgeIds),
  };
}

function primaryThemeEdges(edges: GraphData['edges']): GraphData['edges'] {
  const containsByTarget = new Map<string, GraphData['edges'][number]>();
  const semantic = edges.filter((edge) => {
    if (edge.type !== 'contains') return true;
    const existing = containsByTarget.get(edge.target);
    if (!existing || themeEdgeScore(edge) > themeEdgeScore(existing)) {
      containsByTarget.set(edge.target, edge);
    }
    return false;
  });
  return [...semantic, ...containsByTarget.values()];
}

function themeEdgeScore(edge: GraphData['edges'][number]): number {
  return (edge.basis === 'explicit' ? 2 : 0) + edge.confidence;
}

function physicalEdgeIds(edges: GraphData['edges'], nodeCount: number, lens: GraphLens): Set<string> {
  if (lens === 'authors') return authorPhysicalEdgeIds(edges, nodeCount);

  const physical = new Set<string>();
  const themeEdgesBySource = new Map<string, GraphData['edges']>();

  for (const edge of edges) {
    if (edge.type !== 'contains') {
      physical.add(edge.id);
      continue;
    }
    const list = themeEdgesBySource.get(edge.source) ?? [];
    list.push(edge);
    themeEdgesBySource.set(edge.source, list);
  }

  const candidates: GraphData['edges'] = [];
  for (const list of themeEdgesBySource.values()) {
    list.sort((a, b) => {
      const scoreDiff = themeEdgeScore(b) - themeEdgeScore(a);
      return scoreDiff || stableUnit(a.id) - stableUnit(b.id);
    });
    const localLimit = Math.min(
      LAYOUT_THEME_LINKS_PER_THEME,
      Math.max(8, Math.round(8 + Math.sqrt(list.length) * 2.2))
    );
    candidates.push(...list.slice(0, localLimit));
  }

  const globalLimit = Math.min(
    LAYOUT_THEME_LINKS_GLOBAL_MAX,
    Math.max(180, Math.round(Math.sqrt(Math.max(1, nodeCount)) * 24))
  );
  candidates.sort((a, b) => {
    const scoreDiff = themeEdgeScore(b) - themeEdgeScore(a);
    return scoreDiff || stableUnit(a.id) - stableUnit(b.id);
  });
  for (const edge of candidates.slice(0, globalLimit)) physical.add(edge.id);

  return physical;
}

function authorPhysicalEdgeIds(edges: GraphData['edges'], nodeCount: number): Set<string> {
  const physical = new Set<string>();
  const ranked = edges
    .filter((edge) => edge.type !== 'contains')
    .sort((a, b) => b.confidence - a.confidence || stableUnit(a.id) - stableUnit(b.id));
  const localLimit = Math.min(
    LAYOUT_AUTHOR_LINKS_PER_AUTHOR,
    Math.max(4, Math.round(3 + Math.sqrt(Math.max(1, nodeCount)) / 2))
  );
  const globalLimit = Math.min(
    LAYOUT_AUTHOR_LINKS_GLOBAL_MAX,
    Math.max(120, Math.round(Math.max(1, nodeCount) * 3.2))
  );
  const countByNode = new Map<string, number>();
  const strongestByNode = new Map<string, string>();

  for (const edge of ranked) {
    if (!strongestByNode.has(edge.source)) strongestByNode.set(edge.source, edge.id);
    if (!strongestByNode.has(edge.target)) strongestByNode.set(edge.target, edge.id);
  }

  const add = (edge: GraphData['edges'][number]) => {
    if (physical.size >= globalLimit || physical.has(edge.id)) return;
    physical.add(edge.id);
    countByNode.set(edge.source, (countByNode.get(edge.source) ?? 0) + 1);
    countByNode.set(edge.target, (countByNode.get(edge.target) ?? 0) + 1);
  };

  const byId = new Map(ranked.map((edge) => [edge.id, edge]));
  for (const id of strongestByNode.values()) {
    const edge = byId.get(id);
    if (edge) add(edge);
  }

  for (const edge of ranked) {
    if (physical.size >= globalLimit) break;
    const sourceCount = countByNode.get(edge.source) ?? 0;
    const targetCount = countByNode.get(edge.target) ?? 0;
    if (sourceCount < localLimit || targetCount < localLimit) add(edge);
  }

  return physical;
}

// ── Louvain community detection (simplified) ────────────────────────────────
// Returns a map of node id → community id. Works on undirected weighted edges.
function louvain(cy: Core): Map<string, number> {
  const nodes = cy.nodes().filter((n) => !n.isParent()); // skip compound parents
  const adj = new Map<string, Map<string, number>>();
  let totalWeight = 0;

  // Build adjacency (undirected, weighted by confidence).
  nodes.forEach((n) => { adj.set(n.id(), new Map()); });
  cy.edges().forEach((e) => {
    const s = e.data('source') as string;
    const t = e.data('target') as string;
    if (!adj.has(s) || !adj.has(t)) return;
    const w = Math.max(0.1, Number(e.data('confidence') ?? 0.5));
    const a = adj.get(s)!;
    a.set(t, (a.get(t) ?? 0) + w);
    const b = adj.get(t)!;
    b.set(s, (b.get(s) ?? 0) + w);
    totalWeight += w;
  });
  if (totalWeight === 0 || nodes.length === 0) return new Map();

  // Each node starts in its own community.
  const community = new Map<string, number>();
  const nodeIds: string[] = [];
  nodes.forEach((n) => {
    nodeIds.push(n.id());
    community.set(n.id(), nodeIds.length - 1);
  });

  // k_i = weighted degree of node i
  const k = new Map<string, number>();
  for (const id of nodeIds) {
    let sum = 0;
    for (const w of adj.get(id)!.values()) sum += w;
    k.set(id, sum);
  }

  // Sum of weights inside each community.
  const sigmaIn = new Map<number, number>();
  const sigmaTot = new Map<number, number>();
  for (const id of nodeIds) {
    const c = community.get(id)!;
    sigmaIn.set(c, 0);
    sigmaTot.set(c, k.get(id)!);
  }

  // Iterate until no improvement.
  let improved = true;
  let iter = 0;
  while (improved && iter < 20) {
    improved = false;
    iter++;
    for (const id of nodeIds) {
      const currentC = community.get(id)!;
      const ki = k.get(id)!;
      const neighbors = adj.get(id)!;

      // Remove node from its community.
      let kiIn = 0;
      for (const [nb, w] of neighbors) {
        if (community.get(nb) === currentC) kiIn += w;
      }
      sigmaTot.set(currentC, (sigmaTot.get(currentC) ?? 0) - ki);
      sigmaIn.set(currentC, (sigmaIn.get(currentC) ?? 0) - 2 * kiIn);

      // Find best community among neighbors.
      const neighborComms = new Map<number, number>(); // comm → ki_in
      for (const [nb, w] of neighbors) {
        const nc = community.get(nb)!;
        neighborComms.set(nc, (neighborComms.get(nc) ?? 0) + w);
      }

      let bestC = currentC;
      let bestGain = 0;
      for (const [nc, kiInNew] of neighborComms) {
        const sigmaTotNc = sigmaTot.get(nc) ?? 0;
        const gain = kiInNew / totalWeight - (ki * sigmaTotNc) / (totalWeight * totalWeight);
        if (gain > bestGain) {
          bestGain = gain;
          bestC = nc;
        }
      }

      // Move node to best community.
      community.set(id, bestC);
      const kiInBest = neighborComms.get(bestC) ?? 0;
      sigmaTot.set(bestC, (sigmaTot.get(bestC) ?? 0) + ki);
      sigmaIn.set(bestC, (sigmaIn.get(bestC) ?? 0) + 2 * kiInBest);

      if (bestC !== currentC) improved = true;
    }
  }

  // Renumber communities to 0..N-1.
  const renumber = new Map<number, number>();
  let next = 0;
  const result = new Map<string, number>();
  for (const id of nodeIds) {
    const c = community.get(id)!;
    if (!renumber.has(c)) renumber.set(c, next++);
    result.set(id, renumber.get(c)!);
  }
  return result;
}

export function GraphView({
  settings,
  onSettingsChange,
  target,
}: {
  settings: AppSettings;
  onSettingsChange: () => void;
  target?: GraphNavigationTarget | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const activeLayoutRef = useRef<any | null>(null);
  const applySemanticZoomRef = useRef<(cy: Core, force?: boolean) => void>(() => {});
  const dragStateRef = useRef<DragInteractionState | null>(null);
  const forceLayoutPrimedRef = useRef(false);
  const clearFocusRef = useRef<() => void>(() => {});
  const focusNodeByIdRef = useRef<(nodeId: string) => void>(() => {});
  const openNodeByIdRef = useRef<(nodeId: string) => boolean>(() => false);
  const openEdgeByIdRef = useRef<(edgeId: string) => boolean>(() => false);
  const highlightDepthRef = useRef<number | null>(null);
  const lastUserFocusRef = useRef<string | null>(null);
  const focusByIdRef = useRef<(nodeIds: string[], edgeId?: string | null) => void>(() => {});
  const pendingNavigationRef = useRef<GraphNavigationTarget | null>(null);
  const lastNavigationNonceRef = useRef<number | null>(null);
  const focusCacheRef = useRef<Map<string, FocusCollections>>(new Map());
  const focusClassStateRef = useRef<FocusClassState | null>(null);
  const hoverAugmentRef = useRef<any | null>(null);
  const lastDragReleaseRef = useRef<{ id: string; at: number } | null>(null);
  const pendingFocusFrameRef = useRef<number | null>(null);
  const pendingInitialLayoutTimerRef = useRef<number | null>(null);
  // Track the last semantic-zoom "band" so we only recompute opacities/labels
  // when the zoom level actually crosses a meaningful threshold, not on every
  // wheel tick. This is the single biggest perf win for fluidity.
  const lastZoomBandRef = useRef<number>(-1);
  // Debounce hover focus so rapid mouse movement across nodes doesn't trigger
  // a neighbourhood traversal + style recalc on every single element entered.
  const hoverFocusTimerRef = useRef<number | null>(null);
  // When the Tutor is driving the camera, a container resize should re-apply this focus
  // instead of fitting the whole graph (the node detail panel opening would steal it).
  const lastTutorFocusRef = useRef<{ nodeIds: string[]; edgeId?: string | null } | null>(null);
  // Element to keep centered when the detail panel opens/closes and resizes the
  // viewport. Without this the tapped node would slide under the panel.
  const focusCenterRef = useRef<{ id: string; kind: 'node' | 'edge' } | null>(null);
  // Track whether the current highlight came from a hover (so tap can override it).
  const hoverActiveRef = useRef(false);
  // Deferred forced semantic-zoom recalc. Clearing focus still needs a full label
  // pass to restore the non-focused view; deferring it coalesces pending recalcs
  // and keeps taps from doing O(N+E) work synchronously.
  const pendingZoomRecalcRef = useRef<number | null>(null);
  const scheduleZoomRecalc = useCallback(() => {
    if (pendingZoomRecalcRef.current != null) return;
    pendingZoomRecalcRef.current = window.requestAnimationFrame(() => {
      pendingZoomRecalcRef.current = null;
      const cy = cyRef.current;
      if (cy) applySemanticZoomRef.current(cy, true);
    });
  }, []);
  const cancelPendingFocusFrame = useCallback(() => {
    if (pendingFocusFrameRef.current == null) return;
    window.cancelAnimationFrame(pendingFocusFrameRef.current);
    pendingFocusFrameRef.current = null;
  }, []);
  const cancelPendingInitialLayout = useCallback(() => {
    if (pendingInitialLayoutTimerRef.current == null) return;
    window.clearTimeout(pendingInitialLayoutTimerRef.current);
    pendingInitialLayoutTimerRef.current = null;
  }, []);
  const [lens, setLens] = useState<GraphLens>('ideas');
  const [themesModalOpen, setThemesModalOpen] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [themes, setThemes] = useState<string[]>([]);
  const [themesLoaded, setThemesLoaded] = useState(false);
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [activePreset, setActivePreset] = useState<GraphPresetId>('overview');
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const [highlightDepth, setHighlightDepth] = useState<number | null>(loadHighlightDepth);
  const [layoutMode, setLayoutMode] = useState<'force' | 'radial'>(() => (localStorage.getItem(LAYOUT_KEY) as 'force' | 'radial') || 'force');
  const [communitiesCollapsed, setCommunitiesCollapsed] = useState(false);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const communitiesRef = useRef<Map<string, number>>(new Map());
  const layoutModeRef = useRef<'force' | 'radial'>(layoutMode);
  const lensRef = useRef<GraphLens>(lens);
  const appliedGraphModeRef = useRef<{ lens: GraphLens; layoutMode: 'force' | 'radial' } | null>(null);

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    localStorage.setItem(FILTER_VERSION_KEY, FILTER_VERSION);
  }, [filters]);

  useEffect(() => {
    lensRef.current = lens;
  }, [lens]);

  useEffect(() => {
    layoutModeRef.current = layoutMode;
    localStorage.setItem(LAYOUT_KEY, layoutMode);
  }, [layoutMode]);

  useEffect(() => {
    localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidth));
  }, [detailWidth]);

  useEffect(() => {
    localStorage.setItem(DETAIL_FONT_KEY, String(detailFontSize));
  }, [detailFontSize]);

  useEffect(() => {
    highlightDepthRef.current = highlightDepth;
    localStorage.setItem(LOCAL_GRAPH_DEPTH_KEY, highlightDepth == null ? 'unlimited' : String(highlightDepth));
    if (lastUserFocusRef.current) focusNodeByIdRef.current(lastUserFocusRef.current);
  }, [highlightDepth]);

  const reload = useCallback(() => {
    void window.nodus.getGraph(lens).then(setData);
    void window.nodus.getThemes().then((t) => {
      setThemes(t.map((x) => x.label));
      setThemesLoaded(true);
    });
  }, [lens]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Refresh the graph when scans finish so freshly analysed works appear without
  // having to leave and re-open the view.
  useScanComplete(reload);

  const cancelPendingDragFrame = useCallback(() => {
    const state = dragStateRef.current;
    if (!state || state.frameId == null) return;
    window.cancelAnimationFrame(state.frameId);
    state.frameId = null;
  }, []);

  const stopActiveLayout = useCallback(() => {
    activeLayoutRef.current?.stop?.();
    activeLayoutRef.current = null;
  }, []);

  const removeCommunityGuides = useCallback((cy: Core) => {
    const guides = cy.nodes('[type="community-guide"]');
    if (guides.empty()) return;
    cy.batch(() => {
      guides.forEach((guide) => {
        guide.children().forEach((child) => {
          child.move({ parent: null });
        });
      });
      guides.remove();
    });
  }, []);

  const applyElasticDragStep = useCallback(() => {
    const cy = cyRef.current;
    const state = dragStateRef.current;
    if (!cy || !state) return;

    state.frameId = null;
    const dx = state.pendingDx;
    const dy = state.pendingDy;
    state.pendingDx = 0;
    state.pendingDy = 0;

    const magnitude = Math.hypot(dx, dy);
    if (magnitude < 0.01) return;

    const scale = magnitude > DRAG_ELASTIC_MAX_STEP ? DRAG_ELASTIC_MAX_STEP / magnitude : 1;
    const moveX = dx * scale;
    const moveY = dy * scale;

    cy.batch(() => {
      for (const influence of state.influences) {
        const node = cy.getElementById(influence.id);
        if (node.empty() || node.grabbed()) continue;
        const position = node.position();
        node.position({
          x: position.x + moveX * influence.weight,
          y: position.y + moveY * influence.weight,
        });
      }
      applyLocalCollisionRepulsion(cy, state.collisionIds);
    });
  }, []);

  const scheduleElasticDragStep = useCallback(() => {
    const state = dragStateRef.current;
    if (!state || state.frameId != null) return;
    state.frameId = window.requestAnimationFrame(() => {
      applyElasticDragStep();
    });
  }, [applyElasticDragStep]);

  const frameGraph = useCallback((cy: Core, padding = 80) => {
    const tutorFocus = lastTutorFocusRef.current;
    if (tutorFocus) {
      focusByIdRef.current(tutorFocus.nodeIds, tutorFocus.edgeId);
      return;
    }
    if (lastUserFocusRef.current) return;
    cy.fit(undefined, padding);
  }, []);

  const elements = useMemo<ElementDefinition[]>(() => {
    const f = filters;
    const q = f.search.toLowerCase();
    const visibleNodes = data.nodes.filter((n) => {
      if (lens === 'ideas' && !f.nodeTypes.includes(n.type)) return false;
      if (f.theme && !n.themes.includes(f.theme)) return false;
      if (f.workIds.length > 0 && !(n.workIds ?? []).some((id) => f.workIds.includes(id))) return false;
      if (f.readState === 'read' && !n.read) return false;
      if (f.readState === 'unread' && n.read) return false;
      if (f.minConfidence > 0 && n.maxConfidence < f.minConfidence) return false;
      if (f.authors.length && !n.authors.some((a) => f.authors.includes(a))) return false;
      if (f.yearMin != null && !n.years.some((y) => y >= f.yearMin!)) return false;
      if (f.yearMax != null && !n.years.some((y) => y <= f.yearMax!)) return false;
      if (q && !(n.label.toLowerCase().includes(q) || (n.statement ?? '').toLowerCase().includes(q) || n.authors.some((a) => a.toLowerCase().includes(q)))) {
        return false;
      }
      return true;
    });
    const visibleNodeById = new Map(visibleNodes.map((node) => [node.id, node]));
    const nodeIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = primaryThemeEdges(data.edges.filter((e) => {
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) return false;
      if (lens === 'ideas' && !f.edgeTypes.includes(e.type)) return false;
      if (f.minConfidence > 0 && e.confidence < f.minConfidence) return false;
      if (f.basis === 'explicit' && e.basis !== 'explicit') return false;
      return true;
    }));
    const physicalEdges = physicalEdgeIds(visibleEdges, visibleNodes.length, lens);

    const degreeById = new Map<string, number>();
    for (const node of visibleNodes) degreeById.set(node.id, 0);
    for (const edge of visibleEdges) {
      degreeById.set(edge.source, (degreeById.get(edge.source) ?? 0) + 1);
      degreeById.set(edge.target, (degreeById.get(edge.target) ?? 0) + 1);
    }

    const rankedNodes = visibleNodes
      .filter((node) => node.type !== 'theme')
      .map((node) => ({
        id: node.id,
        score: nodeLabelScore(node, degreeById.get(node.id) ?? 0),
      }))
      .sort((a, b) => b.score - a.score);
    const labelRankById = new Map<string, number>();
    rankedNodes.forEach((node, index) => {
      const rank = rankedNodes.length <= 1 ? 1 : 1 - index / (rankedNodes.length - 1);
      labelRankById.set(node.id, rank);
    });

    return [
      ...visibleNodes.map((n) => ({
        data: {
          id: n.id,
          label: n.label,
          type: n.type,
          // Degree is computed below after edges are built.
          // Placeholder — will be overwritten once we know the edge count per node.
          _workCount: n.workCount,
          degree: degreeById.get(n.id) ?? 0,
          labelRank: n.type === 'theme' ? 1.2 : labelRankById.get(n.id) ?? 0,
          size: graphNodeSize(n, degreeById.get(n.id) ?? 0),
          read: n.read,
        },
      })),
      ...visibleEdges.map((e) => ({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.type,
          basis: e.basis,
          confidence: e.confidence,
          layoutEdge: physicalEdges.has(e.id),
        },
      })),
    ].map((el: any) => {
      // Compute degree from the visible edges and use a soft square-root scale
      // so important nodes stand out without dominating the graph.
      if (el.data.source) return el; // skip edges
      if (el.data.type === 'theme') return el; // theme size stays workCount-based
      const degree = degreeById.get(el.data.id) ?? 0;
      const node = visibleNodeById.get(el.data.id);
      if (node) el.data.size = graphNodeSize(node, degree);
      return el;
    });
  }, [data, filters, lens]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!cyRef.current) {
      const lightTheme = document.documentElement.classList.contains('light');
      cyRef.current = cytoscape({
        container: containerRef.current,
        elements: [],
        // Clamp zoom so the graph never feels "super far" nor too tight, and
        // make wheel zoom feel snappier than the default 1.
        minZoom: 0.12,
        maxZoom: 4,
        wheelSensitivity: 0.35,
        hideEdgesOnViewport: false,
        textureOnViewport: false,
        motionBlur: false,
        pixelRatio: Math.min(1.35, window.devicePixelRatio || 1),
        style: [
          {
            selector: 'node',
            style: {
              'background-color': (ele: any) =>
                ele.data('type') === 'author' ? '#a3a3a3' : NODE_COLORS[ele.data('type') as Exclude<GraphNodeType, 'author'>] ?? '#888',
              label: 'data(label)',
              color: lightTheme ? '#171717' : '#ededed',
              'font-size': (ele: any) => (ele.data('type') === 'theme' ? 11 : ele.data('type') === 'author' ? 9.5 : 8.5),
              'font-weight': (ele: any) => (ele.data('type') === 'theme' ? 650 : 450),
              'text-wrap': 'wrap',
              'text-max-width': (ele: any) => (ele.data('type') === 'theme' ? '128px' : '104px'),
              'text-valign': 'bottom',
              'text-margin-y': 5,
              'min-zoomed-font-size': (ele: any) => (ele.data('type') === 'author' ? 2.8 : 6),
              // Outline keeps labels legible where they cross edges or other nodes.
              'text-outline-width': 2.1,
              'text-outline-color': lightTheme ? '#ffffff' : '#0a0a0a',
              'text-outline-opacity': lightTheme ? 0.8 : 0.72,
              width: 'data(size)',
              height: 'data(size)',
              opacity: 'data(baseOpacity)',
              'border-width': (ele: any) => (ele.data('read') ? 0 : 2),
              'border-color': '#737373',
              'border-style': 'dashed',
              'transition-property': 'opacity, text-opacity, text-outline-opacity, border-width, border-color, overlay-opacity, background-opacity',
              'transition-duration': '0.18s',
              'transition-timing-function': 'ease-in-out',
            } as any,
          },
          // Theme hubs get a soft solid halo so the centre reads as the backbone.
          {
            selector: 'node[type="theme"]',
            style: { 'border-width': 1.8, 'border-color': '#f9b069', 'border-style': 'solid', 'border-opacity': 0.32 } as any,
          },
          {
            selector: 'node:grabbed',
            style: {
              'overlay-color': '#f8fafc',
              'overlay-opacity': 0.08,
              'overlay-padding': 5,
              'z-index': 40,
              'text-opacity': 1,
            } as any,
          },
          // Community compound nodes (collapsed clusters).
          {
            selector: 'node[type="community"]',
            style: {
              'background-color': 'rgba(99,102,241,0.08)',
              'background-opacity': 0.72,
              'border-width': 2,
              'border-color': '#6366f1',
              'border-style': 'dashed',
              'border-opacity': 0.24,
              shape: 'round-rectangle',
              'text-valign': 'top',
              'text-margin-y': 8,
              'font-size': 11,
              'font-weight': 700,
              color: '#c7d2fe',
              'text-outline-width': 2,
              'text-outline-color': '#0a0a0a',
              'text-outline-opacity': 0.55,
              padding: 20,
            } as any,
          },
          {
            selector: 'node[type="community-guide"]',
            style: {
              label: '',
              'background-opacity': 0,
              'border-opacity': 0,
              'text-opacity': 0,
              'overlay-opacity': 0,
              padding: (ele: any) => ele.data('guidePadding') ?? 48,
              events: 'no',
            } as any,
          },
          {
            selector: 'edge',
            style: {
              width: (ele: any) => {
                const layoutEdge = ele.data('layoutEdge') !== false;
                return (layoutEdge ? 0.34 : 0.18) + ele.data('confidence') * (layoutEdge ? 0.62 : 0.24);
              },
              'line-color': (ele: any) => EDGE_TYPE_COLORS[ele.data('type')] ?? '#525252',
              'line-style': (ele: any) => (ele.data('basis') === 'inferred' ? 'dashed' : 'solid'),
              opacity: 'data(baseOpacity)',
              'target-arrow-shape': 'triangle',
              'target-arrow-color': (ele: any) => EDGE_TYPE_COLORS[ele.data('type')] ?? '#525252',
              'arrow-scale': 0.52,
              'curve-style': 'bezier',
              'transition-property': 'opacity, line-color, width, target-arrow-color, source-arrow-color',
              'transition-duration': '0.18s',
              'transition-timing-function': 'ease-in-out',
            } as any,
          },
          // Theme→idea "contains" links are structural branches: faint, solid, no arrow.
          {
            selector: 'edge[type="contains"]',
            style: {
              'line-style': 'solid',
              'line-color': '#3f3f46',
              width: (ele: any) => (ele.data('layoutEdge') ? 0.44 : 0.24),
              opacity: 'data(baseOpacity)',
              'target-arrow-shape': 'none',
            } as any,
          },
          { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#818cf8', 'border-style': 'solid', 'border-opacity': 1, 'text-opacity': 1 } as any },
          // Semantic zoom: hide labels at low zoom for clarity. These come before
          // focus styles so that focus-node/context-node override them.
          { selector: 'node.zoom-label-hidden', style: { 'text-opacity': 0, 'min-zoomed-font-size': 0 } as any },
          { selector: 'node.zoom-label-muted', style: { 'text-opacity': 0.035, 'text-outline-opacity': 0.06 } as any },
          { selector: 'node.zoom-label-mid', style: { 'text-opacity': 0.16, 'text-outline-opacity': 0.2 } as any },
          // Focus mode: everything not in the tapped traversal fades back.
          { selector: 'node.faded', style: { opacity: 0.36, 'text-opacity': 0.08, 'text-outline-opacity': 0.08 } as any },
          { selector: 'edge.faded', style: { opacity: 0.105 } as any },
          {
            selector: 'node.focus-node',
            style: {
              opacity: 0.98,
              'text-opacity': 0.94,
              'border-width': 2,
              'border-color': '#c7d2fe',
              'border-style': 'solid',
              'border-opacity': 0.72,
              'overlay-color': '#818cf8',
              'overlay-opacity': 0.035,
              'overlay-padding': 3,
              'z-index': 18,
            } as any,
          },
          {
            selector: 'edge.focus-edge',
            style: {
              width: (ele: any) => 1.25 + ele.data('confidence') * 1.35,
              'line-color': (ele: any) => EDGE_TYPE_COLORS[ele.data('type')] ?? '#a5b4fc',
              'target-arrow-color': (ele: any) => EDGE_TYPE_COLORS[ele.data('type')] ?? '#a5b4fc',
              'arrow-scale': 0.72,
              opacity: 0.96,
              'z-index': 26,
            } as any,
          },
          {
            selector: 'node.secondary-node',
            style: {
              opacity: 0.82,
              'text-opacity': 0.72,
              'border-width': 1.4,
              'border-color': '#93c5fd',
              'border-style': 'solid',
              'border-opacity': 0.42,
              'z-index': 14,
            } as any,
          },
          {
            selector: 'edge.secondary-edge',
            style: {
              width: (ele: any) => 0.78 + ele.data('confidence') * 0.78,
              opacity: 0.44,
              'z-index': 16,
            } as any,
          },
          {
            selector: 'node.context-node',
            style: {
              opacity: 0.64,
              'text-opacity': 0.62,
              'border-width': 1.5,
              'border-color': '#f59e0b',
              'border-style': 'solid',
              'border-opacity': 0.35,
              'z-index': 10,
            } as any,
          },
          {
            selector: 'edge.context-edge',
            style: {
              width: 0.58,
              'line-color': '#f59e0b',
              opacity: 0.2,
              'target-arrow-shape': 'none',
              'z-index': 9,
            } as any,
          },
          { selector: 'node.spotlight', style: { opacity: 1, 'text-opacity': 1, 'border-width': 3, 'border-color': '#f8fafc', 'border-style': 'solid', 'border-opacity': 0.95, 'overlay-opacity': 0.08, 'overlay-padding': 5, 'z-index': 32 } as any },
          {
            selector: 'node.hover-augment-node',
            style: {
              opacity: 1,
              'text-opacity': 1,
              'text-outline-opacity': 0.85,
              'border-width': 2.4,
              'border-color': '#facc15',
              'border-style': 'solid',
              'border-opacity': 0.9,
              'overlay-color': '#facc15',
              'overlay-opacity': 0.08,
              'overlay-padding': 5,
              'z-index': 36,
            } as any,
          },
          {
            selector: 'edge.hover-augment-edge',
            style: {
              width: (ele: any) => 1.15 + ele.data('confidence') * 1.15,
              opacity: 0.86,
              'line-color': (ele: any) => EDGE_TYPE_COLORS[ele.data('type')] ?? '#facc15',
              'target-arrow-color': (ele: any) => EDGE_TYPE_COLORS[ele.data('type')] ?? '#facc15',
              'arrow-scale': 0.7,
              'z-index': 34,
            } as any,
          },
        ],
        layout: { name: 'preset' },
      });

      const getCachedFocus = (node: any, depth: number | null): FocusCollections => {
        const key = `${node.id()}::${depth == null ? 'all' : depth}`;
        const cache = focusCacheRef.current;
        const cached = cache.get(key);
        if (cached && cached.center?.nonempty?.()) return cached;

        const focus = collectLocalGraph(node, depth);
        cache.set(key, focus);
        if (cache.size > FOCUS_CACHE_LIMIT) {
          const oldest = cache.keys().next().value;
          if (oldest) cache.delete(oldest);
        }
        return focus;
      };

      const removeFocusClasses = () => {
        const cy = cyRef.current!;
        const previous = focusClassStateRef.current;
        cy.batch(() => {
          previous?.primary.removeClass('faded focus-node focus-edge secondary-node secondary-edge context-node context-edge');
          previous?.secondary.removeClass('faded focus-node focus-edge secondary-node secondary-edge context-node context-edge');
          previous?.context.removeClass('faded focus-node focus-edge secondary-node secondary-edge context-node context-edge');
          previous?.spotlight.removeClass('spotlight');
          cy.elements('.faded').removeClass('faded');
          cy.nodes('.spotlight').removeClass('spotlight');
        });
        focusClassStateRef.current = null;
        scheduleZoomRecalc();
      };
      const clearHoverAugment = () => {
        const hover = hoverAugmentRef.current;
        if (!hover) return;
        hover.removeClass('hover-augment-node hover-augment-edge');
        hoverAugmentRef.current = null;
      };
      const applyHoverAugment = (node: any) => {
        const cy = cyRef.current;
        if (!cy || node.empty()) return;
        const neighbourhood = node.closedNeighborhood().filter((ele: any) => {
          if (ele.isNode?.()) return true;
          return ele.data('type') !== 'contains' || ele.data('layoutEdge') !== false;
        });
        clearHoverAugment();
        cy.batch(() => {
          neighbourhood.nodes().addClass('hover-augment-node');
          neighbourhood.edges().addClass('hover-augment-edge');
        });
        hoverAugmentRef.current = neighbourhood;
      };
      const applyFocus = (focus: { primary: any; secondary?: any; context?: any }, spotlightNodes?: any) => {
        const cy = cyRef.current!;
        clearHoverAugment();
        const previous = focusClassStateRef.current;
        const primary = focus.primary;
        const secondary = focus.secondary ?? cy.collection();
        const context = focus.context ?? cy.collection();
        const spotlight = spotlightNodes ?? cy.collection();
        cy.batch(() => {
          if (previous) {
            previous.primary.addClass('faded').removeClass('focus-node focus-edge');
            previous.secondary.addClass('faded').removeClass('secondary-node secondary-edge');
            previous.context.addClass('faded').removeClass('context-node context-edge');
            previous.spotlight.removeClass('spotlight');
          } else {
            cy.elements().addClass('faded');
          }

          context
            .removeClass('faded focus-node focus-edge secondary-node secondary-edge')
            .nodes()
            .addClass('context-node');
          context.edges().addClass('context-edge');
          secondary
            .removeClass('faded focus-node focus-edge context-node context-edge')
            .nodes()
            .addClass('secondary-node');
          secondary.edges().addClass('secondary-edge');
          primary
            .removeClass('faded secondary-node secondary-edge context-node context-edge')
            .nodes()
            .addClass('focus-node');
          primary.edges().addClass('focus-edge');
          spotlight.removeClass('faded').addClass('spotlight');
        });
        focusClassStateRef.current = { primary, secondary, context, spotlight };
      };
      const focusOnNode = (node: any, depthOverride?: number | null) => {
        const focus = getCachedFocus(node, depthOverride ?? highlightDepthRef.current);
        applyFocus({ primary: focus.primary, secondary: focus.secondary, context: focus.context }, focus.center);
      };
      const clearFocus = () => {
        removeFocusClasses();
      };
      clearFocusRef.current = () => {
        clearHoverAugment();
        lastTutorFocusRef.current = null;
        lastUserFocusRef.current = null;
        focusCenterRef.current = null;
        clearFocus();
      };
      focusNodeByIdRef.current = (nodeId: string) => {
        const node = cyRef.current?.getElementById(nodeId);
        if (node?.nonempty()) focusOnNode(node);
      };
      const scheduleNodeFocus = (nodeId: string, seq: number) => {
        cancelPendingFocusFrame();
        pendingFocusFrameRef.current = window.requestAnimationFrame(() => {
          pendingFocusFrameRef.current = null;
          if (seq !== detailSeqRef.current || lastUserFocusRef.current !== nodeId) return;
          const cy = cyRef.current;
          const node = cy?.getElementById(nodeId);
          if (!cy || !node || node.empty()) return;
          const focus = getCachedFocus(node, highlightDepthRef.current ?? 1);
          applyFocus({ primary: focus.primary, secondary: focus.secondary, context: focus.context }, focus.center);
          const neighbourhood = focus.primary.union(focus.secondary).union(focus.context).union(focus.center);
          cy.animate({ center: { eles: neighbourhood } }, { duration: 280, easing: 'ease-in-out-cubic' });
        });
      };
      const scheduleEdgeFocus = (edgeId: string, seq: number) => {
        cancelPendingFocusFrame();
        pendingFocusFrameRef.current = window.requestAnimationFrame(() => {
          pendingFocusFrameRef.current = null;
          if (seq !== detailSeqRef.current || lastUserFocusRef.current !== edgeId) return;
          const cy = cyRef.current;
          const edge = cy?.getElementById(edgeId);
          if (!cy || !edge || edge.empty()) return;
          const endpoints = edge.connectedNodes();
          const depth = highlightDepthRef.current ?? 1;
          let mergedPrimary = cy.collection();
          let mergedSecondary = cy.collection();
          let mergedContext = cy.collection();
          endpoints.forEach((ep: any) => {
            const fg = getCachedFocus(ep, depth);
            mergedPrimary = mergedPrimary.union(fg.primary);
            mergedSecondary = mergedSecondary.union(fg.secondary);
            mergedContext = mergedContext.union(fg.context);
          });
          mergedPrimary = mergedPrimary.union(edge);
          mergedSecondary = mergedSecondary.difference(mergedPrimary);
          mergedContext = mergedContext.difference(mergedPrimary).difference(mergedSecondary);
          applyFocus({ primary: mergedPrimary, secondary: mergedSecondary, context: mergedContext }, endpoints.add(edge));
          cy.animate({ center: { eles: endpoints } }, { duration: 280, easing: 'ease-in-out-cubic' });
        });
      };
      openNodeByIdRef.current = (nodeId: string) => {
        const cy = cyRef.current;
        const node = cy?.getElementById(nodeId);
        if (!cy || !node || node.empty()) return false;
        cancelPendingInitialLayout();
        stopActiveLayout();
        lastTutorFocusRef.current = null;
        hoverActiveRef.current = false;
        lastUserFocusRef.current = node.id();
        const isIdea = lensRef.current === 'ideas' && !node.id().startsWith('theme:');
        const seq = ++detailSeqRef.current;
        let detailPromise: Promise<IdeaDetail | null> | null = null;
        if (isIdea) {
          detailPromise = window.nodus.getIdeaDetail(node.id());
          setIdeaDetail(null);
          setEdgeDetail(null);
          setDetailLoading({ kind: 'idea', id: node.id(), label: String(node.data('label') ?? ''), type: String(node.data('type') ?? '') });
        } else {
          setIdeaDetail(null);
          setEdgeDetail(null);
          setDetailLoading(null);
        }
        focusCenterRef.current = { id: node.id(), kind: 'node' };
        scheduleNodeFocus(node.id(), seq);
        if (detailPromise) {
          void detailPromise.then(
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
        }
        return true;
      };
      openEdgeByIdRef.current = (edgeId: string) => {
        const cy = cyRef.current;
        const edge = cy?.getElementById(edgeId);
        if (!cy || !edge || edge.empty()) return false;
        cancelPendingInitialLayout();
        stopActiveLayout();
        lastTutorFocusRef.current = null;
        hoverActiveRef.current = false;
        lastUserFocusRef.current = edge.id();
        const seq = ++detailSeqRef.current;
        const detailPromise = window.nodus.getEdgeDetail(edge.id());
        setIdeaDetail(null);
        setEdgeDetail(null);
        setDetailLoading({ kind: 'edge', id: edge.id(), label: String(edge.data('type') ?? '') });
        focusCenterRef.current = { id: edge.id(), kind: 'edge' };
        scheduleEdgeFocus(edge.id(), seq);
        void detailPromise.then(
          (d) => {
            if (seq !== detailSeqRef.current) return;
            setEdgeDetail(d);
            setDetailLoading(null);
          },
          () => {
            if (seq !== detailSeqRef.current) return;
            setDetailLoading(null);
          }
        );
        return true;
      };

      const beginElasticDrag = (node: any) => {
        if (node.isParent()) return;
        cancelPendingInitialLayout();
        clearHoverAugment();
        stopActiveLayout();
        cancelPendingDragFrame();
        const isForceLayout = layoutModeRef.current === 'force';
        const influences = isForceLayout ? buildDragInfluences(node) : [];
        dragStateRef.current = {
          nodeId: node.id(),
          influences,
          collisionIds: isForceLayout
            ? [node.id(), ...influences.filter((item) => item.weight >= 0.08).map((item) => item.id)].slice(0, DRAG_COLLISION_MAX_ACTIVE)
            : [node.id()],
          lastPosition: { ...node.position() },
          pendingDx: 0,
          pendingDy: 0,
          totalDx: 0,
          totalDy: 0,
          moved: false,
          frameId: null,
        };
      };

      const updateElasticDrag = (node: any) => {
        const state = dragStateRef.current;
        if (!state || state.nodeId !== node.id()) return;
        const position = node.position();
        const dx = position.x - state.lastPosition.x;
        const dy = position.y - state.lastPosition.y;
        state.pendingDx += dx;
        state.pendingDy += dy;
        state.totalDx += dx;
        state.totalDy += dy;
        if (Math.hypot(state.totalDx, state.totalDy) >= DRAG_MOVEMENT_THRESHOLD) {
          state.moved = true;
        }
        state.lastPosition = { ...position };
        scheduleElasticDragStep();
      };

      const endElasticDrag = (node: any) => {
        const state = dragStateRef.current;
        if (!state || state.nodeId !== node.id()) return;
        cancelPendingDragFrame();
        if (Math.abs(state.pendingDx) > 0.01 || Math.abs(state.pendingDy) > 0.01) {
          applyElasticDragStep();
        }
        if (state.moved) {
          lastDragReleaseRef.current = { id: node.id(), at: Date.now() };
        }
        dragStateRef.current = null;
      };

      // Drive the graph from the Tutor: spotlight the stop's node(s) (and edge when a
      // connection), fade the rest, and smoothly frame them with a slightly wide
      // perspective — close enough to read the node label, wide enough to show its
      // immediate neighbourhood — so the user watches the tour move across the graph.
      focusByIdRef.current = (nodeIds: string[], edgeId?: string | null) => {
        const cy = cyRef.current;
        if (!cy) return;
        lastTutorFocusRef.current = { nodeIds, edgeId };
        focusCenterRef.current = null;
        let eles = cy.collection();
        for (const id of nodeIds) {
          const node = cy.getElementById(id);
          if (node.nonempty()) eles = eles.union(node);
        }
        if (edgeId) {
          const edge = cy.getElementById(edgeId);
          if (edge.nonempty()) eles = eles.union(edge);
        }
        const targetNodes = eles.nodes();
        if (targetNodes.empty()) {
          clearFocus();
          return;
        }
        const keep = targetNodes.closedNeighborhood();
        lastUserFocusRef.current = null;
        applyFocus({ primary: keep }, targetNodes);
        // Center on the stop node(s); pick a zoom that frames the immediate
        // neighbourhood, clamped so it is never too tight nor too far.
        const pad = 110;
        const bb = keep.boundingBox();
        const fitZoom = Math.min(
          (cy.width() - pad * 2) / Math.max(bb.w, 1),
          (cy.height() - pad * 2) / Math.max(bb.h, 1)
        );
        const zoom = Math.max(0.85, Math.min(1.2, fitZoom));
        cy.animate({ center: { eles: targetNodes }, zoom }, { duration: 500, easing: 'ease-in-out-cubic' });
      };

      cyRef.current.on('grab', 'node', (evt) => {
        beginElasticDrag(evt.target);
      });
      cyRef.current.on('drag', 'node', (evt) => {
        updateElasticDrag(evt.target);
      });
      cyRef.current.on('free', 'node', (evt) => {
        endElasticDrag(evt.target);
      });

      cyRef.current.on('tap', 'node', (evt) => {
        const node = evt.target;
        if (hoverFocusTimerRef.current != null) {
          window.clearTimeout(hoverFocusTimerRef.current);
          hoverFocusTimerRef.current = null;
        }
        const lastDrag = lastDragReleaseRef.current;
        if (lastDrag && lastDrag.id === node.id() && Date.now() - lastDrag.at < DRAG_TAP_SUPPRESSION_MS) {
          lastDragReleaseRef.current = null;
          return;
        }
        void openNodeByIdRef.current(node.id());
      });
      cyRef.current.on('tap', 'edge', (evt) => {
        const edge = evt.target;
        if (hoverFocusTimerRef.current != null) {
          window.clearTimeout(hoverFocusTimerRef.current);
          hoverFocusTimerRef.current = null;
        }
        void openEdgeByIdRef.current(edge.id());
      });
      cyRef.current.on('tap', (evt) => {
        if (evt.target === cyRef.current) {
          detailSeqRef.current++;
          cancelPendingFocusFrame();
          hoverActiveRef.current = false;
          // Use the full clear (resets lastUserFocusRef/focusCenterRef too),
          // not the local clearFocus() which only strips CSS classes — that left
          // lastUserFocusRef set, so the background tap didn't drop the focus and
          // subsequent hovers stayed disabled (their guard is
          // `if (lastUserFocusRef.current) return;`).
          clearFocusRef.current();
          setIdeaDetail(null);
          setEdgeDetail(null);
          setDetailLoading(null);
        }
      });
      // Hover highlight: show the node's neighbourhood while hovering. When a tap
      // focus exists, this augments it instead of replacing the selected route. Debounced so
      // sweeping the cursor across many nodes doesn't trigger a traversal + style
      // recalc per element — only the node the cursor actually rests on.
      cyRef.current.on('mouseover', 'node', (evt) => {
        if (dragStateRef.current) return;
        if (hoverFocusTimerRef.current != null) {
          window.clearTimeout(hoverFocusTimerRef.current);
        }
        const target = evt.target;
        hoverFocusTimerRef.current = window.setTimeout(() => {
          hoverFocusTimerRef.current = null;
          if (dragStateRef.current) return;
          hoverActiveRef.current = true;
          if (lastUserFocusRef.current) {
            applyHoverAugment(target);
          } else {
            focusOnNode(target, 1);
          }
        }, 60);
      });
      cyRef.current.on('mouseout', 'node', () => {
        if (hoverFocusTimerRef.current != null) {
          window.clearTimeout(hoverFocusTimerRef.current);
          hoverFocusTimerRef.current = null;
        }
        if (!hoverActiveRef.current) return;
        hoverActiveRef.current = false;
        if (lastUserFocusRef.current) clearHoverAugment();
        else clearFocus();
      });

      // ── Semantic zoom: progressively reveal labels ─────────────────────────
      // • zoom < ZOOM_LABEL_THRESHOLD → only theme labels (ideas are just dots)
      // • mid zoom → themes + high-rank ideas
      // • close zoom → progressively reveal the rest
      //
      // Performance: we quantise the zoom level into discrete bands and only
      // recompute opacities/label classes when the band changes. This avoids
      // the O(N+E) style recalc that fired on every single wheel tick, which
      // was the main reason the graph felt sluggish compared to Obsidian's
      // WebGL renderer.
      const ZOOM_BAND_EDGES = [0.24, 0.42, 0.52, 0.76, 1.02, 1.18, 1.42, 1.72, 2.05];
      const zoomBand = (z: number) => {
        let band = 0;
        for (const edge of ZOOM_BAND_EDGES) {
          if (z >= edge) band++;
          else break;
        }
        return band;
      };
      const applySemanticZoom = (cy: Core, force = false) => {
        const z = cy.zoom();
        const band = zoomBand(z);
        if (!force && band === lastZoomBandRef.current) return;
        lastZoomBandRef.current = band;
        const structurePhase = smoothstep(0.2, 0.64, z);
        const detailPhase = smoothstep(0.82, 1.28, z);
        const fineDetailPhase = smoothstep(1.28, 1.82, z);
        cy.batch(() => {
          // Never hide labels on focused / spotlighted / context nodes.
          const protectedNodes = cy.nodes('.focus-node, .secondary-node, .spotlight, .context-node, :selected');
          const protectedSet = new Set(protectedNodes.map((n: any) => n.id()));
          const labelNodes = cy.nodes().filter((n: any) => !n.isParent() && !protectedSet.has(n.id()));
          const alwaysVisible = labelNodes.filter((n: any) => {
            const type = n.data('type');
            return type === 'theme' || type === 'community';
          });
          const ranked = labelNodes.filter((n: any) => {
            const type = n.data('type');
            return type !== 'theme' && type !== 'community';
          });
          const allRenderableNodes = cy.nodes().filter((n: any) => !n.isParent());
          const protectedEdgeIds = new Set<string>(
            cy
              .edges('.focus-edge, .secondary-edge, .context-edge')
              .map((edge: any) => edge.id())
          );

          labelNodes.removeClass('zoom-label-hidden zoom-label-muted zoom-label-mid');
          protectedNodes.removeClass('zoom-label-hidden zoom-label-muted zoom-label-mid');
          alwaysVisible.removeClass('zoom-label-hidden zoom-label-muted zoom-label-mid');

          allRenderableNodes.forEach((node: any) => {
            const type = node.data('type');
            const rank = Number(node.data('labelRank') ?? 0);
            let opacity = 1;
            if (type === 'theme' || type === 'community') {
              opacity = mix(0.62, 0.94, structurePhase);
            } else if (!protectedSet.has(node.id())) {
              const presence = clampUnit(rank * 0.95 + detailPhase * 0.34 + fineDetailPhase * 0.18);
              opacity = mix(0.1, 0.9, presence);
            }
            node.data('baseOpacity', opacity);
          });

          cy.edges().forEach((edge: any) => {
            const confidence = Math.min(1, Math.max(0, Number(edge.data('confidence') ?? 0.5)));
            const isStructural = edge.data('type') === 'contains';
            const isLayoutEdge = edge.data('layoutEdge') !== false;
            const isPhysicalStructural = isStructural && isLayoutEdge;
            const importance = isStructural
              ? (isPhysicalStructural ? 0.2 : 0.12)
              : isLayoutEdge
                ? 0.34 + confidence * 0.48
                : 0.12 + confidence * 0.18;
            const phase = isStructural ? structurePhase : mix(structurePhase, 1, detailPhase * 0.55);
            const opacity = protectedEdgeIds.has(edge.id())
              ? edge.hasClass('focus-edge')
                ? 0.96
                : edge.hasClass('secondary-edge')
                  ? 0.42
                  : 0.18
              : mix(
                  isStructural ? 0.018 : isLayoutEdge ? 0.04 : 0.018,
                  isStructural ? (isPhysicalStructural ? 0.14 : 0.075) : isLayoutEdge ? 0.26 : 0.095,
                  clampUnit(importance * phase)
                );
            edge.data('baseOpacity', opacity);
          });

          ranked.forEach((node: any) => {
            const rank = Number(node.data('labelRank') ?? 0);
            let mode: 'full' | 'mid' | 'muted' | 'hidden' = 'full';

            const reveal = clampUnit(rank * 1.18 + structurePhase * 0.22 + detailPhase * 0.52 + fineDetailPhase * 0.34);
            const fullCutoff = mix(1.18, 0.28, detailPhase);
            const midCutoff = mix(0.98, 0.14, fineDetailPhase);
            const mutedCutoff = mix(0.82, 0.05, detailPhase);

            if (reveal >= fullCutoff || z >= ZOOM_LABEL_FULL_THRESHOLD) mode = 'full';
            else if (reveal >= midCutoff || z >= ZOOM_LABEL_DETAIL_THRESHOLD) mode = 'mid';
            else if (reveal >= mutedCutoff || z >= ZOOM_LABEL_THRESHOLD) mode = 'muted';
            else mode = 'hidden';

            if (mode === 'hidden') node.addClass('zoom-label-hidden');
            if (mode === 'muted') node.addClass('zoom-label-muted');
            if (mode === 'mid') node.addClass('zoom-label-mid');
          });
        });
      };
      applySemanticZoomRef.current = applySemanticZoom;
      cyRef.current.on('zoom', () => applySemanticZoomRef.current(cyRef.current!));
    }
    const cy = cyRef.current;
    const previousPositions = snapshotNodePositions(cy);
    const previousGraphMode = appliedGraphModeRef.current;
    const lensChanged = previousGraphMode?.lens !== lens;
    const layoutModeChanged = previousGraphMode?.layoutMode !== layoutMode;
    appliedGraphModeRef.current = { lens, layoutMode };
    cancelPendingInitialLayout();
    cancelPendingFocusFrame();
    focusCacheRef.current.clear();
    focusClassStateRef.current = null;
    stopActiveLayout();
    cancelPendingDragFrame();
    dragStateRef.current = null;
    cy.elements().remove();
    cy.add(elements);
    let seededInitialPositions = false;
    let restoredPositions = 0;
    const renderableNodes = cy.nodes().filter((node) => !node.isParent());
    const renderableNodeCount = renderableNodes.length;
    const seedPositions = computeSeedPositions(cy, lens);
    cy.batch(() => {
      renderableNodes.forEach((node) => {
        const previousPosition = previousPositions.get(node.id());
        if (previousPosition) {
          node.position(previousPosition);
          restoredPositions++;
          return;
        }
        const seedPosition = seedPositions?.[node.id()];
        if (seedPosition) {
          node.position(seedPosition);
          seededInitialPositions = true;
        }
      });
    });
    const hasReusablePositions =
      renderableNodeCount === 0 || restoredPositions >= Math.max(1, Math.ceil(renderableNodeCount * 0.72));

    if (layoutMode === 'force' && !hasReusablePositions && !seededInitialPositions && cy.nodes().length > 0) {
      cy.layout({
        name: 'circle',
        fit: false,
        animate: false,
        padding: 120,
      } as any).run();
      seededInitialPositions = true;
    }
    if (lastUserFocusRef.current && cy.getElementById(lastUserFocusRef.current).empty()) {
      lastUserFocusRef.current = null;
      focusCenterRef.current = null;
      setIdeaDetail(null);
      setEdgeDetail(null);
      setDetailLoading(null);
    }
    const tutorFocus = lastTutorFocusRef.current;
    if (tutorFocus && !tutorFocus.nodeIds.some((id) => cy.getElementById(id).nonempty())) {
      lastTutorFocusRef.current = null;
    }
    // NOTE: automatic community guides (invisible compound parents) were removed
    // — they force the layout into a far slower compound-graph path on
    // every rebuild, which was a major cause of the freeze with themes enabled.
    // The explicit "Comunidades" button still groups on demand via toggleCommunities.
    applySemanticZoomRef.current(cy, true);
    // Reset community state when elements are rebuilt.
    setCommunitiesCollapsed(false);
    let layout: any;
    if (lensChanged || layoutModeChanged || !hasReusablePositions) forceLayoutPrimedRef.current = false;
    const forceLayoutNeedsInitialFrame = !forceLayoutPrimedRef.current || !hasReusablePositions;
    const shouldFrameGraph =
      (forceLayoutNeedsInitialFrame || lensChanged || layoutModeChanged) && !lastTutorFocusRef.current && !lastUserFocusRef.current;
    const forceLayoutRandomize = forceLayoutNeedsInitialFrame && !seededInitialPositions && restoredPositions === 0;
    const startForceLayout = (
      randomize: boolean,
      overrides: Record<string, unknown> = {},
      frameOnStop = shouldFrameGraph
    ) => {
      const forceLayout = createForceLayoutOptions(cy, randomize, () => {
        forceLayoutPrimedRef.current = true;
        if (activeLayoutRef.current === layout) activeLayoutRef.current = null;
        if (frameOnStop) frameGraph(cy);
      }, overrides);
      layout = cy.layout(forceLayout);
      activeLayoutRef.current = layout;
      layout.run();
    };
    // Layout selection: force-directed physics or deterministic radial.
    if (layoutMode === 'radial') {
      const positions = computeSeedPositions(cy, lens);
      if (positions) {
        cy.layout({
          name: 'preset',
          positions,
          fit: false,
          padding: 60,
          animate: hasReusablePositions && !lensChanged,
          animationDuration: layoutModeChanged ? 420 : 600,
          animationEasing: 'ease-in-out-cubic',
          stop: () => {
            forceLayoutPrimedRef.current = true;
            if (shouldFrameGraph) frameGraph(cy);
          },
        } as any).run();
      } else {
        startForceLayout(forceLayoutRandomize);
      }
    } else {
      if (forceLayoutNeedsInitialFrame && seededInitialPositions) {
        forceLayoutPrimedRef.current = true;
        if (shouldFrameGraph) frameGraph(cy);
        pendingInitialLayoutTimerRef.current = window.setTimeout(() => {
          pendingInitialLayoutTimerRef.current = null;
          if (cyRef.current !== cy || layoutModeRef.current !== 'force') return;
          startForceLayout(false, {
            fit: false,
            refresh: 36,
            initialTemp: 120,
            coolingFactor: 0.955,
            numIter: Math.max(48, Math.min(INITIAL_FORCE_LAYOUT_MAX_ITER, Math.round(42 + cy.nodes().length * 0.08 + cy.edges().length * 0.025))),
          }, false);
        }, INITIAL_FORCE_LAYOUT_DELAY_MS);
      } else {
        startForceLayout(forceLayoutRandomize);
      }
    }
  }, [applyElasticDragStep, cancelPendingDragFrame, cancelPendingFocusFrame, cancelPendingInitialLayout, elements, lens, layoutMode, scheduleElasticDragStep, scheduleZoomRecalc, stopActiveLayout]);

  // Tear down Cytoscape work on unmount so render/layout loops from the graph
  // cannot keep competing with other sections after navigation.
  useEffect(() => {
    return () => {
      cancelPendingInitialLayout();
      cancelPendingFocusFrame();
      stopActiveLayout();
      cancelPendingDragFrame();
      if (pendingZoomRecalcRef.current != null) {
        window.cancelAnimationFrame(pendingZoomRecalcRef.current);
        pendingZoomRecalcRef.current = null;
      }
      if (hoverFocusTimerRef.current != null) {
        window.clearTimeout(hoverFocusTimerRef.current);
        hoverFocusTimerRef.current = null;
      }
      dragStateRef.current = null;
      focusCacheRef.current.clear();
      focusClassStateRef.current = null;
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [cancelPendingDragFrame, cancelPendingFocusFrame, cancelPendingInitialLayout, stopActiveLayout]);

  // Keep the graph framed when the window or panels resize.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cy = cyRef.current;
      if (!cy || cy.elements().length === 0) return;
      cy.resize();
      if (activeLayoutRef.current) return;
      const tf = lastTutorFocusRef.current;
      if (tf) {
        focusByIdRef.current(tf.nodeIds, tf.edgeId);
        return;
      }
      // Keep the tapped node/edge centered when the detail panel opens or
      // closes (which resizes this container). Without this the node would
      // slide under the panel.
      const fc = focusCenterRef.current;
      if (fc) {
        const el = cy.getElementById(fc.id);
        if (el.nonempty()) {
          const eles = fc.kind === 'edge' ? el.connectedNodes() : el;
          cy.animate({ center: { eles } }, { duration: 180, easing: 'ease-out' });
        }
        return;
      }
      // No active focus: preserve the current pan/zoom. We deliberately do NOT
      // call cy.fit() here — auto-fitting on every resize (e.g. when closing
      // the panel by tapping the background) caused a jarring zoom-out.
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };
  const fitGraph = () => {
    const cy = cyRef.current;
    if (!cy) return;
    frameGraph(cy);
  };
  const changeDetailFont = (delta: number) => {
    setDetailFontSize((value) => Math.min(DETAIL_MAX_FONT, Math.max(DETAIL_MIN_FONT, value + delta)));
  };

  // ── Minimap ────────────────────────────────────────────────────────────────
  const drawMinimap = useCallback(() => {
    const cy = cyRef.current;
    const canvas = minimapRef.current;
    if (!cy || !canvas || cy.elements().length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const lightTheme = document.documentElement.classList.contains('light');

    const W = canvas.width;
    const H = canvas.height;
    const bb = cy.elements().boundingBox();
    const pad = 20;
    const scaleX = (W - pad * 2) / Math.max(bb.w, 1);
    const scaleY = (H - pad * 2) / Math.max(bb.h, 1);
    const scale = Math.min(scaleX, scaleY);
    const offX = pad + (W - pad * 2 - bb.w * scale) / 2;
    const offY = pad + (H - pad * 2 - bb.h * scale) / 2;

    const toMini = (x: number, y: number) => ({
      x: offX + (x - bb.x1) * scale,
      y: offY + (y - bb.y1) * scale,
    });

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = lightTheme ? 'rgba(255,255,255,0.78)' : 'rgba(10,10,10,0.78)';
    ctx.fillRect(0, 0, W, H);

    // Draw edges as faint lines — batched into a single path/stroke.
    // Drawing each edge with its own beginPath()/stroke() was the dominant cost
    // on large (theme-heavy) graphs and fired on every render frame.
    ctx.strokeStyle = lightTheme ? 'rgba(82,82,82,0.22)' : 'rgba(160,160,160,0.25)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    cy.edges().forEach((e) => {
      const sp = toMini(e.sourceEndpoint().x, e.sourceEndpoint().y);
      const tp = toMini(e.targetEndpoint().x, e.targetEndpoint().y);
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(tp.x, tp.y);
    });
    ctx.stroke();

    // Draw nodes as colored dots.
    cy.nodes().forEach((n) => {
      if (n.isParent()) return;
      const p = toMini(n.position().x, n.position().y);
      const color = n.data('type') === 'theme'
        ? '#f97316'
        : n.data('type') === 'author'
          ? '#a3a3a3'
        : (NODE_COLORS[n.data('type') as Exclude<GraphNodeType, 'author'>] ?? '#888');
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, n.data('type') === 'theme' ? 3 : n.data('type') === 'author' ? 2.2 : 1.8, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw viewport rectangle.
    const ext = cy.extent();
    const tl = toMini(ext.x1, ext.y1);
    const br = toMini(ext.x2, ext.y2);
    ctx.strokeStyle = lightTheme ? 'rgba(23,23,23,0.58)' : 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  }, []);

  // Redraw minimap on Cytoscape render, but coalesced through a single
  // requestAnimationFrame so bursts of render events (pan/zoom/drag/layout)
  // only produce one redraw per frame instead of tanking the main thread.
  const minimapRafRef = useRef<number | null>(null);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const schedule = () => {
      if (minimapRafRef.current != null) return;
      minimapRafRef.current = window.requestAnimationFrame(() => {
        minimapRafRef.current = null;
        drawMinimap();
      });
    };
    cy.on('render', schedule);
    return () => {
      cy.off('render', schedule);
      if (minimapRafRef.current != null) {
        window.cancelAnimationFrame(minimapRafRef.current);
        minimapRafRef.current = null;
      }
    };
  }, [drawMinimap]);

  // Minimap click → pan the graph.
  const handleMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cy = cyRef.current;
    const canvas = minimapRef.current;
    if (!cy || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const bb = cy.elements().boundingBox();
    const pad = 20;
    const W = canvas.width;
    const H = canvas.height;
    const scaleX = (W - pad * 2) / Math.max(bb.w, 1);
    const scaleY = (H - pad * 2) / Math.max(bb.h, 1);
    const scale = Math.min(scaleX, scaleY);
    const offX = pad + (W - pad * 2 - bb.w * scale) / 2;
    const offY = pad + (H - pad * 2 - bb.h * scale) / 2;

    const gx = bb.x1 + (mx - offX) / scale;
    const gy = bb.y1 + (my - offY) / scale;
    cy.animate({ center: { renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }, pan: { x: cy.width() / 2 - gx * cy.zoom(), y: cy.height() / 2 - gy * cy.zoom() } } as any, { duration: 300 });
  };

  // ── Community collapse/expand ───────────────────────────────────────────────
  const toggleCommunities = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;

    if (communitiesCollapsed) {
      // Expand: remove compound parents, restore original elements.
      cy.batch(() => {
        const parents = cy.nodes(':parent');
        // Move children out of parents first.
        parents.forEach((p) => {
          p.children().forEach((child) => {
            child.move({ parent: null });
          });
        });
        parents.remove();
      });
      // No automatic guides on expand (see note in the elements effect).
      // Re-layout after expand.
      stopActiveLayout();
      const layout = cy.layout({
        ...createForceLayoutOptions(cy, false, () => {
          if (activeLayoutRef.current === layout) activeLayoutRef.current = null;
        }),
        fit: false,
        animationDuration: 400,
      } as any);
      activeLayoutRef.current = layout;
      layout.run();
      setCommunitiesCollapsed(false);
    } else {
      removeCommunityGuides(cy);
      // Collapse: detect communities and create compound nodes.
      const commMap = louvain(cy);
      communitiesRef.current = commMap;

      // Count community sizes.
      const commSizes = new Map<number, number>();
      for (const c of commMap.values()) commSizes.set(c, (commSizes.get(c) ?? 0) + 1);
      // Only create compound nodes for communities with ≥3 members.
      const validComms = new Set([...commSizes.entries()].filter(([, s]) => s >= 3).map(([c]) => c));
      if (validComms.size < 2) {
        setCommunitiesCollapsed(false);
        return; // Not enough communities to collapse.
      }

      cy.batch(() => {
        for (const commId of validComms) {
          const parentId = `comm:${commId}`;
          cy.add({
            group: 'nodes',
            data: {
              id: parentId,
              label: `Comunidad ${commId + 1}`,
              type: 'community',
              size: 60,
            },
          });
        }
        // Move nodes into their community parent.
        for (const [nodeId, commId] of commMap) {
          if (!validComms.has(commId)) continue;
          const node = cy.getElementById(nodeId);
          if (node.nonempty() && !node.isParent()) {
            node.move({ parent: `comm:${commId}` });
          }
        }
      });
      // Re-layout after collapse.
      stopActiveLayout();
      const layout = cy.layout({
        ...createForceLayoutOptions(cy, false, () => {
          if (activeLayoutRef.current === layout) activeLayoutRef.current = null;
        }),
        fit: false,
        animationDuration: 400,
      } as any);
      activeLayoutRef.current = layout;
      layout.run();
      setCommunitiesCollapsed(true);
    }
  }, [communitiesCollapsed, removeCommunityGuides, stopActiveLayout]);

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
      apply(null, await window.nodus.getEdgeDetail(stop.edgeId));
      return;
    }
    const ideaId = stop.nodeIds.find((id) => !id.startsWith('theme:'));
    if (ideaId) {
      setEdgeDetail(null);
      apply(await window.nodus.getIdeaDetail(ideaId), null);
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
  const applyPreset = useCallback((id: GraphPresetId, navigationTarget?: GraphNavigationTarget) => {
    const next = graphPreset(id, navigationTarget);
    setActivePreset(id);
    setLens(next.lens);
    setFilters(next.filters);
    setLayoutMode(next.layoutMode);
    setHighlightDepth(next.depth);
    setFiltersOpen(false);
    if (id !== 'reading' || !navigationTarget?.workId) {
      setContextNotice(null);
      setContextZoteroKey(null);
    }
  }, []);

  useEffect(() => {
    if (!target || target.nonce === lastNavigationNonceRef.current) return;
    lastNavigationNonceRef.current = target.nonce;
    const preset = target.preset ?? (target.edgeId ? 'contradictions' : target.workId ? 'reading' : 'overview');
    applyPreset(preset, target);
    if (target.openTutor) setTutorOpen(true);
    setContextNotice(navigationNotice(target, preset));
    setContextZoteroKey(target.zoteroKey ?? null);
    pendingNavigationRef.current = target;
  }, [applyPreset, target]);

  useEffect(() => {
    const pending = pendingNavigationRef.current;
    const cy = cyRef.current;
    if (!pending || !cy) return;
    const timer = window.setTimeout(() => {
      const current = pendingNavigationRef.current;
      if (!current) return;
      let handled = false;
      if (current.edgeId) handled = openEdgeByIdRef.current(current.edgeId);
      else if (current.nodeId) handled = openNodeByIdRef.current(current.nodeId);
      else if (current.workId || current.theme || current.search) {
        fitGraph();
        handled = true;
      }
      if (handled) pendingNavigationRef.current = null;
    }, 140);
    return () => window.clearTimeout(timer);
  }, [elements, filters, lens, layoutMode, target]);

  useEffect(() => {
    if (!themesLoaded) return;
    setFilters((f) => (f.theme && !themes.includes(f.theme) ? { ...f, theme: '' } : f));
  }, [themes, themesLoaded]);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Filter bar */}
      <div className="border-b border-neutral-800 p-2 text-xs">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex flex-wrap gap-1">
            {GRAPH_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className={`btn gap-1.5 py-1 ${activePreset === preset.id ? 'btn-primary' : 'btn-ghost border border-neutral-700'}`}
                title={preset.description}
                onClick={() => applyPreset(preset.id)}
              >
                <Icon name={preset.icon} size={13} /> {preset.label}
              </button>
            ))}
          </div>
          <input
            className="input min-w-44"
            placeholder="Buscar en el grafo..."
            value={filters.search}
            onChange={(e) => setF({ search: e.target.value })}
          />
          <button
            className={`btn border border-neutral-700 gap-1.5 ${filtersOpen ? 'bg-neutral-800 text-neutral-100' : 'btn-ghost'}`}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
          >
            <Icon name="search" /> Filtros
          </button>
          {contextNotice && (
            <div className="inline-flex items-center gap-1.5 rounded-md border border-indigo-900/70 bg-indigo-950/20 px-2 py-1 text-indigo-200">
              <Icon name="fit" size={12} />
              <span className="max-w-60 truncate">{contextNotice}</span>
              <button
                className="text-indigo-300 hover:text-white"
                title="Quitar contexto"
                onClick={() => applyPreset('overview')}
              >
                <Icon name="x" size={12} />
              </button>
              {contextZoteroKey && (
                <button
                  className="text-indigo-300 hover:text-white"
                  title="Abrir lectura en Zotero"
                  onClick={() => void window.nodus.openInZotero(contextZoteroKey)}
                >
                  <Icon name="external" size={12} />
                </button>
              )}
            </div>
          )}
          {lens === 'ideas' && (
            <button
              className={`btn border border-neutral-700 gap-1.5 ${tutorOpen ? 'bg-indigo-600 text-white' : 'btn-ghost'}`}
              title="Recorrido guiado por la IA a través de tus ideas y conexiones"
              onClick={() => setTutorOpen((v) => !v)}
            >
              <Icon name="compass" /> Modo Tutor
            </button>
          )}
          {lens === 'ideas' && (
            <button
              className="btn btn-ghost border border-neutral-700 gap-1.5"
              title="Gestionar los temas principales y reprocesar las conexiones de los nodos"
              onClick={() => setThemesModalOpen(true)}
            >
              <Icon name="tag" /> Temas
            </button>
          )}
          <div className="flex-1" />
          <span className="text-neutral-500">{elements.filter((e) => !(e.data as any).source).length} nodos</span>
        </div>

        {filtersOpen && (
          <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-900/55 p-2 flex flex-wrap gap-2 items-center">
            <div className="flex rounded-lg overflow-hidden border border-neutral-700">
              <button className={`px-3 py-1 ${lens === 'ideas' ? 'bg-indigo-600 text-white' : ''}`} onClick={() => setLens('ideas')}>
                Ideas
              </button>
              <button className={`px-3 py-1 ${lens === 'authors' ? 'bg-indigo-600 text-white' : ''}`} onClick={() => setLens('authors')}>
                Autores
              </button>
            </div>
            <div className="flex rounded-lg overflow-hidden border border-neutral-700">
              <button
                className={`px-3 py-1 ${layoutMode === 'force' ? 'bg-indigo-600 text-white' : ''}`}
                title="Layout dirigido por fuerzas: agrupa ideas conectadas"
                onClick={() => setLayoutMode('force')}
              >
                Grafo
              </button>
              <button
                className={`px-3 py-1 ${layoutMode === 'radial' ? 'bg-indigo-600 text-white' : ''}`}
                title="Layout radial: temas en polígono, ideas alrededor"
                onClick={() => setLayoutMode('radial')}
              >
                Radial
              </button>
            </div>
            {lens === 'ideas' && (
              <div className="flex flex-wrap gap-1">
                {GRAPH_NODE_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleIn('nodeTypes', t)}
                    className="px-2 py-0.5 rounded flex items-center gap-1"
                    style={{
                      backgroundColor: filters.nodeTypes.includes(t) ? NODE_COLORS[t] : (settings.theme === 'light' ? '#e5e7eb' : '#262626'),
                      color: filters.nodeTypes.includes(t) ? 'white' : (settings.theme === 'light' ? '#525252' : '#a3a3a3'),
                    }}
                  >
                    {NODE_LABELS[t]}
                  </button>
                ))}
              </div>
            )}
            <select className="input" value={filters.theme} onChange={(e) => setF({ theme: e.target.value })}>
              <option value="">Todos los temas</option>
              {themes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select className="input" value={filters.readState} onChange={(e) => setF({ readState: e.target.value as any })}>
              <option value="all">Leído + no leído</option>
              <option value="read">Solo leído</option>
              <option value="unread">Solo no leído</option>
            </select>
            <select className="input" value={filters.basis} onChange={(e) => setF({ basis: e.target.value as any })}>
              <option value="all">Explícito + inferido</option>
              <option value="explicit">Solo explícito</option>
            </select>
            <label className="flex items-center gap-1 text-neutral-400">
              conf ≥ {filters.minConfidence.toFixed(1)}
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={filters.minConfidence}
                onChange={(e) => setF({ minConfidence: parseFloat(e.target.value) })}
              />
            </label>
            <label className="flex items-center gap-1 text-neutral-400" title="Profundidad de la ruta local al clicar un nodo">
              Ruta
              <select
                className="input w-24"
                value={highlightDepth == null ? 'unlimited' : String(highlightDepth)}
                onChange={(e) => setLocalGraphDepth(e.target.value)}
              >
                <option value="1">1 salto</option>
                <option value="2">2 saltos</option>
                <option value="3">3 saltos</option>
                <option value="4">4 saltos</option>
                <option value="unlimited">Sin límite</option>
              </select>
            </label>
            <input className="input w-16" placeholder="año≥" onChange={(e) => setF({ yearMin: e.target.value ? +e.target.value : null })} />
            <input className="input w-16" placeholder="año≤" onChange={(e) => setF({ yearMax: e.target.value ? +e.target.value : null })} />
            {lens === 'ideas' && (
              <button
                className={`btn border border-neutral-700 gap-1.5 ${communitiesCollapsed ? 'bg-indigo-600 text-white' : 'btn-ghost'}`}
                title={communitiesCollapsed ? 'Expandir comunidades' : 'Colapsar en comunidades (Louvain)'}
                onClick={toggleCommunities}
              >
                <Icon name="layers" /> {communitiesCollapsed ? 'Expandir' : 'Comunidades'}
              </button>
            )}
            <button className="btn btn-ghost border border-neutral-700" onClick={() => applyPreset('overview')}>
              Limpiar
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 flex min-h-0 relative">
        {lens === 'ideas' && tutorOpen && (
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
        <div className="flex-1 min-w-0 relative">
          <div ref={containerRef} className="absolute inset-0" />

          {/* Zoom / fit controls */}
          <div className="absolute top-3 right-3 flex flex-col gap-1">
            <button className="card bg-neutral-900/90 p-1.5 hover:bg-neutral-800" title="Acercar" onClick={() => zoomBy(1.25)}>
              <Icon name="plus" size={16} />
            </button>
            <button className="card bg-neutral-900/90 p-1.5 hover:bg-neutral-800" title="Alejar" onClick={() => zoomBy(0.8)}>
              <Icon name="minus" size={16} />
            </button>
            <button className="card bg-neutral-900/90 p-1.5 hover:bg-neutral-800" title="Ajustar a la pantalla" onClick={fitGraph}>
              <Icon name="fit" size={16} />
            </button>
          </div>

          {/* Minimap */}
          <canvas
            ref={minimapRef}
            width={156}
            height={104}
            className="absolute bottom-3 right-3 rounded-lg border border-neutral-300/70 dark:border-neutral-700 cursor-pointer opacity-70 hover:opacity-95"
            title="Mini-mapa · click para navegar"
            onClick={handleMinimapClick}
          />

          {/* Legend */}
          <div className="absolute bottom-3 left-3 card p-2 text-[10px] space-y-1 bg-neutral-900/90 max-w-[220px]">
            {GRAPH_NODE_TYPES.map((t) => (
              <div key={t} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: NODE_COLORS[t] }} />
                {NODE_LABELS[t]}
              </div>
            ))}
            <div className="pt-1 border-t border-neutral-800 text-neutral-500">○ borde punteado: no leída</div>
            <div className="pt-1 border-t border-neutral-800 space-y-0.5">
              {Object.entries(EDGE_TYPE_COLORS).filter(([t]) => t !== 'contains').map(([type, color]) => (
                <div key={type} className="flex items-center gap-1.5 text-neutral-400">
                  <span className="w-3 h-0.5 rounded" style={{ backgroundColor: color }} />
                  {EDGE_LABELS[type as keyof typeof EDGE_LABELS] ?? type}
                </div>
              ))}
            </div>
            <div className="text-neutral-500">— sólida: explícita · ·· punteada: inferida</div>
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

      {themesModalOpen && (
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
    </div>
  );
}
