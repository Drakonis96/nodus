import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';
// @ts-ignore – no official types for this extension
import coseBilkent from 'cytoscape-cose-bilkent';
import type { AppSettings, GraphData, IdeaType, IdeaDetail, EdgeDetail, GraphNodeType, WorkView, WorkMeta, TutorStop } from '@shared/types';
import { NODE_COLORS, NODE_LABELS, EDGE_LABELS, Badge, Icon } from '../components/ui';
import { useScanComplete } from '../hooks';
import { ThemesModal } from './ThemesModal';
import { TutorPanel } from './TutorPanel';

// Register the cose-bilkent layout extension once.
try { cytoscape.use(coseBilkent); } catch { /* already registered */ }

const IDEA_TYPES: IdeaType[] = ['claim', 'finding', 'construct', 'method', 'framework'];
const GRAPH_NODE_TYPES: Exclude<GraphNodeType, 'author'>[] = ['theme', ...IDEA_TYPES];
const EDGE_TYPES = Object.keys(EDGE_LABELS);
const DEFAULT_LOCAL_GRAPH_DEPTH = 1;

// Force-directed layout via cose-bilkent: produces much cleaner clusters than the
// built-in cose, with automatic edge bundling and better compaction.
const COSE_BILKENT_LAYOUT = {
  name: 'cose-bilkent',
  animate: 'end',
  animationDuration: 600,
  animationEasing: 'ease-in-out-cubic',
  fit: true,
  padding: 60,
  randomize: false,
  nodeRepulsion: 8500,
  idealEdgeLength: 200,
  edgeElasticity: 0.45,
  nestingFactor: 0.1,
  gravity: 0.25,
  numIter: 3000,
  tile: true,
  tilingPaddingVertical: 20,
  tilingPaddingHorizontal: 20,
  gravityRangeCompound: 1.5,
  gravityCompound: 1.0,
  gravityRange: 3.8,
  initialEnergyOnIncremental: 0.8,
} as any;

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
const ZOOM_LABEL_THRESHOLD = 0.3;   // below this, hide all idea labels
const ZOOM_IDEAS_THRESHOLD = 0.65;  // above this, show all idea labels

const LAYOUT_KEY = 'nodus.graph.layout';

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
      const font = type === 'theme' ? 13 : 10;
      const maxWidth = type === 'theme' ? 190 : 150;
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
        nodeBias: type === 'theme' ? 0.28 : 0.5,
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
  authors: [],
  yearMin: null,
  yearMax: null,
  readState: 'all',
  minConfidence: 0,
  basis: 'all',
};

const FILTER_KEY = 'nodus.graph.filters';
const DETAIL_WIDTH_KEY = 'nodus.graph.detailWidth';
const DETAIL_FONT_KEY = 'nodus.graph.detailFontSize';
const LOCAL_GRAPH_DEPTH_KEY = 'nodus.graph.localDepth.v2';

const DETAIL_MIN_WIDTH = 320;
const DETAIL_MAX_WIDTH = 720;
const DETAIL_DEFAULT_WIDTH = 384;
const DETAIL_MIN_FONT = 12;
const DETAIL_MAX_FONT = 20;
const DETAIL_DEFAULT_FONT = 14;

function loadFilters(): Filters {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}') as Partial<Filters>;
    const merged = { ...DEFAULT_FILTERS, ...parsed };
    merged.nodeTypes = Array.from(new Set([...(merged.nodeTypes ?? []), 'theme']));
    merged.edgeTypes = Array.from(new Set([...(merged.edgeTypes ?? []), 'contains']));
    return merged;
  } catch {
    return DEFAULT_FILTERS;
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

function collectLocalGraph(startNode: any, maxDepth: number | null): { primary: any; context: any } {
  const cy = startNode.cy();
  if (startNode.data('type') === 'theme') {
    const memberEdges = startNode.connectedEdges().filter((edge: any) => edge.data('type') === 'contains');
    const members = memberEdges.connectedNodes().filter((node: any) => node.id() !== startNode.id());
    const memberIds = new Set(members.map((node: any) => node.id()));
    const memberLinks = cy.edges().filter((edge: any) => {
      if (edge.data('type') === 'contains') return false;
      const nodes = edge.connectedNodes().toArray();
      return nodes.every((node: any) => memberIds.has(node.id()));
    });
    return { primary: cy.collection(startNode).union(members).union(memberLinks), context: memberEdges };
  }

  const visited = new Set<string>([startNode.id()]);
  let primary = cy.collection(startNode);
  let frontier = [startNode];
  let depth = 0;

  while (frontier.length > 0 && (maxDepth == null || depth < maxDepth)) {
    const next: any[] = [];
    for (const node of frontier) {
      node
        .connectedEdges()
        .filter((edge: any) => edge.data('type') !== 'contains')
        .forEach((edge: any) => {
          const neighbors = edge.connectedNodes().filter((neighbor: any) => neighbor.id() !== node.id() && neighbor.data('type') !== 'theme');
          neighbors.forEach((neighbor: any) => {
            primary = primary.union(edge).union(neighbor);
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

  let context = cy.collection();
  primary.nodes().forEach((node: any) => {
    if (node.data('type') === 'theme') return;
    node.connectedEdges().filter((edge: any) => edge.data('type') === 'contains').forEach((edge: any) => {
      context = context.union(edge).union(edge.connectedNodes().filter((neighbor: any) => neighbor.data('type') === 'theme'));
    });
  });

  return { primary, context };
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

  const m2 = 2 * totalWeight;
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

// Community colors (deterministic from community id).
const COMMUNITY_COLORS = [
  '#6366f1', '#f97316', '#22c55e', '#eab308', '#ec4899',
  '#06b6d4', '#a78bfa', '#f472b6', '#14b8a6', '#ef4444',
  '#8b5cf6', '#3b82f6', '#f59e0b', '#10b981', '#d946ef',
];

export function GraphView({ settings, onSettingsChange }: { settings: AppSettings; onSettingsChange: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const clearFocusRef = useRef<() => void>(() => {});
  const focusNodeByIdRef = useRef<(nodeId: string) => void>(() => {});
  const highlightDepthRef = useRef<number | null>(null);
  const lastUserFocusRef = useRef<string | null>(null);
  const focusByIdRef = useRef<(nodeIds: string[], edgeId?: string | null) => void>(() => {});
  // When the Tutor is driving the camera, a container resize should re-apply this focus
  // instead of fitting the whole graph (the node detail panel opening would steal it).
  const lastTutorFocusRef = useRef<{ nodeIds: string[]; edgeId?: string | null } | null>(null);
  // Track whether the current highlight came from a hover (so tap can override it).
  const hoverActiveRef = useRef(false);
  const [lens, setLens] = useState<'ideas' | 'authors'>('ideas');
  const [themesModalOpen, setThemesModalOpen] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [themes, setThemes] = useState<string[]>([]);
  const [themesLoaded, setThemesLoaded] = useState(false);
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [ideaDetail, setIdeaDetail] = useState<IdeaDetail | null>(null);
  const [edgeDetail, setEdgeDetail] = useState<EdgeDetail | null>(null);
  const [detailWidth, setDetailWidth] = useState(() => loadNumber(DETAIL_WIDTH_KEY, DETAIL_DEFAULT_WIDTH, DETAIL_MIN_WIDTH, DETAIL_MAX_WIDTH));
  const [detailFontSize, setDetailFontSize] = useState(() => loadNumber(DETAIL_FONT_KEY, DETAIL_DEFAULT_FONT, DETAIL_MIN_FONT, DETAIL_MAX_FONT));
  const [highlightDepth, setHighlightDepth] = useState<number | null>(loadHighlightDepth);
  const [layoutMode, setLayoutMode] = useState<'force' | 'radial'>(() => (localStorage.getItem(LAYOUT_KEY) as 'force' | 'radial') || 'force');
  const [communitiesCollapsed, setCommunitiesCollapsed] = useState(false);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const communitiesRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
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

  const elements = useMemo<ElementDefinition[]>(() => {
    const f = filters;
    const q = f.search.toLowerCase();
    const visibleNodes = data.nodes.filter((n) => {
      if (lens === 'ideas' && !f.nodeTypes.includes(n.type)) return false;
      if (f.theme && !n.themes.includes(f.theme)) return false;
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
    const nodeIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = primaryThemeEdges(data.edges.filter((e) => {
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) return false;
      if (lens === 'ideas' && !f.edgeTypes.includes(e.type)) return false;
      if (f.minConfidence > 0 && e.confidence < f.minConfidence) return false;
      if (f.basis === 'explicit' && e.basis !== 'explicit') return false;
      return true;
    }));
    return [
      ...visibleNodes.map((n) => ({
        data: {
          id: n.id,
          label: n.label,
          type: n.type,
          // Degree is computed below after edges are built.
          // Placeholder — will be overwritten once we know the edge count per node.
          _workCount: n.workCount,
          size: n.type === 'theme' ? 38 + Math.min(56, n.workCount * 10) : 20,
          read: n.read,
        },
      })),
      ...visibleEdges.map((e) => ({
        data: { id: e.id, source: e.source, target: e.target, type: e.type, basis: e.basis, confidence: e.confidence },
      })),
    ].map((el: any) => {
      // For idea nodes, compute degree from the visible edges and use it for sizing.
      if (el.data.source) return el; // skip edges
      if (el.data.type === 'theme') return el; // theme size stays workCount-based
      const degree = visibleEdges.filter((e) => e.source === el.data.id || e.target === el.data.id).length;
      el.data.size = 18 + Math.min(48, degree * 5);
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
        style: [
          {
            selector: 'node',
            style: {
              'background-color': (ele: any) =>
                ele.data('type') === 'author' ? '#a3a3a3' : NODE_COLORS[ele.data('type') as Exclude<GraphNodeType, 'author'>] ?? '#888',
              label: 'data(label)',
              color: lightTheme ? '#171717' : '#ededed',
              'font-size': (ele: any) => (ele.data('type') === 'theme' ? 13 : 10),
              'font-weight': (ele: any) => (ele.data('type') === 'theme' ? 700 : 400),
              'text-wrap': 'wrap',
              'text-max-width': '150px',
              'text-valign': 'bottom',
              'text-margin-y': 6,
              'min-zoomed-font-size': 5,
              // Outline keeps labels legible where they cross edges or other nodes.
              'text-outline-width': 2.5,
              'text-outline-color': lightTheme ? '#ffffff' : '#0a0a0a',
              'text-outline-opacity': lightTheme ? 0.95 : 0.9,
              width: 'data(size)',
              height: 'data(size)',
              'border-width': (ele: any) => (ele.data('read') ? 0 : 2),
              'border-color': '#737373',
              'border-style': 'dashed',
              'transition-property': 'opacity, border-width, border-color, overlay-opacity',
              'transition-duration': '0.2s',
              'transition-timing-function': 'ease-in-out',
            } as any,
          },
          // Theme hubs get a soft solid halo so the centre reads as the backbone.
          {
            selector: 'node[type="theme"]',
            style: { 'border-width': 3, 'border-color': '#f9b069', 'border-style': 'solid', 'border-opacity': 0.5 } as any,
          },
          // Community compound nodes (collapsed clusters).
          {
            selector: 'node[type="community"]',
            style: {
              'background-color': 'rgba(99,102,241,0.08)',
              'background-opacity': 1,
              'border-width': 2,
              'border-color': '#6366f1',
              'border-style': 'dashed',
              'border-opacity': 0.4,
              shape: 'round-rectangle',
              'text-valign': 'top',
              'text-margin-y': 8,
              'font-size': 11,
              'font-weight': 700,
              color: '#a5b4fc',
              'text-outline-width': 2,
              'text-outline-color': '#0a0a0a',
              'text-outline-opacity': 0.8,
              padding: 20,
            } as any,
          },
          {
            selector: 'edge',
            style: {
              width: (ele: any) => 0.7 + ele.data('confidence') * 1.4,
              'line-color': (ele: any) => EDGE_TYPE_COLORS[ele.data('type')] ?? '#525252',
              'line-style': (ele: any) => (ele.data('basis') === 'inferred' ? 'dashed' : 'solid'),
              opacity: (ele: any) => 0.14 + ele.data('confidence') * 0.34,
              'target-arrow-shape': 'triangle',
              'target-arrow-color': (ele: any) => EDGE_TYPE_COLORS[ele.data('type')] ?? '#525252',
              'curve-style': 'bezier',
              'transition-property': 'opacity, line-color, width, target-arrow-color',
              'transition-duration': '0.2s',
              'transition-timing-function': 'ease-in-out',
            } as any,
          },
          // Theme→idea "contains" links are structural branches: faint, solid, no arrow.
          {
            selector: 'edge[type="contains"]',
            style: {
              'line-style': 'solid',
              'line-color': '#3f3f46',
              width: 0.8,
              opacity: 0.1,
              'target-arrow-shape': 'none',
            } as any,
          },
          { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#818cf8', 'border-style': 'solid', 'border-opacity': 1 } as any },
          // Semantic zoom: hide labels at low zoom for clarity. These come before
          // focus styles so that focus-node/context-node override them.
          { selector: 'node.zoom-label-hidden', style: { 'text-opacity': 0, 'min-zoomed-font-size': 0 } as any },
          { selector: 'node.zoom-label-mid', style: { 'text-opacity': 0, 'min-zoomed-font-size': 0 } as any },
          // Focus mode: everything not in the tapped traversal fades back.
          { selector: '.faded', style: { opacity: 0.22, 'text-opacity': 0.18 } as any },
          {
            selector: 'node.focus-node',
            style: {
              opacity: 1,
              'text-opacity': 1,
              'border-width': 3,
              'border-color': '#a5b4fc',
              'border-style': 'solid',
              'border-opacity': 0.95,
              'overlay-color': '#818cf8',
              'overlay-opacity': 0.08,
              'overlay-padding': 7,
              'z-index': 20,
            } as any,
          },
          {
            selector: 'edge.focus-edge',
            style: {
              width: (ele: any) => 2.6 + ele.data('confidence') * 3.4,
              'line-color': (ele: any) => EDGE_TYPE_COLORS[ele.data('type')] ?? '#a5b4fc',
              'target-arrow-color': (ele: any) => EDGE_TYPE_COLORS[ele.data('type')] ?? '#a5b4fc',
              opacity: 0.98,
              'z-index': 30,
            } as any,
          },
          {
            selector: 'node.context-node',
            style: {
              opacity: 0.85,
              'text-opacity': 0.85,
              'border-width': 2,
              'border-color': '#f59e0b',
              'border-style': 'solid',
              'border-opacity': 0.55,
              'z-index': 12,
            } as any,
          },
          {
            selector: 'edge.context-edge',
            style: {
              width: 1.2,
              'line-color': '#f59e0b',
              opacity: 0.34,
              'target-arrow-shape': 'none',
              'z-index': 10,
            } as any,
          },
          { selector: 'node.spotlight', style: { 'border-width': 5, 'border-color': '#f8fafc', 'border-style': 'solid', 'border-opacity': 1, 'overlay-opacity': 0.16 } as any },
        ],
        layout: COSE_BILKENT_LAYOUT,
      });

      const removeFocusClasses = () => {
        const cy = cyRef.current!;
        cy.batch(() => {
          cy.elements().removeClass('faded focus-node focus-edge context-node context-edge');
          cy.nodes().removeClass('spotlight');
        });
      };
      const applyFocus = (primary: any, context?: any, spotlightNodes?: any) => {
        const cy = cyRef.current!;
        cy.batch(() => {
          cy.elements().removeClass('focus-node focus-edge context-node context-edge');
          cy.nodes().removeClass('spotlight');
          cy.elements().addClass('faded');
          context?.removeClass('faded');
          context?.nodes().addClass('context-node');
          context?.edges().addClass('context-edge');
          primary.removeClass('faded');
          primary.nodes().addClass('focus-node');
          primary.edges().addClass('focus-edge');
          spotlightNodes?.addClass('spotlight');
        });
      };
      const focusOnNode = (node: any) => {
        const focus = collectLocalGraph(node, highlightDepthRef.current);
        applyFocus(focus.primary, focus.context, node);
      };
      const clearFocus = () => {
        removeFocusClasses();
      };
      clearFocusRef.current = () => {
        lastTutorFocusRef.current = null;
        lastUserFocusRef.current = null;
        clearFocus();
      };
      focusNodeByIdRef.current = (nodeId: string) => {
        const node = cyRef.current?.getElementById(nodeId);
        if (node?.nonempty()) focusOnNode(node);
      };

      // Drive the graph from the Tutor: spotlight the stop's node(s) (and edge when a
      // connection), fade the rest, and smoothly frame them with a slightly wide
      // perspective — close enough to read the node label, wide enough to show its
      // immediate neighbourhood — so the user watches the tour move across the graph.
      focusByIdRef.current = (nodeIds: string[], edgeId?: string | null) => {
        const cy = cyRef.current;
        if (!cy) return;
        lastTutorFocusRef.current = { nodeIds, edgeId };
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
        applyFocus(keep, undefined, targetNodes);
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

      cyRef.current.on('tap', 'node', async (evt) => {
        const node = evt.target;
        lastTutorFocusRef.current = null;
        hoverActiveRef.current = false;
        lastUserFocusRef.current = node.id();
        focusOnNode(node);
        setEdgeDetail(null);
        if (lens === 'ideas' && !node.id().startsWith('theme:')) {
          setIdeaDetail(await window.nodus.getIdeaDetail(node.id()));
        } else {
          setIdeaDetail(null);
        }
      });
      cyRef.current.on('tap', 'edge', async (evt) => {
        const edge = evt.target;
        lastTutorFocusRef.current = null;
        hoverActiveRef.current = false;
        lastUserFocusRef.current = null;
        applyFocus(edge.connectedNodes().add(edge), undefined, edge.connectedNodes());
        setIdeaDetail(null);
        setEdgeDetail(await window.nodus.getEdgeDetail(edge.id()));
      });
      cyRef.current.on('tap', (evt) => {
        if (evt.target === cyRef.current) {
          hoverActiveRef.current = false;
          clearFocus();
          setIdeaDetail(null);
          setEdgeDetail(null);
        }
      });
      // Hover highlight: show the node's neighbourhood while hovering, unless the
      // user has already clicked a node (tap-focus takes priority).
      cyRef.current.on('mouseover', 'node', (evt) => {
        if (lastUserFocusRef.current) return; // tap-focus active → skip hover
        hoverActiveRef.current = true;
        focusOnNode(evt.target);
      });
      cyRef.current.on('mouseout', 'node', () => {
        if (!hoverActiveRef.current) return;
        hoverActiveRef.current = false;
        if (!lastUserFocusRef.current) clearFocus();
      });

      // ── Semantic zoom: progressively reveal labels ─────────────────────────
      // • zoom < ZOOM_LABEL_THRESHOLD → only theme labels (ideas are just dots)
      // • zoom < ZOOM_IDEAS_THRESHOLD → themes + high-degree ideas (top 25%)
      // • zoom ≥ ZOOM_IDEAS_THRESHOLD → everything visible
      const applySemanticZoom = (cy: Core) => {
        const z = cy.zoom();
        cy.batch(() => {
          // Never hide labels on focused / spotlighted / context nodes.
          const protectedNodes = cy.nodes('.focus-node, .spotlight, .context-node');
          const protectedSet = new Set(protectedNodes.map((n: any) => n.id()));
          const ideas = cy.nodes('[type!="theme"]').filter((n: any) => !protectedSet.has(n.id()));
          const themes = cy.nodes('[type="theme"]').filter((n: any) => !protectedSet.has(n.id()));

          if (z < ZOOM_LABEL_THRESHOLD) {
            // Far zoom: hide all idea labels, keep theme labels
            ideas.addClass('zoom-label-hidden');
            ideas.removeClass('zoom-label-mid');
            themes.removeClass('zoom-label-hidden zoom-label-mid');
          } else if (z < ZOOM_IDEAS_THRESHOLD) {
            // Mid zoom: themes always visible, only high-degree ideas shown
            themes.removeClass('zoom-label-hidden zoom-label-mid');
            ideas.removeClass('zoom-label-hidden');
            ideas.addClass('zoom-label-mid');
            // Show top 25% ideas by degree
            if (ideas.length > 0) {
              const degrees = ideas.map((n: any) => n.degree(false)).sort((a: number, b: number) => b - a);
              const cutoff = degrees[Math.max(0, Math.floor(degrees.length * 0.25))] ?? 1;
              ideas.forEach((n: any) => {
                if (n.degree(false) >= cutoff) n.removeClass('zoom-label-mid');
                else n.addClass('zoom-label-mid');
              });
            }
          } else {
            // Close zoom: everything visible
            ideas.removeClass('zoom-label-hidden zoom-label-mid');
            themes.removeClass('zoom-label-hidden zoom-label-mid');
          }
        });
      };
      cyRef.current.on('zoom', () => applySemanticZoom(cyRef.current!));
    }
    const cy = cyRef.current;
    cy.elements().remove();
    cy.add(elements);
    // Reset community state when elements are rebuilt.
    setCommunitiesCollapsed(false);
    // Always frame the whole graph after laying out, so it neither overflows the
    // viewport nor sits as a tiny clump regardless of how cose spread the nodes.
    cy.one('layoutstop', () => cy.fit(undefined, 60));
    // Layout selection: force-directed (cose-bilkent) or deterministic radial.
    if (layoutMode === 'radial') {
      const positions = lens === 'ideas' ? computeRadialPositions(cy) : null;
      if (positions) {
        cy.layout({
          name: 'preset',
          positions,
          fit: true,
          padding: 60,
          animate: true,
          animationDuration: 600,
          animationEasing: 'ease-in-out-cubic',
        } as any).run();
      } else {
        cy.layout({ ...COSE_BILKENT_LAYOUT, animate: false }).run();
      }
    } else {
      cy.layout(COSE_BILKENT_LAYOUT).run();
    }
  }, [elements, lens, layoutMode]);

  // Keep the graph framed when the window or panels resize.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cy = cyRef.current;
      if (!cy || cy.elements().length === 0) return;
      cy.resize();
      const tf = lastTutorFocusRef.current;
      if (tf) { focusByIdRef.current(tf.nodeIds, tf.edgeId); return; }
      // When the user has focused a node (click), preserve the current zoom/pan
      // instead of resetting to fit — the detail panel resize should not steal the view.
      if (lastUserFocusRef.current) return;
      cy.fit(undefined, 48);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };
  const fitGraph = () => cyRef.current?.fit(undefined, 48);
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
    ctx.fillStyle = 'rgba(10,10,10,0.85)';
    ctx.fillRect(0, 0, W, H);

    // Draw edges as faint lines.
    ctx.strokeStyle = 'rgba(100,100,100,0.25)';
    ctx.lineWidth = 0.5;
    cy.edges().forEach((e) => {
      const sp = toMini(e.sourceEndpoint().x, e.sourceEndpoint().y);
      const tp = toMini(e.targetEndpoint().x, e.targetEndpoint().y);
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(tp.x, tp.y);
      ctx.stroke();
    });

    // Draw nodes as colored dots.
    cy.nodes().forEach((n) => {
      if (n.isParent()) return;
      const p = toMini(n.position().x, n.position().y);
      const color = n.data('type') === 'theme'
        ? '#f97316'
        : (NODE_COLORS[n.data('type') as Exclude<GraphNodeType, 'author'>] ?? '#888');
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, n.data('type') === 'theme' ? 3 : 1.8, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw viewport rectangle.
    const ext = cy.extent();
    const tl = toMini(ext.x1, ext.y1);
    const br = toMini(ext.x2, ext.y2);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  }, []);

  // Redraw minimap on every Cytoscape render.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const handler = () => drawMinimap();
    cy.on('render', handler);
    return () => { cy.off('render', handler); };
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
      // Re-layout after expand.
      cy.layout({ ...COSE_BILKENT_LAYOUT, animate: true, animationDuration: 400, randomize: false }).run();
      setCommunitiesCollapsed(false);
    } else {
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
      cy.layout({ ...COSE_BILKENT_LAYOUT, animate: true, animationDuration: 400, randomize: false }).run();
      setCommunitiesCollapsed(true);
    }
  }, [communitiesCollapsed]);

  // Tutor stop → frame the node on the graph and open its info in the right sidebar so
  // it can be read alongside the narration. A sequence token avoids a stale async detail
  // landing after the user has already advanced to the next stop.
  const tutorDetailSeq = useRef(0);
  const showTutorStop = useCallback(async (stop: TutorStop) => {
    focusByIdRef.current(stop.nodeIds, stop.edgeId);
    const seq = ++tutorDetailSeq.current;
    const apply = (idea: IdeaDetail | null, edge: EdgeDetail | null) => {
      if (seq !== tutorDetailSeq.current) return;
      setIdeaDetail(idea);
      setEdgeDetail(edge);
    };
    if (stop.kind === 'connection' && stop.edgeId) {
      apply(null, await window.nodus.getEdgeDetail(stop.edgeId));
      return;
    }
    const ideaId = stop.nodeIds.find((id) => !id.startsWith('theme:'));
    if (ideaId) {
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

  useEffect(() => {
    if (!themesLoaded) return;
    setFilters((f) => (f.theme && !themes.includes(f.theme) ? { ...f, theme: '' } : f));
  }, [themes, themesLoaded]);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Filter bar */}
      <div className="border-b border-neutral-800 p-2 flex flex-wrap gap-2 items-center text-xs">
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
        <input className="input" placeholder="Buscar…" value={filters.search} onChange={(e) => setF({ search: e.target.value })} />
        {lens === 'ideas' && (
          <div className="flex gap-1">
            {GRAPH_NODE_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => toggleIn('nodeTypes', t)}
                className="px-2 py-0.5 rounded flex items-center gap-1"
                style={{
                  backgroundColor: filters.nodeTypes.includes(t) ? NODE_COLORS[t] : '#262626',
                  color: filters.nodeTypes.includes(t) ? 'white' : '#a3a3a3',
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
          <option value="read">Solo leído (profundo)</option>
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
        <button className="btn btn-ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>
          Limpiar filtros
        </button>
        {lens === 'ideas' && (
          <button
            className={`btn border border-neutral-700 gap-1.5 ${communitiesCollapsed ? 'bg-indigo-600 text-white' : 'btn-ghost'}`}
            title={communitiesCollapsed ? 'Expandir comunidades' : 'Colapsar en comunidades (Louvain)'}
            onClick={toggleCommunities}
          >
            <Icon name="layers" /> {communitiesCollapsed ? 'Expandir' : 'Comunidades'}
          </button>
        )}
        {lens === 'ideas' && (
          <button
            className="btn btn-ghost border border-neutral-700 gap-1.5"
            title="Gestionar los temas principales y reprocesar las conexiones de los nodos"
            onClick={() => setThemesModalOpen(true)}
          >
            <Icon name="tag" /> Temas principales
          </button>
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
        <div className="flex-1" />
        <span className="text-neutral-500">{elements.filter((e) => !(e.data as any).source).length} nodos</span>
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
            width={180}
            height={120}
            className="absolute bottom-3 right-3 rounded-lg border border-neutral-700 cursor-pointer opacity-80 hover:opacity-100"
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

        {/* Detail panel */}
        {(ideaDetail || edgeDetail) && (
          <DetailPanel
            ideaDetail={ideaDetail}
            edgeDetail={edgeDetail}
            width={detailWidth}
            fontSize={detailFontSize}
            onWidthChange={setDetailWidth}
            onFontChange={changeDetailFont}
            onClose={() => {
              setIdeaDetail(null);
              setEdgeDetail(null);
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

function loadNumber(key: string, fallback: number, min: number, max: number): number {
  const parsed = Number(localStorage.getItem(key));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function DetailPanel({
  ideaDetail,
  edgeDetail,
  width,
  fontSize,
  onWidthChange,
  onFontChange,
  onClose,
}: {
  ideaDetail: IdeaDetail | null;
  edgeDetail: EdgeDetail | null;
  width: number;
  fontSize: number;
  onWidthChange: (width: number) => void;
  onFontChange: (delta: number) => void;
  onClose: () => void;
}) {
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (evt: PointerEvent) => {
      onWidthChange(Math.min(DETAIL_MAX_WIDTH, Math.max(DETAIL_MIN_WIDTH, startWidth + startX - evt.clientX)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  return (
    <div className="relative shrink-0 border-l border-neutral-800 bg-neutral-900/95 overflow-y-auto p-4 graph-detail-panel" style={{ width, '--detail-font-size': `${fontSize}px` } as React.CSSProperties}>
      <div
        className="absolute left-0 top-0 h-full w-2 -translate-x-1/2 cursor-col-resize hover:bg-indigo-500/25"
        role="separator"
        aria-orientation="vertical"
        title="Ajustar ancho"
        onPointerDown={startResize}
      />
      <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-3 flex items-center justify-end gap-1 border-b border-neutral-800 bg-neutral-900/95 px-4 py-2">
        <button className="card bg-neutral-900 px-2 py-1 hover:bg-neutral-800 text-xs" title="Disminuir texto" onClick={() => onFontChange(-1)}>
          a
        </button>
        <button className="card bg-neutral-900 px-2 py-1 hover:bg-neutral-800 text-sm font-semibold" title="Aumentar texto" onClick={() => onFontChange(1)}>
          A
        </button>
        <button className="ml-2 text-neutral-500 hover:text-white" title="Cerrar" onClick={onClose}>
          ✕
        </button>
      </div>
      {ideaDetail && (
        <div className="space-y-3">
          <div>
            <Badge color="indigo">{NODE_LABELS[ideaDetail.idea.type as IdeaType] ?? ideaDetail.idea.type}</Badge>
            <h3 className="font-semibold mt-2">{ideaDetail.idea.label}</h3>
            <p className="text-neutral-400 mt-1">{ideaDetail.idea.statement}</p>
          </div>
          <div>
            <div className="text-xs uppercase text-neutral-500 mb-1">Obras que la desarrollan</div>
            {ideaDetail.occurrences.map((o) => (
              <OccurrenceCard key={o.nodus_id} occurrence={o} />
            ))}
          </div>
          {ideaDetail.evidence.length > 0 && (
            <div>
              <div className="text-xs uppercase text-neutral-500 mb-1">Evidencia anclada</div>
              {ideaDetail.evidence.map((ev) => (
                <blockquote key={ev.id} className="border-l-2 border-indigo-700 pl-3 py-2 my-2 text-xs text-neutral-300 italic bg-neutral-950/35 rounded-r-md">
                  “{ev.quote}” <span className="text-neutral-500 not-italic">{ev.location ?? ''} · {ev.kind}</span>
                </blockquote>
              ))}
            </div>
          )}
        </div>
      )}
      {edgeDetail && (
        <div className="space-y-3">
          <h3 className="font-semibold">
            {EDGE_LABELS[edgeDetail.edge.type as keyof typeof EDGE_LABELS] ?? edgeDetail.edge.type}
          </h3>
          {edgeDetail.explanation && <p className="text-neutral-300">{edgeDetail.explanation}</p>}
          <div className="text-neutral-400">
            <span className="text-neutral-200">{edgeDetail.fromLabel}</span> → <span className="text-neutral-200">{edgeDetail.toLabel}</span>
          </div>
          <div className="flex gap-2">
            <Badge color={edgeDetail.edge.basis === 'explicit' ? 'green' : 'amber'}>{edgeDetail.edge.basis}</Badge>
            <Badge>conf {edgeDetail.edge.confidence.toFixed(2)}</Badge>
          </div>
          {edgeDetail.evidence.map((ev) => (
            <blockquote key={ev.id} className="border-l-2 border-indigo-700 pl-3 py-2 my-2 text-xs text-neutral-300 italic bg-neutral-950/35 rounded-r-md">
              “{ev.quote}” <span className="text-neutral-500">{ev.location ?? ''}</span>
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}

const ITEM_TYPE_ES: Record<string, string> = {
  journalArticle: 'artículo de revista',
  magazineArticle: 'artículo de revista',
  newspaperArticle: 'artículo de periódico',
  bookSection: 'capítulo de libro',
  book: 'libro',
  conferencePaper: 'ponencia',
  thesis: 'tesis',
  report: 'informe',
  preprint: 'preprint',
  manuscript: 'manuscrito',
  webpage: 'página web',
  document: 'documento',
  encyclopediaArticle: 'entrada de enciclopedia',
};

function itemTypeEs(t?: string | null): string | null {
  return t ? ITEM_TYPE_ES[t] ?? t : null;
}

function OccurrenceCard({ occurrence }: { occurrence: IdeaDetail['occurrences'][number] }) {
  const [open, setOpen] = useState(false);
  const work = occurrence.work;
  const author = work.authors[0] ?? 'Autor desconocido';
  const year = work.year ?? 's.f.';

  return (
    <div className="card p-3 mb-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-xs truncate">{work.title}</div>
          <div className="text-[11px] text-neutral-400 mt-0.5">
            {author}
            {work.authors.length > 1 ? ' et al.' : ''} ({year})
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            className="inline-flex items-center justify-center text-neutral-500 hover:text-neutral-200 p-1"
            title={open ? 'Ocultar metadatos' : 'Mostrar metadatos'}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name="info" size={14} />
          </button>
          <button
            className="inline-flex items-center gap-1 text-indigo-400 text-xs p-1 hover:text-indigo-300"
            title="Abrir en Zotero"
            onClick={() => window.nodus.openInZotero(work.zotero_key)}
          >
            <Icon name="external" size={13} /> Zotero
          </button>
        </div>
      </div>
      {open && <OccurrenceMeta work={work} />}
      <div className="text-[11px] text-neutral-500 mt-2">
        {occurrence.role} · conf {occurrence.confidence.toFixed(2)}
      </div>
      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">{occurrence.development}</p>
    </div>
  );
}

/** Bibliographic detail for one occurrence — authors, venue, pages — read live from Zotero. */
function OccurrenceMeta({ work }: { work: WorkView }) {
  const [meta, setMeta] = useState<WorkMeta | null>(null);
  useEffect(() => {
    let on = true;
    void window.nodus.getWorkMeta(work.nodus_id).then((m) => {
      if (on) setMeta(m);
    });
    return () => {
      on = false;
    };
  }, [work.nodus_id]);

  const authors = meta?.authors?.length ? meta.authors : work.authors;
  const type = itemTypeEs(meta?.itemType ?? work.item_type);
  const year = work.year ?? meta?.year ?? null;
  const venue: string[] = [];
  if (meta?.container) venue.push(meta.container);
  if (meta?.publisher) venue.push(meta.publisher);
  if (meta?.volume) venue.push(`vol. ${meta.volume}${meta.issue ? `(${meta.issue})` : ''}`);
  else if (meta?.issue) venue.push(`n.º ${meta.issue}`);
  if (meta?.pages) venue.push(`pp. ${meta.pages}`);
  else if (meta?.numPages) venue.push(`${meta.numPages} pp.`);
  if (meta?.place) venue.push(meta.place);

  return (
    <div className="text-[11px] text-neutral-500 mt-1 space-y-0.5">
      {authors.length > 0 && (
        <div className="text-neutral-400">
          {authors.slice(0, 4).join('; ')}
          {authors.length > 4 ? ' et al.' : ''}
        </div>
      )}
      {(type || year) && <div>{[type, year].filter(Boolean).join(' · ')}</div>}
      {venue.length > 0 && <div className="text-neutral-400">{venue.join(' · ')}</div>}
      {meta?.doi && <div className="font-mono truncate">doi:{meta.doi}</div>}
    </div>
  );
}
