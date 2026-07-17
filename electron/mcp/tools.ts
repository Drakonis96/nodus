import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { app } from 'electron';
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
import path from 'node:path';
import { getDb, openDbPath } from '../db/database';
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
import { listPersons, getPerson, listEvents, listEvidenceFor, recordCounts } from '../db/entitiesRepo';
import * as archive from '../db/archiveRepo';
import * as dbMode from '../db/databasesRepo';
import { decodeCheckbox, decodeMultiSelect, decodeNumber } from '@shared/databases';
import { comparableType, type FormulaSpec } from '@shared/databaseFormula';
import { describeFormula } from '@shared/databaseFormulaEval';
import {
  applyDatabaseFilter,
  sortDatabaseRows,
  operatorsForColumn,
  opNeedsValue,
  type FilterCondition,
  type FilterOp,
} from '@shared/databaseFilters';
import { STUDY_QUESTION_TYPES, type StudyQuestionType } from '@shared/studyQuestions';
import type { ArchiveItem, DatabaseColumn, DatabaseRow, HistoricalEventType } from '@shared/types';
import { kinOf } from '../db/relationshipsRepo';
import { listOpenSuggestions, listSuggestionsForPerson } from '../db/kinshipSuggestionsRepo';
import * as writingDrafts from '../db/writingDraftsRepo';
import * as studyOrg from '../db/studyOrgRepo';
import * as studyQuestions from '../db/studyQuestionsRepo';
import * as studyLearning from '../db/studyLearningRepo';
import { searchStudyCorpus } from '../ai/studySearch';
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
const EVENT_TYPES = [
  'birth',
  'baptism',
  'marriage',
  'death',
  'burial',
  'census',
  'residence',
  'migration',
  'occupation',
  'other',
] as const satisfies readonly HistoricalEventType[];
const ARCHIVE_KINDS = ['image', 'csv', 'xlsx', 'pdf', 'text', 'other'] as const;
const STUDY_QUESTION_TYPE_VALUES = STUDY_QUESTION_TYPES as unknown as [string, ...string[]];
// The question-bank filter matches stored per-question difficulty; 'mixed' only exists
// as a generation setting, so it is not offered here.
const STUDY_QUESTION_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const STUDY_QUESTION_STATUSES = ['pending', 'approved', 'problematic', 'discarded'] as const;
// The same operator vocabulary the in-app filter bar uses (shared/databaseFilters).
const DB_FILTER_OPS = [
  'contains',
  'notContains',
  'equals',
  'notEquals',
  'isEmpty',
  'notEmpty',
  'gt',
  'gte',
  'lt',
  'lte',
  'before',
  'after',
  'isAnyOf',
  'isNoneOf',
  'hasAllOf',
  'isChecked',
  'isUnchecked',
] as const satisfies readonly FilterOp[];

const modelSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    model: z.string().trim().min(1).max(300),
  })
  .describe('Nodus model override. If omitted, the model configured in Nodus Settings is used.');

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
  .describe('Target length. adaptive: sized by the corpus; concise ~5-8 pp; standard ~9-14 pp; exhaustive ~15-20 pp.');
const deepResearchSectionLimitSchema = z
  .union([z.literal('auto'), z.number().int().min(1).max(20)])
  .default('auto')
  .describe("Section cap. 'auto' sizes it by the corpus; a number fixes it (with one grace section).");

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
  return new McpToolError('not_found', `No ${kind} exists with id "${id}".`);
}

function json(value: unknown) {
  const content = [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }];
  // Modern MCP clients prefer structuredContent over re-parsing the text block. We
  // mirror object results there (the spec's structuredContent must be an object, not
  // an array or primitive) while still sending the text for older clients. No
  // outputSchema is declared, so the SDK forwards it without per-tool validation.
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return { content, structuredContent: value as Record<string, unknown> };
  }
  return { content };
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
        text: JSON.stringify({ error: { category: 'internal', message: 'The operation could not be completed in Nodus.' } }),
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

/**
 * Semantic search can only find what has been embedded, and an unindexed corpus returns
 * exactly what an irrelevant query returns: nothing. A bare empty list therefore reads as
 * "the corpus does not discuss this" — a confident false negative — when the truth is
 * "this was never indexed" (never scanned, or the embedding model changed in Settings and
 * the stored vectors no longer match). Every semantic tool reports its index coverage, and
 * says so outright when there is none, so a client can tell the two apart.
 */
function searchCoverage(indexed: number, indexable: number, what: string) {
  return {
    indexed,
    indexable,
    ...(indexed === 0
      ? {
          warning:
            `No ${what} in this vault are indexed for semantic search with the embedding model currently configured in Nodus, so this search cannot match anything. ` +
            'An empty result here does NOT mean the corpus lacks the topic — do not tell the user it does. Ask them to index the vault in Nodus (or restore the embedding model it was indexed with).',
        }
      : {}),
  };
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

function count(table: 'ideas' | 'works' | 'gaps' | 'authors' | 'notes' | 'themes' | 'passages'): number {
  return (getDb().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

/**
 * Describes the vault these tools are actually serving, plus the vaults available to
 * switch to. `active` is resolved from the database file this process has OPEN, not from
 * the registry's activeVaultId: the connection is cached until an explicit vault switch,
 * while the registry is a file any second Nodus instance can rewrite underneath us.
 * Trusting the registry there would label another vault's data with this vault's name —
 * a silent misattribution. When the two disagree we serve (and say) the open one, and
 * hand the client a `warning` it can relay instead of guessing.
 */
function vaultContext() {
  const vaults = listVaults();
  const registryActive = getActiveVault();
  const openPath = openDbPath();
  const serving = (openPath ? vaults.find((vault) => path.resolve(vault.path) === path.resolve(openPath)) : null) ?? registryActive;
  const diverged = serving.id !== registryActive.id;
  return {
    active: { id: serving.id, name: serving.name, type: serving.type },
    available: vaults.map((vault) => ({ id: vault.id, name: vault.name, type: vault.type, active: vault.id === serving.id })),
    ...(diverged
      ? {
          warning:
            `Nodus has since made "${registryActive.name}" the active vault (another window or instance switched it), but this MCP server still serves "${serving.name}". ` +
            'Every tool here returns data from "' +
            serving.name +
            '". Ask the user to restart Nodus (or reconnect this MCP client) before trusting these results for the other vault.',
        }
      : {}),
  };
}

// ── Databases mode (read-only) decode helpers ────────────────────────────────

/** Decode a cell to a human-readable value for MCP (resolves option labels, counts). */
function dbCellValue(col: DatabaseColumn, row: DatabaseRow): unknown {
  const raw = row.cells[col.id] ?? null;
  // A rollup is derived and kept beside the cells, so it has to be read from there or it
  // reaches the client as null. A formula lives in cells but is typed by what it computes,
  // so a numeric one is handed over as a number rather than as a string.
  if (col.type === 'rollup') return row.rollups?.[col.id] ?? null;
  switch (comparableType(col)) {
    case 'select':
      return col.options.find((o) => o.id === raw)?.label ?? null;
    case 'multi_select':
      return decodeMultiSelect(raw).map((id) => col.options.find((o) => o.id === id)?.label ?? id);
    case 'checkbox':
      return decodeCheckbox(raw);
    case 'number':
      return decodeNumber(raw);
    case 'attachment':
      return (row.attachments?.[col.id] ?? []).map((a) => a.fileName);
    case 'relation':
      return { links: row.relationCounts?.[col.id] ?? 0 };
    default:
      return raw;
  }
}

function dbRowRecord(columns: DatabaseColumn[], row: DatabaseRow): { id: string; fields: Record<string, unknown> } {
  const fields: Record<string, unknown> = {};
  for (const col of columns) fields[col.name] = dbCellValue(col, row);
  return { id: row.id, fields };
}

/** Resolve a column reference (id or case-insensitive name) with a helpful error. */
function dbResolveColumn(columns: DatabaseColumn[], ref: string): DatabaseColumn {
  const needle = ref.trim().toLowerCase();
  const found = columns.find((c) => c.id === ref) ?? columns.find((c) => c.name.toLowerCase() === needle);
  if (!found) {
    throw new McpToolError(
      'invalid_input',
      `No column named "${ref}" exists in this database. Available columns: ${columns.map((c) => c.name).join(', ')}.`
    );
  }
  return found;
}

/** Build a shared-engine FilterCondition from an MCP condition (labels → option ids). */
function dbBuildCondition(
  columns: DatabaseColumn[],
  input: { column: string; op: FilterOp; value?: string | string[] }
): FilterCondition {
  const column = dbResolveColumn(columns, input.column);
  const allowed = operatorsForColumn(column);
  if (!allowed.includes(input.op)) {
    throw new McpToolError(
      'invalid_input',
      `Operator "${input.op}" does not apply to column "${column.name}" (${comparableType(column)}). Valid operators: ${
        allowed.length ? allowed.join(', ') : 'none — this column is not filterable'
      }.`
    );
  }
  if (opNeedsValue(input.op) && (input.value === undefined || (Array.isArray(input.value) && input.value.length === 0))) {
    throw new McpToolError('invalid_input', `Operator "${input.op}" on column "${column.name}" requires a value.`);
  }
  let value: string | string[] | undefined = input.value;
  const type = comparableType(column);
  if ((type === 'select' || type === 'multi_select') && input.value !== undefined) {
    const labels = Array.isArray(input.value) ? input.value : [input.value];
    value = labels.map((label) => {
      const needle = label.trim().toLowerCase();
      const option = column.options.find((o) => o.id === label) ?? column.options.find((o) => o.label.toLowerCase() === needle);
      if (!option) {
        throw new McpToolError(
          'invalid_input',
          `Column "${column.name}" has no option "${label}". Available options: ${column.options.map((o) => o.label).join(', ')}.`
        );
      }
      return option.id;
    });
  }
  return { id: `mcp-${column.id}-${input.op}`, columnId: column.id, op: input.op, value };
}

// ── Genealogy / records decode helpers ────────────────────────────────────────

/** Compact archive item for list results: metadata plus text snippets, never the blob. */
function compactArchiveItem(item: ArchiveItem, folderNames: Map<string, string>) {
  return {
    itemId: item.itemId,
    title: item.title,
    kind: item.kind,
    docType: item.docType,
    year: item.year,
    fileName: item.fileName,
    mimeType: item.mimeType,
    hasFile: item.hasBlob,
    folders: item.folderIds.map((id) => folderNames.get(id) ?? id),
    tags: item.tags,
    linkedPersons: item.linkedPersons.map((p) => p.displayName),
    source: item.source,
    descriptionSnippet: snippet(item.description, 300) || null,
    extractedTextSnippet: snippet(item.extractedText, 300) || null,
    updatedAt: item.updatedAt,
  };
}

function archiveFolderNames(): Map<string, string> {
  return new Map(archive.listFolders().map((folder) => [folder.folderId, folder.name]));
}

function dbRowSearchText(columns: DatabaseColumn[], row: DatabaseRow): string {
  return columns
    .map((col) => {
      const v = dbCellValue(col, row);
      if (v == null) return '';
      if (Array.isArray(v)) return v.join(' ');
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    })
    .join(' ')
    .toLowerCase();
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
  if (matches.length === 0) throw notFound('author', value);
  throw new McpToolError(
    'invalid_input',
    `The search "${value}" matches several authors: ${matches
      .slice(0, 6)
      .map((author) => `${author.fullName || author.name} (${author.author_id})`)
      .join('; ')}. Use the author_id.`
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
        'Returns the running Nodus version, the current size and vocabulary of this local corpus, and which vault it belongs to. Ideas, themes, edges, debates, gaps and authors are generated by analysing works and are read-only through MCP. All tools read the vault reported as `vault.active`; if the user seems to mean a different one from `vault.available`, tell them to switch it in the Nodus app — MCP cannot change the active vault. If `vault.warning` is present, the app has since switched vaults and this server is still serving the one named in `vault.active`: relay that warning instead of presenting the results as the other vault\'s.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => {
      const records = recordCounts();
      const studyWorkspace = studyOrg.getStudyWorkspace();
      return {
        version: app.getVersion(),
        vault: vaultContext(),
        counts: {
          ideas: count('ideas'),
          works: count('works'),
          themes: count('themes'),
          debates: getDebates().length,
          gaps: count('gaps'),
          authors: count('authors'),
          passages: count('passages'),
          notes: count('notes'),
          persons: records.persons,
          events: records.events,
          archiveItems: archive.archiveCounts().items,
          databases: dbMode.listDatabases().length,
          studyCourses: studyWorkspace.courses.length,
          studyDocuments: studyWorkspace.documents.length,
          studyQuestions: studyQuestions.listStudyQuestions().length,
        },
        enums: { ideaTypes: IDEA_TYPES, edgeTypes: EDGE_TYPES, gapKinds: GAP_KINDS, eventTypes: EVENT_TYPES },
      };
    })
  );

  server.registerTool(
    'nodus_list_ideas',
    {
      title: 'List ideas',
      description:
        'Lists derived ideas in the local corpus. Returns compact rows (label plus a statement snippet) by default to keep responses cheap; pass full=true for complete statements, or use nodus_get_idea for one idea with relations. Read-only; ideas are created only by Nodus deep scans of works.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
        type: z.enum(IDEA_TYPES).optional(),
        query: querySchema,
        full: z
          .boolean()
          .default(false)
          .describe('true returns each idea\'s full statement; by default only a snippet (statementSnippet) is returned.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, type, query, full }) =>
      tool(() => {
        const all = ideas
          .allIdeaCandidates()
          .filter((idea) => !type || idea.type === type)
          .filter((idea) => matchesText(query, [idea.label, idea.statement]))
          .sort((a, b) => a.global_id.localeCompare(b.global_id));
        const result = page('ideas', all, limit, offset);
        if (full) return result;
        return {
          ...result,
          ideas: result.ideas.map(({ statement, ...idea }) => ({ ...idea, statementSnippet: snippet(statement, 220) })),
        };
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
        if (!detail) throw notFound('idea', ideaId);
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
      description:
        'Finds ideas ranked by semantic similarity. Requires embeddings and an embedding provider already configured in Nodus. Reports index coverage (`indexed` of `indexable` ideas); when `indexed` is 0 the vault has no vectors for the configured embedding model, so an empty result means "not indexed", NOT "not in the corpus" — a `warning` says so.',
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
            'No embeddings available. Configure the embedding provider and key in Nodus Settings.'
          );
        }
        return {
          ideas: ideas.findSimilarIdeas(vector, -1, limit),
          ...searchCoverage(ideas.embeddedIdeaCount(), count('ideas'), 'ideas'),
        };
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
        if (!detail) throw notFound('idea', ideaId);
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
        if (!getCopilotIdeaDetail(ideaId)) throw notFound('idea', ideaId);
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
        if (!debate) throw notFound('debate', edgeId);
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
        if (!detail) throw notFound('research gap', gapId);
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
        if (!root) throw notFound('author', author);
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
        'Searches authors in the local corpus by id, name, affiliation or top themes. Returns each author footprint and whether a dossier synthesis has already been generated. Read-only.',
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
        'Resolves an author by author_id or name. If a dossier synthesis already exists it is returned; if it does not and generateIfMissing=true, it is generated and saved using the configured synthesis model or the given model. Pass refresh=true to regenerate even when one exists. May consume provider tokens when it generates.',
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
        if (!dossier) throw notFound('author', author);

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
        if (!nodusId) throw notFound('work', workId);
        const work = getWork(nodusId);
        if (!work) throw notFound('work', workId);
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
        if (workId && !nodusId) throw notFound('work', workId);
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
        if (!detail) throw notFound('passage', passageId);
        return detail;
      })()
  );

  server.registerTool(
    'nodus_search_passages',
    {
      title: 'Search full-text passages semantically',
      description:
        'Finds full-text passage chunks ranked by semantic similarity to the query — the direct way to locate where the corpus discusses a topic, with citable work metadata attached to every hit. Optionally scoped to one work (workId accepts a nodus_id or a Zotero key). Returns snippets; use nodus_get_passage for the full text. Complements nodus_search_ideas (derived claims) with retrieval over the underlying source text, and unlike nodus_analyze_passage it performs no AI relation typing. Requires an embedding provider already configured in Nodus. Read-only.',
      inputSchema: {
        query: z.string().trim().min(1).max(8_000),
        limit: z.number().int().min(1).max(50).default(10),
        minSimilarity: z
          .number()
          .min(0)
          .max(1)
          .default(0.18)
          .describe(
            'Cosine similarity floor; 0.18 is the value the Nodus writing copilot uses. Scores are RELATIVE and their scale depends on the configured embedding model — with some models unrelated text still scores well above this floor, so clearing it is not evidence of relevance on its own. Rank by the returned order and judge each hit by its text.'
          ),
        workId: z.string().trim().min(1).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, limit, minSimilarity, workId }) =>
      tool(async () => {
        const nodusId = workId ? resolveWorkNodusId(workId) : null;
        if (workId && !nodusId) throw notFound('work', workId);
        const vector = await embed(query);
        if (!vector) {
          throw new McpToolError(
            'ai_unconfigured',
            'No embeddings available. Configure the embedding provider and key in Nodus Settings.'
          );
        }
        const hits = passages.findSimilarPassages(vector, minSimilarity, limit, nodusId ? { nodusIds: [nodusId] } : {});
        return {
          ...searchCoverage(passages.embeddedPassageCount(), count('passages'), 'full-text passages'),
          passages: hits.map((hit) => ({
            passage_id: hit.passage_id,
            nodus_id: hit.nodus_id,
            similarity: hit.similarity,
            page_label: hit.page_label,
            textSnippet: snippet(hit.text, 600),
            work: {
              title: hit.title,
              authors: parseAuthorsJson(hit.authors_json),
              year: hit.year,
              zotero_key: hit.zotero_key,
            },
          })),
        };
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
        if (!resolved) throw notFound('theme', theme);
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
        if (!route) throw notFound('tutor route', routeId);
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
        if (!detail) throw notFound('project', projectId);
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
        if (!note) throw notFound('note', noteId);
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
        if (!detail) throw notFound('coverage question', id);
        return detail;
      })()
  );

  server.registerTool(
    'nodus_ask_coverage_question',
    {
      title: 'Ask and map a coverage question',
      description:
        'Creates a research question, uses Nodus AI to decompose it, maps coverage against the local corpus, and saves the result. This modifies Nodus data and may consume provider tokens. Sends MCP progress notifications while mapping when the request carries a progressToken. All-or-nothing: if decomposition or mapping fails, the question is not left behind in Nodus.',
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
        try {
          notify('Decomposing the question into sub-questions…');
          await decomposeQuestion(request);
          return await mapCoverage(request, (p) => notify(`Mapping coverage ${p.index}/${p.total}: ${p.subQuestion}`));
        } catch (error) {
          // The row is written before the AI runs, so a failure here (no provider, a
          // transient error) would report an error to the client and still leave an
          // empty, unmapped question in the user's vault. Undo it: the client was told
          // the call failed, so nothing may survive it.
          researchQuestions.deleteResearchQuestion(created.rq.id);
          throw error;
        }
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
          .describe('"nodus": the model configured in Nodus writes the report. "client": the model calling this MCP writes it from the returned kit.'),
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
                ? `[section ${p.sectionIndex}${p.sectionTotal ? `/${p.sectionTotal}` : ''}] ${p.message}`
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
        if (parentId && !notes.getNoteFolder(parentId)) throw notFound('folder', parentId);
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
        if (!folder) throw notFound('folder', id);
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
        if (folderId && !notes.getNoteFolder(folderId)) throw notFound('folder', folderId);
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
        if (folderId && !notes.getNoteFolder(folderId)) throw notFound('folder', folderId);
        const note = notes.updateNote({ id, title, content, folderId });
        if (!note) throw notFound('note', id);
        return note;
      })()
  );

  // ── Genealogy / primary-source records (read-only) ─────────────────────────
  // These read the entity ontology (persons, events, kinship). In a genealogy or
  // primary-sources vault they let an AI client reason over the family/record layer;
  // in an academic vault they simply return empty. They are strictly read-only: an
  // AI client can never write a relationship or confirm a suggestion through MCP —
  // that stays in the user's hands inside the Nodus app.

  server.registerTool(
    'nodus_list_persons',
    {
      title: 'List persons',
      description:
        'Lists persons in the records ontology (genealogy / primary-source vaults): the people extracted from records or entered by hand. Optional name query matches the display name or a name variant. Read-only; returns an empty list in vaults without a records layer.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
        query: querySchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query }) =>
      tool(() => {
        const all = listPersons({ search: query || undefined }).map((p) => ({
          personId: p.personId,
          displayName: p.displayName,
          sex: p.sex,
          birthDate: p.birthDate,
          deathDate: p.deathDate,
        }));
        return page('persons', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_person',
    {
      title: 'Get a person with kin, events and evidence',
      description:
        'Gets one person with their immediate kinship (parents, spouses, children, siblings), life events, the cited evidence backing them, and any OPEN kinship suggestions that concern them. Kinship suggestions are evidence-backed proposals awaiting the user\'s confirmation in the Nodus app — they are NOT asserted relationships, and this tool cannot confirm or write them. Read-only. Do not present a suggestion as an established fact.',
      inputSchema: { personId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ personId }) =>
      tool(() => {
        const person = getPerson(personId);
        if (!person) throw notFound('person', personId);
        const kin = kinOf(personId);
        const names = (people: { displayName: string }[]) => people.map((p) => p.displayName);
        return {
          personId: person.personId,
          displayName: person.displayName,
          sex: person.sex,
          birthDate: person.birthDate,
          deathDate: person.deathDate,
          nameVariants: person.names.map((n) => n.name),
          biography: person.biography,
          kin: {
            parents: names(kin.parents),
            spouses: names(kin.spouses),
            children: names(kin.children),
            siblings: names(kin.siblings),
          },
          events: listEvents({ personId }).map((e) => ({ type: e.type, date: e.date, place: e.placeName, label: e.label })),
          evidence: listEvidenceFor('person', personId).map((ev) => ({ quote: ev.quote, location: ev.location, source: ev.sourceKind })),
          kinshipSuggestions: listSuggestionsForPerson(personId).map((s) => ({
            type: s.type,
            fromName: s.fromName,
            toName: s.toName,
            strength: s.strength,
            status: 'proposed (awaiting user confirmation in Nodus)',
            evidence: s.evidence.filter((ev) => ev.quote).map((ev) => ({ quote: ev.quote, location: ev.location, signal: ev.signal })),
          })),
        };
      })()
  );

  server.registerTool(
    'nodus_list_kin_suggestions',
    {
      title: 'List open kinship suggestions',
      description:
        'Lists the vault\'s OPEN kinship suggestions: evidence-backed parent/spouse proposals derived from records and explicit textual claims, each carrying its verbatim quotes and a strength (alta/media/baja). These are hypotheses awaiting the user\'s confirmation in the Nodus app — never present them as established relationships, and note that only the user can confirm them. Read-only.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset }) =>
      tool(() => {
        const all = listOpenSuggestions().map((s) => ({
          suggestionId: s.suggestionId,
          type: s.type,
          fromName: s.fromName,
          toName: s.toName,
          strength: s.strength,
          evidence: s.evidence.filter((ev) => ev.quote).map((ev) => ({ quote: ev.quote, location: ev.location, signal: ev.signal })),
        }));
        return page('suggestions', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_list_events',
    {
      title: 'List timeline events',
      description:
        'Lists the historical events of the records ontology (genealogy / primary-source vaults) in chronological order — the same data behind the Nodus timeline. Optional filters: personId (events the person participates in), type (birth|baptism|marriage|death|burial|census|residence|migration|occupation|other), and a from/to window over the sortable date (ISO prefix, e.g. "1890" or "1890-05"). Each event carries its participants with their roles. Read-only; returns an empty list in vaults without a records layer.',
      inputSchema: {
        ...paginationSchema,
        personId: z.string().trim().min(1).optional(),
        type: z.enum(EVENT_TYPES).optional(),
        from: z.string().trim().min(1).max(30).optional().describe('Earliest sortable date, ISO prefix (e.g. "1890" or "1890-05-01").'),
        to: z.string().trim().min(1).max(30).optional().describe('Latest sortable date, ISO prefix.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, personId, type, from, to }) =>
      tool(() => {
        if (personId && !getPerson(personId)) throw notFound('person', personId);
        const events = listEvents({ personId, type, from, to });
        const paged = page('events', events, limit, offset);
        return {
          ...paged,
          events: paged.events.map((e) => ({
            eventId: e.eventId,
            type: e.type,
            label: e.label,
            date: e.date,
            place: e.placeName,
            notes: e.notes,
            participants: e.participants.map((p) => ({ personId: p.personId, name: p.displayName ?? null, role: p.role })),
          })),
        };
      })()
  );

  server.registerTool(
    'nodus_list_archive_items',
    {
      title: 'List archive documents',
      description:
        'Lists the evidence-archive documents of a genealogy / primary-source vault (record photos, scans, transcribed certificates, exports) with their document type, year, folders, tags and linked persons. Optional filters: query (title/description/text), docTypes, kinds, tags, personId (documents linked to that person) and a year window. Returns compact rows with text snippets; use nodus_get_archive_item for the full extracted text and metadata. File binaries are never returned. Read-only; empty in vaults without an archive.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        docTypes: z.array(z.string().trim().min(1).max(200)).max(25).optional().describe('Document-type ids (see each item\'s docType).'),
        kinds: z.array(z.enum(ARCHIVE_KINDS)).max(6).optional(),
        tags: z.array(z.string().trim().min(1).max(200)).max(25).optional(),
        personId: z.string().trim().min(1).optional(),
        yearFrom: z.number().int().min(0).max(3000).optional(),
        yearTo: z.number().int().min(0).max(3000).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, docTypes, kinds, tags, personId, yearFrom, yearTo }) =>
      tool(() => {
        if (personId && !getPerson(personId)) throw notFound('person', personId);
        const items = archive.listItems({
          search: query,
          docTypes,
          kinds,
          tags,
          personIds: personId ? [personId] : undefined,
          yearFrom,
          yearTo,
        });
        const folderNames = archiveFolderNames();
        const compact = items.map((item) => compactArchiveItem(item, folderNames));
        return page('items', compact, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_archive_item',
    {
      title: 'Get archive document',
      description:
        'Gets one evidence-archive document by itemId: full extracted text, description, provenance (source), document type with its metadata form values, folders, tags and linked persons. The file binary itself is not returned. Read-only.',
      inputSchema: { itemId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ itemId }) =>
      tool(() => {
        const item = archive.getItem(itemId);
        if (!item) throw notFound('archive item', itemId);
        const folderNames = archiveFolderNames();
        return {
          itemId: item.itemId,
          title: item.title,
          kind: item.kind,
          docType: item.docType,
          metadata: item.metadata,
          year: item.year,
          fileName: item.fileName,
          mimeType: item.mimeType,
          bytes: item.bytes,
          hasFile: item.hasBlob,
          folders: item.folderIds.map((id) => folderNames.get(id) ?? id),
          tags: item.tags,
          linkedPersons: item.linkedPersons.map((p) => ({ personId: p.personId, displayName: p.displayName })),
          source: item.source,
          description: item.description,
          extractedText: item.extractedText,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      })()
  );

  server.registerTool(
    'nodus_search_archive',
    {
      title: 'Search archive documents semantically',
      description:
        'Finds evidence-archive documents ranked by semantic similarity to the query — the direct way to locate which records discuss a person, place or fact when exact words differ (period spellings, synonyms). Searches the embedded extracted text/description of archive items. Reports index coverage (`indexed` of `indexable`); when `indexed` is 0 nothing can match and a `warning` says so, so an empty result means "not indexed", NOT "not in the archive". Returns compact items with a similarity score; use nodus_get_archive_item for full text. Requires an embedding provider already configured in Nodus. Read-only.',
      inputSchema: {
        query: z.string().trim().min(1).max(8_000),
        limit: z.number().int().min(1).max(50).default(10),
        minSimilarity: z
          .number()
          .min(0)
          .max(1)
          .default(0.35)
          .describe(
            'Cosine similarity floor; 0.35 is the value the Nodus archive discovery uses. Scores are RELATIVE and their scale depends on the configured embedding model — with some models unrelated text still scores ~0.5, so a hit clearing this floor is not evidence of relevance on its own. Rank by the returned order and judge each hit by its text.'
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, limit, minSimilarity }) =>
      tool(async () => {
        const vector = await embed(query);
        if (!vector) {
          throw new McpToolError(
            'ai_unconfigured',
            'No embeddings available. Configure the embedding provider and key in Nodus Settings.'
          );
        }
        const hits = archive.findArchiveItemsSimilar(vector, { limit, minSimilarity });
        const folderNames = archiveFolderNames();
        const embedding = archive.archiveEmbeddingCount();
        return {
          items: hits.map((hit) => ({ ...compactArchiveItem(hit, folderNames), similarity: hit.similarity })),
          ...searchCoverage(embedding.indexed, embedding.total, 'archive documents'),
        };
      })()
  );

  // ── Databases mode (read-only) ──────────────────────────────────────────────
  server.registerTool(
    'nodus_list_databases',
    {
      title: 'List databases',
      description:
        'Lists the structured databases in a "databases"-mode vault (Notion-like tables the user built). Returns each database\'s id, short id, name and row count. Read-only; use nodus_get_database_schema for columns and nodus_query_database for rows.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => ({
      databases: dbMode.listDatabases().map((d) => ({ id: d.id, shortId: d.shortId, name: d.name, rows: d.rowCount })),
    }))
  );

  server.registerTool(
    'nodus_get_database_schema',
    {
      title: 'Get database schema',
      description:
        'Gets a database\'s columns: each column\'s id, name and type (title|text|number|date|time|select|multi_select|checkbox|attachment|ai|ai_image|relation|rollup|formula) plus the option labels for select/multi-select columns. A formula column also reports `computes` (number|text — what its values behave as, since "formula" says nothing on its own) and `formula`, a plain-language description of the recipe. Read-only.',
      inputSchema: { databaseId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ databaseId }) =>
      tool(() => {
        const detail = dbMode.getDatabaseDetail(databaseId);
        if (!detail) throw notFound('database', databaseId);
        return {
          database: { id: detail.database.id, shortId: detail.database.shortId, name: detail.database.name, rows: detail.database.rowCount },
          columns: detail.columns.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            // "formula" tells a client nothing it can query on, so say what it yields and how.
            ...(c.type === 'formula'
              ? {
                  computes: comparableType(c),
                  formula: describeFormula(c.config.formula as FormulaSpec | undefined, detail.columns) || undefined,
                }
              : {}),
            options: c.options.length ? c.options.map((o) => o.label) : undefined,
          })),
        };
      })()
  );

  server.registerTool(
    'nodus_query_database',
    {
      title: 'Query database rows',
      description:
        'Lists a database\'s rows with human-readable field values (select/multi-select resolved to labels, checkboxes to booleans, attachments to file names, relations to a link count). Three composable narrowing mechanisms: `query` (substring over all of a row\'s text), `filter` (typed conditions — the same engine as the in-app filter bar; reference columns by name or id, select/multi-select values by option label) and `sorts` (multi-column, applied in order; empty values always sort last). Get the columns, their types and option labels from nodus_get_database_schema first. Read-only; paginated.',
      inputSchema: {
        databaseId: z.string().trim().min(1),
        query: querySchema,
        filter: z
          .object({
            conjunction: z.enum(['and', 'or']).default('and'),
            conditions: z
              .array(
                z.object({
                  column: z.string().trim().min(1).describe('Column name (case-insensitive) or column id.'),
                  op: z.enum(DB_FILTER_OPS),
                  value: z
                    .union([z.string(), z.array(z.string()).max(50)])
                    .optional()
                    .describe('Text/number/date as string; option labels (or ids) for select/multi-select. Omit for isEmpty/notEmpty/isChecked/isUnchecked.'),
                })
              )
              .min(1)
              .max(20),
          })
          .optional()
          .describe('Typed row filter. Number columns compare numerically (gt/gte/lt/lte), date columns support before/after, select columns isAnyOf/isNoneOf/hasAllOf.'),
        sorts: z
          .array(z.object({ column: z.string().trim().min(1), dir: z.enum(['asc', 'desc']).default('asc') }))
          .max(5)
          .optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ databaseId, query, filter, sorts, limit, offset }) =>
      tool(() => {
        const detail = dbMode.getDatabaseDetail(databaseId);
        if (!detail) throw notFound('database', databaseId);
        let rows = dbMode.listRows(databaseId, { sort: 'position' });
        if (filter) {
          const conditions = filter.conditions.map((cond) => dbBuildCondition(detail.columns, cond));
          rows = applyDatabaseFilter(rows, detail.columns, { conjunction: filter.conjunction, conditions });
        }
        if (sorts?.length) {
          const rules = sorts.map((s) => ({ columnId: dbResolveColumn(detail.columns, s.column).id, dir: s.dir }));
          rows = sortDatabaseRows(rows, detail.columns, rules);
        }
        const q = query?.trim().toLowerCase();
        if (q) rows = rows.filter((r) => dbRowSearchText(detail.columns, r).includes(q));
        const paged = page('rows', rows, limit, offset);
        return { ...paged, rows: paged.rows.map((r) => dbRowRecord(detail.columns, r)) };
      })()
  );

  server.registerTool(
    'nodus_get_database_row',
    {
      title: 'Get a database row',
      description:
        'Gets one database row by id, with its field values decoded to human-readable form. Unlike nodus_query_database (which reports relation columns as link counts), here each relation column resolves to the labels of its linked targets. Read-only.',
      inputSchema: { rowId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ rowId }) =>
      tool(() => {
        const row = dbMode.getRow(rowId);
        if (!row) throw notFound('row', rowId);
        const detail = dbMode.getDatabaseDetail(row.databaseId);
        if (!detail) throw notFound('database', row.databaseId);
        const record = dbRowRecord(detail.columns, row);
        for (const col of detail.columns) {
          if (col.type !== 'relation') continue;
          record.fields[col.name] = dbMode.listRelations(row.id, col.id).map((rel) => ({
            label: rel.label,
            kind: rel.targetKind,
            ...(rel.vaultName ? { vault: rel.vaultName } : {}),
          }));
        }
        return {
          database: { id: detail.database.id, name: detail.database.name },
          ...record,
        };
      })()
  );

  // ── Study vault (read-only) ────────────────────────────────────────────────
  // Learning data can be inspected and searched by an explicitly enabled local
  // MCP client, but creation, grading and review decisions remain in the app.
  server.registerTool(
    'nodus_study_get_workspace',
    {
      title: 'Get study workspace',
      description:
        'Returns the active vault\'s study organisation: academic years, courses, subjects, topics and compact document metadata. Read-only. Empty arrays mean that the active vault has no study layer. '
        + 'Courses and subjects carry an academicYearId into academicYears (label "2024/2025"); a subject whose academicYearId is null belongs to its course\'s year, and null on both means no academic year is set.',
      inputSchema: { includeArchived: z.boolean().default(false) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ includeArchived }) =>
      tool(() => {
        const workspace = studyOrg.getStudyWorkspace({ includeArchived });
        return {
          // Without the year rows an academicYearId is an opaque uuid the client
          // cannot turn back into "2024/2025".
          academicYears: workspace.academicYears,
          courses: workspace.courses,
          subjects: workspace.subjects,
          topics: workspace.topics,
          documents: workspace.documents.map(({ contentMarkdown: _content, ...document }) => document),
          placements: workspace.placements,
          tags: workspace.tags,
        };
      })()
  );

  server.registerTool(
    'nodus_study_get_document',
    {
      title: 'Get study document',
      description:
        'Gets one study document and its placements. Content is omitted by default; pass includeContent=true when the complete Markdown is needed. Read-only.',
      inputSchema: {
        documentId: z.string().trim().min(1),
        includeContent: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ documentId, includeContent }) =>
      tool(() => {
        const workspace = studyOrg.getStudyWorkspace({ includeArchived: true, includeDeleted: false });
        const document = workspace.documents.find((item) => item.id === documentId || item.shortId === documentId);
        if (!document) throw notFound('study document', documentId);
        const { contentMarkdown: _contentMarkdown, ...metadata } = document;
        return {
          document: includeContent ? document : metadata,
          placements: workspace.placements.filter((placement) => placement.documentId === document.id),
          tags: workspace.documentTags
            .filter((link) => link.documentId === document.id)
            .map((link) => workspace.tags.find((tag) => tag.id === link.tagId))
            .filter(Boolean),
          contentOmitted: !includeContent,
        };
      })()
  );

  server.registerTool(
    'nodus_study_search',
    {
      title: 'Search the study corpus',
      description:
        'Searches study documents, imported materials, transcripts, questions and exams in the active vault. Returns grounded snippets and precise locations where available. Read-only.',
      inputSchema: {
        query: z.string().trim().min(2).max(2_000),
        kinds: z.array(z.enum(['document', 'material', 'transcript', 'question', 'exam'])).max(5).optional(),
        courseId: z.string().trim().min(1).optional(),
        subjectId: z.string().trim().min(1).optional(),
        topicId: z.string().trim().min(1).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, kinds, courseId, subjectId, topicId, limit }) =>
      tool(async () => searchStudyCorpus(query, { kinds, courseId, subjectId, topicId, limit }))()
  );

  server.registerTool(
    'nodus_study_list_questions',
    {
      title: 'List study questions',
      description:
        'Lists compact, source-grounded questions from the active study vault, filterable by course/subject/topic, question type, difficulty and review status. Read-only; lifecycle and grading actions remain inside Nodus.',
      inputSchema: {
        query: querySchema,
        courseId: z.string().trim().min(1).optional(),
        subjectId: z.string().trim().min(1).optional(),
        topicId: z.string().trim().min(1).optional(),
        type: z.enum(STUDY_QUESTION_TYPE_VALUES).optional(),
        difficulty: z.enum(STUDY_QUESTION_DIFFICULTIES).optional(),
        status: z.enum(STUDY_QUESTION_STATUSES).optional(),
        favorite: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, courseId, subjectId, topicId, type, difficulty, status, favorite, limit, offset }) =>
      tool(() => {
        const questions = studyQuestions.listStudyQuestions({
          search: query,
          courseId,
          subjectId,
          topicId,
          type: type as StudyQuestionType | undefined,
          difficulty,
          status,
          favorite,
        });
        const compact = questions.map((question) => ({
          id: question.id,
          shortId: question.shortId,
          prompt: question.prompt,
          type: question.type,
          difficulty: question.difficulty,
          cognitiveLevel: question.cognitiveLevel,
          status: question.status,
          explanation: question.explanation,
          tags: question.tags,
          courseId: question.courseId,
          subjectId: question.subjectId,
          topicId: question.topicId,
          source: question.source,
          favorite: question.favorite,
        }));
        return page('questions', compact, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_study_get_progress',
    {
      title: 'Get study progress',
      description:
        'Returns the local evidence-based study progress dashboard and planner snapshot. Read-only; no review, session or goal is changed.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => ({
      progress: studyLearning.getStudyProgressDashboard(),
      planner: studyLearning.getStudyPlanner(),
    }))
  );
}
