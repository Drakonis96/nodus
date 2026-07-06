import type {
  HypothesisCandidate,
  HypothesisLabRequest,
  HypothesisLabResult,
  HypothesisVariable,
} from '@shared/types';
import {
  buildHypothesisLabFallback,
  type HypothesisDebateSource,
  type HypothesisGapSource,
  type HypothesisIdeaSource,
  type HypothesisLabCorpus,
  type HypothesisProjectSource,
  type HypothesisWorkSource,
} from '../../shared/hypothesisLab';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { getContradictions } from '../graph/graphService';
import * as projects from '../db/projectsRepo';
import { completeJson } from './aiClient';

interface IdeaRow {
  id: string;
  label: string;
  statement: string;
  type: string;
  themes: string | null;
  work_ids: string | null;
  work_count: number;
  evidence_count: number;
}

interface GapRow {
  id: string;
  kind: HypothesisGapSource['kind'];
  statement: string;
  confidence: number;
  related_idea: string | null;
  work_id: string;
  work_title: string;
  authors_json: string;
  year: number | null;
  evidence_quote: string | null;
}

interface WorkRow {
  id: string;
  title: string;
  authors_json: string;
  year: number | null;
  themes: string | null;
  deep_status: string;
  idea_count: number;
  gap_count: number;
  summary: string | null;
}

interface AiCandidatePatch {
  id?: string;
  title?: string;
  hypothesis?: string;
  rationale?: string;
  variables?: Array<Partial<HypothesisVariable>>;
  methods?: string[];
  predictions?: string[];
  counterArguments?: string[];
  nextSteps?: string[];
  searchQueries?: string[];
  draftAbstract?: string;
}

interface AiHypothesisResult {
  candidates?: AiCandidatePatch[];
  warnings?: string[];
}

function isAiHypothesisResult(value: unknown): value is AiHypothesisResult {
  return typeof value === 'object' && value !== null && Array.isArray((value as AiHypothesisResult).candidates);
}

export async function generateHypothesisLab(request: HypothesisLabRequest): Promise<HypothesisLabResult> {
  const corpus = buildCorpus(request);
  const fallback = buildHypothesisLabFallback(corpus);
  if (fallback.candidates.length === 0) return fallback;

  try {
    const ai = await completeJson<AiHypothesisResult>(
      {
        system: [
          'Eres el Laboratorio de hipotesis de Nodus. Tu tarea es mejorar hipotesis academicas generadas desde un corpus local.',
          'Usa SOLO los candidatos y evidencias recibidos. No inventes autores, obras, paginas, citas ni datos externos.',
          'Puedes mejorar la formulacion, variables, metodo, predicciones, objeciones, siguientes pasos y resumen.',
          'Conserva los ids de candidatos. No cambies puntuaciones ni cites fuentes nuevas.',
          'Cada hipotesis debe ser comprobable, defendible y expresada como una proposicion de investigacion, no como tema generico.',
          'Si el usuario pidio ingles, escribe todos los campos de prosa en ingles.',
          '',
          'Devuelve EXCLUSIVAMENTE JSON valido:',
          '{"candidates":[{"id":"hyp-...","title":"...","hypothesis":"...","rationale":"...","variables":[{"name":"...","role":"phenomenon|context|condition|mechanism|outcome|case|method","description":"..."}],"methods":["..."],"predictions":["..."],"counterArguments":["..."],"nextSteps":["..."],"searchQueries":["..."],"draftAbstract":"..."}],"warnings":["..."]}',
        ].join('\n'),
        user: JSON.stringify(buildAiContext(fallback), null, 2),
        temperature: 0.18,
        maxTokens: 12000,
      },
      isAiHypothesisResult,
      request.model
    );
    return mergeAi(fallback, ai);
  } catch (error) {
    return {
      ...fallback,
      warnings: [
        ...fallback.warnings,
        `La IA no pudo refinar las hipótesis; se muestra la versión estructural local. ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

function buildCorpus(request: HypothesisLabRequest): HypothesisLabCorpus {
  const settings = getSettings();
  const normalized: HypothesisLabRequest = {
    ...request,
    objective: request.objective?.trim() ?? '',
    language: request.language ?? settings.promptLanguage ?? 'es',
    maxCandidates: request.maxCandidates ?? 6,
  };
  return {
    request: normalized,
    generatedAt: new Date().toISOString(),
    ideas: listIdeas(),
    gaps: listGaps(),
    debates: listDebates(),
    works: listWorks(),
    passages: countTable('passages'),
    project: normalized.projectId ? projectSource(normalized.projectId) : null,
    warnings: [],
  };
}

function listIdeas(): HypothesisIdeaSource[] {
  const rows = getDb()
    .prepare(
      `SELECT i.global_id AS id, i.label, i.statement, i.type,
              COALESCE(GROUP_CONCAT(DISTINCT t.label), '') AS themes,
              COALESCE(GROUP_CONCAT(DISTINCT io.nodus_id), '') AS work_ids,
              COUNT(DISTINCT io.nodus_id) AS work_count,
              COUNT(DISTINCT e.id) AS evidence_count
         FROM ideas i
         LEFT JOIN idea_occurrences io ON io.global_id = i.global_id
         LEFT JOIN evidence e ON e.global_id = i.global_id
         LEFT JOIN idea_theme_links itl ON itl.global_id = i.global_id
         LEFT JOIN themes t ON t.theme_id = itl.theme_id
        GROUP BY i.global_id
        ORDER BY work_count DESC, evidence_count DESC, i.created_at ASC
        LIMIT 500`
    )
    .all() as IdeaRow[];
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    statement: row.statement,
    type: row.type,
    themes: splitList(row.themes),
    workIds: splitList(row.work_ids),
    workCount: row.work_count,
    evidenceCount: row.evidence_count,
  }));
}

function listGaps(): HypothesisGapSource[] {
  const rows = getDb()
    .prepare(
      `SELECT g.id, g.kind, g.statement, g.confidence, g.related_idea,
              w.nodus_id AS work_id, w.title AS work_title, w.authors_json, w.year,
              e.quote AS evidence_quote
         FROM gaps g
         JOIN works w ON w.nodus_id = g.nodus_id
         LEFT JOIN evidence e ON e.id = g.evidence_id
        WHERE w.archived = 0
        ORDER BY g.confidence DESC
        LIMIT 220`
    )
    .all() as GapRow[];
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    statement: row.statement,
    confidence: row.confidence,
    relatedIdeaId: row.related_idea,
    workId: row.work_id,
    workTitle: row.work_title,
    authors: parseAuthors(row.authors_json),
    year: row.year,
    evidenceQuote: row.evidence_quote,
  }));
}

function listWorks(): HypothesisWorkSource[] {
  const rows = getDb()
    .prepare(
      `SELECT w.nodus_id AS id, w.title, w.authors_json, w.year, w.deep_status,
              COALESCE(GROUP_CONCAT(DISTINCT t.label), '') AS themes,
              COUNT(DISTINCT io.global_id) AS idea_count,
              COUNT(DISTINCT g.id) AS gap_count,
              CASE WHEN w.summary_status = 'done' THEN ws.summary ELSE NULL END AS summary
         FROM works w
         LEFT JOIN work_themes wt ON wt.nodus_id = w.nodus_id
         LEFT JOIN themes t ON t.theme_id = wt.theme_id
         LEFT JOIN idea_occurrences io ON io.nodus_id = w.nodus_id
         LEFT JOIN gaps g ON g.nodus_id = w.nodus_id
         LEFT JOIN work_summaries ws ON ws.nodus_id = w.nodus_id
        WHERE w.archived = 0
        GROUP BY w.nodus_id
        ORDER BY gap_count DESC, idea_count DESC, w.year DESC
        LIMIT 300`
    )
    .all() as WorkRow[];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    authors: parseAuthors(row.authors_json),
    year: row.year,
    themes: splitList(row.themes),
    deepStatus: row.deep_status,
    ideaCount: row.idea_count,
    gapCount: row.gap_count,
    summary: row.summary,
  }));
}

function listDebates(): HypothesisDebateSource[] {
  return getContradictions()
    .slice(0, 120)
    .map((detail) => ({
      id: detail.edge.id,
      fromId: detail.edge.from_id,
      toId: detail.edge.to_id,
      fromLabel: detail.fromLabel,
      toLabel: detail.toLabel,
      explanation: detail.explanation ?? null,
      confidence: detail.edge.confidence,
    }));
}

function projectSource(projectId: string): HypothesisProjectSource | null {
  const detail = projects.getProjectDetail(projectId);
  if (!detail) return null;
  return {
    id: detail.project.id,
    title: detail.project.title,
    brief: detail.project.brief,
    linkLabels: detail.links.map((link) => link.label).filter(Boolean).slice(0, 30),
  };
}

function buildAiContext(result: HypothesisLabResult): Record<string, unknown> {
  return {
    request: {
      objective: result.request.objective,
      mode: result.request.mode,
      language: result.request.language,
    },
    stats: result.stats,
    candidates: result.candidates.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      hypothesis: candidate.hypothesis,
      rationale: candidate.rationale,
      maturity: candidate.maturity,
      scores: {
        novelty: candidate.novelty,
        support: candidate.support,
        testability: candidate.testability,
        risk: candidate.risk,
      },
      variables: candidate.variables,
      evidence: candidate.evidence.map((e) => ({
        kind: e.kind,
        role: e.role,
        label: e.label,
        citation: e.citation,
        quote: e.quote,
      })),
      methods: candidate.methods,
      predictions: candidate.predictions,
      counterArguments: candidate.counterArguments,
      nextSteps: candidate.nextSteps,
      draftAbstract: candidate.draftAbstract,
    })),
    rules: [
      'No anadas fuentes nuevas.',
      'No cambies ids.',
      'Mantén cada hipótesis comprobable y ligada al hueco detectado.',
    ],
  };
}

function mergeAi(base: HypothesisLabResult, ai: AiHypothesisResult): HypothesisLabResult {
  const patches = new Map((ai.candidates ?? []).filter((item) => item.id).map((item) => [item.id!, item]));
  const candidates = base.candidates.map((candidate) => sanitizeCandidatePatch(candidate, patches.get(candidate.id)));
  return {
    ...base,
    stats: { ...base.stats, aiRefined: true },
    candidates,
    warnings: [...base.warnings, ...stringList(ai.warnings)],
  };
}

function sanitizeCandidatePatch(
  candidate: HypothesisCandidate,
  patch: AiCandidatePatch | undefined
): HypothesisCandidate {
  if (!patch) return candidate;
  return {
    ...candidate,
    title: cleanString(patch.title, candidate.title),
    hypothesis: cleanString(patch.hypothesis, candidate.hypothesis),
    rationale: cleanString(patch.rationale, candidate.rationale),
    variables: sanitizeVariables(patch.variables, candidate.variables),
    methods: stringList(patch.methods, 6, candidate.methods),
    predictions: stringList(patch.predictions, 6, candidate.predictions),
    counterArguments: stringList(patch.counterArguments, 6, candidate.counterArguments),
    nextSteps: stringList(patch.nextSteps, 8, candidate.nextSteps),
    searchQueries: stringList(patch.searchQueries, 6, candidate.searchQueries),
    draftAbstract: cleanString(patch.draftAbstract, candidate.draftAbstract),
  };
}

function sanitizeVariables(value: AiCandidatePatch['variables'], fallback: HypothesisVariable[]): HypothesisVariable[] {
  if (!Array.isArray(value)) return fallback;
  const roles = new Set<HypothesisVariable['role']>(['phenomenon', 'context', 'condition', 'mechanism', 'outcome', 'case', 'method']);
  const variables = value
    .map((item): HypothesisVariable | null => {
      const name = cleanString(item.name, '');
      if (!name) return null;
      const role = roles.has(item.role as HypothesisVariable['role']) ? (item.role as HypothesisVariable['role']) : 'phenomenon';
      return {
        name,
        role,
        description: cleanString(item.description, ''),
      };
    })
    .filter((item): item is HypothesisVariable => !!item)
    .slice(0, 8);
  return variables.length ? variables : fallback;
}

function countTable(table: 'passages'): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

function splitList(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseAuthors(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function cleanString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function stringList(value: unknown, max = 8, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const out = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
  return out.length ? out.slice(0, max) : fallback;
}
