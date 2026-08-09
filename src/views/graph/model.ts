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
  /** Primary semantic territory used by the renderer's knowledge-atlas layer. */
  group?: string;
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
  /** A cross-theme neighbour of the current theme's core: an idea that lives in
   *  another theme but connects into this one. Rendered as a small context
   *  satellite and clickable to jump to its theme. */
  bridge?: boolean;
  /** For a bridge node, the label of the theme to jump to when it is clicked. */
  bridgeTheme?: string;
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
      group: n.type === 'theme' ? n.label : n.themes[0],
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

// Theme *nodes* carry an uppercased display label (graphService), while an idea's
// `themes` keeps the original case. Match membership on a normalized key so the
// two always line up — otherwise a drilled theme finds no ideas and the graph
// comes up empty. Also collapses stray whitespace for robustness.
function normalizeThemeKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Level 1 — the corpus as a constellation of themes. Each theme becomes one node
 * sized by how many ideas it holds and coloured from a categorical palette; a
 * light edge joins two themes weighted by how many idea↔idea relations cross
 * between them (using each idea's primary theme). No idea nodes are emitted.
 */
export function buildThemeConstellation(data: GraphData): GraphModel {
  const themeNodes = data.nodes.filter((n) => n.type === 'theme');
  const themeIds = new Set(themeNodes.map((node) => node.id));
  const labelToId = new Map<string, string>(); // normalized theme label → theme node id
  for (const theme of themeNodes) labelToId.set(normalizeThemeKey(theme.label), theme.id);

  // Membership + a single primary theme per idea (first listed) for edge crossing.
  // All keyed on the normalized label so uppercased theme nodes still match.
  const memberCount = new Map<string, number>(); // normalized label → idea count
  const primaryTheme = new Map<string, string>(); // idea id → theme node id
  const ideaIds = new Set<string>();
  for (const node of data.nodes) {
    if (node.type === 'theme') continue;
    ideaIds.add(node.id);
    const themes = node.themes ?? [];
    if (themes.length) {
      const primaryId = labelToId.get(normalizeThemeKey(themes[0]));
      if (primaryId) primaryTheme.set(node.id, primaryId);
    }
    for (const label of themes) {
      const key = normalizeThemeKey(label);
      memberCount.set(key, (memberCount.get(key) ?? 0) + 1);
    }
  }

  const pairWeight = new Map<string, number>();
  for (const edge of data.edges) {
    if (edge.type === 'contains') continue;
    if (!ideaIds.has(edge.source) || !ideaIds.has(edge.target)) continue;
    const a = primaryTheme.get(edge.source); // already a theme node id
    const b = primaryTheme.get(edge.target);
    if (!a || !b || a === b) continue;
    const key = a < b ? `${a} ${b}` : `${b} ${a}`;
    pairWeight.set(key, (pairWeight.get(key) ?? 0) + 1);
  }
  const maxWeight = Math.max(1, ...pairWeight.values());

  const nodes: NodeModel[] = themeNodes.map((theme, index) => {
    const count = memberCount.get(normalizeThemeKey(theme.label)) ?? theme.workCount ?? 0;
    return {
      id: theme.id,
      label: theme.label,
      type: 'theme',
      group: theme.label,
      createdAt: theme.createdAt,
      workCount: count,
      degree: count,
      labelRank: 1.2,
      size: themeConstellationSize(count),
      read: true,
      color: THEME_CONSTELLATION_PALETTE[index % THEME_CONSTELLATION_PALETTE.length],
    };
  });

  // The progressive overview endpoint already returns aggregated theme↔theme
  // edges. Preserve them directly instead of trying to reconstruct them from
  // idea nodes that were intentionally omitted from the compact payload.
  const directThemeEdges = data.edges.filter(
    (edge) => themeIds.has(edge.source) && themeIds.has(edge.target)
  );
  if (directThemeEdges.length) {
    return {
      nodes,
      edges: directThemeEdges.map((edge) => ({ ...edge, layoutEdge: true })),
    };
  }

  const edges: EdgeModel[] = [];
  for (const [key, weight] of pairWeight) {
    const [source, target] = key.split(' ');
    edges.push({
      id: `themelink ${key}`,
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

// ── Compact atlas scenes for the graph presets ───────────────────────────────
// The presets used to feed their filtered *complete* graph to Sigma. That kept
// the WebGL renderer fast, but visually they fell back to the old hairball: no
// hierarchy, no bounded scene and no thematic geography. These builders retain
// the precise preset filters while selecting a representative, deterministic
// scene that the atlas renderer can settle and frame in one pass.

const IDEA_ATLAS_GLOBAL_CAP = 126;
const GAP_ATLAS_GLOBAL_CAP = 112;
const AUTHOR_ATLAS_CAP = 144;
const AUTHOR_ATLAS_MAX_TERRITORIES = 8;

function atlasThemeColorMap(data: GraphData): Map<string, string> {
  const colors = new Map<string, string>();
  let index = 0;
  for (const node of data.nodes) {
    if (node.type !== 'theme') continue;
    colors.set(normalizeThemeKey(node.label), THEME_CONSTELLATION_PALETTE[index % THEME_CONSTELLATION_PALETTE.length]);
    index++;
  }
  return colors;
}

function syntheticThemeId(group: string): string {
  return `atlas-theme:${Math.round(stableUnit(group) * 1_000_000_000)}`;
}

function buildIdeaPresetAtlas(
  data: GraphData,
  base: GraphModel,
  preset: Extract<GraphPresetId, 'gaps' | 'reading' | 'unread'>
): GraphModel {
  const candidates = base.nodes.filter((node) => node.type !== 'theme');
  if (candidates.length === 0) return { nodes: [], edges: [] };

  const byGroup = new Map<string, NodeModel[]>();
  for (const node of candidates) {
    const group = node.group?.trim() || '∅';
    const bucket = byGroup.get(group) ?? [];
    bucket.push(node);
    byGroup.set(group, bucket);
  }

  const groupEntries = [...byGroup.entries()].sort((a, b) =>
    b[1].length - a[1].length || a[0].localeCompare(b[0])
  );
  const globalCap = preset === 'gaps' ? GAP_ATLAS_GLOBAL_CAP : IDEA_ATLAS_GLOBAL_CAP;
  const perGroupCap = preset === 'gaps' ? 8 : 9;
  const selected: NodeModel[] = [];
  const totalByGroup = new Map<string, number>();

  for (const [group, nodes] of groupEntries) {
    totalByGroup.set(group, nodes.length);
    nodes.sort((a, b) => {
      if (preset === 'gaps') {
        // Sparse, unread and low-confidence-peripheral ideas are the places where
        // the corpus has the least connective tissue — the useful gap signal the
        // legacy preset was trying to expose with edge filters alone.
        return a.degree - b.degree || Number(a.read) - Number(b.read)
          || b.labelRank - a.labelRank || a.label.localeCompare(b.label);
      }
      // Reading atlases lead with the ideas that best connect their territory.
      return b.degree - a.degree || b.workCount - a.workCount
        || b.labelRank - a.labelRank || a.label.localeCompare(b.label);
    });
    const room = Math.max(0, globalCap - selected.length);
    if (room === 0) break;
    selected.push(...nodes.slice(0, Math.min(perGroupCap, room)));
  }

  const selectedIds = new Set(selected.map((node) => node.id));
  const selectedGroups = new Set(selected.map((node) => node.group?.trim() || '∅'));
  const themeByKey = new Map(
    data.nodes
      .filter((node) => node.type === 'theme')
      .map((node) => [normalizeThemeKey(node.label), node] as const)
  );
  const colorByTheme = atlasThemeColorMap(data);
  const themeIdByGroup = new Map<string, string>();
  const themeNodes: NodeModel[] = [];

  for (const group of selectedGroups) {
    const source = group === '∅' ? undefined : themeByKey.get(normalizeThemeKey(group));
    const id = source?.id ?? syntheticThemeId(group);
    themeIdByGroup.set(group, id);
    const total = totalByGroup.get(group) ?? 0;
    themeNodes.push({
      id,
      label: source?.label ?? '∅',
      type: 'theme',
      group,
      createdAt: source?.createdAt,
      workCount: total,
      degree: total,
      labelRank: 1.2,
      size: themeConstellationSize(total),
      read: preset !== 'unread',
      color: colorByTheme.get(normalizeThemeKey(group))
        ?? THEME_CONSTELLATION_PALETTE[themeNodes.length % THEME_CONSTELLATION_PALETTE.length],
    });
  }

  const rankedSelected = [...selected].sort((a, b) => {
    if (preset === 'gaps') return a.degree - b.degree || a.label.localeCompare(b.label);
    return b.degree - a.degree || a.label.localeCompare(b.label);
  });
  const selectedNodes = rankedSelected.map((node, index) => ({
    ...node,
    size: Math.max(9, Math.min(18, node.size)),
    labelRank: rankedSelected.length <= 1 ? 1 : 1 - index / (rankedSelected.length - 1),
  }));

  const semanticEdges = base.edges
    .filter((edge) => edge.type !== 'contains' && selectedIds.has(edge.source) && selectedIds.has(edge.target))
    .sort((a, b) => Number(b.layoutEdge) - Number(a.layoutEdge) || b.confidence - a.confidence)
    .slice(0, 260)
    .map((edge) => ({ ...edge, layoutEdge: true }));
  const membershipEdges: EdgeModel[] = selectedNodes.flatMap((node) => {
    const group = node.group?.trim() || '∅';
    const source = themeIdByGroup.get(group);
    if (!source) return [];
    return [{
      id: `atlas-membership:${source}:${node.id}`,
      source,
      target: node.id,
      type: 'contains',
      basis: 'inferred',
      confidence: 0.72,
      layoutEdge: true,
    }];
  });

  return { nodes: [...themeNodes, ...selectedNodes], edges: [...membershipEdges, ...semanticEdges] };
}

function buildAuthorPresetAtlas(base: GraphModel): GraphModel {
  const ranked = base.nodes
    .filter((node) => node.type === 'author')
    .sort((a, b) => b.degree - a.degree || b.workCount - a.workCount || a.label.localeCompare(b.label))
    .slice(0, AUTHOR_ATLAS_CAP);
  if (ranked.length === 0) return { nodes: [], edges: [] };

  const kept = new Set(ranked.map((node) => node.id));
  const edges = base.edges
    .filter((edge) => kept.has(edge.source) && kept.has(edge.target))
    .sort((a, b) => b.confidence - a.confidence || stableUnit(a.id) - stableUnit(b.id))
    .slice(0, 120)
    .map((edge) => ({ ...edge, layoutEdge: true }));

  // Small deterministic label propagation gives the author lens real visual
  // territories without importing another clustering runtime into the renderer.
  const adjacency = new Map<string, Array<{ id: string; weight: number }>>();
  for (const node of ranked) adjacency.set(node.id, []);
  for (const edge of edges) {
    const weight = Math.max(0.05, edge.confidence);
    adjacency.get(edge.source)?.push({ id: edge.target, weight });
    adjacency.get(edge.target)?.push({ id: edge.source, weight });
  }
  const labels = new Map(ranked.map((node) => [node.id, node.id]));
  const ids = ranked.map((node) => node.id).sort();
  for (let iteration = 0; iteration < 8; iteration++) {
    let changed = false;
    for (const id of ids) {
      const scores = new Map<string, number>();
      for (const neighbor of adjacency.get(id) ?? []) {
        const label = labels.get(neighbor.id) ?? neighbor.id;
        scores.set(label, (scores.get(label) ?? 0) + neighbor.weight);
      }
      let best = labels.get(id) ?? id;
      let bestScore = -1;
      for (const [label, score] of [...scores].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (score > bestScore) {
          best = label;
          bestScore = score;
        }
      }
      if (best !== labels.get(id)) {
        labels.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const membersByLabel = new Map<string, string[]>();
  for (const id of ids) {
    const label = labels.get(id) ?? id;
    const members = membersByLabel.get(label) ?? [];
    members.push(id);
    membersByLabel.set(label, members);
  }
  const communities = [...membersByLabel.entries()].sort((a, b) =>
    b[1].length - a[1].length || a[0].localeCompare(b[0])
  );
  const retainedLabels = new Set(communities.slice(0, AUTHOR_ATLAS_MAX_TERRITORIES - 1).map(([label]) => label));
  const territoryById = new Map<string, string>();
  for (const [label, members] of communities) {
    const territory = retainedLabels.has(label) ? `author-network:${label}` : 'author-network:periphery';
    for (const id of members) territoryById.set(id, territory);
  }
  const territories = [...new Set(territoryById.values())].sort();
  const colorByTerritory = new Map(territories.map((territory, index) => [
    territory,
    THEME_CONSTELLATION_PALETTE[index % THEME_CONSTELLATION_PALETTE.length],
  ]));
  const degreeById = new Map(ranked.map((node) => [node.id, 0]));
  for (const edge of edges) {
    degreeById.set(edge.source, (degreeById.get(edge.source) ?? 0) + 1);
    degreeById.set(edge.target, (degreeById.get(edge.target) ?? 0) + 1);
  }

  const nodes = ranked.map((node, index) => {
    const territory = territoryById.get(node.id) ?? 'author-network:periphery';
    const degree = degreeById.get(node.id) ?? 0;
    return {
      ...node,
      group: territory,
      color: colorByTerritory.get(territory),
      degree,
      size: authorNodeSize(node.workCount, degree),
      labelRank: ranked.length <= 1 ? 1 : 1 - index / (ranked.length - 1),
    };
  });
  const territoryIndex = new Map(territories.map((territory, index) => [territory, index]));
  const hubByTerritory = new Map<string, string>();
  const hubNodes: NodeModel[] = territories.map((territory, index) => {
    const memberCount = nodes.filter((node) => node.group === territory).length;
    const id = `author-territory:${index}`;
    hubByTerritory.set(territory, id);
    return {
      id,
      label: `C${index + 1}`,
      type: 'theme',
      group: territory,
      createdAt: null,
      workCount: memberCount,
      degree: memberCount,
      labelRank: 1.2,
      size: themeConstellationSize(memberCount),
      read: true,
      color: colorByTerritory.get(territory),
    };
  });
  const membershipEdges: EdgeModel[] = nodes.map((node) => {
    const territory = node.group ?? 'author-network:periphery';
    const hub = hubByTerritory.get(territory) ?? `author-territory:${territoryIndex.get(territory) ?? 0}`;
    return {
      id: `author-membership:${hub}:${node.id}`,
      source: hub,
      target: node.id,
      type: 'contains',
      basis: 'inferred',
      confidence: 0.78,
      layoutEdge: true,
    };
  });
  return { nodes: [...hubNodes, ...nodes], edges: [...membershipEdges, ...edges] };
}

/** Build the compact semantic scene for a non-overview graph preset. */
export function buildPresetAtlas(
  data: GraphData,
  filters: GraphFilters,
  lens: GraphLens,
  preset: GraphPresetId
): GraphModel | null {
  if (preset !== 'gaps' && preset !== 'reading' && preset !== 'unread' && preset !== 'authors') return null;
  const base = buildGraphModel(data, filters, lens, preset);
  if (preset === 'authors') return buildAuthorPresetAtlas(base);
  return buildIdeaPresetAtlas(data, base, preset);
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
  const wanted = normalizeThemeKey(themeLabel);
  const memberById = new Map<string, GraphData['nodes'][number]>();
  for (const node of data.nodes) {
    if (node.type === 'theme') continue;
    if ((node.themes ?? []).some((l) => normalizeThemeKey(l) === wanted)) memberById.set(node.id, node);
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
    const key = edge.source < edge.target ? `${edge.source} ${edge.target}` : `${edge.target} ${edge.source}`;
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
      group: themeLabel,
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
    const [source, target] = key.split(' ');
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

  // ── Cross-theme bridges ─────────────────────────────────────────────────────
  // Ideas from OTHER themes that connect into this theme's core. Without them a
  // theme view silos its ideas and hides interdisciplinary links. We keep a
  // bounded set (the most-connected) as small satellites coloured by their own
  // theme; the renderer reveals a focused idea's bridges and lets a click jump to
  // that theme. Skipped for very large "show all" cores to stay economical.
  const BRIDGE_CAP = 60;
  if (kept.size > 0 && kept.size <= 250) {
    const themeColorByKey = new Map<string, string>();
    let ti = 0;
    for (const node of data.nodes) {
      if (node.type !== 'theme') continue;
      themeColorByKey.set(normalizeThemeKey(node.label), THEME_CONSTELLATION_PALETTE[ti % THEME_CONSTELLATION_PALETTE.length]);
      ti++;
    }
    const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
    const bridgeStat = new Map<string, { count: number; conf: number }>();
    for (const edge of data.edges) {
      if (edge.type === 'contains' || edge.source === edge.target) continue;
      for (const [inCore, other] of [[edge.source, edge.target], [edge.target, edge.source]] as const) {
        if (!kept.has(inCore) || kept.has(other)) continue;
        const on = nodeById.get(other);
        if (!on || on.type === 'theme') continue;
        if ((on.themes ?? []).some((l) => normalizeThemeKey(l) === wanted)) continue; // shares this theme → not a bridge
        const s = bridgeStat.get(other) ?? { count: 0, conf: 0 };
        s.count += 1;
        s.conf = Math.max(s.conf, edge.confidence);
        bridgeStat.set(other, s);
      }
    }
    const bridgeIds = [...bridgeStat.entries()]
      .sort((a, b) => b[1].count - a[1].count || b[1].conf - a[1].conf)
      .slice(0, BRIDGE_CAP)
      .map(([id]) => id);
    const bridgeSet = new Set(bridgeIds);

    for (const id of bridgeIds) {
      const node = nodeById.get(id)!;
      const firstTheme = (node.themes ?? [])[0];
      nodes.push({
        id,
        label: node.label,
        type: node.type,
        group: firstTheme,
        createdAt: node.createdAt,
        workCount: node.workCount,
        degree: bridgeStat.get(id)!.count,
        labelRank: 0,
        size: ideaNodeSize(2) * 0.85,
        read: node.read,
        color: firstTheme ? themeColorByKey.get(normalizeThemeKey(firstTheme)) : undefined,
        bridge: true,
        bridgeTheme: firstTheme,
      });
    }
    // Edges tying the core to its bridges (deduped, and only one endpoint may be a bridge).
    const seenEdge = new Set(edges.map((e) => e.id));
    for (const edge of data.edges) {
      if (edge.type === 'contains' || seenEdge.has(edge.id)) continue;
      const coreA = kept.has(edge.source);
      const coreB = kept.has(edge.target);
      const brA = bridgeSet.has(edge.source);
      const brB = bridgeSet.has(edge.target);
      if ((coreA && brB) || (brA && coreB)) {
        seenEdge.add(edge.id);
        edges.push({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: edge.type,
          basis: edge.basis,
          confidence: edge.confidence,
          layoutEdge: true,
        });
      }
    }
  }

  return { nodes, edges };
}

export { clampUnit };
