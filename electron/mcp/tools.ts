import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AI_PROVIDERS as SHARED_AI_PROVIDERS } from '@shared/providers';
import type {
  AiProvider,
  Debate,
  LightStatus,
  DeepStatus,
  ModelRef,
  NoteSource,
  ProjectChapter,
  ProjectKind,
  ProjectStatus,
  SummaryStatus,
  WritingWorkshopBrief,
  WritingWorkshopDraft,
  WritingWorkshopSelection,
  WorkFilter,
  AuthorSummary,
} from '@shared/types';
import { getDb } from '../db/database';
import { getActiveVault, listVaults } from '../vaults/vaultRegistry';
import * as ideas from '../db/ideasRepo';
import { getWork, getWorkByZoteroKey, getWorkByAliasKey, listWorks } from '../db/worksRepo';
import * as gaps from '../db/gapsRepo';
import * as notes from '../db/notesRepo';
import * as passages from '../db/passagesRepo';
import * as projects from '../db/projectsRepo';
import * as researchQuestions from '../db/researchMapRepo';
import * as themes from '../db/themesRepo';
import * as tutorRoutes from '../db/tutorRepo';
import * as workSummaries from '../db/workSummariesRepo';
import * as writingDrafts from '../db/writingDraftsRepo';
import { buildAuthorGraph, getDebate, getDebates } from '../graph/graphService';
import { embed, AiError } from '../ai/aiClient';
import { decomposeQuestion, mapCoverage } from '../ai/researchMap';
import { buildWritingWorkshopSnapshot, generateWritingWorkshopDraft } from '../ai/writingWorkshop';
import { generateDeepResearchReport } from '../ai/deepResearch';
import { buildDeepResearchBrief, assembleClientDeepResearchReport } from '../ai/deepResearchClient';
import { analyzeText, composeCopilotIdeaInsertion, getCopilotIdeaDetail } from '../ai/liveRelations';
import {
  buildAuthorDossier,
  listAuthors as listAuthorSummaries,
  synthesizeAuthorDossier,
} from '../ai/authorDossier';

const IDEA_TYPES = ['claim', 'finding', 'construct', 'method', 'framework'] as const;
const EDGE_TYPES = [
  'extends',
  'contradicts',
  'applies_to',
  'shares_method',
  'precondition_of',
  'measures_same',
  'supports',
  'refutes',
  'variant_of',
  'refines',
  'contains',
] as const;
const GAP_KINDS = ['future_work', 'limitation', 'open_question', 'unresolved_contradiction'] as const;
const LIGHT_STATUSES = ['all', 'none', 'pending', 'done', 'failed'] as const;
const DEEP_STATUSES = ['all', 'none', 'pending', 'done', 'failed', 'skipped_no_text'] as const;
const SUMMARY_STATUSES = ['all', 'none', 'pending', 'done', 'failed', 'skipped_no_text'] as const;
// The canonical provider list had drifted here (xiaomi and the local providers
// were missing), silently rejecting valid model overrides from MCP clients.
const AI_PROVIDERS = SHARED_AI_PROVIDERS as [AiProvider, ...AiProvider[]];
const NOTE_KINDS = ['markdown', 'assistant', 'writing', 'debate', 'idea'] as const;
const PROJECT_KINDS = ['thesis', 'article', 'chapter', 'literature_review', 'theoretical_framework', 'other'] as const;
const PROJECT_STATUSES = ['active', 'paused', 'done'] as const;
const TUTOR_MODES = ['overview', 'prompt'] as const;
const WRITING_KINDS = [
  'literature_review',
  'theoretical_framework',
  'debate',
  'gap_justification',
  'chapter_section',
  'research_question',
] as const;

const modelSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    model: z.string().trim().min(1).max(300),
  })
  .describe('Modelo de Nodus. Si se omite, se usa el modelo configurado en Ajustes.');

const writingBriefSchema = z.object({
  kind: z.enum(WRITING_KINDS),
  objective: z.string().trim().min(1).max(8_000),
  audience: z.string().trim().max(1_000).optional(),
  tone: z.enum(['academic', 'synthetic', 'critical', 'exploratory']).optional(),
  language: z.enum(['es', 'en', 'fr']).optional(),
});

const writingSelectionSchema = z.object({
  ideaIds: z.array(z.string().min(1)).max(300),
  themeIds: z.array(z.string().min(1)).max(100),
  gapIds: z.array(z.string().min(1)).max(300),
  contradictionIds: z.array(z.string().min(1)).max(300),
  workIds: z.array(z.string().min(1)).max(300),
  passageIds: z.array(z.string().min(1)).max(300),
  tutorRouteIds: z.array(z.string().min(1)).max(100),
});

const deepResearchTargetLengthSchema = z
  .enum(['adaptive', 'concise', 'standard', 'exhaustive'])
  .default('adaptive')
  .describe('Extensión objetivo. adaptive: la decide el corpus; concise ~5-8 pp; standard ~9-14 pp; exhaustive ~15-20 pp.');
const deepResearchSectionLimitSchema = z
  .union([z.literal('auto'), z.number().int().min(1).max(20)])
  .default('auto')
  .describe("Tope de secciones. 'auto' lo dimensiona por el corpus; un número lo fija (con una sección de gracia).");

const writingDraftSchema = z.object({
  generatedAt: z.string().min(1),
  brief: writingBriefSchema,
  selection: writingSelectionSchema,
  title: z.string().min(1).max(2_000),
  abstract: z.string().max(20_000),
  outline: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string(),
      purpose: z.string(),
      keyClaims: z.array(z.string()),
      sources: z.array(z.string()),
    })
  ),
  draftMarkdown: z.string().max(200_000),
  matrix: z.array(
    z.object({
      claim: z.string(),
      role: z.enum(['support', 'contrast', 'gap', 'method', 'definition', 'context']),
      sourceLabel: z.string(),
      citation: z.string(),
      evidence: z.string(),
      notes: z.string(),
    })
  ),
  bibliography: z.array(z.string()),
  nextSteps: z.array(z.string()),
  limitations: z.array(z.string()),
  stats: z.object({
    selectedIdeas: z.number().int().nonnegative(),
    selectedThemes: z.number().int().nonnegative(),
    selectedGaps: z.number().int().nonnegative(),
    selectedContradictions: z.number().int().nonnegative(),
    selectedWorks: z.number().int().nonnegative(),
    selectedPassages: z.number().int().nonnegative(),
    selectedTutorRoutes: z.number().int().nonnegative(),
    contextChars: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
});

const paginationSchema = {
  limit: z.number().int().min(1).max(200).default(100),
  offset: z.number().int().min(0).default(0),
};
const compactLimitSchema = z.number().int().min(1).max(100).default(25);
const querySchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .optional()
  .describe('Case-insensitive substring matched against the main text fields of each entity (title/label, statement/content…), never against ids or enum values.');

class McpToolError extends Error {
  constructor(
    readonly category: 'not_found' | 'invalid_input' | 'ai_unconfigured' | 'ai_transient' | 'internal',
    message: string
  ) {
    super(message);
  }
}

function notFound(kind: string, id: string): McpToolError {
  return new McpToolError('not_found', `No existe ${kind} con id "${id}".`);
}

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown) {
  if (error instanceof McpToolError) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: { category: error.category, message: error.message } }) }],
      isError: true,
    };
  }
  if (error instanceof AiError) {
    const category = error.config ? 'ai_unconfigured' : error.retriable ? 'ai_transient' : 'internal';
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: { category, message: error.message } }) }],
      isError: true,
    };
  }
  console.error('[mcp] tool failed', error);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: { category: 'internal', message: 'La operación no se pudo completar en Nodus.' } }),
      },
    ],
    isError: true,
  };
}

function tool<T>(fn: () => T | Promise<T>) {
  return async () => {
    try {
      return json(await fn());
    } catch (error) {
      return errorResult(error);
    }
  };
}

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** Bridges a Nodus onProgress callback to MCP notifications/progress so clients can
 *  keep long tool calls alive. No-op when the client sent no progressToken. */
function progressNotifier(extra: ToolExtra | undefined): (message: string) => void {
  const progressToken = extra?._meta?.progressToken;
  if (extra === undefined || progressToken === undefined) return () => {};
  let step = 0;
  return (message) => {
    step += 1;
    void extra
      .sendNotification({ method: 'notifications/progress', params: { progressToken, progress: step, message } })
      .catch(() => {
        /* progress is best-effort; a dropped notification must never abort the tool */
      });
  };
}

function page<T, K extends string>(key: K, rows: T[], limit: number, offset: number): Record<K, T[]> & {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
} {
  const slice = rows.slice(offset, offset + limit);
  return {
    [key]: slice,
    total: rows.length,
    limit,
    offset,
    hasMore: offset + slice.length < rows.length,
  } as Record<K, T[]> & { total: number; limit: number; offset: number; hasMore: boolean };
}

/** Case-insensitive substring match over an entity's human-readable text fields only,
 *  so a query never matches JSON keys, enum values or internal ids. */
function matchesText(query: string | undefined, fields: (string | null | undefined)[]): boolean {
  if (!query?.trim()) return true;
  const q = query.trim().toLowerCase();
  return fields.some((field) => !!field && field.toLowerCase().includes(q));
}

function debateSearchFields(debate: Debate): string[] {
  return [
    debate.tension,
    ...debate.sharedThemes,
    ...[debate.sideA, debate.sideB].flatMap((side) => [
      side.label,
      side.statement,
      ...side.authors,
      ...side.works.map((work) => work.title),
    ]),
  ];
}

function snippet(text: string | null | undefined, max = 360): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

function parseAuthorsJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function count(table: 'ideas' | 'works' | 'gaps' | 'authors' | 'notes'): number {
  return (getDb().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

/** Describes which vault the MCP is currently bound to, plus the vaults available to switch to.
 *  The active vault is chosen from the Nodus app UI; MCP tools always read the active one. */
function vaultContext() {
  const active = getActiveVault();
  return {
    active: { id: active.id, name: active.name },
    available: listVaults().map((vault) => ({ id: vault.id, name: vault.name, active: vault.active })),
  };
}

function workCounts(nodusId: string) {
  const db = getDb();
  const scalar = (sql: string) => (db.prepare(sql).get(nodusId) as { n: number }).n;
  return {
    ideas: scalar('SELECT COUNT(DISTINCT global_id) AS n FROM idea_occurrences WHERE nodus_id = ?'),
    evidence: scalar('SELECT COUNT(*) AS n FROM evidence WHERE nodus_id = ?'),
    gaps: scalar('SELECT COUNT(*) AS n FROM gaps WHERE nodus_id = ?'),
    passages: scalar('SELECT COUNT(*) AS n FROM passages WHERE nodus_id = ?'),
  };
}

function compactProjectChapter(chapter: ProjectChapter, includeText = false) {
  if (includeText) return chapter;
  const { originalText: _originalText, currentMarkdown: _currentMarkdown, ...rest } = chapter;
  return {
    ...rest,
    currentMarkdownSnippet: snippet(chapter.currentMarkdown, 500),
  };
}

function compactTutorRoute(route: NonNullable<ReturnType<typeof tutorRoutes.getTutorRoute>>) {
  return {
    id: route.id,
    planId: route.planId,
    generatedAt: route.generatedAt,
    updatedAt: route.updatedAt,
    lastPlayedAt: route.lastPlayedAt,
    mode: route.mode,
    prompt: route.prompt,
    overview: route.overview,
    totalThemes: route.totalThemes,
    totalIdeas: route.totalIdeas,
    totalConnections: route.totalConnections,
    rating: route.rating,
    model: route.model,
    routeTitle: route.route.title,
    stopCount: route.route.stops.length,
  };
}

function resolveTheme(value: string) {
  const needle = value.trim().toLowerCase();
  return themes.listManagedThemes().find((theme) => theme.theme_id === value || theme.label.toLowerCase() === needle) ?? null;
}

function authorMatchesQuery(author: AuthorSummary, query?: string): boolean {
  if (!query?.trim()) return true;
  const q = query.trim().toLowerCase();
  return [
    author.author_id,
    author.name,
    author.fullName,
    author.firstName,
    author.lastName,
    author.affiliation ?? '',
    ...author.topThemes,
  ]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function resolveAuthor(value: string): AuthorSummary {
  const authors = listAuthorSummaries();
  const needle = value.trim().toLowerCase();
  const exact = authors.find(
    (author) =>
      author.author_id === value ||
      author.name.toLowerCase() === needle ||
      author.fullName.toLowerCase() === needle
  );
  if (exact) return exact;

  const matches = authors.filter((author) => authorMatchesQuery(author, value));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw notFound('un autor', value);
  throw new McpToolError(
    'invalid_input',
    `La búsqueda "${value}" coincide con varios autores: ${matches
      .slice(0, 6)
      .map((author) => `${author.fullName || author.name} (${author.author_id})`)
      .join('; ')}. Usa el author_id.`
  );
}

function asModel(model?: z.infer<typeof modelSchema>): ModelRef | undefined {
  return model as ModelRef | undefined;
}

/** Resolve a work reference that may be a nodus_id, a Zotero key, or a merged alias key. */
function resolveWorkNodusId(workId: string): string | null {
  const byNodusId = getWork(workId);
  if (byNodusId) return byNodusId.nodus_id;
  const byZoteroKey = getWorkByZoteroKey(workId) ?? getWorkByAliasKey(workId);
  return byZoteroKey?.nodus_id ?? null;
}

function asBrief(brief: z.infer<typeof writingBriefSchema>): WritingWorkshopBrief {
  return brief as WritingWorkshopBrief;
}

function asSelection(selection: z.infer<typeof writingSelectionSchema>): WritingWorkshopSelection {
  return selection as WritingWorkshopSelection;
}

function asDraft(draft: z.infer<typeof writingDraftSchema>): WritingWorkshopDraft {
  return draft as WritingWorkshopDraft;
}

/** Register the complete external MCP surface. Derived graph entities are intentionally read-only. */
export function registerTools(server: McpServer): void {
  server.registerTool(
    'nodus_get_capabilities',
    {
      title: 'Nodus corpus capabilities',
      description:
        'Returns the current size and vocabulary of this local Nodus corpus, plus which vault it belongs to. Ideas, themes, edges, debates, gaps and authors are generated by analysing works and are read-only through MCP. All tools read the active vault (`vault.active`); if the user seems to mean a different one from `vault.available`, tell them to switch it in the Nodus app — MCP cannot change the active vault.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => ({
      vault: vaultContext(),
      counts: {
        ideas: count('ideas'),
        works: count('works'),
        debates: getDebates().length,
        gaps: count('gaps'),
        authors: count('authors'),
        notes: count('notes'),
      },
      enums: { ideaTypes: IDEA_TYPES, edgeTypes: EDGE_TYPES, gapKinds: GAP_KINDS },
    }))
  );

  server.registerTool(
    'nodus_list_ideas',
    {
      title: 'List ideas',
      description: 'Lists derived ideas in the local corpus. Read-only; ideas are created only by Nodus deep scans of works.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
        type: z.enum(IDEA_TYPES).optional(),
        query: querySchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, type, query }) =>
      tool(() => {
        const all = ideas
          .allIdeaCandidates()
          .filter((idea) => !type || idea.type === type)
          .filter((idea) => matchesText(query, [idea.label, idea.statement]))
          .sort((a, b) => a.global_id.localeCompare(b.global_id));
        return page('ideas', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_idea',
    {
      title: 'Get idea with relations',
      description: 'Gets one derived idea, its occurrences, evidence, and every direct relation to other ideas. Read-only.',
      inputSchema: { ideaId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ ideaId }) =>
      tool(() => {
        const detail = ideas.getIdeaDetail(ideaId);
        if (!detail) throw notFound('una idea', ideaId);
        return { ...detail, relations: ideas.getIdeaEdges(ideaId) };
      })()
  );

  server.registerTool(
    'nodus_get_ideas_by_work',
    {
      title: 'Get ideas by work',
      description:
        'Lists every derived idea (claim, finding, construct, method, framework) with an occurrence anchored to a given work. The inverse of nodus_get_idea: instead of the works of an idea, it returns the ideas of a work. Deterministic and exhaustive over the existing idea↔work relation; use it instead of nodus_search_ideas when you need the complete set for one work. workId accepts a nodus_id or a Zotero key. Each idea also carries the fields specific to its occurrence in this work: role, confidence and development. An unknown workId yields an empty list, not an error. Read-only.',
      inputSchema: {
        workId: z.string().trim().min(1),
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ workId, limit, offset }) =>
      tool(() => {
        const nodusId = resolveWorkNodusId(workId);
        if (!nodusId) return { ideas: [], total: 0 };
        return ideas.getIdeasByWork(nodusId, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_search_ideas',
    {
      title: 'Search ideas semantically',
      description: 'Finds ideas ranked by semantic similarity. Requires embeddings and an embedding provider already configured in Nodus.',
      inputSchema: {
        query: z.string().trim().min(1).max(8_000),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, limit }) =>
      tool(async () => {
        const vector = await embed(query);
        if (!vector) {
          throw new McpToolError(
            'ai_unconfigured',
            'No hay embeddings disponibles. Configura el proveedor y la clave de embeddings en Ajustes de Nodus.'
          );
        }
        return { ideas: ideas.findSimilarIdeas(vector, -1, limit) };
      })()
  );

  server.registerTool(
    'nodus_analyze_passage',
    {
      title: 'Analyze a passage against the library',
      description:
        'Writing-copilot engine: takes an arbitrary passage (e.g. a paragraph being drafted) and returns how it relates to the whole corpus. For each candidate idea, work or passage it gives a typed relation (supports, contradicts, refines, extends, applies_to, …), a similarity and confidence, a short rationale, and — when the target resolves to a work — the Zotero item to cite (zoteroKey, an author-year label and a Zotero quick-search string). This is the symmetric, ad-hoc counterpart of the per-chapter analysis used by the Nodus writing copilot. Read-only over the derived graph: it does not create ideas or edges. Requires an embedding provider configured in Nodus and uses one AI pass to type the relations, so it may consume provider tokens. Returns { available: false } when no embedding provider is configured.',
      inputSchema: {
        text: z.string().trim().min(1).max(8_000),
        model: modelSchema.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ text, model }) => tool(() => analyzeText(text, asModel(model)))()
  );

  server.registerTool(
    'nodus_get_copilot_idea',
    {
      title: 'Get idea with citation and connections',
      description:
        'Returns one derived idea shaped for writing: its statement, every occurrence, its evidence and its graph connections, plus the citation metadata needed to cite it — the Zotero item key, an author-year label and a Zotero quick-search string, both for the idea and for each occurrence. Complements nodus_get_idea (raw relations) with the ready-to-cite Zotero bridge used by the writing copilot. Pair it with nodus_analyze_passage, which returns the candidate ideas. Read-only.',
      inputSchema: { ideaId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ ideaId }) =>
      tool(() => {
        const detail = getCopilotIdeaDetail(ideaId);
        if (!detail) throw notFound('una idea', ideaId);
        return detail;
      })()
  );

  server.registerTool(
    'nodus_compose_insertion',
    {
      title: 'Compose a cited insertion for a paragraph',
      description:
        'Uses Nodus AI to write one short, academic sentence that integrates a chosen library idea into the user’s paragraph, with the parenthetical (Author, Year) citation already in place and grounded only in that idea’s statement, evidence and connections. Returns the insertable plain text plus its nodus:// citation and the author-year label. Use the ideaId of a relation returned by nodus_analyze_passage. The model is taken from Nodus Settings; this consumes provider tokens.',
      inputSchema: {
        ideaId: z.string().trim().min(1),
        paragraphText: z.string().trim().min(1).max(8_000),
        selectionText: z.string().trim().max(4_000).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ ideaId, paragraphText, selectionText }) =>
      tool(() => {
        if (!getCopilotIdeaDetail(ideaId)) throw notFound('una idea', ideaId);
        return composeCopilotIdeaInsertion({ ideaId, paragraphText, selectionText });
      })()
  );

  server.registerTool(
    'nodus_list_debates',
    {
      title: 'List debates',
      description: 'Lists contradiction/refutation debates, including their opposing ideas, works, evidence, timeline and relation. Read-only.',
      inputSchema: { ...paginationSchema, query: querySchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query }) =>
      tool(() => {
        const all = getDebates().filter((debate) => matchesText(query, debateSearchFields(debate)));
        return page('debates', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_debate',
    {
      title: 'Get debate',
      description: 'Gets the complete debate for a contradiction or refutation edge id. Read-only.',
      inputSchema: { edgeId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ edgeId }) =>
      tool(() => {
        const debate = getDebate(edgeId);
        if (!debate) throw notFound('un debate', edgeId);
        return debate;
      })()
  );

  server.registerTool(
    'nodus_list_gaps',
    {
      title: 'List research gaps',
      description: 'Lists normalized research-gap aggregates. Use one returned gapIds value with nodus_get_gap for a full record. Read-only.',
      inputSchema: { ...paginationSchema, query: querySchema, kind: z.enum(GAP_KINDS).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, kind }) =>
      tool(() => {
        const all = gaps
          .aggregateGaps()
          .filter((gap) => (!kind || gap.kind === kind) && matchesText(query, [gap.statement, ...gap.works.map((work) => work.title)]));
        return page('gaps', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_gap',
    {
      title: 'Get research gap',
      description: 'Gets an individual research-gap record with the originating work, related idea, and evidence. Read-only.',
      inputSchema: { gapId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ gapId }) =>
      tool(() => {
        const detail = gaps.getGapDetail(gapId);
        if (!detail) throw notFound('un hueco', gapId);
        return detail;
      })()
  );

  server.registerTool(
    'nodus_get_author_relations',
    {
      title: 'Get author relations',
      description: 'Returns the weighted author graph. With author, returns that author and their immediate neighbours; author can be an id or exact displayed name. Read-only.',
      inputSchema: { author: z.string().trim().min(1).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ author }) =>
      tool(() => {
        const graph = buildAuthorGraph();
        if (!author) return graph;
        const root = graph.nodes.find((node) => node.id === author || node.label === author);
        if (!root) throw notFound('un autor', author);
        const edges = graph.edges.filter((edge) => edge.source === root.id || edge.target === root.id);
        const nodeIds = new Set([root.id, ...edges.flatMap((edge) => [edge.source, edge.target])]);
        return { nodes: graph.nodes.filter((node) => nodeIds.has(node.id)), edges };
      })()
  );

  server.registerTool(
    'nodus_search_authors',
    {
      title: 'Search authors',
      description:
        'Busca autores del corpus local por id, nombre, afiliación o temas principales. Devuelve el footprint de cada autor y si ya tiene síntesis de ficha generada.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        synthesis: z.enum(['all', 'with', 'without']).default('all'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, synthesis = 'all' }) =>
      tool(() => {
        const all = listAuthorSummaries()
          .filter((author) => authorMatchesQuery(author, query))
          .filter((author) => synthesis === 'all' || (synthesis === 'with' ? author.hasSynthesis : !author.hasSynthesis));
        return page('authors', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_author_synthesis',
    {
      title: 'Get or generate author synthesis',
      description:
        'Resuelve un autor por author_id o nombre. Si ya existe una síntesis de ficha, la devuelve; si no existe y generateIfMissing=true, la genera y la guarda usando el modelo de síntesis configurado o el modelo indicado. Use refresh=true para regenerar aunque exista.',
      inputSchema: {
        author: z.string().trim().min(1).max(500),
        generateIfMissing: z.boolean().default(true),
        refresh: z.boolean().default(false),
        model: modelSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ author, generateIfMissing = true, refresh = false, model }) =>
      tool(async () => {
        const resolved = resolveAuthor(author);
        const dossier = buildAuthorDossier(resolved.author_id);
        if (!dossier) throw notFound('un autor', author);

        if (!refresh && dossier.synthesis) {
          return {
            source: 'cached',
            author: resolved,
            synthesis: dossier.synthesis,
            counts: {
              works: dossier.works.length,
              ideas: dossier.ideas.length,
              relations: dossier.relations.length,
              themes: dossier.themes.length,
            },
          };
        }

        if (!generateIfMissing && !refresh) {
          return {
            source: 'missing',
            author: resolved,
            synthesis: null,
            counts: {
              works: dossier.works.length,
              ideas: dossier.ideas.length,
              relations: dossier.relations.length,
              themes: dossier.themes.length,
            },
          };
        }

        const synthesis = await synthesizeAuthorDossier(resolved.author_id, asModel(model));
        return {
          source: refresh ? 'refreshed' : 'generated',
          author: { ...resolved, hasSynthesis: true },
          synthesis,
          counts: {
            works: dossier.works.length,
            ideas: dossier.ideas.length,
            relations: dossier.relations.length,
            themes: dossier.themes.length,
          },
        };
      })()
  );

  server.registerTool(
    'nodus_list_works',
    {
      title: 'List works',
      description:
        'Lists Zotero/library works with pagination and operational filters. Use nodus_get_work for per-work counts, summary and passage status. Read-only.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        includeArchived: z.boolean().default(false),
        lightStatus: z.enum(LIGHT_STATUSES).default('all'),
        deepStatus: z.enum(DEEP_STATUSES).default('all'),
        summaryStatus: z.enum(SUMMARY_STATUSES).default('all'),
        statusFlags: z
          .array(z.enum(['deep', 'summary', 'ideas', 'passages', '!deep', '!summary', '!ideas', '!passages']))
          .max(8)
          .optional(),
        theme: z.string().trim().min(1).max(500).optional(),
        zoteroTags: z.array(z.string().trim().min(1).max(500)).max(25).optional(),
        zoteroTagMode: z.enum(['any', 'all']).default('any'),
        collections: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
        collectionMode: z.enum(['any', 'all']).default('any'),
        yearMin: z.number().int().min(0).max(3000).optional(),
        yearMax: z.number().int().min(0).max(3000).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({
      limit,
      offset,
      query,
      includeArchived,
      lightStatus,
      deepStatus,
      summaryStatus,
      statusFlags,
      theme,
      zoteroTags,
      zoteroTagMode,
      collections,
      collectionMode,
      yearMin,
      yearMax,
    }) =>
      tool(() => {
        const filter: WorkFilter = {
          search: query,
          includeArchived,
          lightStatus: lightStatus as LightStatus | 'all',
          deepStatus: deepStatus as DeepStatus | 'all',
          summaryStatus: summaryStatus as SummaryStatus | 'all',
          statusFlags,
          theme,
          zoteroTags,
          zoteroTagMode,
          collections,
          collectionMode,
          yearMin,
          yearMax,
        };
        return page('works', listWorks(filter), limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_work',
    {
      title: 'Get work',
      description:
        'Gets one work by nodus_id, Zotero key or merged alias key, including themes/tags, orientation summary, passage status and derived entity counts. Read-only.',
      inputSchema: { workId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ workId }) =>
      tool(() => {
        const nodusId = resolveWorkNodusId(workId);
        if (!nodusId) throw notFound('una obra', workId);
        const work = getWork(nodusId);
        if (!work) throw notFound('una obra', workId);
        return {
          work,
          summary: workSummaries.getWorkSummary(nodusId),
          counts: workCounts(nodusId),
          passageStatus: passages.workPassageStatuses([nodusId])[0] ?? null,
        };
      })()
  );

  server.registerTool(
    'nodus_list_work_passages',
    {
      title: 'List full-text passages',
      description:
        'Lists full-text passage chunks, optionally scoped to one work. Returns snippets only; use nodus_get_passage for full text. Read-only.',
      inputSchema: {
        ...paginationSchema,
        workId: z.string().trim().min(1).optional(),
        query: querySchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, workId, query }) =>
      tool(() => {
        const nodusId = workId ? resolveWorkNodusId(workId) : null;
        if (workId && !nodusId) throw notFound('una obra', workId);
        const params: unknown[] = [];
        const clauses: string[] = ['w.archived = 0'];
        if (nodusId) {
          clauses.push('p.nodus_id = ?');
          params.push(nodusId);
        }
        if (query?.trim()) {
          clauses.push('(LOWER(p.text) LIKE ? OR LOWER(w.title) LIKE ?)');
          const q = `%${query.trim().toLowerCase()}%`;
          params.push(q, q);
        }
        const rows = getDb()
          .prepare(
            `SELECT p.passage_id, p.nodus_id, p.chunk_index, p.page_label, p.char_len, p.text,
                    w.title, w.authors_json, w.year, w.zotero_key
               FROM passages p
               JOIN works w ON w.nodus_id = p.nodus_id
              WHERE ${clauses.join(' AND ')}
              ORDER BY w.year DESC, w.title COLLATE NOCASE ASC, p.chunk_index ASC`
          )
          .all(...params) as {
          passage_id: string;
          nodus_id: string;
          chunk_index: number;
          page_label: string | null;
          char_len: number;
          text: string;
          title: string;
          authors_json: string;
          year: number | null;
          zotero_key: string;
        }[];
        const out = rows.map((row) => ({
          passage_id: row.passage_id,
          nodus_id: row.nodus_id,
          chunk_index: row.chunk_index,
          page_label: row.page_label,
          char_len: row.char_len,
          textSnippet: snippet(row.text),
          work: {
            title: row.title,
            authors: parseAuthorsJson(row.authors_json),
            year: row.year,
            zotero_key: row.zotero_key,
          },
        }));
        return page('passages', out, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_passage',
    {
      title: 'Get full-text passage',
      description: 'Gets one full-text passage chunk by passage_id, including source-work citation metadata. Read-only.',
      inputSchema: { passageId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ passageId }) =>
      tool(() => {
        const detail = passages.getPassageDetail(passageId);
        if (!detail) throw notFound('un pasaje', passageId);
        return detail;
      })()
  );

  server.registerTool(
    'nodus_list_themes',
    {
      title: 'List themes',
      description: 'Lists graph/library themes with work and idea counts, pagination and filters. Read-only.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        pinned: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, pinned }) =>
      tool(() => {
        const all = themes
          .listManagedThemes()
          .filter((theme) => pinned === undefined || theme.pinned === pinned)
          .filter((theme) => matchesText(query, [theme.label]));
        return page('themes', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_theme',
    {
      title: 'Get theme',
      description:
        'Gets a theme by theme_id or exact label, with paged works and ideas connected to that theme. Read-only.',
      inputSchema: {
        theme: z.string().trim().min(1),
        worksLimit: compactLimitSchema,
        worksOffset: z.number().int().min(0).default(0),
        ideasLimit: compactLimitSchema,
        ideasOffset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ theme, worksLimit, worksOffset, ideasLimit, ideasOffset }) =>
      tool(() => {
        const resolved = resolveTheme(theme);
        if (!resolved) throw notFound('un tema', theme);
        const linkedWorks = listWorks({ theme: resolved.label });
        const ideaRows = getDb()
          .prepare(
            `SELECT DISTINCT i.global_id, i.type, i.label, i.statement
               FROM idea_theme_links itl
               JOIN ideas i ON i.global_id = itl.global_id
              WHERE itl.theme_id = ?
              ORDER BY i.label COLLATE NOCASE ASC`
          )
          .all(resolved.theme_id);
        return {
          theme: resolved,
          works: page('items', linkedWorks, worksLimit, worksOffset),
          ideas: page('items', ideaRows, ideasLimit, ideasOffset),
        };
      })()
  );

  server.registerTool(
    'nodus_list_tutor_routes',
    {
      title: 'List saved tutor routes',
      description: 'Lists saved Tutor routes with pagination. The full route is omitted; use nodus_get_tutor_route for stops. Read-only.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        mode: z.enum(TUTOR_MODES).optional(),
        minRating: z.number().int().min(1).max(5).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, mode, minRating }) =>
      tool(() => {
        const all = tutorRoutes
          .listTutorRoutes()
          .filter((route) => !mode || route.mode === mode)
          .filter((route) => minRating === undefined || (route.rating ?? 0) >= minRating)
          .filter((route) =>
            matchesText(query, [
              route.prompt,
              route.overview,
              route.route.title,
              route.route.description,
              ...route.route.stops.flatMap((stop) => [stop.title, stop.focus]),
            ])
          )
          .map(compactTutorRoute);
        return page('routes', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_tutor_route',
    {
      title: 'Get saved tutor route',
      description: 'Gets a complete saved Tutor route, including route stops and graph context. Read-only.',
      inputSchema: { routeId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ routeId }) =>
      tool(() => {
        const route = tutorRoutes.getTutorRoute(routeId);
        if (!route) throw notFound('una ruta de Tutor', routeId);
        return route;
      })()
  );

  server.registerTool(
    'nodus_list_projects',
    {
      title: 'List projects',
      description: 'Lists research-writing projects/manuscripts with pagination and filters. Read-only.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        kind: z.enum(PROJECT_KINDS).optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, kind, status }) =>
      tool(() => {
        const all = projects
          .listProjects()
          .filter((project) => !kind || project.kind === (kind as ProjectKind))
          .filter((project) => !status || project.status === (status as ProjectStatus))
          .filter((project) => matchesText(query, [project.title, project.brief]));
        return page('projects', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_project',
    {
      title: 'Get project',
      description:
        'Gets one research-writing project with sections, links, chapter metadata and stats. Chapter bodies are summarized unless includeChapterText=true. Read-only.',
      inputSchema: { projectId: z.string().trim().min(1), includeChapterText: z.boolean().default(false) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ projectId, includeChapterText }) =>
      tool(() => {
        const detail = projects.getProjectDetail(projectId);
        if (!detail) throw notFound('un proyecto', projectId);
        return {
          ...detail,
          chapters: detail.chapters.map((chapter) => compactProjectChapter(chapter, includeChapterText)),
        };
      })()
  );

  server.registerTool(
    'nodus_search_notes',
    {
      title: 'Search notes',
      description:
        'Searches user-created notes with pagination and snippets. Use nodus_get_note for full Markdown content. Read-only.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        kind: z.enum(NOTE_KINDS).optional(),
        folderId: z.string().trim().min(1).nullable().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, kind, folderId }) =>
      tool(() => {
        const tree = notes.getNotesTree();
        const folderById = new Map(tree.folders.map((folder) => [folder.id, folder]));
        const all = tree.notes
          .filter((note) => !kind || note.kind === kind)
          .filter((note) => folderId === undefined || note.folderId === folderId)
          .filter((note) => matchesText(query, [note.title, note.content]))
          .map((note) => ({
            id: note.id,
            folderId: note.folderId,
            folderName: note.folderId ? folderById.get(note.folderId)?.name ?? null : null,
            title: note.title,
            kind: note.kind,
            source: note.source,
            orderIdx: note.orderIdx,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            contentSnippet: snippet(note.content, 400),
          }));
        return page('notes', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_list_notes_tree',
    {
      title: 'List notes tree',
      description: 'Returns the user-created notes and folders. Each folder carries its summary brief (the ideas it is meant to hold). This list omits note content; use nodus_get_note for a full note.',
      inputSchema: { ...paginationSchema, query: querySchema, kind: z.enum(NOTE_KINDS).optional(), folderId: z.string().trim().min(1).nullable().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, kind, folderId }) =>
      tool(() => {
        const tree = notes.getNotesTree();
        const filteredNotes = tree.notes
          .filter((note) => !kind || note.kind === kind)
          .filter((note) => folderId === undefined || note.folderId === folderId)
          .filter((note) => matchesText(query, [note.title, note.content]))
          .map(({ content: _content, ...note }) => ({ ...note, contentSnippet: snippet(_content, 220) }));
        return { folders: tree.folders, ...page('notes', filteredNotes, limit, offset) };
      })()
  );

  server.registerTool(
    'nodus_get_note',
    {
      title: 'Get note',
      description: 'Gets a user-created note including Markdown content. Read-only.',
      inputSchema: { noteId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ noteId }) =>
      tool(() => {
        const note = notes.getNote(noteId);
        if (!note) throw notFound('una nota', noteId);
        return note;
      })()
  );

  server.registerTool(
    'nodus_list_coverage_questions',
    {
      title: 'List coverage questions',
      description: 'Lists saved research coverage questions. Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => ({ questions: researchQuestions.listResearchQuestions() }))
  );

  server.registerTool(
    'nodus_get_coverage_question',
    {
      title: 'Get coverage question',
      description: 'Gets a saved research question, its sub-questions, coverage status, and linked ideas/works. Read-only.',
      inputSchema: { id: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id }) =>
      tool(() => {
        const detail = researchQuestions.getResearchQuestionDetail(id);
        if (!detail) throw notFound('una pregunta de cobertura', id);
        return detail;
      })()
  );

  server.registerTool(
    'nodus_ask_coverage_question',
    {
      title: 'Ask and map a coverage question',
      description:
        'Creates a research question, uses Nodus AI to decompose it, maps coverage against the local corpus, and saves the result. This modifies Nodus data and may consume provider tokens. Sends MCP progress notifications while mapping when the request carries a progressToken.',
      inputSchema: {
        question: z.string().trim().min(1).max(8_000),
        notes: z.string().trim().max(8_000).optional(),
        model: modelSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ question, notes: questionNotes, model }, extra) =>
      tool(async () => {
        const notify = progressNotifier(extra);
        const created = researchQuestions.createResearchQuestion(question, questionNotes);
        const request = { rqId: created.rq.id, model: asModel(model) };
        notify('Descomponiendo la pregunta en subpreguntas…');
        await decomposeQuestion(request);
        return mapCoverage(request, (p) => notify(`Mapeando cobertura ${p.index}/${p.total}: ${p.subQuestion}`));
      })()
  );

  server.registerTool(
    'nodus_writing_snapshot',
    {
      title: 'Build writing workshop snapshot',
      description: 'Ranks Nodus ideas, themes, gaps, works and evidence for a writing objective. It may use configured embeddings but does not write data.',
      inputSchema: { brief: writingBriefSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ brief }) => tool(() => buildWritingWorkshopSnapshot(asBrief(brief)))()
  );

  server.registerTool(
    'nodus_generate_writing_draft',
    {
      title: 'Generate writing workshop draft',
      description: 'Generates a grounded Markdown draft from an explicit Nodus writing selection. With save=true, it also saves the draft. This can consume provider tokens and may modify data.',
      inputSchema: {
        brief: writingBriefSchema,
        selection: writingSelectionSchema,
        model: modelSchema.optional(),
        save: z.boolean().default(false),
        title: z.string().trim().min(1).max(2_000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ brief, selection, model, save, title }) =>
      tool(async () => {
        const draft = await generateWritingWorkshopDraft({ brief: asBrief(brief), selection: asSelection(selection), model: asModel(model) });
        const saved = save ? writingDrafts.saveWritingWorkshopDraft({ draft, model: asModel(model), title }) : null;
        return { draft, savedDraftId: saved?.id ?? null, savedDraft: saved };
      })()
  );

  server.registerTool(
    'nodus_save_writing_draft',
    {
      title: 'Save writing workshop draft',
      description: 'Saves a draft previously generated by the Nodus writing workshop. This modifies Nodus data.',
      inputSchema: { draft: writingDraftSchema, model: modelSchema.optional(), title: z.string().trim().min(1).max(2_000).optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ draft, model, title }) => tool(() => writingDrafts.saveWritingWorkshopDraft({ draft: asDraft(draft), model: asModel(model), title }))()
  );

  server.registerTool(
    'nodus_list_writing_drafts',
    {
      title: 'List saved writing drafts',
      description: 'Lists drafts saved by the Nodus writing workshop. Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => ({ drafts: writingDrafts.listWritingWorkshopDrafts() }))
  );

  server.registerTool(
    'nodus_generate_deep_research',
    {
      title: 'Generate a Deep Research report',
      description:
        'Runs the orchestrated, coverage-guided, fully-cited Deep Research pipeline over the whole corpus (5–20 pp). Two writers via `writer`: ' +
        '"nodus" (default) — Nodus\'s own configured model plans and writes the whole report and returns it (save=true also stores it as a draft). ' +
        '"client" — returns a self-contained writing kit (corpus materials with verbatim citation tokens, target scope, method and citation policy) so the MODEL CALLING THIS MCP articulates and drafts the report itself; when done, that draft is passed to nodus_finalize_deep_research to validate citations and assemble references. Both keep Nodus as the grounding authority. writer="nodus" can consume provider tokens and may take several minutes; it sends MCP progress notifications (planning, per-section, assembly) when the request carries a progressToken.',
      inputSchema: {
        objective: z.string().trim().min(1).max(8_000),
        language: z.enum(['es', 'en', 'fr']).optional(),
        audience: z.string().trim().max(1_000).optional(),
        targetLength: deepResearchTargetLengthSchema,
        sectionLimit: deepResearchSectionLimitSchema,
        writer: z
          .enum(['nodus', 'client'])
          .default('nodus')
          .describe('"nodus": el modelo configurado en Nodus redacta el informe. "client": el modelo que llama al MCP lo redacta a partir del kit devuelto.'),
        model: modelSchema.optional(),
        save: z.boolean().default(false),
        title: z.string().trim().min(1).max(2_000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ objective, language, audience, targetLength, sectionLimit, writer, model, save, title }, extra) =>
      tool(async () => {
        if (writer === 'client') {
          return buildDeepResearchBrief({ objective, language, audience, targetLength, sectionLimit });
        }
        const notify = progressNotifier(extra);
        const report = await generateDeepResearchReport(
          { objective, language, audience, targetLength, sectionLimit, model: asModel(model) ?? null },
          (p) =>
            notify(
              p.phase === 'section' && p.sectionIndex
                ? `[sección ${p.sectionIndex}${p.sectionTotal ? `/${p.sectionTotal}` : ''}] ${p.message}`
                : p.message
            )
        );
        const saved = save ? writingDrafts.saveWritingWorkshopDraft({ draft: report.draft, model: asModel(model), title }) : null;
        return { report, savedDraftId: saved?.id ?? null, savedDraft: saved };
      })()
  );

  server.registerTool(
    'nodus_finalize_deep_research',
    {
      title: 'Finalize a client-written Deep Research report',
      description:
        'Second step of nodus_generate_deep_research(writer="client"). Takes the Markdown the calling model wrote (`## ` body sections only) and enforces Nodus\'s citation contract: hallucinated citations are stripped, labels canonicalised, and the References/bibliography are built from the works actually cited. Returns the assembled report in the standard draft shape; with save=true it also stores it as a Nodus writing draft. Pass the SAME objective/language used for the brief so the same corpus snapshot is used to validate citations.',
      inputSchema: {
        objective: z.string().trim().min(1).max(8_000),
        language: z.enum(['es', 'en', 'fr']).optional(),
        audience: z.string().trim().max(1_000).optional(),
        sectionsMarkdown: z.string().trim().min(1).max(200_000),
        title: z.string().trim().min(1).max(2_000).optional(),
        abstract: z.string().trim().max(20_000).optional(),
        limitations: z.array(z.string().trim().min(1).max(2_000)).max(30).optional(),
        nextSteps: z.array(z.string().trim().min(1).max(2_000)).max(30).optional(),
        save: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ objective, language, audience, sectionsMarkdown, title, abstract, limitations, nextSteps, save }) =>
      tool(async () => {
        const report = await assembleClientDeepResearchReport({
          objective,
          language,
          audience,
          sectionsMarkdown,
          title,
          abstract,
          limitations,
          nextSteps,
        });
        const saved = save ? writingDrafts.saveWritingWorkshopDraft({ draft: report.draft, title }) : null;
        return { report, savedDraftId: saved?.id ?? null, savedDraft: saved };
      })()
  );

  server.registerTool(
    'nodus_create_folder',
    {
      title: 'Create notes folder',
      description: 'Creates a user-owned folder in the Nodus notes workspace. An optional summary describes the ideas the folder is meant to hold. This modifies Nodus data.',
      inputSchema: {
        name: z.string().trim().min(1).max(500),
        parentId: z.string().trim().min(1).nullable().optional(),
        summary: z.string().trim().max(8_000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ name, parentId, summary }) =>
      tool(() => {
        if (parentId && !notes.getNoteFolder(parentId)) throw notFound('una carpeta', parentId);
        const folder = notes.createNoteFolder({ name, parentId });
        if (summary && summary.trim()) return notes.updateNoteFolderSummary(folder.id, summary) ?? folder;
        return folder;
      })()
  );

  server.registerTool(
    'nodus_update_folder_summary',
    {
      title: 'Update folder summary',
      description:
        "Sets a notes folder's summary brief (the ideas the folder is meant to hold). Nodus reads this brief to suggest ideas to integrate into the folder. This modifies Nodus data.",
      inputSchema: { id: z.string().trim().min(1), summary: z.string().max(8_000) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ id, summary }) =>
      tool(() => {
        const folder = notes.updateNoteFolderSummary(id, summary);
        if (!folder) throw notFound('una carpeta', id);
        return folder;
      })()
  );

  server.registerTool(
    'nodus_create_note',
    {
      title: 'Create note',
      description: 'Creates a user-owned note in the Nodus notes workspace. This modifies Nodus data.',
      inputSchema: {
        title: z.string().trim().min(1).max(2_000),
        content: z.string().max(500_000),
        kind: z.enum(NOTE_KINDS).default('markdown'),
        folderId: z.string().trim().min(1).nullable().optional(),
        source: z
          .object({ origin: z.enum(NOTE_KINDS), model: modelSchema.nullable().optional(), ref: z.string().nullable().optional(), note: z.string().nullable().optional() })
          .nullable()
          .optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ title, content, kind, folderId, source }) =>
      tool(() => {
        if (folderId && !notes.getNoteFolder(folderId)) throw notFound('una carpeta', folderId);
        return notes.createNote({ title, content, kind, folderId, source: source as NoteSource | null | undefined });
      })()
  );

  server.registerTool(
    'nodus_update_note',
    {
      title: 'Update note',
      description: 'Updates title, Markdown content, or folder for an existing user-owned Nodus note. This modifies Nodus data.',
      inputSchema: {
        id: z.string().trim().min(1),
        title: z.string().trim().min(1).max(2_000).optional(),
        content: z.string().max(500_000).optional(),
        folderId: z.string().trim().min(1).nullable().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ id, title, content, folderId }) =>
      tool(() => {
        if (folderId && !notes.getNoteFolder(folderId)) throw notFound('una carpeta', folderId);
        const note = notes.updateNote({ id, title, content, folderId });
        if (!note) throw notFound('una nota', id);
        return note;
      })()
  );
}
