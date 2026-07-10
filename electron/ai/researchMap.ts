import type {
  ModelRef,
  ResearchQuestionDetail,
  RqCoverageLink,
  RqCoverageStatus,
  RqDecomposeRequest,
  RqMapProgress,
  RqMapRequest,
} from '@shared/types';
import { getDb } from '../db/database';
import { findSimilarIdeas } from '../db/ideasRepo';
import { completeJson, embed } from './aiClient';
import { PROMPT_RQ_COVERAGE, PROMPT_RQ_DECOMPOSE } from './prompts';
import * as repo from '../db/researchMapRepo';

const SEM_THRESHOLD = 0.3;
const MAX_CANDIDATES = 14;
const MAX_WORKS_PER_IDEA = 5;

// ─── helpers (lightweight lexical fallback when no embeddings are available) ──

const STOP_WORDS = new Set([
  'para','con','los','las','del','una','uno','que','como','por','sobre','entre','este','esta',
  'estos','estas','cual','cuales','tiene','tienen','ser','son','the','and','for','with','that',
  'this','from','into','about','what','which','have','has','been','their','your','sus','más','muy',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3 && !STOP_WORDS.has(token))
  );
}

function relevance(tokens: Set<string>, text: string): number {
  if (tokens.size === 0) return 0;
  const hay = tokenize(text);
  let hits = 0;
  for (const token of tokens) if (hay.has(token)) hits += 1;
  return hits / Math.max(4, tokens.size);
}

function clip(value: string, max: number): string {
  const clean = (value || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

function parseAuthors(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

function authorYear(authors: string[], year: number | null): string {
  const raw = authors[0]?.replace(/\s+/g, ' ').trim();
  const surname = raw ? (raw.includes(',') ? raw.slice(0, raw.indexOf(',')) : raw.split(' ').slice(-1)[0]).trim() : 'Autor';
  return year ? `${surname}, ${year}` : surname;
}

// ─── candidate retrieval ─────────────────────────────────────────────────────

interface IdeaWorkInfo {
  nodus_id: string;
  title: string;
  authors: string[];
  year: number | null;
  read: boolean;
}

interface IdeaCandidate {
  id: string;
  label: string;
  statement: string;
  themes: string[];
  works: IdeaWorkInfo[];
  evidenceSample: string | null;
  read: boolean;
  score: number;
}

interface IdeaLexRow {
  global_id: string;
  label: string;
  statement: string;
}

function ideaContext(globalId: string, score: number): IdeaCandidate | null {
  const db = getDb();
  const idea = db
    .prepare('SELECT global_id, label, statement FROM ideas WHERE global_id = ?')
    .get(globalId) as IdeaLexRow | undefined;
  if (!idea) return null;

  const themeRows = db
    .prepare(
      'SELECT t.label AS label FROM idea_theme_links l JOIN themes t ON t.theme_id = l.theme_id WHERE l.global_id = ?'
    )
    .all(globalId) as { label: string }[];

  const workRows = db
    .prepare(
      `SELECT w.nodus_id, w.title, w.authors_json, w.year, w.read_tag, w.deep_status
         FROM idea_occurrences io
         JOIN works w ON w.nodus_id = io.nodus_id
        WHERE io.global_id = ?
        ORDER BY io.role = 'principal' DESC, io.confidence DESC, w.year DESC
        LIMIT ?`
    )
    .all(globalId, MAX_WORKS_PER_IDEA) as {
    nodus_id: string;
    title: string;
    authors_json: string;
    year: number | null;
    read_tag: number;
    deep_status: string;
  }[];

  const works: IdeaWorkInfo[] = workRows.map((w) => ({
    nodus_id: w.nodus_id,
    title: w.title,
    authors: parseAuthors(w.authors_json),
    year: w.year,
    read: w.read_tag === 1 || w.deep_status === 'done',
  }));

  const evidence = db
    .prepare('SELECT quote FROM evidence WHERE global_id = ? LIMIT 1')
    .get(globalId) as { quote: string } | undefined;

  return {
    id: idea.global_id,
    label: idea.label,
    statement: idea.statement,
    themes: themeRows.map((t) => t.label),
    works,
    evidenceSample: evidence ? clip(evidence.quote, 240) : null,
    read: works.some((w) => w.read),
    score,
  };
}

/** Top candidate ideas for a sub-question: semantic if embeddings exist, else lexical. */
async function retrieveCandidates(text: string, lexRows: IdeaLexRow[]): Promise<IdeaCandidate[]> {
  const emb = await embed(text);
  if (emb) {
    const hits = findSimilarIdeas(emb, SEM_THRESHOLD, MAX_CANDIDATES);
    if (hits.length > 0) {
      return hits
        .map((h) => ideaContext(h.global_id, h.similarity))
        .filter((c): c is IdeaCandidate => c !== null);
    }
  }
  const tokens = tokenize(text);
  return lexRows
    .map((row) => ({ row, score: relevance(tokens, `${row.label} ${row.statement}`) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map((r) => ideaContext(r.row.global_id, r.score))
    .filter((c): c is IdeaCandidate => c !== null);
}

interface DisputeEdge {
  edgeId: string;
  fromId: string;
  toId: string;
  label: string;
}

function disputesAmong(ids: string[]): DisputeEdge[] {
  if (ids.length < 2) return [];
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, from_id, to_id, type FROM visible_edges
        WHERE type IN ('contradicts','refutes')
          AND from_id IN (${placeholders}) AND to_id IN (${placeholders})`
    )
    .all(...ids, ...ids) as { id: string; from_id: string; to_id: string; type: string }[];
  return rows.map((r) => ({
    edgeId: r.id,
    fromId: r.from_id,
    toId: r.to_id,
    label: r.type === 'refutes' ? 'refutación' : 'contradicción',
  }));
}

// ─── AI calls ────────────────────────────────────────────────────────────────

interface AiDecomposition {
  subQuestions: { text: string; rationale?: string }[];
}
function isAiDecomposition(value: unknown): value is AiDecomposition {
  if (!value || typeof value !== 'object') return false;
  const arr = (value as AiDecomposition).subQuestions;
  return Array.isArray(arr) && arr.every((s) => s && typeof s.text === 'string');
}

interface AiCoverage {
  status: RqCoverageStatus;
  justification: string;
  ideaIds: string[];
}
function isAiCoverage(value: unknown): value is AiCoverage {
  if (!value || typeof value !== 'object') return false;
  const v = value as AiCoverage;
  return (
    ['covered', 'partial', 'uncovered', 'disputed'].includes(v.status) &&
    typeof v.justification === 'string' &&
    Array.isArray(v.ideaIds) &&
    v.ideaIds.every((id) => typeof id === 'string')
  );
}

export async function decomposeQuestion(request: RqDecomposeRequest): Promise<ResearchQuestionDetail> {
  const rq = repo.getResearchQuestion(request.rqId);
  if (!rq) throw new Error('No se encontró la pregunta de investigación.');

  const user = JSON.stringify({ pregunta: rq.question, notas: rq.notes ?? '' }, null, 2);
  const ai = await completeJson<AiDecomposition>(
    { system: PROMPT_RQ_DECOMPOSE, user, temperature: 0.2, maxTokens: 1600 },
    isAiDecomposition,
    request.model
  );

  repo.replaceSubQuestions(
    request.rqId,
    ai.subQuestions
      .map((s) => ({ text: s.text.trim(), rationale: s.rationale?.trim() || null }))
      .filter((s) => s.text.length > 0)
  );
  repo.updateRqModel(request.rqId, request.model ?? null);
  repo.setRqStatus(request.rqId, 'decomposed');
  return repo.getResearchQuestionDetail(request.rqId)!;
}

export async function mapCoverage(
  request: RqMapRequest,
  onProgress?: (p: RqMapProgress) => void
): Promise<ResearchQuestionDetail> {
  const rq = repo.getResearchQuestion(request.rqId);
  if (!rq) throw new Error('No se encontró la pregunta de investigación.');
  const subs = repo.getSubQuestionRows(request.rqId);

  // Load lightweight idea rows once for the lexical fallback path.
  const lexRows = getDb()
    .prepare('SELECT global_id, label, statement FROM ideas')
    .all() as IdeaLexRow[];

  const total = subs.length;
  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i];
    onProgress?.({ index: i, total, phase: 'retrieving', subQuestion: sub.text });

    const candidates = await retrieveCandidates(sub.text, lexRows);
    const candidateById = new Map(candidates.map((c) => [c.id, c]));

    onProgress?.({ index: i, total, phase: 'classifying', subQuestion: sub.text });

    let coverage: AiCoverage;
    if (candidates.length === 0) {
      coverage = { status: 'uncovered', justification: 'La biblioteca no contiene ideas que aborden esta sub-pregunta.', ideaIds: [] };
    } else {
      const disputesAll = disputesAmong(candidates.map((c) => c.id));
      const payload = {
        subPregunta: sub.text,
        ideasCandidatas: candidates.map((c) => ({
          id: c.id,
          etiqueta: c.label,
          enunciado: clip(c.statement, 400),
          temas: c.themes,
          numObras: c.works.length,
          soporteEnObrasLeidas: c.read,
          citaMuestra: c.evidenceSample,
        })),
        paresEnContradiccion: disputesAll.map((d) => ({ a: d.fromId, b: d.toId })),
      };
      try {
        coverage = await completeJson<AiCoverage>(
          { system: PROMPT_RQ_COVERAGE, user: JSON.stringify(payload, null, 2), temperature: 0.15, maxTokens: 900 },
          isAiCoverage,
          request.model
        );
      } catch {
        // Fall back to a conservative data-only verdict if the model call fails.
        coverage = {
          status: candidates.length >= 2 ? 'partial' : 'uncovered',
          justification: 'Clasificación automática no disponible; verdicto provisional por recuperación.',
          ideaIds: candidates.slice(0, 4).map((c) => c.id),
        };
      }
    }

    // Enforce the closed set: drop any hallucinated ids.
    const chosenIds = coverage.ideaIds.filter((id) => candidateById.has(id));
    let status = chosenIds.length === 0 ? 'uncovered' : coverage.status;

    // Build links from real data.
    const links: Omit<RqCoverageLink, 'id'>[] = [];
    const seenWorks = new Set<string>();
    for (const id of chosenIds) {
      const c = candidateById.get(id)!;
      links.push({
        kind: 'idea',
        refId: id,
        label: clip(c.label, 90),
        score: Number(c.score.toFixed(3)),
        readState: c.read ? 'read' : 'unread',
      });
      for (const w of c.works) {
        if (seenWorks.has(w.nodus_id)) continue;
        seenWorks.add(w.nodus_id);
        links.push({
          kind: 'work',
          refId: w.nodus_id,
          label: `${authorYear(w.authors, w.year)} — ${clip(w.title, 80)}`,
          score: null,
          readState: w.read ? 'read' : 'unread',
        });
      }
    }

    // Data-driven dispute cross-link: if chosen ideas contradict each other, surface it.
    const disputes = disputesAmong(chosenIds);
    for (const d of disputes) {
      links.push({ kind: 'debate', refId: d.edgeId, label: d.label, score: null, readState: null });
    }
    if (disputes.length > 0 && (status === 'covered' || status === 'partial')) {
      status = 'disputed';
    }

    repo.setSubQuestionCoverage(sub.id, status as RqCoverageStatus, coverage.justification.trim(), links);
    onProgress?.({ index: i, total, phase: 'done', subQuestion: sub.text });
  }

  repo.setRqMapped(request.rqId);
  repo.updateRqModel(request.rqId, request.model ?? (rq.model as ModelRef | null) ?? null);
  return repo.getResearchQuestionDetail(request.rqId)!;
}
