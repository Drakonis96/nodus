// Renderer-agnostic graph model.
//
// This module turns raw GraphData (+ filters / lens / preset) into a plain
// structure of nodes and edges with every visual attribute pre-computed
// (size, degree, label rank, which edges participate in the physics layout).
// It is deliberately free of any Cytoscape or Sigma types so it can feed the
// graphology graph used by the Sigma renderer — and be unit-reasoned in
// isolation. The logic mirrors the original `elements` memo in GraphView.
import type { GraphData, GraphNodeType, IdeaType } from '@shared/types';
import type { GraphPresetId } from '../../navigation';

export type GraphLens = 'ideas' | 'authors';

export const IDEA_TYPES: IdeaType[] = ['claim', 'finding', 'construct', 'method', 'framework'];
export const GRAPH_NODE_TYPES: Exclude<GraphNodeType, 'author'>[] = ['theme', ...IDEA_TYPES];

const LAYOUT_THEME_LINKS_PER_THEME = 28;
const LAYOUT_THEME_LINKS_GLOBAL_MAX = 520;
const LAYOUT_AUTHOR_LINKS_PER_AUTHOR = 8;
const LAYOUT_AUTHOR_LINKS_GLOBAL_MAX = 360;

// Edge-type hues, mirrored from the legacy renderer so the legend stays valid.
export const EDGE_TYPE_COLORS: Record<string, string> = {
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
  contains: '#3f3f46',
};

export interface GraphFilters {
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

export interface NodeModel {
  id: string;
  label: string;
  type: GraphNodeType;
  createdAt?: string | null;
  workCount: number;
  degree: number;
  /** 0..1 importance used to drive semantic-zoom label reveal order. */
  labelRank: number;
  size: number;
  read: boolean;
  /** Explicit render colour. When set (e.g. per-theme in the constellation) it
   *  overrides the type-based palette the renderer would otherwise apply. */
  color?: string;
}

export interface EdgeModel {
  id: string;
  source: string;
  target: string;
  type: string;
  basis: string;
  confidence: number;
  /** True when the edge participates in the physics layout (thinned set). */
  layoutEdge: boolean;
}

export interface GraphModel {
  nodes: NodeModel[];
  edges: EdgeModel[];
}

export function stableUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function themeNodeSize(workCount: number): number {
  return 22 + Math.min(12, Math.sqrt(Math.max(0, workCount)) * 2.55);
}
export function ideaNodeSize(degree: number): number {
  return 11 + Math.min(12, Math.sqrt(Math.max(0, degree)) * 2.75);
}
export function authorNodeSize(workCount: number, degree: number): number {
  return 10 + Math.min(10, Math.sqrt(Math.max(0, workCount)) * 1.35 + Math.sqrt(Math.max(0, degree)) * 0.95);
}
export function graphNodeSize(node: GraphData['nodes'][number], degree: number): number {
  if (node.type === 'theme') return themeNodeSize(node.workCount);
  if (node.type === 'author') return authorNodeSize(node.workCount, degree);
  return ideaNodeSize(degree);
}

function nodeLabelScore(node: GraphData['nodes'][number], degree: number): number {
  const workCount = Number(node.workCount ?? 0);
  const confidence = Number(node.maxConfidence ?? 0);
  if (node.type === 'theme') return 1000 + workCount * 10 + degree * 12;
  if (node.type === 'author') return degree * 12 + workCount * 4 + confidence * 2;
  return degree * 14 + workCount * 3 + confidence * 6;
}

function themeEdgeScore(edge: GraphData['edges'][number]): number {
  return (edge.basis === 'explicit' ? 2 : 0) + edge.confidence;
}

/**
 * Keep only the single strongest theme→idea "contains" edge per idea, plus all
 * semantic (non-contains) edges. This keeps every idea attached to one hub
 * without drowning the graph in structural links.
 */
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
    list.sort((a, b) => themeEdgeScore(b) - themeEdgeScore(a) || stableUnit(a.id) - stableUnit(b.id));
    const localLimit = Math.min(LAYOUT_THEME_LINKS_PER_THEME, Math.max(8, Math.round(8 + Math.sqrt(list.length) * 2.2)));
    candidates.push(...list.slice(0, localLimit));
  }
  const globalLimit = Math.min(LAYOUT_THEME_LINKS_GLOBAL_MAX, Math.max(180, Math.round(Math.sqrt(Math.max(1, nodeCount)) * 24)));
  candidates.sort((a, b) => themeEdgeScore(b) - themeEdgeScore(a) || stableUnit(a.id) - stableUnit(b.id));
  for (const edge of candidates.slice(0, globalLimit)) physical.add(edge.id);
  return physical;
}

/**
 * The renderer-agnostic counterpart of GraphView's `elements` memo. Pure: same
 * inputs always produce the same model, so it is safe to call from a memo.
 */
export function buildGraphModel(
  data: GraphData,
  filters: GraphFilters,
  lens: GraphLens,
  preset: GraphPresetId,
  revealedNodeIds: ReadonlySet<string> = new Set()
): GraphModel {
  const f = filters;
  const q = f.search.toLowerCase();
  const nodeMatchesFilters = (n: GraphData['nodes'][number], includeSearch: boolean) => {
    if (lens === 'ideas' && !f.nodeTypes.includes(n.type)) return false;
    if (lens === 'ideas' && f.theme && !n.themes.includes(f.theme)) return false;
    if (f.workIds.length > 0 && !(n.workIds ?? []).some((id) => f.workIds.includes(id))) return false;
    if (f.readState === 'read' && !n.read) return false;
    if (f.readState === 'unread' && n.read) return false;
    if (f.minConfidence > 0 && n.maxConfidence < f.minConfidence) return false;
    if (f.authors.length && !n.authors.some((a) => f.authors.includes(a))) return false;
    if (f.yearMin != null && !n.years.some((y) => y >= f.yearMin!)) return false;
    if (f.yearMax != null && !n.years.some((y) => y <= f.yearMax!)) return false;
    if (includeSearch && q && !(n.label.toLowerCase().includes(q) || (n.statement ?? '').toLowerCase().includes(q) || n.authors.some((a) => a.toLowerCase().includes(q)))) {
      return false;
    }
    return true;
  };

  // Text search initially shows only matching ideas. A deliberate click on one
  // of those ideas may reveal its local connections, but all other filters stay
  // authoritative: search becomes the only condition relaxed for that context.
  let visibleNodes = data.nodes.filter((node) => nodeMatchesFilters(node, true));
  const contextEligibleNodeIds = new Set(
    data.nodes
      .filter((node) => nodeMatchesFilters(node, false))
      .map((node) => node.id)
  );
  let nodeIds = new Set(visibleNodes.map((n) => n.id));
  const eligibleEdges = data.edges.filter((edge) => {
    if (!contextEligibleNodeIds.has(edge.source) || !contextEligibleNodeIds.has(edge.target)) return false;
    if (lens === 'ideas' && !f.edgeTypes.includes(edge.type)) return false;
    if (f.minConfidence > 0 && edge.confidence < f.minConfidence) return false;
    if (lens === 'ideas' && f.basis === 'explicit' && edge.basis !== 'explicit') return false;
    return true;
  });

  const revealedEdges = q && revealedNodeIds.size > 0
    ? eligibleEdges.filter((edge) => revealedNodeIds.has(edge.source) || revealedNodeIds.has(edge.target))
    : [];

  if (revealedEdges.length > 0) {
    for (const edge of revealedEdges) {
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }
    visibleNodes = data.nodes.filter((node) => nodeIds.has(node.id));
  }

  const primaryVisibleEdges = primaryThemeEdges(eligibleEdges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)));
  const primaryVisibleEdgeIds = new Set(primaryVisibleEdges.map((edge) => edge.id));
  let visibleEdges = [
    ...primaryVisibleEdges,
    // The default view collapses redundant theme membership links. A manually
    // revealed idea is an explicit request for its full local neighbourhood, so
    // retain every direct edge that passed the active non-text filters.
    ...revealedEdges.filter((edge) => !primaryVisibleEdgeIds.has(edge.id)),
  ];

  if (lens === 'ideas' && preset === 'contradictions') {
    const contradictionNodeIds = new Set<string>();
    for (const edge of visibleEdges) {
      if (edge.type !== 'contradicts' && edge.type !== 'refutes') continue;
      contradictionNodeIds.add(edge.source);
      contradictionNodeIds.add(edge.target);
    }
    const contextualNodeIds = new Set(contradictionNodeIds);
    for (const edge of visibleEdges) {
      if (edge.type !== 'contains') continue;
      if (contradictionNodeIds.has(edge.source) || contradictionNodeIds.has(edge.target)) {
        contextualNodeIds.add(edge.source);
        contextualNodeIds.add(edge.target);
      }
    }
    visibleNodes = visibleNodes.filter((node) => contextualNodeIds.has(node.id));
    nodeIds = new Set(visibleNodes.map((n) => n.id));
    visibleEdges = primaryThemeEdges(visibleEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)));
  }

  const visibleNodeById = new Map(visibleNodes.map((node) => [node.id, node]));
  const physicalEdges = physicalEdgeIds(visibleEdges, visibleNodes.length, lens);

  const degreeById = new Map<string, number>();
  for (const node of visibleNodes) degreeById.set(node.id, 0);
  for (const edge of visibleEdges) {
    degreeById.set(edge.source, (degreeById.get(edge.source) ?? 0) + 1);
    degreeById.set(edge.target, (degreeById.get(edge.target) ?? 0) + 1);
  }

  const rankedNodes = visibleNodes
    .filter((node) => node.type !== 'theme')
    .map((node) => ({ id: node.id, score: nodeLabelScore(node, degreeById.get(node.id) ?? 0) }))
    .sort((a, b) => b.score - a.score);
  const labelRankById = new Map<string, number>();
  rankedNodes.forEach((node, index) => {
    const rank = rankedNodes.length <= 1 ? 1 : 1 - index / (rankedNodes.length - 1);
    labelRankById.set(node.id, rank);
  });

  const nodes: NodeModel[] = visibleNodes.map((n) => {
    const degree = degreeById.get(n.id) ?? 0;
    const source = visibleNodeById.get(n.id)!;
    return {
      id: n.id,
      label: n.label,
      type: n.type,
      createdAt: n.createdAt,
      workCount: n.workCount,
      degree,
      labelRank: n.type === 'theme' ? 1.2 : labelRankById.get(n.id) ?? 0,
      size: graphNodeSize(source, degree),
      read: n.read,
    };
  });

  const edges: EdgeModel[] = visibleEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: e.type,
    basis: e.basis,
    confidence: e.confidence,
    layoutEdge: physicalEdges.has(e.id),
  }));

  return { nodes, edges };
}

// ── Semantic-zoom levels ─────────────────────────────────────────────────────
// The graph opens on a legible overview (one node per theme) instead of dumping
// every idea into a single hairball. Drilling into a theme reveals the backbone
// of its most-connected ideas, and clicking an idea opens its local neighbourhood
// (handled by the existing focus machinery). These two pure builders produce the
// GraphModel for the first two levels; both are deterministic and side-effect free.

/** 14 distinguishable hues for theme nodes; legible on light and dark grounds. */
export const THEME_CONSTELLATION_PALETTE = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6',
  '#14b8a6', '#f97316', '#84cc16', '#06b6d4', '#a855f7', '#eab308', '#64748b',
];

export function themeConstellationSize(memberCount: number): number {
  // Gentle sqrt curve: the cap only guards against absurd outliers, so even the
  // busiest themes still differ in size instead of all saturating at the maximum.
  return 20 + Math.min(70, Math.sqrt(Math.max(0, memberCount)) * 1.4);
}

/**
 * Level 1 — the corpus as a constellation of themes. Each theme becomes one node
 * sized by how many ideas it holds and coloured from a categorical palette; a
 * light edge joins two themes weighted by how many idea↔idea relations cross
 * between them (using each idea's primary theme). No idea nodes are emitted.
 */
export function buildThemeConstellation(data: GraphData): GraphModel {
  const themeNodes = data.nodes.filter((n) => n.type === 'theme');
  const labelToId = new Map<string, string>();
  for (const theme of themeNodes) labelToId.set(theme.label, theme.id);

  // Membership + a single primary theme per idea (first listed) for edge crossing.
  const memberCount = new Map<string, number>(); // theme label → idea count
  const primaryTheme = new Map<string, string>(); // idea id → theme label
  const ideaIds = new Set<string>();
  for (const node of data.nodes) {
    if (node.type === 'theme') continue;
    ideaIds.add(node.id);
    const themes = node.themes ?? [];
    if (themes.length) primaryTheme.set(node.id, themes[0]);
    for (const label of themes) memberCount.set(label, (memberCount.get(label) ?? 0) + 1);
  }

  const pairWeight = new Map<string, number>();
  for (const edge of data.edges) {
    if (edge.type === 'contains') continue;
    if (!ideaIds.has(edge.source) || !ideaIds.has(edge.target)) continue;
    const a = primaryTheme.get(edge.source);
    const b = primaryTheme.get(edge.target);
    if (!a || !b || a === b) continue;
    const ida = labelToId.get(a);
    const idb = labelToId.get(b);
    if (!ida || !idb) continue;
    const key = ida < idb ? `${ida} ${idb}` : `${idb} ${ida}`;
    pairWeight.set(key, (pairWeight.get(key) ?? 0) + 1);
  }
  const maxWeight = Math.max(1, ...pairWeight.values());

  const nodes: NodeModel[] = themeNodes.map((theme, index) => {
    const count = memberCount.get(theme.label) ?? theme.workCount ?? 0;
    return {
      id: theme.id,
      label: theme.label,
      type: 'theme',
      createdAt: theme.createdAt,
      workCount: count,
      degree: count,
      labelRank: 1.2,
      size: themeConstellationSize(count),
      read: true,
      color: THEME_CONSTELLATION_PALETTE[index % THEME_CONSTELLATION_PALETTE.length],
    };
  });

  const edges: EdgeModel[] = [];
  for (const [key, weight] of pairWeight) {
    const [source, target] = key.split(' ');
    edges.push({
      id: `themelink ${key}`,
      source,
      target,
      type: 'related',
      basis: 'inferred',
      confidence: clampUnit(weight / maxWeight),
      layoutEdge: true,
    });
  }
  return { nodes, edges };
}

function largestComponent(ids: Set<string>, adjacency: Map<string, Set<string>>): Set<string> {
  const seen = new Set<string>();
  let best = new Set<string>();
  for (const start of ids) {
    if (seen.has(start)) continue;
    const component = new Set<string>();
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const current = queue.pop()!;
      component.add(current);
      for (const other of adjacency.get(current) ?? []) {
        if (ids.has(other) && !seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
    if (component.size > best.size) best = component;
  }
  return best;
}

/**
 * Level 2 — the backbone of one theme. Keeps that theme's most-connected ideas
 * (capped, largest connected component) with the semantic edges between them, so
 * relations are actually visible instead of buried under thousands of nodes.
 */
export function buildThemeBackbone(data: GraphData, themeLabel: string, cap = 90): GraphModel {
  const memberById = new Map<string, GraphData['nodes'][number]>();
  for (const node of data.nodes) {
    if (node.type === 'theme') continue;
    if ((node.themes ?? []).includes(themeLabel)) memberById.set(node.id, node);
  }
  const memberIds = new Set(memberById.keys());

  // Undirected adjacency + one representative semantic edge per member pair.
  const adjacency = new Map<string, Set<string>>();
  const edgeByPair = new Map<string, GraphData['edges'][number]>();
  for (const id of memberIds) adjacency.set(id, new Set());
  for (const edge of data.edges) {
    if (edge.type === 'contains') continue;
    if (edge.source === edge.target) continue;
    if (!memberIds.has(edge.source) || !memberIds.has(edge.target)) continue;
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
    const key = edge.source < edge.target ? `${edge.source} ${edge.target}` : `${edge.target} ${edge.source}`;
    const existing = edgeByPair.get(key);
    if (!existing || edge.confidence > existing.confidence) edgeByPair.set(key, edge);
  }

  // Largest connected component, then the top-`cap` by degree within it, then the
  // largest component again so the retained core stays cohesive.
  const connectedIds = new Set([...memberIds].filter((id) => (adjacency.get(id)?.size ?? 0) > 0));
  let core = largestComponent(connectedIds.size ? connectedIds : memberIds, adjacency);
  if (core.size === 0) core = new Set([...memberIds].slice(0, cap));

  const degreeIn = (id: string, within: Set<string>) => {
    let d = 0;
    for (const other of adjacency.get(id) ?? []) if (within.has(other)) d++;
    return d;
  };
  let kept = core;
  if (core.size > cap) {
    kept = new Set([...core].sort((a, b) => degreeIn(b, core) - degreeIn(a, core)).slice(0, cap));
    const trimmed = largestComponent(kept, adjacency);
    if (trimmed.size > 1) kept = trimmed;
  }

  const degreeById = new Map<string, number>();
  for (const id of kept) degreeById.set(id, degreeIn(id, kept));

  const ranked = [...kept].sort((a, b) => (degreeById.get(b) ?? 0) - (degreeById.get(a) ?? 0));
  const labelRankById = new Map<string, number>();
  ranked.forEach((id, index) => {
    labelRankById.set(id, ranked.length <= 1 ? 1 : 1 - index / (ranked.length - 1));
  });

  const nodes: NodeModel[] = [...kept].map((id) => {
    const node = memberById.get(id)!;
    const degree = degreeById.get(id) ?? 0;
    return {
      id,
      label: node.label,
      type: node.type,
      createdAt: node.createdAt,
      workCount: node.workCount,
      degree,
      labelRank: labelRankById.get(id) ?? 0,
      size: ideaNodeSize(degree),
      read: node.read,
    };
  });

  const edges: EdgeModel[] = [];
  for (const [key, edge] of edgeByPair) {
    const [source, target] = key.split(' ');
    if (!kept.has(source) || !kept.has(target)) continue;
    edges.push({
      id: edge.id,
      source,
      target,
      type: edge.type,
      basis: edge.basis,
      confidence: edge.confidence,
      layoutEdge: true,
    });
  }
  return { nodes, edges };
}

export { clampUnit };
