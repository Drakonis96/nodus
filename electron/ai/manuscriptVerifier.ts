import type {
  AppLanguage,
  ApplyManuscriptCitationRequest,
  ApplyManuscriptCitationResult,
  ManuscriptClaimCheck,
  ManuscriptClaimSeverity,
  ManuscriptClaimStatus,
  ManuscriptEvidenceCandidate,
  ManuscriptVerificationRequest,
  ManuscriptVerificationResult,
} from '@shared/types';
import {
  classifyClaimLocally,
  extractManuscriptClaims,
  insertCitationIntoDraft,
  summarizeChecks,
  tokenizeForMatch,
  type ExtractedManuscriptClaim,
} from '../../shared/manuscriptVerifier';
import { completeJson, embed } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import { allIdeaCandidates, findSimilarIdeas } from '../db/ideasRepo';
import { findSimilarPassages } from '../db/passagesRepo';
import { getChapter, updateChapterMarkdown } from '../db/projectsRepo';

const DEFAULT_MAX_CLAIMS = 80;
const SEMANTIC_IDEA_THRESHOLD = 0.3;
const SEMANTIC_PASSAGE_THRESHOLD = 0.28;
const LEXICAL_IDEA_THRESHOLD = 0.18;
const MAX_EVIDENCE_PER_CLAIM = 6;
const AI_BATCH_SIZE = 8;

interface IndexedIdeaCandidate {
  global_id: string;
  type: string;
  label: string;
  statement: string;
  tokens: Set<string>;
}

interface AiClaimReview {
  id?: string;
  status?: string;
  severity?: string;
  rationale?: string;
  evidenceIds?: string[];
  replacementHint?: string | null;
}

interface AiReviewResponse {
  claims: AiClaimReview[];
}

function isAiReviewResponse(value: unknown): value is AiReviewResponse {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as AiReviewResponse).claims));
}

export async function verifyManuscriptCitations(
  request: ManuscriptVerificationRequest
): Promise<ManuscriptVerificationResult> {
  const chapter = getChapter(request.chapterId);
  const generatedAt = new Date().toISOString();
  const language = request.language ?? getSettings().uiLanguage ?? 'es';
  const warnings: string[] = [];
  if (!chapter?.currentMarkdown.trim()) {
    return {
      chapterId: request.chapterId,
      generatedAt,
      available: false,
      aiReviewed: false,
      summary: summarizeChecks([], 0),
      claims: [],
      warnings: [warn(language, 'empty')],
    };
  }

  const maxClaims = Math.max(1, Math.min(160, request.maxClaims ?? DEFAULT_MAX_CLAIMS));
  const claims = extractManuscriptClaims(chapter.currentMarkdown, maxClaims);
  if (claims.length === 0) {
    return {
      chapterId: request.chapterId,
      generatedAt,
      available: false,
      aiReviewed: false,
      summary: summarizeChecks([], 0),
      claims: [],
      warnings: [warn(language, 'noClaims')],
    };
  }

  const ideas = allIdeaCandidates();
  if (ideas.length === 0) warnings.push(warn(language, 'noIdeas'));
  const indexedIdeas = ideas.map((idea) => ({
    ...idea,
    tokens: new Set(tokenizeForMatch(`${idea.label} ${idea.statement}`)),
  }));

  const checks: ManuscriptClaimCheck[] = [];
  let embeddingsUsed = false;
  for (const claim of claims) {
    const evidence = await gatherEvidence(claim, indexedIdeas);
    if (evidence.embeddingUsed) embeddingsUsed = true;
    checks.push(classifyClaimLocally({ claim, evidence: evidence.candidates, language }));
  }

  if (!embeddingsUsed) warnings.push(warn(language, 'noEmbeddings'));

  const refined = await refineWithAi(checks, request, language, warnings);
  const finalChecks = sortChecks(refined.checks);
  return {
    chapterId: request.chapterId,
    generatedAt,
    available: ideas.length > 0 || finalChecks.some((claim) => claim.suggestedCitations.length > 0),
    aiReviewed: refined.aiReviewed,
    summary: summarizeChecks(finalChecks, claims.length),
    claims: finalChecks,
    warnings,
  };
}

export function applyManuscriptCitation(request: ApplyManuscriptCitationRequest): ApplyManuscriptCitationResult {
  const chapter = getChapter(request.chapterId);
  if (!chapter) return { applied: false, chapter: null };
  const result = insertCitationIntoDraft(chapter.currentMarkdown, request.excerpt, request.citationMarkdown);
  if (!result.applied || result.markdown === chapter.currentMarkdown) {
    return { applied: false, chapter };
  }
  const updated = updateChapterMarkdown(request.chapterId, result.markdown, { versionLabel: 'Antes de aplicar cita' });
  return { applied: Boolean(updated), chapter: updated };
}

async function gatherEvidence(
  claim: ExtractedManuscriptClaim,
  indexedIdeas: IndexedIdeaCandidate[]
): Promise<{ candidates: ManuscriptEvidenceCandidate[]; embeddingUsed: boolean }> {
  const candidates = new Map<string, ManuscriptEvidenceCandidate>();
  let embeddingUsed = false;
  const vector = await embed(claim.excerpt);
  if (vector) {
    embeddingUsed = true;
    for (const hit of findSimilarIdeas(vector, SEMANTIC_IDEA_THRESHOLD, 5)) {
      upsertCandidate(candidates, {
        kind: 'idea',
        refId: hit.global_id,
        label: hit.label,
        citation: `nodus://idea/${encodeURIComponent(hit.global_id)}`,
        snippet: hit.statement,
        score: clampScore(hit.similarity),
      });
    }
    for (const hit of findSimilarPassages(vector, SEMANTIC_PASSAGE_THRESHOLD, 4)) {
      upsertCandidate(candidates, {
        kind: 'passage',
        refId: hit.passage_id,
        label: hit.title,
        citation: `nodus://passage/${encodeURIComponent(hit.passage_id)}`,
        snippet: hit.text,
        score: clampScore(hit.similarity),
        workTitle: hit.title,
        pageLabel: hit.page_label,
      });
    }
  }

  for (const hit of lexicalIdeaMatches(claim.excerpt, indexedIdeas, 4)) {
    upsertCandidate(candidates, {
      kind: 'idea',
      refId: hit.global_id,
      label: hit.label,
      citation: `nodus://idea/${encodeURIComponent(hit.global_id)}`,
      snippet: hit.statement,
      score: hit.score,
    });
  }

  return {
    candidates: [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, MAX_EVIDENCE_PER_CLAIM),
    embeddingUsed,
  };
}

function lexicalIdeaMatches(excerpt: string, ideas: IndexedIdeaCandidate[], limit: number) {
  const queryTokens = new Set(tokenizeForMatch(excerpt));
  if (queryTokens.size === 0) return [];
  return ideas
    .map((idea) => ({ ...idea, score: scoreTokenSets(queryTokens, idea.tokens) }))
    .filter((idea) => idea.score >= LEXICAL_IDEA_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function scoreTokenSets(queryTokens: Set<string>, targetTokens: Set<string>): number {
  if (queryTokens.size === 0 || targetTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) overlap += 1;
  }
  if (overlap === 0) return 0;
  const cosineLike = overlap / Math.sqrt(queryTokens.size * targetTokens.size);
  const queryCoverage = overlap / queryTokens.size;
  return Number(Math.min(1, cosineLike * 0.7 + queryCoverage * 0.3).toFixed(4));
}

function upsertCandidate(map: Map<string, ManuscriptEvidenceCandidate>, candidate: ManuscriptEvidenceCandidate): void {
  const key = `${candidate.kind}:${candidate.refId}`;
  const existing = map.get(key);
  if (!existing || candidate.score > existing.score) {
    map.set(key, { ...candidate, score: clampScore(candidate.score), snippet: clip(candidate.snippet, 700) });
  }
}

async function refineWithAi(
  checks: ManuscriptClaimCheck[],
  request: ManuscriptVerificationRequest,
  language: AppLanguage,
  warnings: string[]
): Promise<{ checks: ManuscriptClaimCheck[]; aiReviewed: boolean }> {
  const reviewable = checks.filter((check) => check.suggestedCitations.length > 0 || check.status === 'missing_citation');
  if (reviewable.length === 0) return { checks, aiReviewed: false };

  const byId = new Map(checks.map((check) => [check.id, check]));
  let reviewed = false;
  for (let i = 0; i < reviewable.length; i += AI_BATCH_SIZE) {
    const batch = reviewable.slice(i, i + AI_BATCH_SIZE);
    try {
      const response = await completeJson<AiReviewResponse>(
        {
          system: [
            'Eres un verificador academico dentro de Nodus.',
            'No recibes el manuscrito completo. Solo recibes frases candidatas y candidatos recuperados desde ideas/pasajes del corpus local.',
            'Tu tarea es clasificar si una frase necesita cita, ya esta cubierta, es aportacion propia o solo tiene una coincidencia debil.',
            'Usa status exactamente: missing_citation, covered, own_argument, weak_match.',
            'Marca missing_citation solo si NO hay cita existente y algun candidato respalda directamente la frase.',
            'Marca own_argument si la frase expresa una contribucion del autor o si no hay respaldo directo en los candidatos.',
            'No inventes fuentes, ids ni citas. Usa solo evidenceIds de los candidatos recibidos.',
            'En evidenceIds incluye SOLO los candidatos que respaldan directamente la frase, del mas al menos pertinente. Omite los candidatos fuera de tema aunque aparezcan en la lista.',
            language === 'en'
              ? 'Write rationale and replacementHint in English.'
              : 'Escribe rationale y replacementHint en espanol.',
            'Devuelve solo JSON {"claims":[{"id","status","severity":"high|medium|low|info","rationale":"breve","evidenceIds":["kind:id"],"replacementHint":"opcional"}]}',
          ].join('\n'),
          user: JSON.stringify(
            {
              claims: batch.map((check) => ({
                id: check.id,
                excerpt: clip(check.excerpt, 700),
                hasCitation: check.hasCitation,
                existingCitations: check.existingCitations,
                localStatus: check.status,
                localRationale: check.rationale,
                candidates: check.suggestedCitations.map((candidate) => ({
                  evidenceId: `${candidate.kind}:${candidate.refId}`,
                  kind: candidate.kind,
                  label: candidate.label,
                  citation: candidate.citation,
                  score: candidate.score,
                  snippet: clip(candidate.snippet, 450),
                })),
              })),
            },
            null,
            2
          ),
          temperature: 0.05,
          maxTokens: 3500,
        },
        isAiReviewResponse,
        request.model ?? null
      );
      for (const review of response.claims) {
        const current = review.id ? byId.get(review.id) : null;
        if (!current) continue;
        byId.set(current.id, applyAiReview(current, review));
      }
      reviewed = true;
    } catch {
      // Keep the deterministic result; verifier remains useful without an LLM.
    }
  }

  if (!reviewed) warnings.push(warn(language, 'noAi'));
  return { checks: checks.map((check) => byId.get(check.id) ?? check), aiReviewed: reviewed };
}

function applyAiReview(check: ManuscriptClaimCheck, review: AiClaimReview): ManuscriptClaimCheck {
  let status = normalizeStatus(review.status) ?? check.status;
  if (check.hasCitation && status === 'missing_citation') status = 'covered';
  const allowedEvidence = new Set(check.suggestedCitations.map((candidate) => `${candidate.kind}:${candidate.refId}`));
  const endorsedIds = new Set((review.evidenceIds ?? []).filter((id) => allowedEvidence.has(id)));
  const endorsed = check.suggestedCitations
    .filter((candidate) => endorsedIds.has(`${candidate.kind}:${candidate.refId}`))
    .map((candidate) => ({ ...candidate, aiEndorsed: true }));
  const others = check.suggestedCitations
    .filter((candidate) => !endorsedIds.has(`${candidate.kind}:${candidate.refId}`))
    .map((candidate) => ({ ...candidate, aiEndorsed: false }));
  // When the AI explicitly names the supporting sources for a claim that needs (or
  // weakly has) a citation, drop the rest: those are the off-topic matches the user
  // sees as "super distant". Otherwise keep the ranked list but float endorsed first.
  const prunes = status === 'missing_citation' || status === 'weak_match';
  const suggestedCitations = (
    prunes && endorsed.length > 0 ? endorsed : [...endorsed, ...others]
  ).sort((a, b) => b.score - a.score);
  const severity = normalizeSeverity(review.severity) ?? severityForStatus(status, { ...check, suggestedCitations });

  return {
    ...check,
    status,
    severity,
    rationale: typeof review.rationale === 'string' && review.rationale.trim() ? clip(review.rationale, 500) : check.rationale,
    replacementHint:
      typeof review.replacementHint === 'string' && review.replacementHint.trim()
        ? clip(review.replacementHint, 300)
        : check.replacementHint,
    suggestedCitations,
  };
}

function normalizeStatus(value: unknown): ManuscriptClaimStatus | null {
  const raw = String(value ?? '').trim();
  if (raw === 'missing_citation' || raw === 'covered' || raw === 'own_argument' || raw === 'weak_match') return raw;
  return null;
}

function normalizeSeverity(value: unknown): ManuscriptClaimSeverity | null {
  const raw = String(value ?? '').trim();
  if (raw === 'high' || raw === 'medium' || raw === 'low' || raw === 'info') return raw;
  return null;
}

function severityForStatus(status: ManuscriptClaimStatus, check: ManuscriptClaimCheck): ManuscriptClaimSeverity {
  if (status === 'missing_citation') return check.suggestedCitations[0]?.score >= 0.42 ? 'high' : 'medium';
  if (status === 'weak_match') return 'low';
  return 'info';
}

function sortChecks(checks: ManuscriptClaimCheck[]): ManuscriptClaimCheck[] {
  const rank: Record<ManuscriptClaimStatus, number> = {
    missing_citation: 0,
    weak_match: 1,
    covered: 2,
    own_argument: 3,
  };
  return checks.slice().sort((a, b) => {
    const statusDelta = rank[a.status] - rank[b.status];
    if (statusDelta !== 0) return statusDelta;
    const scoreDelta = (b.suggestedCitations[0]?.score ?? 0) - (a.suggestedCitations[0]?.score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return a.paragraphIndex - b.paragraphIndex || a.sentenceIndex - b.sentenceIndex;
  });
}

function warn(language: AppLanguage, kind: 'empty' | 'noClaims' | 'noIdeas' | 'noEmbeddings' | 'noAi'): string {
  const en = language === 'en';
  switch (kind) {
    case 'empty':
      return en ? 'The selected chapter has no text to verify.' : 'El capitulo seleccionado no tiene texto que verificar.';
    case 'noClaims':
      return en
        ? 'No citation-worthy academic claims were detected in this chapter.'
        : 'No se detectaron afirmaciones academicas verificables en este capitulo.';
    case 'noIdeas':
      return en
        ? 'There are no listed corpus ideas to compare against.'
        : 'No hay ideas listadas del corpus contra las que comparar.';
    case 'noEmbeddings':
      return en
        ? 'Embeddings are unavailable, so the verifier used listed ideas only.'
        : 'No hay embeddings disponibles; el verificador uso solo ideas listadas.';
    case 'noAi':
      return en
        ? 'AI review was unavailable, so deterministic retrieval results are shown.'
        : 'La revision con IA no estuvo disponible; se muestran resultados deterministas.';
  }
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}...`;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
