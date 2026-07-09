import type {
  Author,
  ChatMessageRecord,
  Evidence,
  Gap,
  GraphEdge,
  GraphNode,
  Idea,
  ModelRef,
  ResearchChatRequest,
  ResearchChatResponse,
  ResearchContextSelection,
  ResearchContextStats,
  Work,
} from '@shared/types';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { buildAuthorGraph, buildIdeaGraph, buildReadingPath, getContradictions } from '../graph/graphService';
import { getItem, LOCAL_USER_ID } from '../zotero/zoteroClient';
import { resolveWorkText } from '../extraction/textExtractor';
import { completeText, completeTextStream } from './aiClient';
import { embed } from './aiClient';
import { findSimilarWorks } from '../db/workSummariesRepo';
import { findSimilarPassages } from '../db/passagesRepo';
import { findSimilarIdeas } from '../db/ideasRepo';

const MAX_HISTORY_MESSAGES = 12;
const MAX_DOCUMENTS = 30;
const MAX_DOCUMENT_CHARS = 12_000;
const MAX_DOCUMENT_TOTAL_CHARS = 160_000;
const MAX_SUMMARIES = 180;
const MAX_SUMMARY_CHARS = 5_000;
const MAX_SUMMARY_TOTAL_CHARS = 180_000;
const PASSAGE_SIM_THRESHOLD = 0.32;
const TOP_K_SCOPED_PASSAGES = 8;
const TOP_K_GLOBAL_PASSAGES = 6;
const MAX_PASSAGE_CONTEXT_CHARS = 24_000;

// ── Query-relevant retrieval ────────────────────────────────────────────────
// The graph sections used to dump the whole corpus regardless of the question,
// which overflowed the model's context window on large libraries. Instead we
// retrieve a top-K slice ranked by the question's embedding (via findSimilarIdeas
// / findSimilarWorks) and scope every derived section to that slice. When no
// embedding provider is configured we fall back to a bounded, most-supported
// slice so the payload is always capped.
const IDEA_SIM_THRESHOLD = 0.28;
const TOP_K_IDEAS = 60;
const MAX_OCCURRENCES_PER_IDEA = 6;
const MAX_EVIDENCE_PER_IDEA = 5;
const TOP_K_THEMES = 20;
const MAX_THEME_IDEAS = 12;
const MAX_THEME_WORKS = 12;
const TOP_K_CONTRADICTIONS = 30;
const TOP_K_GAPS = 30;
const TOP_K_AUTHORS = 25;
const MAX_AUTHOR_WORKS = 12;
const MAX_AUTHOR_IDEAS = 12;
const WORK_SIM_THRESHOLD = 0.2;
const TOP_K_SCOPE_WORKS = 120;
const MAX_GRAPH_IDEA_NODES = 50;
const MAX_GRAPH_THEME_NODES = 24;
const MAX_GRAPH_EDGES = 100;
// Backstop for the whole assembled context (~4 chars/token). Keeps the request
// well under the smallest supported model windows even with history + output,
// trimming the least query-relevant sections first if the caps above still
// leave the payload too large.
const MAX_TOTAL_CONTEXT_CHARS = 600_000;
const CONTEXT_DROP_ORDER = [
  'grafo',
  'documentos_relacionados',
  'rutas_de_lectura',
  'autores',
  'documentos_resumidos',
  'temas_principales',
  'huecos_de_investigacion',
  'contradicciones',
  'ideas_generadas',
  'pasajes_relevantes',
];

type SectionPayload = Record<string, unknown>;

/**
 * Query-relevance scope shared by every graph section. Built once per request
 * from the last user message so all sections agree on the same top-K slice.
 * A null id set means "no embedding available" — sections then fall back to a
 * bounded, most-supported selection instead of dumping the corpus.
 */
interface RelevanceScope {
  queryEmbedding: number[] | null;
  /** Ordered top-K idea ids relevant to the question, or null when no embedding is available. */
  ideaIds: string[] | null;
  ideaIdSet: Set<string> | null;
  /** Works linked to relevant ideas ∪ works whose summary matches the question. */
  workIdSet: Set<string> | null;
}

interface BuildResult {
  context: SectionPayload;
  stats: ResearchContextStats;
}

type WorkRow = Work;

type IdeaRow = Omit<Idea, 'embedding'>;

interface WorkSummary {
  nodus_id: string;
  zotero_key: string;
  title: string;
  authors: string[];
  year: number | null;
  item_type: string;
  doi: string | null;
  source_type: string | null;
}

interface PromptBuild {
  system: string;
  user: string;
  stats: ResearchContextStats;
}

export async function answerResearchChat(request: ResearchChatRequest): Promise<ResearchChatResponse> {
  const { system, user, stats } = await buildResearchChatPrompt(request);
  const answer = await completeText(
    {
      system,
      user,
      temperature: 0.2,
      maxTokens: 6000,
    },
    request.model
  );

  return { answer: answer.trim(), stats };
}

export async function streamResearchChat(
  request: ResearchChatRequest,
  onDelta: (delta: string, kind?: 'content' | 'reasoning') => void,
  signal?: AbortSignal
): Promise<ResearchChatResponse> {
  const { system, user, stats } = await buildResearchChatPrompt(request);
  const answer = await completeTextStream(
    {
      system,
      user,
      temperature: 0.2,
      maxTokens: 6000,
    },
    onDelta,
    request.model,
    signal
  );

  return { answer: answer.trim(), stats };
}

/**
 * Ask the chat model for a short title summarising the conversation so far. The model
 * that powered the conversation names it, per the product spec. Falls back to a trimmed
 * first user message when the model is unavailable or returns nothing usable.
 */
export async function generateChatTitle(messages: ChatMessageRecord[], model?: ModelRef | null): Promise<string> {
  const relevant = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim() && !m.error)
    .slice(0, 6)
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content.trim().slice(0, 600)}`);
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim())?.content.trim() ?? '';
  const fallback = firstUser ? truncateTitle(firstUser) : 'Conversación sin título';
  if (relevant.length === 0) return fallback;

  try {
    const raw = await completeText(
      {
        system:
          'Eres un asistente que pone títulos. Devuelve EXCLUSIVAMENTE un título breve (máximo 6 palabras), ' +
          'en español, sin comillas, sin punto final y sin prefijos como "Título:". Resume el tema de la conversación.',
        user: relevant.join('\n'),
        temperature: 0.2,
        maxTokens: 40,
      },
      model
    );
    const title = truncateTitle(raw);
    return title || fallback;
  } catch {
    return fallback;
  }
}

function truncateTitle(text: string): string {
  const clean = text
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^t[íi]tulo\s*:?\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/, '')
    .trim();
  if (!clean) return '';
  if (clean.length <= 60) return clean;
  return `${clean.slice(0, 57).trim()}…`;
}

async function buildResearchChatPrompt(request: ResearchChatRequest): Promise<PromptBuild> {
  const messages = request.messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim())
    .slice(-MAX_HISTORY_MESSAGES);

  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    throw new Error('El chat necesita una pregunta del usuario.');
  }

  const question = messages[messages.length - 1].content;
  const { context, stats } = await buildResearchContext(request.selection, question);
  const system = [
    'Eres el asistente de investigacion avanzado de Nodus.',
    'Responde en espanol, con rigor academico y usando solo el contexto modular que recibes.',
    'Si el contexto seleccionado no contiene la seccion necesaria, dilo de forma concreta y explica que seccion convendria activar.',
    'Conserva las relaciones entre autores, documentos e ideas cuando esten presentes en el contexto.',
    'No inventes contenido de documentos que no aparezca en el contexto.',
    '',
    'CITAS DE FUENTES (obligatorio, estilo NotebookLM):',
    '- Cada vez que te refieras a una idea concreta (afirmacion, hallazgo, constructo, metodo o marco) presente en el contexto, DEBES citar su fuente inmediatamente despues de la mencion.',
    '- La cita es un enlace markdown con el formato `[Autor, Año](nodus://idea/<id>)`, donde `<id>` es el campo `id` exacto de la idea en el contexto y `Autor, Año` provienen de la obra que la desarrolla (usa el apellido del primer autor y el año). Ejemplo: `la memoria de trabajo es limitada ([Baddeley, 1992](nodus://idea/abc-123))`.',
    '- Si la idea aparece en varias obras, cita la principal; si citas dos, repite el enlace con cada autor.',
    '- Para citar un documento concreto sin idea asociada, usa `[Autor, Año](nodus://work/<nodus_id>)` con el `nodus_id` exacto del documento.',
    '- Para citar una contradiccion o refutacion concreta de la seccion `contradicciones`, usa `[contradiccion](nodus://contradiction/<id>)` con el `id` exacto de esa relacion.',
    '- Para citar un hueco concreto de la seccion `huecos_de_investigacion`, usa `[hueco](nodus://gap/<id>)` con el `id` exacto de ese hueco.',
    '- La sección `pasajes_relevantes` contiene texto literal de las obras. Cuando sostengas una afirmación con uno de esos pasajes, cítalo inmediatamente como `[Autor, Año, p. N](nodus://passage/<id>)` usando el campo `citation` exacto del pasaje. No atribuyas al pasaje más de lo que dice literalmente.',
    '- Si una conclusion se apoya en una idea y tambien en una contradiccion o hueco, incluye ambas citas junto a la frase relevante.',
    '- Usa SIEMPRE el id exacto que aparece en el contexto. Nunca inventes ni abrevies los ids.',
    '- No conviertas en enlace las citas a obras que no esten en el contexto; en ese caso nombra autor y año en texto plano.',
    '- La sección `documentos_resumidos` contiene resúmenes de ORIENTACIÓN. Úsala para ubicar y comparar obras, pero NUNCA la cites como evidencia ni atribuyas a ella afirmaciones verificables. Las citas deben seguir apuntando a ideas, evidencias, huecos, contradicciones o la obra original.',
  ].join('\n');

  const user = JSON.stringify(
    {
      contexto_modular_seleccionado: context,
      conversacion: messages,
    },
    null,
    2
  );

  return { system, user, stats };
}

/**
 * Resolve the query embedding once and derive the shared relevance scope (top-K
 * ideas + the works those ideas live in ∪ works whose summary matches). Every
 * graph section ranks/filters against this so the assembled context is a
 * bounded, question-relevant slice rather than a full-corpus dump.
 */
async function buildRelevanceScope(selection: ResearchContextSelection, question: string): Promise<RelevanceScope> {
  const needsRelevance =
    selection.ideas ||
    selection.themes ||
    selection.contradictions ||
    selection.gaps ||
    selection.authors ||
    selection.graph ||
    selection.documents ||
    selection.passages !== false;

  let queryEmbedding: number[] | null = null;
  if (needsRelevance && question.trim()) {
    try {
      queryEmbedding = await embed(question.trim());
    } catch (error) {
      // Semantic retrieval is an evidence layer, not a reason to block an answer
      // when the user has not configured an embedding provider yet. Sections then
      // fall back to their bounded, most-supported selection.
      console.warn('[researchAssistant] semantic retrieval unavailable:', error instanceof Error ? error.message : String(error));
    }
  }

  if (!queryEmbedding) {
    return { queryEmbedding: null, ideaIds: null, ideaIdSet: null, workIdSet: null };
  }

  // Zero matches (query far from the corpus, or ideas not yet embedded for the
  // active provider) must fall back to the bounded default rather than filter
  // every section down to nothing — so an empty result becomes a null scope,
  // not an empty one. queryEmbedding is kept for documents/passages retrieval.
  const similarIdeas = findSimilarIdeas(queryEmbedding, IDEA_SIM_THRESHOLD, TOP_K_IDEAS).map((row) => row.global_id);
  const ideaIds = similarIdeas.length ? similarIdeas : null;
  const ideaIdSet = ideaIds ? new Set(ideaIds) : null;

  const workIds = new Set<string>();
  if (ideaIds) {
    const placeholders = ideaIds.map(() => '?').join(',');
    const rows = getDb()
      .prepare(`SELECT DISTINCT nodus_id FROM idea_occurrences WHERE global_id IN (${placeholders})`)
      .all(...ideaIds) as { nodus_id: string }[];
    for (const row of rows) workIds.add(row.nodus_id);
  }
  for (const row of findSimilarWorks(queryEmbedding, WORK_SIM_THRESHOLD, TOP_K_SCOPE_WORKS)) {
    workIds.add(row.nodus_id);
  }
  const workIdSet = workIds.size ? workIds : null;

  return { queryEmbedding, ideaIds, ideaIdSet, workIdSet };
}

/**
 * Ordered idea ids for the Ideas section. Uses the query-relevant top-K when an
 * embedding is available, otherwise falls back to the most-supported ideas so
 * the section stays bounded even without embeddings.
 */
function resolveIdeaIds(scope: RelevanceScope, limit: number): string[] {
  if (scope.ideaIds) return scope.ideaIds.slice(0, limit);
  const rows = getDb()
    .prepare(
      `SELECT i.global_id
         FROM ideas i
         LEFT JOIN idea_occurrences io ON io.global_id = i.global_id
        GROUP BY i.global_id
        ORDER BY COUNT(io.nodus_id) DESC, i.created_at DESC
        LIMIT ?`
    )
    .all(limit) as { global_id: string }[];
  return rows.map((row) => row.global_id);
}

/**
 * Final safety net: even after per-section caps, drop the least query-relevant
 * sections until the serialized context fits the token budget. This should rarely
 * fire given the top-K caps, but guarantees the request never overflows.
 */
function enforceContextBudget(context: SectionPayload): { truncated: boolean } {
  const dropped: string[] = [];
  for (const key of CONTEXT_DROP_ORDER) {
    if (JSON.stringify(context).length <= MAX_TOTAL_CONTEXT_CHARS) break;
    if (context[key] == null) continue;
    delete context[key];
    dropped.push(key);
  }
  if (dropped.length) {
    context.contexto_recortado = {
      motivo: 'El contexto superaba el presupuesto de tokens; se omitieron las secciones menos relevantes a la consulta.',
      secciones_omitidas: dropped,
    };
  }
  return { truncated: dropped.length > 0 };
}

async function buildResearchContext(selection: ResearchContextSelection, question = ''): Promise<BuildResult> {
  const context: SectionPayload = {
    generated_at: new Date().toISOString(),
    note: 'Este objeto contiene exclusivamente las secciones marcadas por el usuario, acotadas a lo relevante para la consulta.',
  };
  const sections: string[] = [];
  const linkedWorkIds = new Set<string>();
  let truncated = false;

  const scope = await buildRelevanceScope(selection, question);

  if (selection.ideas) {
    context.ideas_generadas = listIdeas(linkedWorkIds, scope);
    sections.push('Ideas generadas');
  }

  if (selection.themes) {
    context.temas_principales = listThemes(linkedWorkIds, scope);
    sections.push('Temas principales');
  }

  if (selection.contradictions) {
    context.contradicciones = listContradictions(linkedWorkIds, scope);
    sections.push('Contradicciones');
  }

  if (selection.gaps) {
    context.huecos_de_investigacion = listGaps(linkedWorkIds, scope);
    sections.push('Huecos de investigacion');
  }

  if (selection.readingPath) {
    const plan = buildReadingPath();
    for (const phase of plan.phases) {
      for (const entry of phase.entries) linkedWorkIds.add(entry.nodus_id);
    }
    context.rutas_de_lectura = plan;
    sections.push('Rutas de lectura');
  }

  if (selection.authors) {
    context.autores = listAuthors(linkedWorkIds, scope);
    sections.push('Autores');
  }

  if (selection.graph) {
    context.grafo = listGraph(selection, linkedWorkIds, scope);
    sections.push('Grafo');
  }

  const passageScopeWorkIds = new Set(linkedWorkIds);

  if (selection.documents) {
    const documentContext = await listDocuments(linkedWorkIds, scope.queryEmbedding);
    context.documentos_relacionados = documentContext.documents;
    context.documentos_resumidos = documentContext.summaries;
    if (documentContext.omitted > 0) {
      context.documentos_relacionados_omitidos = documentContext.omitted;
    }
    sections.push('Documentos relacionados');
    truncated = truncated || documentContext.truncated;
  }

  // Default to enabled for historic saved selections created before the passage
  // toggle existed. Explicit false still gives the reader full control.
  if (selection.passages !== false) {
    const passages = listRelevantPassages(scope.queryEmbedding, passageScopeWorkIds);
    context.pasajes_relevantes = passages;
    sections.push('Pasajes de texto completo');
  }

  const budget = enforceContextBudget(context);
  truncated = truncated || budget.truncated;

  const contextChars = JSON.stringify(context).length;
  return {
    context,
    stats: {
      sections,
      works: linkedWorkIds.size,
      documents: selection.documents && Array.isArray(context.documentos_relacionados)
        ? context.documentos_relacionados.length
        : 0,
      summaries: selection.documents && Array.isArray(context.documentos_resumidos)
        ? context.documentos_resumidos.length
        : 0,
      passages: Array.isArray(context.pasajes_relevantes) ? context.pasajes_relevantes.length : 0,
      contextChars,
      truncated,
    },
  };
}

function listIdeas(linkedWorkIds: Set<string>, scope: RelevanceScope) {
  const db = getDb();
  const ideaIds = resolveIdeaIds(scope, TOP_K_IDEAS);
  if (ideaIds.length === 0) return [];
  const placeholders = ideaIds.map(() => '?').join(',');

  const ideas = db
    .prepare(`SELECT global_id, type, label, statement, created_at FROM ideas WHERE global_id IN (${placeholders})`)
    .all(...ideaIds) as IdeaRow[];
  const ideaById = new Map(ideas.map((idea) => [idea.global_id, idea]));

  const occurrences = db
    .prepare(
      `SELECT io.global_id, io.nodus_id, io.role, io.development, io.confidence,
              w.zotero_key, w.title, w.authors_json, w.year, w.item_type, w.doi, w.source_type
       FROM idea_occurrences io
       JOIN works w ON w.nodus_id = io.nodus_id
       WHERE w.archived = 0 AND io.global_id IN (${placeholders})
       ORDER BY w.year DESC, w.title ASC`
    )
    .all(...ideaIds) as Array<{
      global_id: string;
      nodus_id: string;
      role: string;
      development: string;
      confidence: number;
      zotero_key: string;
      title: string;
      authors_json: string;
      year: number | null;
      item_type: string;
      doi: string | null;
      source_type: string | null;
    }>;
  const evidence = db
    .prepare(`SELECT * FROM evidence WHERE global_id IN (${placeholders}) ORDER BY nodus_id ASC`)
    .all(...ideaIds) as Evidence[];

  const occByIdea = groupBy(occurrences, (o) => o.global_id);
  const evidenceByIdea = groupBy(evidence, (e) => e.global_id);

  // Preserve the relevance order returned by resolveIdeaIds.
  return ideaIds
    .map((id) => ideaById.get(id))
    .filter((idea): idea is IdeaRow => Boolean(idea))
    .map((idea) => {
      const occs = (occByIdea.get(idea.global_id) ?? []).slice(0, MAX_OCCURRENCES_PER_IDEA);
      for (const occurrence of occs) linkedWorkIds.add(occurrence.nodus_id);
      return {
        id: idea.global_id,
        type: idea.type,
        label: idea.label,
        statement: idea.statement,
        occurrences: occs.map((o) => ({
          role: o.role,
          development: o.development,
          confidence: o.confidence,
          work: workSummary(o),
        })),
        evidence: (evidenceByIdea.get(idea.global_id) ?? []).slice(0, MAX_EVIDENCE_PER_IDEA).map(evidenceSummary),
      };
    });
}

function listThemes(linkedWorkIds: Set<string>, scope: RelevanceScope) {
  const db = getDb();
  let themes = db
    .prepare(
      `SELECT t.theme_id, t.label, t.created_at,
              COUNT(DISTINCT wt.nodus_id) AS work_count,
              COUNT(DISTINCT it.global_id) AS idea_count
       FROM themes t
       LEFT JOIN work_themes wt ON wt.theme_id = t.theme_id
       LEFT JOIN idea_theme_links it ON it.theme_id = t.theme_id
       GROUP BY t.theme_id
       ORDER BY idea_count DESC, work_count DESC, t.label ASC`
    )
    .all() as Array<{ theme_id: string; label: string; created_at: string; work_count: number; idea_count: number }>;

  // Keep only themes that carry at least one query-relevant idea.
  if (scope.ideaIdSet && scope.ideaIds && scope.ideaIds.length) {
    const placeholders = scope.ideaIds.map(() => '?').join(',');
    const linkedThemeIds = new Set(
      (
        db
          .prepare(`SELECT DISTINCT theme_id FROM idea_theme_links WHERE global_id IN (${placeholders})`)
          .all(...scope.ideaIds) as { theme_id: string }[]
      ).map((row) => row.theme_id)
    );
    themes = themes.filter((theme) => linkedThemeIds.has(theme.theme_id));
  }
  themes = themes.slice(0, TOP_K_THEMES);

  return themes.map((theme) => {
    const works = (
      db
        .prepare(
          `SELECT w.nodus_id, w.zotero_key, w.title, w.authors_json, w.year, w.item_type, w.doi, w.source_type
           FROM work_themes wt
           JOIN works w ON w.nodus_id = wt.nodus_id
           WHERE wt.theme_id = ? AND w.archived = 0
           ORDER BY w.year DESC, w.title ASC`
        )
        .all(theme.theme_id) as Array<WorkRow & { authors_json: string }>
    ).slice(0, MAX_THEME_WORKS);
    const allIdeas = db
      .prepare(
        `SELECT DISTINCT i.global_id, i.type, i.label, i.statement
         FROM idea_theme_links it
         JOIN ideas i ON i.global_id = it.global_id
         WHERE it.theme_id = ?
         ORDER BY i.label ASC`
      )
      .all(theme.theme_id) as Array<{ global_id: string; type: string; label: string; statement: string }>;
    // Surface the relevant ideas first; fall back to all when none intersect.
    let ideas = allIdeas;
    if (scope.ideaIdSet) {
      const relevant = allIdeas.filter((idea) => scope.ideaIdSet!.has(idea.global_id));
      ideas = relevant.length ? relevant : allIdeas;
    }
    ideas = ideas.slice(0, MAX_THEME_IDEAS);
    for (const work of works) linkedWorkIds.add(work.nodus_id);
    return {
      id: theme.theme_id,
      label: theme.label,
      work_count: theme.work_count,
      idea_count: theme.idea_count,
      works: works.map(workSummary),
      ideas: ideas.map((idea) => ({
        id: idea.global_id,
        type: idea.type,
        label: idea.label,
        statement: idea.statement,
      })),
    };
  });
}

function listContradictions(linkedWorkIds: Set<string>, scope: RelevanceScope) {
  const db = getDb();
  let details = getContradictions();
  // Keep contradictions that touch a query-relevant idea, then cap by confidence.
  if (scope.ideaIdSet) {
    const set = scope.ideaIdSet;
    details = details.filter((detail) => set.has(detail.edge.from_id) || set.has(detail.edge.to_id));
  }
  details = details
    .slice()
    .sort((a, b) => (b.edge.confidence ?? 0) - (a.edge.confidence ?? 0))
    .slice(0, TOP_K_CONTRADICTIONS);
  return details.map((detail) => {
    if (detail.edge.source_work) linkedWorkIds.add(detail.edge.source_work);
    for (const ev of detail.evidence) linkedWorkIds.add(ev.nodus_id);
    const from = db.prepare('SELECT global_id, type, label, statement FROM ideas WHERE global_id = ?').get(detail.edge.from_id) as
      | { global_id: string; type: string; label: string; statement: string }
      | undefined;
    const to = db.prepare('SELECT global_id, type, label, statement FROM ideas WHERE global_id = ?').get(detail.edge.to_id) as
      | { global_id: string; type: string; label: string; statement: string }
      | undefined;
    return {
      id: detail.edge.id,
      type: detail.edge.type,
      basis: detail.edge.basis,
      confidence: detail.edge.confidence,
      explanation: detail.explanation,
      from: from
        ? { id: from.global_id, type: from.type, label: from.label, statement: from.statement }
        : { id: detail.edge.from_id, label: detail.fromLabel },
      to: to ? { id: to.global_id, type: to.type, label: to.label, statement: to.statement } : { id: detail.edge.to_id, label: detail.toLabel },
      source_work: detail.edge.source_work ? getWorkSummary(detail.edge.source_work) : null,
      evidence: detail.evidence.map(evidenceSummary),
    };
  });
}

function listGaps(linkedWorkIds: Set<string>, scope: RelevanceScope) {
  const rows = getDb()
    .prepare(
      `SELECT g.*, w.zotero_key, w.title, w.authors_json, w.year, w.item_type, w.doi, w.source_type,
              i.label AS idea_label, i.statement AS idea_statement,
              e.quote AS evidence_quote, e.location AS evidence_location, e.kind AS evidence_kind
       FROM gaps g
       JOIN works w ON w.nodus_id = g.nodus_id
       LEFT JOIN ideas i ON i.global_id = g.related_idea
       LEFT JOIN evidence e ON e.id = g.evidence_id
       WHERE w.archived = 0
       ORDER BY g.confidence DESC, w.year DESC`
    )
    .all() as Array<Gap & {
      zotero_key: string;
      title: string;
      authors_json: string;
      year: number | null;
      item_type: string;
      doi: string | null;
      source_type: string | null;
      idea_label: string | null;
      idea_statement: string | null;
      evidence_quote: string | null;
      evidence_location: string | null;
      evidence_kind: string | null;
    }>;

  // Prefer gaps tied to a query-relevant idea; backfill with the highest-
  // confidence remaining gaps. Rows are already confidence-ordered.
  let selected = rows;
  if (scope.ideaIdSet) {
    const set = scope.ideaIdSet;
    const linked = rows.filter((row) => row.related_idea != null && set.has(row.related_idea));
    const rest = rows.filter((row) => !(row.related_idea != null && set.has(row.related_idea)));
    selected = [...linked, ...rest];
  }
  selected = selected.slice(0, TOP_K_GAPS);

  return selected.map((row) => {
    linkedWorkIds.add(row.nodus_id);
    return {
      id: row.id,
      kind: row.kind,
      statement: row.statement,
      confidence: row.confidence,
      related_idea: row.related_idea
        ? {
            id: row.related_idea,
            label: row.idea_label,
            statement: row.idea_statement,
          }
        : null,
      work: workSummary(row),
      evidence: row.evidence_quote
        ? {
            quote: row.evidence_quote,
            location: row.evidence_location,
            kind: row.evidence_kind,
          }
        : null,
    };
  });
}

function listAuthors(linkedWorkIds: Set<string>, scope: RelevanceScope) {
  const db = getDb();
  let authors = db.prepare('SELECT * FROM authors ORDER BY name ASC').all() as Author[];

  // Keep authors who wrote a work in the query-relevant scope.
  if (scope.workIdSet) {
    const workIds = [...scope.workIdSet];
    if (workIds.length === 0) {
      authors = [];
    } else {
      const placeholders = workIds.map(() => '?').join(',');
      const relevantAuthorIds = new Set(
        (
          db
            .prepare(`SELECT DISTINCT author_id FROM work_authors WHERE nodus_id IN (${placeholders})`)
            .all(...workIds) as { author_id: string }[]
        ).map((row) => row.author_id)
      );
      authors = authors.filter((author) => relevantAuthorIds.has(author.author_id));
    }
  }
  authors = authors.slice(0, TOP_K_AUTHORS);
  const authorIdSet = new Set(authors.map((author) => author.author_id));

  const relations = (
    db
      .prepare(
        `SELECT ar.from_author, fa.name AS from_name, ar.to_author, ta.name AS to_name, ar.type, ar.weight
         FROM author_relations ar
         JOIN authors fa ON fa.author_id = ar.from_author
         JOIN authors ta ON ta.author_id = ar.to_author
         ORDER BY ar.weight DESC`
      )
      .all() as Array<{
        from_author: string;
        from_name: string;
        to_author: string;
        to_name: string;
        type: string;
        weight: number;
      }>
  ).filter((relation) => authorIdSet.has(relation.from_author) && authorIdSet.has(relation.to_author));

  return {
    authors: authors.map((author) => {
      const works = (
        db
          .prepare(
            `SELECT w.nodus_id, w.zotero_key, w.title, w.authors_json, w.year, w.item_type, w.doi, w.source_type
             FROM work_authors wa
             JOIN works w ON w.nodus_id = wa.nodus_id
             WHERE wa.author_id = ? AND w.archived = 0
             ORDER BY w.year DESC, w.title ASC`
          )
          .all(author.author_id) as Array<WorkRow & { authors_json: string }>
      ).slice(0, MAX_AUTHOR_WORKS);
      const allIdeas = db
        .prepare(
          `SELECT DISTINCT i.global_id, i.type, i.label, i.statement
           FROM work_authors wa
           JOIN idea_occurrences io ON io.nodus_id = wa.nodus_id
           JOIN ideas i ON i.global_id = io.global_id
           WHERE wa.author_id = ?
           ORDER BY i.label ASC`
        )
        .all(author.author_id) as Array<{ global_id: string; type: string; label: string; statement: string }>;
      let ideas = allIdeas;
      if (scope.ideaIdSet) {
        const relevant = allIdeas.filter((idea) => scope.ideaIdSet!.has(idea.global_id));
        ideas = relevant.length ? relevant : allIdeas;
      }
      ideas = ideas.slice(0, MAX_AUTHOR_IDEAS);
      for (const work of works) linkedWorkIds.add(work.nodus_id);
      return {
        id: author.author_id,
        name: author.name,
        affiliation: author.affiliation,
        works: works.map(workSummary),
        ideas: ideas.map((idea) => ({
          id: idea.global_id,
          type: idea.type,
          label: idea.label,
          statement: idea.statement,
        })),
      };
    }),
    relations,
  };
}

/**
 * Emit the graph *structure* the model can reason and cite over — not the
 * rendering metadata. We keep each node's id/label/type/statement and the
 * relations; we drop the heavy fields (workIds, years, read, workCount, plus the
 * authors/themes name arrays that balloon on aggregate nodes) since that detail
 * already lives in the dedicated autores/temas sections. Cuts the section ~5x.
 */
function slimGraphNode(node: GraphNode) {
  return {
    id: node.id,
    label: node.label,
    type: node.type,
    statement: node.statement,
    max_confidence: node.maxConfidence,
  };
}

function slimGraphEdge(edge: GraphEdge) {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type,
    basis: edge.basis,
    confidence: edge.confidence,
  };
}

function listGraph(selection: ResearchContextSelection, linkedWorkIds: Set<string>, scope: RelevanceScope) {
  const parts = selection.graphParts;
  const out: SectionPayload = {};
  const ideaGraph = buildIdeaGraph();
  const ideaSet = scope.ideaIdSet;

  if (parts.ideaNodes) {
    let nodes = ideaGraph.nodes.filter((node) => node.type !== 'theme');
    if (ideaSet) nodes = nodes.filter((node) => ideaSet.has(node.id));
    nodes = nodes.slice(0, MAX_GRAPH_IDEA_NODES);
    out.nodos_de_ideas = nodes.map(slimGraphNode);
    for (const node of nodes) addIdeaWorkIds(node.id, linkedWorkIds);
  }
  if (parts.themeNodes) {
    const themeNodes = ideaGraph.nodes.filter((node) => node.type === 'theme').slice(0, MAX_GRAPH_THEME_NODES);
    out.nodos_de_temas = themeNodes.map(slimGraphNode);
    for (const node of themeNodes) {
      if (node.id.startsWith('theme:')) addThemeWorkIds(node.id.slice('theme:'.length), linkedWorkIds);
    }
  }
  if (parts.ideaEdges) {
    let edges = ideaGraph.edges;
    if (ideaSet) edges = edges.filter((edge) => ideaSet.has(edge.source) && ideaSet.has(edge.target));
    edges = edges.slice(0, MAX_GRAPH_EDGES);
    out.relaciones_de_ideas = edges.map(slimGraphEdge);
    for (const edge of edges) {
      addIdeaWorkIds(edge.source, linkedWorkIds);
      addIdeaWorkIds(edge.target, linkedWorkIds);
    }
  }
  if (parts.authorGraph) {
    const authorGraph = buildAuthorGraph();
    const nodes = authorGraph.nodes.slice(0, TOP_K_AUTHORS);
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = authorGraph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    out.grafo_de_autores = { nodes: nodes.map(slimGraphNode), edges: edges.map(slimGraphEdge) };
    for (const node of nodes) addAuthorWorkIds(node.id, linkedWorkIds);
  }
  return out;
}

async function listDocuments(
  linkedWorkIds: Set<string>,
  queryEmbedding: number[] | null
): Promise<{ documents: unknown[]; summaries: unknown[]; omitted: number; truncated: boolean }> {
  const candidateWorks = selectDocumentWorks(linkedWorkIds, queryEmbedding);
  const works = candidateWorks.slice(0, MAX_DOCUMENTS);
  const omitted = Math.max(0, candidateWorks.length - works.length);
  const settings = getSettings();
  const userId = settings.zoteroUserId || LOCAL_USER_ID;
  const documents: unknown[] = [];
  let totalChars = 0;
  let truncated = omitted > 0;
  const summaries = listDocumentSummaries(candidateWorks);

  for (const work of works) {
    linkedWorkIds.add(work.nodus_id);
    const item = await getItem(userId, work.zotero_key).catch(() => null);
    const doc = await resolveWorkText(userId, work.zotero_key, settings.zoteroStoragePath, item?.abstract ?? null, work.doi, {
      unpaywallEmail: settings.unpaywallEmail,
      preferZoteroFulltext: settings.preferZoteroFulltext,
      ocr: {
        enabled: settings.ocrEnabled,
        languages: settings.ocrLanguages,
        maxPages: settings.ocrMaxPages,
      },
    }).catch((e) => ({
      text: '',
      sourceType: work.source_type ?? 'none',
      notes: e instanceof Error ? e.message : String(e),
    }));
    const remaining = Math.max(0, MAX_DOCUMENT_TOTAL_CHARS - totalChars);
    const clipped = clipText(doc.text, Math.min(MAX_DOCUMENT_CHARS, remaining));
    totalChars += clipped.text.length;
    truncated = truncated || clipped.truncated;
    documents.push({
      work: workSummary(work),
      source_type: doc.sourceType,
      notes: doc.notes,
      text: clipped.text,
      truncated: clipped.truncated,
      original_chars: doc.text.length,
    });
    if (totalChars >= MAX_DOCUMENT_TOTAL_CHARS) {
      truncated = true;
      break;
    }
  }

  return { documents, summaries, omitted, truncated };
}

function selectDocumentWorks(linkedWorkIds: Set<string>, queryEmbedding: number[] | null): WorkRow[] {
  const db = getDb();
  let works: WorkRow[];
  if (linkedWorkIds.size > 0) {
    const all = Array.from(linkedWorkIds)
      .map((id) => db.prepare('SELECT * FROM works WHERE nodus_id = ? AND archived = 0').get(id) as WorkRow | undefined)
      .filter((work): work is WorkRow => Boolean(work));
    works = all;
  } else {
    works = db
      .prepare("SELECT * FROM works WHERE archived = 0 ORDER BY deep_status = 'done' DESC, year DESC, title ASC")
      .all() as WorkRow[];
  }
  const fallback = (a: WorkRow, b: WorkRow) =>
    Number(b.deep_status === 'done') - Number(a.deep_status === 'done') ||
    (b.year ?? 0) - (a.year ?? 0) ||
    a.title.localeCompare(b.title);
  if (!queryEmbedding) return works.sort(fallback);
  const similarities = new Map(findSimilarWorks(queryEmbedding, -1, Math.max(works.length, MAX_SUMMARIES)).map((row) => [row.nodus_id, row.similarity]));
  return works.sort((a, b) => {
    const aSimilarity = similarities.get(a.nodus_id);
    const bSimilarity = similarities.get(b.nodus_id);
    if (aSimilarity != null || bSimilarity != null) return (bSimilarity ?? -Infinity) - (aSimilarity ?? -Infinity) || fallback(a, b);
    return fallback(a, b);
  });
}

function listRelevantPassages(queryEmbedding: number[] | null, linkedWorkIds: Set<string>): unknown[] {
  if (!queryEmbedding) return [];
  const scoped = linkedWorkIds.size
    ? findSimilarPassages(queryEmbedding, PASSAGE_SIM_THRESHOLD, TOP_K_SCOPED_PASSAGES, {
        nodusIds: [...linkedWorkIds],
      })
    : [];
  const global = findSimilarPassages(queryEmbedding, PASSAGE_SIM_THRESHOLD, TOP_K_GLOBAL_PASSAGES);
  const unique = new Map<string, (typeof global)[number]>();
  for (const passage of [...scoped, ...global]) {
    if (!unique.has(passage.passage_id)) unique.set(passage.passage_id, passage);
  }

  let chars = 0;
  const passages: unknown[] = [];
  for (const passage of unique.values()) {
    const remaining = MAX_PASSAGE_CONTEXT_CHARS - chars;
    if (remaining <= 0) break;
    const clipped = clipText(passage.text, remaining);
    if (!clipped.text) continue;
    chars += clipped.text.length;
    passages.push({
      text: clipped.text,
      truncated: clipped.truncated,
      similarity: Number(passage.similarity.toFixed(3)),
      location: passage.page_label,
      work: {
        nodus_id: passage.nodus_id,
        title: passage.title,
        authors: parseAuthors(passage.authors_json),
        year: passage.year,
        zotero_key: passage.zotero_key,
      },
      citation: `nodus://passage/${encodeURIComponent(passage.passage_id)}`,
    });
  }
  return passages;
}

function listDocumentSummaries(candidateWorks: WorkRow[]): unknown[] {
  const ids = candidateWorks.map((work) => work.nodus_id);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT ws.nodus_id, ws.summary, ws.source_level
         FROM work_summaries ws
         JOIN works w ON w.nodus_id = ws.nodus_id
        WHERE ws.nodus_id IN (${placeholders})
          AND w.summary_status = 'done'`
    )
    .all(...ids) as { nodus_id: string; summary: string; source_level: 'deep' | 'light' }[];
  const byWork = new Map(rows.map((row) => [row.nodus_id, row]));
  const summaries: unknown[] = [];
  let chars = 0;
  for (const work of candidateWorks) {
    const row = byWork.get(work.nodus_id);
    if (!row || summaries.length >= MAX_SUMMARIES) continue;
    const remaining = Math.max(0, MAX_SUMMARY_TOTAL_CHARS - chars);
    if (remaining === 0) break;
    const clipped = clipText(row.summary, Math.min(MAX_SUMMARY_CHARS, remaining));
    chars += clipped.text.length;
    summaries.push({
      work: workSummary(work),
      summary: clipped.text,
      source_level: row.source_level,
      orientation_only: true,
      truncated: clipped.truncated,
    });
  }
  return summaries;
}

function getWorkSummary(nodusId: string): WorkSummary | null {
  const row = getDb().prepare('SELECT * FROM works WHERE nodus_id = ?').get(nodusId) as WorkRow | undefined;
  return row ? workSummary(row) : null;
}

function workSummary(row: {
  nodus_id: string;
  zotero_key: string;
  title: string;
  authors_json: string;
  year: number | null;
  item_type: string;
  doi: string | null;
  source_type: string | null;
}): WorkSummary {
  return {
    nodus_id: row.nodus_id,
    zotero_key: row.zotero_key,
    title: row.title,
    authors: parseAuthors(row.authors_json),
    year: row.year,
    item_type: row.item_type,
    doi: row.doi,
    source_type: row.source_type,
  };
}

function parseAuthors(authorsJson: string): string[] {
  try {
    const parsed = JSON.parse(authorsJson || '[]');
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

function evidenceSummary(e: Evidence) {
  return {
    quote: e.quote,
    location: e.location,
    kind: e.kind,
    work_id: e.nodus_id,
  };
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function addIdeaWorkIds(globalId: string, out: Set<string>): void {
  if (globalId.startsWith('theme:')) return;
  const rows = getDb()
    .prepare('SELECT nodus_id FROM idea_occurrences WHERE global_id = ?')
    .all(globalId) as { nodus_id: string }[];
  for (const row of rows) out.add(row.nodus_id);
}

function addThemeWorkIds(themeId: string, out: Set<string>): void {
  const rows = getDb().prepare('SELECT nodus_id FROM work_themes WHERE theme_id = ?').all(themeId) as { nodus_id: string }[];
  for (const row of rows) out.add(row.nodus_id);
}

function addAuthorWorkIds(authorId: string, out: Set<string>): void {
  const rows = getDb().prepare('SELECT nodus_id FROM work_authors WHERE author_id = ?').all(authorId) as { nodus_id: string }[];
  for (const row of rows) out.add(row.nodus_id);
}

function clipText(text: string, max: number): { text: string; truncated: boolean } {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return { text: clean, truncated: false };
  if (max <= 0) return { text: '', truncated: true };
  return { text: `${clean.slice(0, max).trim()}...`, truncated: true };
}
