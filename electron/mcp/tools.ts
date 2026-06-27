import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type {
  ModelRef,
  NoteSource,
  WritingWorkshopBrief,
  WritingWorkshopDraft,
  WritingWorkshopSelection,
} from '@shared/types';
import { getDb } from '../db/database';
import * as ideas from '../db/ideasRepo';
import { getWork, getWorkByZoteroKey, getWorkByAliasKey } from '../db/worksRepo';
import * as gaps from '../db/gapsRepo';
import * as notes from '../db/notesRepo';
import * as researchQuestions from '../db/researchMapRepo';
import * as writingDrafts from '../db/writingDraftsRepo';
import { buildAuthorGraph, getDebate, getDebates } from '../graph/graphService';
import { embed, AiError } from '../ai/aiClient';
import { decomposeQuestion, mapCoverage } from '../ai/researchMap';
import { buildWritingWorkshopSnapshot, generateWritingWorkshopDraft } from '../ai/writingWorkshop';

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
const AI_PROVIDERS = ['anthropic', 'openai', 'openrouter', 'deepseek', 'gemini'] as const;
const NOTE_KINDS = ['markdown', 'assistant', 'writing', 'debate', 'idea'] as const;
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

function count(table: 'ideas' | 'works' | 'gaps' | 'authors' | 'notes'): number {
  return (getDb().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
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
        'Returns the current size and vocabulary of this local Nodus corpus. Ideas, themes, edges, debates, gaps and authors are generated by analysing works and are read-only through MCP.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => ({
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
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, type }) =>
      tool(() => {
        const all = ideas
          .allIdeaCandidates()
          .filter((idea) => !type || idea.type === type)
          .sort((a, b) => a.global_id.localeCompare(b.global_id));
        return { ideas: all.slice(offset, offset + limit), total: all.length };
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
    'nodus_list_debates',
    {
      title: 'List debates',
      description: 'Lists contradiction/refutation debates, including their opposing ideas, works, evidence, timeline and relation. Read-only.',
      inputSchema: { limit: z.number().int().min(1).max(200).default(100) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit }) => tool(() => ({ debates: getDebates().slice(0, limit) }))()
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
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => ({ gaps: gaps.aggregateGaps() }))
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
    'nodus_list_notes_tree',
    {
      title: 'List notes tree',
      description: 'Returns the user-created notes and folders. Each folder carries its summary brief (the ideas it is meant to hold). This list omits note content; use nodus_get_note for a full note.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => {
      const tree = notes.getNotesTree();
      return { folders: tree.folders, notes: tree.notes.map(({ content: _content, ...note }) => note) };
    })
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
      description: 'Creates a research question, uses Nodus AI to decompose it, maps coverage against the local corpus, and saves the result. This modifies Nodus data and may consume provider tokens.',
      inputSchema: {
        question: z.string().trim().min(1).max(8_000),
        notes: z.string().trim().max(8_000).optional(),
        model: modelSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ question, notes: questionNotes, model }) =>
      tool(async () => {
        const created = researchQuestions.createResearchQuestion(question, questionNotes);
        const request = { rqId: created.rq.id, model: asModel(model) };
        await decomposeQuestion(request);
        return mapCoverage(request);
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
