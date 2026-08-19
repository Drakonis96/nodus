import { v4 as uuid } from 'uuid';
import type { ArgumentBlock, ArgumentMap, ArgumentMapRequest, ArgumentRouteSuggestion, EdgeType, IdeaType, ModelRef } from '@shared/types';
import { getDb } from '../db/database';
import { getIdeaSummary } from '../db/ideasRepo';
import { getSettings } from '../db/settingsRepo';
import { completeJson } from './aiClient';

// The argument map is built from the LOCAL subgraph around the seed idea (BFS
// over real idea↔idea edges), so the model can only reference ideas that
// actually connect to the seed. We cap the volume so it stays focused.
//
// The two paths have very different budgets: the AI path has to fit a model
// context, while the automatic path is pure local computation and only pays for
// what it draws. Sharing the AI's cap was what flattened every hub route into a
// star — an idea with more neighbours than the cap consumed the whole budget at
// depth 0, so not one neighbour↔neighbour edge survived to branch from.
const MAX_DEPTH = 3;
const AI_MAX_IDEAS = 80;
const AI_MAX_EDGES = 160;
const STRUCTURAL_MAX_IDEAS = 400;
const STRUCTURAL_MAX_EDGES = 1200;
const STATEMENT_CLIP = 220;
const MAX_BLOCKS = 90;
const MAX_TREE_DEPTH = 4;

const EDGE_TYPE_LABELS: Record<string, string> = {
  extends: 'extiende',
  variant_of: 'variante de',
  refines: 'refina',
  contradicts: 'contradice',
  applies_to: 'aplica a',
  shares_method: 'comparte método',
  precondition_of: 'precondición de',
  measures_same: 'mide lo mismo',
  supports: 'apoya',
  refutes: 'refuta',
};

// English counterpart for the structural (auto-mode) overview/summary, which are
// shown verbatim in the UI; picked by the interface language.
const EDGE_TYPE_LABELS_EN: Record<string, string> = {
  extends: 'extends',
  variant_of: 'variant of',
  refines: 'refines',
  contradicts: 'contradicts',
  applies_to: 'applies to',
  shares_method: 'shares method',
  precondition_of: 'precondition of',
  measures_same: 'measures the same',
  supports: 'supports',
  refutes: 'refutes',
};

const VALID_RELATIONS = new Set<string>([
  'extends',
  'variant_of',
  'refines',
  'contradicts',
  'applies_to',
  'shares_method',
  'precondition_of',
  'measures_same',
  'supports',
  'refutes',
  'related',
  'framing',
]);

interface IdeaRow {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
}

type RawIdeaRow = Omit<IdeaRow, 'type' | 'label' | 'statement'> & {
  type: IdeaType | null;
  label: string | null;
  statement: string | null;
};

/** SQLite's original ideas table allowed nullable text; renderer contracts do not. */
function listArgumentIdeas(): IdeaRow[] {
  const rows = getDb()
    .prepare('SELECT global_id, type, label, statement FROM ideas')
    .all() as RawIdeaRow[];
  return rows.map((row) => ({
    global_id: row.global_id,
    type: row.type ?? 'claim',
    label: row.label ?? row.global_id,
    statement: row.statement ?? '',
  }));
}

interface EdgeRow {
  id: string;
  from_id: string;
  to_id: string;
  type: string;
  basis: string;
  confidence: number;
}

function clip(text: string, max = STATEMENT_CLIP): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

interface LocalSubgraph {
  ideas: IdeaRow[];
  edges: EdgeRow[];
  ideaById: Map<string, IdeaRow>;
  truncated: boolean;
  /** Connection counts in the FULL graph, so a capped subgraph can still report
   *  how many links an idea really has instead of how many survived the cap. */
  graphDegree: Map<string, number>;
  graphDebate: Map<string, number>;
}

function isDebateEdge(type: string): boolean {
  return type === 'contradicts' || type === 'refutes';
}

/** BFS the real idea↔idea edges from a seed, returning the focused subgraph. */
function buildLocalSubgraph(seedId: string, maxIdeas = AI_MAX_IDEAS, maxEdges = AI_MAX_EDGES): LocalSubgraph {
  const allIdeas = listArgumentIdeas();
  const ideaById = new Map(allIdeas.map((i) => [i.global_id, i]));
  if (!ideaById.has(seedId)) {
    throw new Error('La idea indicada no existe en el grafo.');
  }

  const allEdges = (
    getDb()
      .prepare(
        `SELECT id, from_id, to_id, type, basis, confidence FROM visible_edges WHERE type != 'contains'`
      )
      .all() as EdgeRow[]
  ).filter((e) => ideaById.has(e.from_id) && ideaById.has(e.to_id));

  // Undirected adjacency over idea↔idea edges, plus whole-graph counts.
  const adj = new Map<string, { edge: EdgeRow; other: string }[]>();
  const graphDegree = new Map<string, number>();
  const graphDebate = new Map<string, number>();
  for (const e of allEdges) {
    for (const [a, b] of [
      [e.from_id, e.to_id],
      [e.to_id, e.from_id],
    ] as const) {
      (adj.get(a) ?? adj.set(a, []).get(a)!).push({ edge: e, other: b });
      graphDegree.set(a, (graphDegree.get(a) ?? 0) + 1);
      if (isDebateEdge(e.type)) graphDebate.set(a, (graphDebate.get(a) ?? 0) + 1);
    }
  }

  // Expand strongest-link-first (debates lead, see edgePriority). The walk used to
  // take neighbours in row order, so a capped subgraph kept an arbitrary slice —
  // for a hub that silently dropped some of the very debates the route promised.
  const visited = new Set<string>([seedId]);
  let frontier: string[] = [seedId];
  let truncated = false;

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0 && !truncated; depth++) {
    const next: string[] = [];
    for (const node of frontier) {
      const neighbors = [...(adj.get(node) ?? [])].sort((a, b) => edgePriority(b.edge) - edgePriority(a.edge));
      for (const { other } of neighbors) {
        if (visited.has(other)) continue;
        if (visited.size >= maxIdeas) {
          truncated = true;
          break;
        }
        visited.add(other);
        next.push(other);
      }
      if (truncated) break;
    }
    frontier = next;
  }

  // Keep the INDUCED subgraph: every edge between two kept ideas, not merely the
  // ones the walk happened to cross. The walk only ever crosses edges out of the
  // frontier, so collecting them was what left the neighbours with no links of
  // their own and every branch a leaf.
  const induced = allEdges.filter((e) => visited.has(e.from_id) && visited.has(e.to_id));
  let edges = induced;
  if (induced.length > maxEdges) {
    truncated = true;
    // The seed's own links are the map's top-level branches: never trade them for
    // a stronger link buried deeper in the subgraph.
    const seedEdges = induced.filter((e) => e.from_id === seedId || e.to_id === seedId);
    const rest = induced
      .filter((e) => e.from_id !== seedId && e.to_id !== seedId)
      .sort((a, b) => edgePriority(b) - edgePriority(a))
      .slice(0, Math.max(0, maxEdges - seedEdges.length));
    edges = [...seedEdges, ...rest];
  }
  const ideas = [...visited].map((id) => ideaById.get(id)!).filter(Boolean);

  return { ideas, edges, ideaById, truncated, graphDegree, graphDebate };
}

interface RawBlock {
  ideaId?: string;
  label?: string;
  summary?: string;
  relation?: string;
  children?: RawBlock[];
}

interface RawResult {
  overview?: string;
  root?: RawBlock;
}

function isRawResult(v: unknown): v is RawResult {
  return typeof v === 'object' && v !== null && typeof (v as RawResult).root === 'object';
}

const SYSTEM = `Eres el cartógrafo de argumentos de Nodus. Recibes una idea SEMILLA y el subgrafo REAL de ideas conectadas a ella (con sus tipos y las relaciones reales entre ellas: apoya, refuta, contradice, extiende, refina, aplica a, etc.).

OBJETIVO:
- Traza un ESQUEMA JERÁRQUICO DE BLOQUES (árbol) que despliegue progresivamente cómo se ramifica la argumentación desde la semilla.
- La RAÍZ es la idea semilla. Sus hijos son las ideas directamente conectadas, agrupadas en ramas coherentes. Desciende recursivamente siguiendo las conexiones reales hasta profundidad 3-4.
- Cada bloque representa UNA idea real del subgrafo. Usa su "ideaId" exacto. El árbol debe reflejar la estructura argumental: lo que la semilla APOYA o de lo que se DERIVA, los DEBATES (contradicciones/refutaciones) como ramas distintas, las extensiones y refinamientos como subramas.
- "relation" describe cómo el bloque se vincula a su padre: usa el tipo de arista real (supports, refutes, contradicts, extends, refines, applies_to, shares_method, precondition_of, measures_same, variant_of). Si no hay una arista directa clara, usa "related".
- "summary" es UNA línea breve (máx ~140 caracteres) que explica el papel de esa idea en el argumento, en español, claro y concreto.
- "label" puede ser una versión ligeramente abreviada/legible del título de la idea (no la inventes).

REGLAS ESTRICTAS:
- "ideaId" debe ser un id presente en "ideas" del subgrafo recibido. La raíz debe ser exactamente la idea semilla. No inventes ids ni ideas.
- Un mismo ideaId puede aparecer una sola vez en todo el árbol (evita duplicados; si una idea conecta de varias formas, colócala bajo el padre más significativo).
- No dejes ramas vacías: si un bloque no tiene hijos relevantes, usa "children": [].
- Cubre TODAS las ideas relevantes del subgrafo que aporten al argumento; no resumas dejando fuera ideas conectadas significativas. Prioriza cobertura sobre brevedad.

SALIDA: EXCLUSIVAMENTE JSON válido con esta forma:
{
  "overview": "1-2 frases: qué argumento despliega este mapa y su estructura a vista de pájaro.",
  "root": {
    "ideaId": "g-0001",
    "label": "…",
    "summary": "…",
    "relation": "root",
    "children": [
      { "ideaId": "…", "label": "…", "summary": "…", "relation": "supports", "children": [ … ] }
    ]
  }
}`;

/** Recursively sanitize + ground the model's tree in real idea data. */
function sanitizeBlock(
  raw: RawBlock,
  ideaById: Map<string, IdeaRow>,
  seedId: string,
  isRoot: boolean,
  seenIdeaIds: Set<string>,
  depth: number,
  blockCount: { n: number }
): ArgumentBlock | null {
  if (blockCount.n >= MAX_BLOCKS) return null;
  const ideaId = typeof raw.ideaId === 'string' ? raw.ideaId : null;

  // Root must be the seed; non-root blocks must reference a real idea.
  if (isRoot) {
    if (ideaId !== seedId) return null;
  } else if (!ideaId || !ideaById.has(ideaId) || seenIdeaIds.has(ideaId)) {
    return null;
  }
  seenIdeaIds.add(ideaId!);
  blockCount.n++;

  const idea = ideaById.get(ideaId!)!;
  const relationRaw = typeof raw.relation === 'string' ? raw.relation : 'related';
  const relation = (isRoot ? 'root' : VALID_RELATIONS.has(relationRaw) ? relationRaw : 'related') as ArgumentBlock['relation'];

  const children: ArgumentBlock[] = [];
  if (depth < MAX_TREE_DEPTH && Array.isArray(raw.children)) {
    for (const childRaw of raw.children) {
      if (blockCount.n >= MAX_BLOCKS) break;
      const child = sanitizeBlock(childRaw, ideaById, seedId, false, seenIdeaIds, depth + 1, blockCount);
      if (child) children.push(child);
    }
  }

  return {
    id: uuid(),
    ideaId,
    label: clip(typeof raw.label === 'string' && raw.label.trim() ? raw.label : idea.label, 160),
    statement: idea.statement,
    type: idea.type,
    summary: clip(typeof raw.summary === 'string' ? raw.summary : '', 200),
    relation,
    children,
  };
}

function countIdeas(block: ArgumentBlock, set = new Set<string>()): Set<string> {
  if (block.ideaId) set.add(block.ideaId);
  for (const c of block.children) countIdeas(c, set);
  return set;
}

export async function buildArgumentMap(request: ArgumentMapRequest, model?: ModelRef | null): Promise<ArgumentMap> {
  // Automatic mode: build the tree structurally from the real graph edges,
  // no model needed. Falls through to the AI path otherwise.
  if (request.mode === 'auto') {
    return buildStructuralArgumentMap(request.seedIdeaId);
  }

  const { seedIdeaId } = request;
  const seed = getIdeaSummary(seedIdeaId);
  if (!seed) throw new Error('La idea indicada no existe en el grafo.');

  const { ideas, edges, ideaById, truncated } = buildLocalSubgraph(seedIdeaId);

  // No connections: return a single-block map so the UI still renders something.
  if (edges.length === 0 || ideas.length <= 1) {
    const root: ArgumentBlock = {
      id: uuid(),
      ideaId: seed.global_id,
      label: seed.label,
      statement: seed.statement,
      type: seed.type,
      summary: 'Esta idea no tiene conexiones con otras ideas en el grafo.',
      relation: 'root',
      children: [],
    };
    return {
      seedIdeaId: seed.global_id,
      seedLabel: seed.label,
      overview: 'La idea seleccionada no tiene conexiones directas con otras ideas analizada.',
      root,
      generatedAt: new Date().toISOString(),
      truncated: false,
      ideaCount: 1,
    };
  }

  const ideasPayload = ideas.map((i) => ({
    id: i.global_id,
    type: i.type,
    label: i.label,
    statement: clip(i.statement),
  }));
  const connectionsPayload = edges.map((e) => ({
    id: e.id,
    from: e.from_id,
    to: e.to_id,
    type: e.type,
    type_label: EDGE_TYPE_LABELS[e.type] ?? e.type,
    basis: e.basis,
    confidence: e.confidence,
  }));

  const user = JSON.stringify({
    idea_semilla: { id: seed.global_id, type: seed.type, label: seed.label, statement: clip(seed.statement) },
    ideas: ideasPayload,
    conexiones: connectionsPayload,
  });

  const result = await completeJson<RawResult>(
    { system: SYSTEM, user, temperature: 0.2, maxTokens: 8000 },
    isRawResult,
    model
  );

  const blockCount = { n: 0 };
  const root = sanitizeBlock(result.root ?? {}, ideaById, seed.global_id, true, new Set(), 0, blockCount);
  if (!root) {
    // Fallback: a single root block if the model output was unusable.
    return {
      seedIdeaId: seed.global_id,
      seedLabel: seed.label,
      overview: result.overview ? clip(result.overview, 600) : '',
      root: {
        id: uuid(),
        ideaId: seed.global_id,
        label: seed.label,
        statement: seed.statement,
        type: seed.type,
        summary: '',
        relation: 'root',
        children: [],
      },
      generatedAt: new Date().toISOString(),
      truncated,
      ideaCount: 1,
    };
  }

  return {
    seedIdeaId: seed.global_id,
    seedLabel: seed.label,
    overview: clip(result.overview ?? '', 600),
    root,
    generatedAt: new Date().toISOString(),
    truncated,
    ideaCount: countIdeas(root).size,
  };
}

// ── Automatic mode: structural discovery + tree (no AI) ───────────────────────

const STRUCTURAL_MAX_DEPTH = 3;
/** Branches drawn per level: wide at the seed, narrowing as the map descends.
 *  1 + 12 + 12·4 + 48·2 = 157 blocks, so a full map always fits the budget below
 *  and no branch is starved by one that happened to be walked first. */
const STRUCTURAL_BRANCHES_BY_DEPTH = [12, 4, 2];
const STRUCTURAL_MAX_BLOCKS = 160;

interface AdjEntry {
  other: string;
  edge: EdgeRow;
}

/** Sort priority: surface debates (contradicts/refutes) first, then by confidence. */
function edgePriority(edge: EdgeRow): number {
  let p = edge.confidence;
  if (isDebateEdge(edge.type)) p += 1.5;
  else if (edge.type === 'supports' || edge.type === 'extends') p += 0.4;
  return p;
}

/** Which side of the argument a link is on, for the branch quota below. */
function relationFamily(type: string): 'debate' | 'support' | 'other' {
  if (isDebateEdge(type)) return 'debate';
  if (type === 'supports' || type === 'extends' || type === 'precondition_of') return 'support';
  return 'other';
}

/**
 * Choose which connections become branches. Ranking by priority alone hands every
 * slot to the debates (they carry a +1.5 bonus), which paints a hub as nothing but
 * contradiction; a map of an argument has to show what backs the idea too. So the
 * slots are dealt round-robin across the three families, strongest link first
 * within each, and the result is re-sorted so debates still lead the reading.
 */
function pickBranches(candidates: AdjEntry[], cap: number): AdjEntry[] {
  const buckets: Record<'debate' | 'support' | 'other', AdjEntry[]> = { debate: [], support: [], other: [] };
  for (const c of [...candidates].sort((a, b) => edgePriority(b.edge) - edgePriority(a.edge))) {
    buckets[relationFamily(c.edge.type)].push(c);
  }
  const families = ['debate', 'support', 'other'] as const;
  const picked: AdjEntry[] = [];
  for (let i = 0; picked.length < cap && families.some((f) => buckets[f].length > 0); i++) {
    const bucket = buckets[families[i % families.length]];
    const next = bucket.shift();
    if (next) picked.push(next);
  }
  return picked.sort((a, b) => edgePriority(b.edge) - edgePriority(a.edge));
}

/** Rank idea hubs by weighted connectivity for the automatic route picker. */
export function discoverArgumentRoutes(): ArgumentRouteSuggestion[] {
  const allIdeas = listArgumentIdeas();
  const ideaById = new Map(allIdeas.map((i) => [i.global_id, i]));
  if (allIdeas.length === 0) return [];

  const allEdges = getDb()
    .prepare(
      `SELECT id, from_id, to_id, type, basis, confidence FROM visible_edges WHERE type != 'contains'`
    )
    .all() as EdgeRow[];

  // Adjacency + per-idea metrics.
  const adj = new Map<string, AdjEntry[]>();
  const degree = new Map<string, number>();
  const debate = new Map<string, number>();
  const confSum = new Map<string, number>();
  const relationCounts = new Map<string, Map<string, number>>();

  for (const e of allEdges) {
    if (!ideaById.has(e.from_id) || !ideaById.has(e.to_id)) continue;
    for (const [a, b] of [
      [e.from_id, e.to_id],
      [e.to_id, e.from_id],
    ] as const) {
      (adj.get(a) ?? adj.set(a, []).get(a)!).push({ other: b, edge: e });
      degree.set(a, (degree.get(a) ?? 0) + 1);
      confSum.set(a, (confSum.get(a) ?? 0) + e.confidence);
      if (isDebateEdge(e.type)) debate.set(a, (debate.get(a) ?? 0) + 1);
      const rc = relationCounts.get(a) ?? relationCounts.set(a, new Map()).get(a)!;
      rc.set(e.type, (rc.get(e.type) ?? 0) + 1);
    }
  }

  // Rank: weighted degree (debates bonus) → degree → avg confidence.
  const ranked = allIdeas
    .filter((i) => (degree.get(i.global_id) ?? 0) > 0)
    .map((i) => {
      const d = degree.get(i.global_id) ?? 0;
      const db = debate.get(i.global_id) ?? 0;
      const cs = confSum.get(i.global_id) ?? 0;
      const score = d + db * 1.5 + cs * 0.2;
      return { idea: i, d, db, cs, score };
    })
    .sort((a, b) => b.score - a.score || b.d - a.d);

  return ranked.map(({ idea, d, db, cs }) => {
    const neighbors = adj.get(idea.global_id) ?? [];
    const topRelations = [...(relationCounts.get(idea.global_id) ?? new Map()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([type, count]) => ({ type: type as EdgeType, count }));
    const neighborLabels = [...neighbors]
      .sort((a, b) => edgePriority(b.edge) - edgePriority(a.edge))
      .slice(0, 4)
      .map((n) => ideaById.get(n.other)?.label ?? n.other);
    return {
      ideaId: idea.global_id,
      label: idea.label,
      statement: idea.statement,
      type: idea.type,
      degree: d,
      debateCount: db,
      avgConfidence: d > 0 ? cs / d : 0,
      topRelations,
      neighborLabels,
    };
  });
}

/** Build the block tree structurally from the real graph edges (no model). */
export function buildStructuralArgumentMap(seedIdeaId: string): ArgumentMap {
  const seed = getIdeaSummary(seedIdeaId);
  if (!seed) throw new Error('La idea indicada no existe en el grafo.');

  const { ideaById, edges, truncated, graphDegree, graphDebate } = buildLocalSubgraph(
    seedIdeaId,
    STRUCTURAL_MAX_IDEAS,
    STRUCTURAL_MAX_EDGES
  );

  // Adjacency over the kept subgraph.
  const adj = new Map<string, AdjEntry[]>();
  for (const e of edges) {
    if (!ideaById.has(e.from_id) || !ideaById.has(e.to_id)) continue;
    (adj.get(e.from_id) ?? adj.set(e.from_id, []).get(e.from_id)!).push({ other: e.to_id, edge: e });
    (adj.get(e.to_id) ?? adj.set(e.to_id, []).get(e.to_id)!).push({ other: e.from_id, edge: e });
  }

  const lang: 'es' | 'en' = getSettings().uiLanguage === 'es' ? 'es' : 'en';
  const relLabelOf = (rel: string): string =>
    (lang === 'en' ? EDGE_TYPE_LABELS_EN[rel] : EDGE_TYPE_LABELS[rel]) ?? rel;
  // Counted over the whole graph, not the kept subgraph: the route list promises
  // the real figure, and a map that quietly reported the post-cap one read as if
  // connections had gone missing.
  const seedDegree = graphDegree.get(seed.global_id) ?? 0;
  const seedDebate = graphDebate.get(seed.global_id) ?? 0;

  const makeBlock = (idea: IdeaRow, parentEdge: EdgeRow | null): ArgumentBlock => ({
    id: uuid(),
    ideaId: idea.global_id,
    label: idea.label,
    statement: idea.statement,
    type: idea.type,
    summary: '',
    relation: parentEdge ? (parentEdge.type as ArgumentBlock['relation']) : 'root',
    children: [],
  });

  // Grow the tree level by level. A depth-first walk let the first branch it
  // descended spend the whole block budget, leaving its siblings bare; taking one
  // level at a time spends the budget evenly across the argument.
  const root = makeBlock(ideaById.get(seed.global_id)!, null);
  const placed = new Set<string>([seed.global_id]);
  const parentEdgeOf = new Map<string, EdgeRow>();
  let blockCount = 1;
  let frontier: ArgumentBlock[] = [root];

  for (let depth = 0; depth < STRUCTURAL_MAX_DEPTH && frontier.length > 0 && blockCount < STRUCTURAL_MAX_BLOCKS; depth++) {
    const cap = STRUCTURAL_BRANCHES_BY_DEPTH[depth] ?? STRUCTURAL_BRANCHES_BY_DEPTH[STRUCTURAL_BRANCHES_BY_DEPTH.length - 1];
    const next: ArgumentBlock[] = [];
    for (const block of frontier) {
      if (blockCount >= STRUCTURAL_MAX_BLOCKS) break;
      // Ideas already placed elsewhere are skipped: each idea appears once, so the
      // tree stays a tree and the same card never shows up on two branches.
      const candidates = (adj.get(block.ideaId!) ?? []).filter((n) => !placed.has(n.other));
      for (const { other, edge } of pickBranches(candidates, cap)) {
        if (blockCount >= STRUCTURAL_MAX_BLOCKS) break;
        if (placed.has(other)) continue;
        placed.add(other);
        const child = makeBlock(ideaById.get(other)!, edge);
        parentEdgeOf.set(child.id, edge);
        block.children.push(child);
        blockCount++;
        next.push(child);
      }
    }
    frontier = next;
  }

  // Summaries last, so each block can state how many of its connections it drew.
  const describe = (block: ArgumentBlock): void => {
    const degree = graphDegree.get(block.ideaId!) ?? 0;
    const hidden = Math.max(0, degree - block.children.length);
    if (hidden > 0) block.hiddenChildren = hidden;
    if (block.relation === 'root') {
      block.summary =
        lang === 'en'
          ? `${seedDegree} connection(s)${seedDebate ? ` · ${seedDebate} debate(s)` : ''}`
          : `${seedDegree} conexiones${seedDebate ? ` · ${seedDebate} debate(s)` : ''}`;
    } else {
      const relLabel = relLabelOf(block.relation);
      const conf = parentEdgeOf.get(block.id)?.confidence ?? 0;
      block.summary =
        block.children.length > 0
          ? `${relLabel} · conf ${conf.toFixed(2)} · ${block.children.length} ${lang === 'en' ? 'derivation(s)' : 'derivación(es)'}`
          : `${relLabel} · conf ${conf.toFixed(2)}`;
    }
    for (const child of block.children) describe(child);
  };
  describe(root);

  const overview =
    seedDegree === 0
      ? lang === 'en'
        ? 'The selected idea has no direct connections to other ideas.'
        : 'La idea seleccionada no tiene conexiones directas con otras ideas.'
      : lang === 'en'
        ? `Automatic walkthrough: the central idea links ${seedDegree} connection(s)${
            seedDebate ? `, of which ${seedDebate} are debates (contradictions/refutations)` : ''
          }. The map opens its ${root.children.length} strongest branch(es) — debates, support and refinements — and follows each one down the real connections. Expand the branches to explore the argument.`
        : `Recorrido automático: la idea central articula ${seedDegree} conexiones${
            seedDebate ? `, de las cuales ${seedDebate} son debates (contradicciones/refutaciones)` : ''
          }. El mapa abre sus ${root.children.length} ramas más fuertes —debates, apoyos y refinamientos— y sigue cada una por las conexiones reales. Despliega las ramas para explorar la argumentación.`;

  return {
    seedIdeaId: seed.global_id,
    seedLabel: seed.label,
    overview,
    root,
    generatedAt: new Date().toISOString(),
    truncated,
    ideaCount: countIdeas(root).size,
  };
}
