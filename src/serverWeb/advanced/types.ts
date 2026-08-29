import type { GraphData, GraphEdge, GraphNode, IdeaType } from '@shared/types';

/** Wire-safe page returned by the published Server workspace projections. */
export type AdvancedPage<T> = {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  revision?: string;
};

export type AdvancedIdea = {
  id: string;
  label: string;
  type: IdeaType;
  statement: string;
  workCount: number;
  themes: string[];
  maxConfidence: number;
  connectionCount: number;
};

export type AdvancedIdeaDetail = {
  idea: Record<string, unknown> & { global_id?: string; label?: string; type?: string; statement?: string };
  relations: Array<Record<string, unknown>>;
  occurrences: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  themes: string[];
  revision?: string;
};

export type AdvancedWorkDetail = {
  work: Record<string, unknown> & { nodus_id?: string; title?: string; abstract?: string; citation?: string };
  ideas: Array<Record<string, unknown> & { global_id?: string; label?: string; type?: string; statement?: string }>;
  summary: Record<string, unknown> | null;
  passages: number;
  documentProfile: null | {
    state?: Record<string, unknown>;
    version?: Record<string, unknown>;
    fields?: Array<Record<string, unknown>>;
    sections?: Array<Record<string, unknown>>;
    supports?: Array<Record<string, unknown>>;
    ideaLinks?: Array<Record<string, unknown>>;
    citationPolicy?: string;
  };
  revision?: string;
};

export type AdvancedAuthor = {
  author_id: string;
  name: string;
  firstName: string;
  lastName: string;
  fullName: string;
  affiliation: string | null;
  workCount: number;
  editedCount: number;
  ideaCount: number;
  relationCount: number;
  topTags: string[];
  topThemes: string[];
  read: boolean;
  hasSynthesis: boolean;
  saved: boolean;
};

export type AdvancedSynthesis = {
  thesis: string;
  remember: string[];
  positioning: string;
  model: Record<string, unknown> | null;
  generatedAt: string;
  stale: boolean;
};

export type AdvancedAuthorWork = {
  nodus_id: string;
  title: string;
  authors: string[];
  year: number | null;
  itemType: string | null;
  doi: string | null;
  sourceType: string | null;
  read: boolean;
  role: 'author' | 'editor';
  attributed: boolean;
  [key: string]: unknown;
};

export type AdvancedAuthorIdea = {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  development: string;
  role: 'principal' | 'secondary';
  confidence: number;
  workId: string;
  workTitle: string;
  year: number | null;
  provisional: boolean;
  themes: string[];
  evidence: Array<Record<string, unknown>>;
};

export type AdvancedAuthorRelation = {
  author_id: string;
  name: string;
  type: string;
  weight: number;
  sharedThemes: string[];
};

export type AdvancedAuthorDossier = {
  author: Record<string, unknown>;
  fullName: string;
  firstName: string;
  lastName: string;
  works: AdvancedAuthorWork[];
  editedWorks: AdvancedAuthorWork[];
  ideas: AdvancedAuthorIdea[];
  relations: AdvancedAuthorRelation[];
  themes: string[];
  synthesis: AdvancedSynthesis | null;
};

export type AdvancedGraphResponse = {
  seedId: string;
  depth: number;
  ideas: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  truncated?: boolean;
  revision?: string;
};

/** Convert the intentionally loose REST graph rows to the shared Sigma input. */
export function toGraphData(payload: AdvancedGraphResponse): GraphData {
  const ideaNodes: GraphNode[] = payload.ideas.map((row, index) => {
    const id = String(row.global_id ?? row.id ?? index);
    const rawType = String(row.type ?? 'claim');
    const type = (['claim', 'finding', 'construct', 'method', 'framework', 'theme'].includes(rawType)
      ? rawType
      : 'claim') as GraphNode['type'];
    return {
      id,
      label: String(row.label ?? id),
      type,
      statement: String(row.statement ?? ''),
      workCount: Number(row.workCount ?? row.work_count ?? 0) || 0,
      workIds: Array.isArray(row.workIds) ? row.workIds.map(String) : [],
      read: row.read === true || row.read === 1,
      themes: Array.isArray(row.themes) ? row.themes.map(String) : [],
      years: Array.isArray(row.years) ? row.years.map(Number).filter(Number.isFinite) : [],
      authors: Array.isArray(row.authors) ? row.authors.map(String) : [],
      maxConfidence: Number(row.maxConfidence ?? row.max_confidence ?? 0) || 0,
      createdAt: row.createdAt == null ? null : String(row.createdAt),
    };
  });
  // The published REST projection is intentionally idea-centric. Sigma's
  // progressive Desktop atlas, however, requires explicit theme nodes and
  // membership edges. Reconstruct those losslessly from each idea's published
  // theme labels so the first scene is the same constellation as Desktop.
  const themeLabels = [...new Set(ideaNodes.flatMap((node) => node.themes).map((label) => label.trim()).filter(Boolean))];
  const themeId = (label: string) => `theme:${encodeURIComponent(label.trim().toLocaleLowerCase())}`;
  const themeNodes: GraphNode[] = themeLabels.map((label) => ({
    id: themeId(label),
    label,
    type: 'theme',
    statement: '',
    workCount: ideaNodes.filter((node) => node.themes.includes(label)).length,
    workIds: [],
    read: true,
    themes: [label],
    years: [],
    authors: [],
    maxConfidence: 1,
    createdAt: null,
  }));
  const nodes = [...themeNodes, ...ideaNodes];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const semanticEdges: GraphEdge[] = payload.edges.flatMap((row, index) => {
    const source = String(row.source ?? row.from_id ?? '');
    const target = String(row.target ?? row.to_id ?? '');
    if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return [];
    return [{
      id: String(row.id ?? `edge-${index}`),
      source,
      target,
      type: String(row.type ?? 'supports'),
      basis: String(row.basis ?? 'explicit') as GraphEdge['basis'],
      confidence: Number(row.confidence ?? 0) || 0,
    }];
  });
  const membershipEdges: GraphEdge[] = ideaNodes.flatMap((node) => node.themes.map((label, index) => ({
    id: `contains:${themeId(label)}:${node.id}:${index}`,
    source: themeId(label),
    target: node.id,
    type: 'contains',
    basis: 'inferred',
    confidence: 1,
  })));
  const edges = [...semanticEdges, ...membershipEdges];
  return { nodes, edges };
}
