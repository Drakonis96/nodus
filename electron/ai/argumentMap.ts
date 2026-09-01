import { v4 as uuid } from 'uuid';
import type { ArgumentBlock, ArgumentMap, ArgumentMapRequest, ArgumentRouteSuggestion, EdgeType, IdeaType, ModelRef, PromptLanguage } from '@shared/types';
import { getDb } from '../db/database';
import { getIdeaSummary } from '../db/ideasRepo';
import { getSettings } from '../db/settingsRepo';
import { completeJson } from './aiClient';
import { argumentMapPrompt } from '@shared/graphPromptPacks';

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

const EDGE_TYPE_LABELS_BY_LANGUAGE: Record<PromptLanguage, Record<string, string>> = {
  es: EDGE_TYPE_LABELS,
  en: EDGE_TYPE_LABELS_EN,
  fr: { extends: 'étend', variant_of: 'variante de', refines: 'affine', contradicts: 'contredit', applies_to: "s'applique à", shares_method: 'partage la méthode', precondition_of: 'prérequis de', measures_same: 'mesure la même chose', supports: 'soutient', refutes: 'réfute' },
  de: { extends: 'erweitert', variant_of: 'Variante von', refines: 'verfeinert', contradicts: 'widerspricht', applies_to: 'gilt für', shares_method: 'teilt die Methode', precondition_of: 'Voraussetzung für', measures_same: 'misst dasselbe', supports: 'stützt', refutes: 'widerlegt' },
  pt: { extends: 'estende', variant_of: 'variante de', refines: 'refina', contradicts: 'contradiz', applies_to: 'aplica-se a', shares_method: 'partilha o método', precondition_of: 'pré-condição de', measures_same: 'mede o mesmo', supports: 'apoia', refutes: 'refuta' },
  'pt-BR': { extends: 'estende', variant_of: 'variante de', refines: 'refina', contradicts: 'contradiz', applies_to: 'aplica-se a', shares_method: 'compartilha o método', precondition_of: 'pré-condição de', measures_same: 'mede o mesmo', supports: 'apoia', refutes: 'refuta' },
  it: { extends: 'estende', variant_of: 'variante di', refines: 'perfeziona', contradicts: 'contraddice', applies_to: 'si applica a', shares_method: 'condivide il metodo', precondition_of: 'precondizione di', measures_same: 'misura lo stesso', supports: 'supporta', refutes: 'confuta' },
  tr: { extends: 'genişletir', variant_of: 'şunun varyantı', refines: 'iyileştirir', contradicts: 'çelişir', applies_to: 'şuna uygulanır', shares_method: 'yöntemi paylaşır', precondition_of: 'şunun ön koşulu', measures_same: 'aynı şeyi ölçer', supports: 'destekler', refutes: 'çürütür' },
};

const NO_CONNECTION_COPY: Record<PromptLanguage, { summary: string; overview: string }> = {
  es: { summary: 'Esta idea no tiene conexiones con otras ideas en el grafo.', overview: 'La idea seleccionada no tiene conexiones directas con otras ideas analizadas.' },
  en: { summary: 'This idea has no connections to other ideas in the graph.', overview: 'The selected idea has no direct connections to other ideas.' },
  fr: { summary: "Cette idée n'est reliée à aucune autre idée du graphe.", overview: "L'idée sélectionnée n'a aucun lien direct avec d'autres idées." },
  de: { summary: 'Diese Idee hat keine Verbindungen zu anderen Ideen im Graphen.', overview: 'Die ausgewählte Idee hat keine direkten Verbindungen zu anderen Ideen.' },
  pt: { summary: 'Esta ideia não tem ligações a outras ideias no grafo.', overview: 'A ideia selecionada não tem ligações diretas a outras ideias.' },
  'pt-BR': { summary: 'Esta ideia não tem conexões com outras ideias no grafo.', overview: 'A ideia selecionada não tem conexões diretas com outras ideias.' },
  it: { summary: 'Questa idea non ha collegamenti con altre idee nel grafo.', overview: "L'idea selezionata non ha collegamenti diretti con altre idee." },
  tr: { summary: 'Bu fikrin grafikte başka fikirlerle bağlantısı yok.', overview: 'Seçilen fikrin başka fikirlerle doğrudan bağlantısı yok.' },
};

function structuralOverview(language: PromptLanguage, degree: number, debates: number, branches: number): string {
  if (degree === 0) return NO_CONNECTION_COPY[language].overview;
  const debatePart = debates > 0
    ? ({
        es: `, de las cuales ${debates} son debates (contradicciones/refutaciones)`,
        en: `, ${debates} of them debates (contradictions/refutations)`,
        fr: `, dont ${debates} débats (contradictions/réfutations)`,
        de: `, davon ${debates} Debatten (Widersprüche/Widerlegungen)`,
        pt: `, das quais ${debates} debates (contradições/refutações)`,
        'pt-BR': `, sendo ${debates} debates (contradições/refutações)`,
        it: `, di cui ${debates} dibattiti (contraddizioni/confutazioni)`,
        tr: `; bunların ${debates} kadarı tartışma (çelişki/çürütme)`,
      } as Record<PromptLanguage, string>)[language]
    : '';
  return ({
    es: `Recorrido automático: la idea central articula ${degree} conexiones${debatePart}. El mapa abre ${branches} rama(s) más fuertes y sigue cada una por las conexiones reales.`,
    en: `Automatic walkthrough: the central idea links ${degree} connection(s)${debatePart}. The map opens its ${branches} strongest branch(es) and follows each through real connections.`,
    fr: `Parcours automatique : l'idée centrale relie ${degree} connexion(s)${debatePart}. La carte ouvre ${branches} branche(s) principales et suit chacune par les liens réels.`,
    de: `Automatischer Rundgang: Die zentrale Idee verbindet ${degree} Verbindung(en)${debatePart}. Die Karte öffnet ${branches} stärkste(n) Zweig(e) und folgt den echten Verbindungen.`,
    pt: `Percurso automático: a ideia central liga ${degree} ligação(ões)${debatePart}. O mapa abre ${branches} ramo(s) mais fortes e segue cada um pelas ligações reais.`,
    'pt-BR': `Percurso automático: a ideia central conecta ${degree} conexão(ões)${debatePart}. O mapa abre ${branches} ramo(s) mais fortes e segue cada um pelas conexões reais.`,
    it: `Percorso automatico: l'idea centrale collega ${degree} connessione/i${debatePart}. La mappa apre ${branches} ramo/i più forti e segue ciascuno attraverso i collegamenti reali.`,
    tr: `Otomatik gezinti: merkez fikir ${degree} bağlantı kurar${debatePart}. Harita ${branches} güçlü dalı açar ve her birini gerçek bağlantılar boyunca izler.`,
  } as Record<PromptLanguage, string>)[language];
}

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
  const language: PromptLanguage = request.language ?? getSettings().promptLanguage ?? 'es';
  // Automatic mode: build the tree structurally from the real graph edges,
  // no model needed. Falls through to the AI path otherwise.
  if (request.mode === 'auto') {
    return buildStructuralArgumentMap(request.seedIdeaId, language);
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
      summary: NO_CONNECTION_COPY[language].summary,
      relation: 'root',
      children: [],
    };
    return {
      seedIdeaId: seed.global_id,
      seedLabel: seed.label,
      overview: NO_CONNECTION_COPY[language].overview,
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
    type_label: EDGE_TYPE_LABELS_BY_LANGUAGE[language]?.[e.type] ?? e.type,
    basis: e.basis,
    confidence: e.confidence,
  }));

  const user = JSON.stringify({
    idea_semilla: { id: seed.global_id, type: seed.type, label: seed.label, statement: clip(seed.statement) },
    ideas: ideasPayload,
    conexiones: connectionsPayload,
  });

  const result = await completeJson<RawResult>(
    { system: argumentMapPrompt(language), user, temperature: 0.2, maxTokens: 8000 },
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
export function buildStructuralArgumentMap(seedIdeaId: string, language: PromptLanguage = getSettings().promptLanguage ?? 'es'): ArgumentMap {
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

  const lang = language;
  const relLabelOf = (rel: string): string =>
    (EDGE_TYPE_LABELS_BY_LANGUAGE[lang]?.[rel]) ?? rel;
  const structuralCountCopy = ({
    es: { connection: 'conexiones', debate: 'debate(s)', derivation: 'derivación(es)' },
    en: { connection: 'connection(s)', debate: 'debate(s)', derivation: 'derivation(s)' },
    fr: { connection: 'connexion(s)', debate: 'débat(s)', derivation: 'dérivation(s)' },
    de: { connection: 'Verbindung(en)', debate: 'Debatte(n)', derivation: 'Ableitung(en)' },
    pt: { connection: 'ligação(ões)', debate: 'debate(s)', derivation: 'derivação(ões)' },
    'pt-BR': { connection: 'conexão(ões)', debate: 'debate(s)', derivation: 'derivação(ões)' },
    it: { connection: 'connessione/i', debate: 'dibattito/i', derivation: 'derivazione/i' },
    tr: { connection: 'bağlantı', debate: 'tartışma', derivation: 'türetim' },
  } as Record<PromptLanguage, { connection: string; debate: string; derivation: string }>)[lang];
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
      block.summary = `${seedDegree} ${structuralCountCopy.connection}${seedDebate ? ` · ${seedDebate} ${structuralCountCopy.debate}` : ''}`;
    } else {
      const relLabel = relLabelOf(block.relation);
      const conf = parentEdgeOf.get(block.id)?.confidence ?? 0;
      block.summary =
        block.children.length > 0
          ? `${relLabel} · conf ${conf.toFixed(2)} · ${block.children.length} ${structuralCountCopy.derivation}`
          : `${relLabel} · conf ${conf.toFixed(2)}`;
    }
    for (const child of block.children) describe(child);
  };
  describe(root);

  const overview = structuralOverview(lang, seedDegree, seedDebate, root.children.length);

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
