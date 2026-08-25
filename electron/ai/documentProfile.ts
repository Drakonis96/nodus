import { createHash, randomUUID } from 'node:crypto';
import type {
  DocumentIdeaLink,
  DocumentProfileAudit,
  DocumentProfileFieldKind,
  DocumentProfileSupport,
  DocumentSection,
  ModelRef,
  Work,
} from '@shared/types';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import {
  advanceRunningDocumentIndexJob,
  clearDocumentCheckpoints,
  publishDocumentProfile,
  readDocumentCheckpoint,
  saveDocumentCheckpoint,
  setDocumentProfileState,
  updateDocumentIndexJob,
} from '../db/documentProfilesRepo';
import { cosineSimilarity, currentEmbeddingConfig, decodeEmbedding } from '../db/ideasRepo';
import type { PassageInsert } from '../db/passagesRepo';
import { planRetrievalChunks, resolveWorkText, resolvedTextStateFromDoc } from '../extraction/textExtractor';
import { setResolvedTextState } from '../db/worksRepo';
import { analysisFingerprint, analysisModelFingerprint, upsertLibraryAnalysisProvenance } from '../db/libraryAnalysisProvenance';
import { getItem, LOCAL_USER_ID } from '../zotero/zoteroClient';
import { AiError, completeJson, embedMany } from './aiClient';

export const DOCUMENT_PROFILE_PIPELINE_VERSION = 'document-profile/4';
export const DOCUMENT_PROFILE_SCHEMA_VERSION = 1;
const ANALYSIS_WORDS = 2_500;
const MIN_SECTION_WORDS = 80;
const DIRECT_SUPPORT_CONFIDENCE_FLOOR = 0.8;
const CENTRAL_FIELD_KINDS = new Set<DocumentProfileFieldKind>(['problem', 'question', 'thesis', 'method', 'conclusion', 'contribution']);

const SECTION_SYSTEM = `Analiza íntegramente el fragmento de una sección académica. Devuelve JSON estricto:
{"title":"","summary":"","role":"","concepts":[""],"claims":[{"text":"","support_quote":"cita literal del fragmento","page":"p. N o null","confidence":0.0}]}
La cita debe copiarse literalmente. Distingue el argumento central de menciones incidentales. No inventes.`;

const SECTION_REDUCE_SYSTEM = `Fusiona análisis parciales de UNA misma sección. Devuelve el mismo JSON estricto.
Conserva solo afirmaciones centrales y sus citas literales ya presentes en los análisis parciales. No inventes citas.`;

const SECTION_AUDIT_SYSTEM = `Audita un análisis de sección contra el fragmento completo que lo sustenta. Devuelve JSON estricto:
{"passed":true,"issues":[""],"analysis":{"title":"","summary":"","role":"","concepts":[""],"claims":[{"text":"","support_quote":"cita literal del fragmento","page":"p. N o null","confidence":0.0}]}}
Comprueba que summary, role y claims no contradigan el fragmento, que distingan tesis de menciones incidentales y que toda support_quote sea literal. Si passed=false, devuelve en analysis una versión íntegra ya corregida usando solo el fragmento. Si passed=true, repite sin cambios el análisis recibido. No inventes.`;

const PROFILE_SYSTEM = `Construye una ficha verificable de una obra a partir de sus secciones ya analizadas. Devuelve JSON estricto:
{"source_language":"es","overview":"","fields":[{"kind":"thesis","text":"","confidence":0.0,"centrality":0.0,"support_quote":"cita literal ya incluida en las secciones","page":"p. N o null"}]}
Kinds permitidos: object,problem,question,thesis,argument,method,sources,concept,temporal_scope,geographic_scope,disciplinary_scope,structure,conclusion,contribution,limitation,genre,audience,positioning,original_abstract.
Incluye varios argument/concept cuando proceda. Omite lo que la obra no permita afirmar. Toda afirmación debe tener apoyo literal. No uses conocimiento externo.`;

const AUDIT_SYSTEM = `Audita una ficha documental contra su estructura y apoyos literales. Devuelve JSON estricto:
{"passed":true,"score":0.0,"issues":[""],"field_fixes":[{"index":0,"text":"","support_quote":""}],"overview":""}
Comprueba tesis central, método, fuentes, alcance, conclusiones, centralidad frente a menciones incidentales y fidelidad de cada apoyo. passed solo puede ser true si no hay errores sustantivos. No inventes.`;

const REPAIR_SYSTEM = `Repara la ficha usando exclusivamente los análisis de sección y los problemas del auditor. Devuelve exactamente el esquema de ficha original. Elimina campos no apoyados. Cada support_quote debe copiar, sin alterar una sola palabra, uno de los support_quote presentes en claims; no lo resumas, traduzcas ni parafrasees.`;

export interface DerivedDocumentSection extends DocumentSection {
  body: string;
}

interface RawClaim { text: string; support_quote: string; page: string | null; confidence: number }
interface SectionAnalysis { title: string; summary: string; role: string; concepts: string[]; claims: RawClaim[] }
interface RawProfileField {
  kind: DocumentProfileFieldKind;
  text: string;
  confidence: number;
  centrality: number;
  support_quote: string;
  page: string | null;
}
interface ProfileSynthesis { source_language: string; overview: string; fields: RawProfileField[] }
interface AuditResponse {
  passed: boolean;
  score: number;
  issues: string[];
  field_fixes: Array<{ index: number; text: string; support_quote: string }>;
  overview: string;
}
interface SectionAuditResponse { passed: boolean; issues: string[]; analysis: SectionAnalysis | null }
interface PreparedPassages {
  contentHash: string;
  rows: PassageInsert[];
  embeddingProvider: string;
  embeddingModel: string;
}

function isSectionAuditResponse(value: unknown): value is SectionAuditResponse {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export interface DocumentProfileScanProgress {
  phase: 'waiting_source' | 'structuring' | 'analyzing_sections' | 'synthesizing' | 'auditing' | 'repairing' | 'embedding' | 'aligning' | 'publishing';
  progress: number;
  message: string;
}

export interface RunDocumentProfileOptions {
  jobId: string;
  generatorModel: ModelRef | null;
  auditorModel: ModelRef | null;
  signal?: AbortSignal;
  onProgress?: (progress: DocumentProfileScanProgress) => void;
}

const clean = (value: unknown, max = 20_000): string => typeof value === 'string'
  ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const strings = (value: unknown, max = 24): string[] => Array.isArray(value)
  ? value.map((item) => clean(item, 500)).filter(Boolean).slice(0, max) : [];
const number01 = (value: unknown): number => Math.max(0, Math.min(1, Number(value) || 0));
const page = (value: unknown): string | null => {
  const match = clean(value, 30).match(/(?:p\.?|page|página)\s*(\d+)/i);
  return match ? `p. ${match[1]}` : null;
};
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const sha1 = (value: string): string => createHash('sha1').update(value).digest('hex');

function isSectionAnalysis(value: unknown): value is SectionAnalysis {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.summary === 'string' && Array.isArray(item.concepts) && Array.isArray(item.claims);
}

function normalizeSectionAnalysis(value: SectionAnalysis, fallbackTitle: string): SectionAnalysis {
  return {
    title: clean(value.title, 300) || fallbackTitle,
    summary: clean(value.summary, 4_000),
    role: clean(value.role, 300),
    concepts: strings(value.concepts),
    claims: (Array.isArray(value.claims) ? value.claims : []).flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const claim = entry as unknown as Record<string, unknown>;
      const text = clean(claim.text, 1_500);
      const quote = clean(claim.support_quote, 1_200);
      return text && quote ? [{ text, support_quote: quote, page: page(claim.page), confidence: number01(claim.confidence) }] : [];
    }).slice(0, 16),
  };
}

function normalizeDirectSupportConfidence(analysis: SectionAnalysis): SectionAnalysis {
  return {
    ...analysis,
    claims: analysis.claims.map((claim) => ({
      ...claim,
      // Confidence is evidence metadata, not an unchecked model opinion. Once a
      // claim has survived literal matching and the independent section audit,
      // zero is internally contradictory and makes the document auditor reject
      // otherwise valid evidence at random.
      confidence: Math.max(DIRECT_SUPPORT_CONFIDENCE_FLOOR, claim.confidence),
    })),
  };
}

function normalizeSectionAuditResponse(value: unknown, fallbackTitle: string): SectionAuditResponse {
  const root = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const nested = root.section_audit && typeof root.section_audit === 'object' && !Array.isArray(root.section_audit)
    ? root.section_audit as Record<string, unknown>
    : null;
  const item = nested ?? root;
  const rawPassed = item.passed;
  const passed = rawPassed === true || (typeof rawPassed === 'string' && rawPassed.trim().toLowerCase() === 'true');
  const rawIssues = Array.isArray(item.issues) ? item.issues : item.issues == null ? [] : [item.issues];
  const candidate = item.analysis ?? item.corrected_analysis;
  const analysis = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? normalizeSectionAnalysis(candidate as SectionAnalysis, fallbackTitle)
    : null;
  return { passed, issues: rawIssues.map((issue) => clean(issue, 1_000)).filter(Boolean).slice(0, 30), analysis };
}

function isProfileSynthesis(value: unknown): value is ProfileSynthesis {
  // The synthesis/repair pass is followed by stricter deterministic checks. Let
  // those checks reject an incomplete profile with a useful quality error instead
  // of failing early because a provider omitted an empty array or wrapped the
  // requested object in `profile`.
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const FIELD_KINDS = new Set<DocumentProfileFieldKind>([
  'object','problem','question','thesis','argument','method','sources','concept','temporal_scope',
  'geographic_scope','disciplinary_scope','structure','conclusion','contribution','limitation',
  'genre','audience','positioning','original_abstract',
]);

function normalizeProfile(value: unknown): ProfileSynthesis {
  const root = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const nested = root.profile && typeof root.profile === 'object' && !Array.isArray(root.profile)
    ? root.profile as Record<string, unknown>
    : null;
  const item = nested ?? root;
  return {
    source_language: clean(item.source_language, 20) || 'und',
    overview: clean(item.overview, 5_000),
    fields: (Array.isArray(item.fields) ? item.fields : []).flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const field = entry as unknown as Record<string, unknown>;
      const kind = clean(field.kind, 40) as DocumentProfileFieldKind;
      const text = clean(field.text, 3_000);
      const support = clean(field.support_quote, 1_200);
      if (!FIELD_KINDS.has(kind) || !text || !support) return [];
      return [{ kind, text, support_quote: support, page: page(field.page), confidence: number01(field.confidence), centrality: number01(field.centrality) }];
    }).slice(0, 80),
  };
}

function isAuditResponse(value: unknown): value is AuditResponse {
  // Gemini Flash Lite occasionally returns a structurally useful audit with a
  // numeric string, a single issue string or an omitted optional repair list.
  // Rejecting that whole object turns an ordinary "repair this profile" verdict
  // into a terminal schema error. The normalizer below remains conservative:
  // absent/unknown verdicts become failed, never passed.
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Normalize provider JSON without ever promoting an ambiguous audit to passed. */
export function normalizeDocumentProfileAuditResponse(value: unknown): AuditResponse {
  const root = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const nested = root.audit && typeof root.audit === 'object' && !Array.isArray(root.audit)
    ? root.audit as Record<string, unknown>
    : null;
  const item = nested ?? root;
  const rawPassed = item.passed;
  const passed = rawPassed === true || (typeof rawPassed === 'string' && rawPassed.trim().toLowerCase() === 'true');
  const rawIssues = Array.isArray(item.issues) ? item.issues : item.issues == null ? [] : [item.issues];
  const rawFixes = Array.isArray(item.field_fixes) ? item.field_fixes : [];
  return {
    passed,
    score: number01(item.score),
    issues: rawIssues.map((issue) => clean(issue, 1_000)).filter(Boolean).slice(0, 50),
    field_fixes: rawFixes.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const fix = entry as Record<string, unknown>;
      const index = Math.trunc(Number(fix.index));
      if (!Number.isFinite(index) || index < 0) return [];
      return [{ index, text: clean(fix.text, 3_000), support_quote: clean(fix.support_quote, 1_200) }];
    }).slice(0, 80),
    overview: clean(item.overview, 5_000),
  };
}

function auditFailureMessage(audit: DocumentProfileAudit): string {
  const details = [
    ...audit.issues,
    `veredicto=${audit.passed ? 'aprobado' : 'rechazado'}`,
    `puntuación=${audit.score.toFixed(2)}`,
    `apoyos=${audit.supportCoverage.toFixed(2)}`,
    `estructura=${audit.structureCoverage.toFixed(2)}`,
  ];
  return details.join(' · ');
}

interface SourceLocation {
  label: string | null;
  sourceRef: string | null;
  pageNumber: number | null;
}

function parseSourceLocationAt(text: string, offset: number, sourceMap: Record<string, string> = {}): SourceLocation {
  let found: RegExpExecArray | null = null;
  const pattern = /\[\[(?:src:(s\d+)(?:\s+p\.\s*(\d+))?|p\.\s*(\d+))\]\]/gi;
  for (const match of text.matchAll(pattern)) {
    if ((match.index ?? 0) > offset) break;
    found = match as RegExpExecArray;
  }
  if (!found) return { label: null, sourceRef: null, pageNumber: null };
  const marker = found[1] ?? null;
  const pageNumber = Number(found[2] ?? found[3]) || null;
  return {
    label: pageNumber == null ? null : `p. ${pageNumber}`,
    sourceRef: marker == null ? null : sourceMap[marker] ?? marker,
    pageNumber,
  };
}

function headingMatches(text: string, sourceMap: Record<string, string>): Array<{ index: number; end: number; level: number; title: string; location: SourceLocation }> {
  const result: Array<{ index: number; end: number; level: number; title: string; location: SourceLocation }> = [];
  const pattern = /^(#{1,6})[ \t]+([^\n]+)$/gm;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    result.push({ index, end: index + match[0].length, level: match[1].length, title: clean(match[2], 300), location: parseSourceLocationAt(text, index, sourceMap) });
  }
  return result;
}

function chunksWithOffsets(text: string, wordsPerChunk = 3_500): Array<{ start: number; end: number; body: string }> {
  const words = [...text.matchAll(/\S+/g)];
  if (!words.length) return [];
  const chunks: Array<{ start: number; end: number; body: string }> = [];
  for (let startWord = 0; startWord < words.length; startWord += wordsPerChunk) {
    const endWord = Math.min(words.length, startWord + wordsPerChunk);
    const start = words[startWord].index ?? 0;
    const last = words[endWord - 1];
    const end = (last.index ?? 0) + last[0].length;
    chunks.push({ start, end, body: text.slice(start, end) });
  }
  return chunks;
}

/** Pure, stable structural pass reused by tests and the scanner. */
export function deriveDocumentStructure(text: string, fallbackTitle: string, sourceMap: Record<string, string> = {}): DerivedDocumentSection[] {
  const headings = headingMatches(text, sourceMap);
  if (headings.length === 0) {
    return chunksWithOffsets(text).map((chunk, ordinal) => {
      const start = parseSourceLocationAt(text, chunk.start, sourceMap);
      const end = parseSourceLocationAt(text, chunk.end, sourceMap);
      return ({
      sectionId: `section-${sha256(`${fallbackTitle}|${ordinal}|${sha256(chunk.body)}`).slice(0, 24)}`,
      parentSectionId: null, level: 1, ordinal, title: ordinal === 0 ? fallbackTitle : `Sección ${ordinal + 1}`,
      role: null, summary: '', concepts: [], claims: [], pageStart: start.label,
      pageEnd: end.label, sourceRef: start.sourceRef ?? end.sourceRef,
      pageStartNumber: start.pageNumber, pageEndNumber: end.pageNumber,
      charStart: chunk.start, charEnd: chunk.end,
      contentHash: sha256(chunk.body), body: chunk.body,
      });
    });
  }
  const sections: DerivedDocumentSection[] = [];
  const parents: Array<{ level: number; id: string }> = [];
  if (headings[0].index > 0 && text.slice(0, headings[0].index).split(/\s+/).length >= MIN_SECTION_WORDS) {
    const body = text.slice(0, headings[0].index);
    sections.push({
      sectionId: `section-${sha256(`${fallbackTitle}|front|${sha256(body)}`).slice(0, 24)}`,
      parentSectionId: null, level: 1, ordinal: 0, title: fallbackTitle, role: null, summary: '',
      concepts: [], claims: [], pageStart: parseSourceLocationAt(text, 0, sourceMap).label,
      pageEnd: parseSourceLocationAt(text, headings[0].index, sourceMap).label,
      sourceRef: parseSourceLocationAt(text, headings[0].index, sourceMap).sourceRef,
      pageStartNumber: parseSourceLocationAt(text, 0, sourceMap).pageNumber,
      pageEndNumber: parseSourceLocationAt(text, headings[0].index, sourceMap).pageNumber,
      charStart: 0, charEnd: headings[0].index, contentHash: sha256(body), body,
    });
  }
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const end = headings[index + 1]?.index ?? text.length;
    const body = text.slice(heading.end, end).trim();
    if (!body) continue;
    while (parents.length && parents.at(-1)!.level >= heading.level) parents.pop();
    const endLocation = parseSourceLocationAt(text, end, sourceMap);
    const sectionId = `section-${sha256(`${heading.level}|${heading.title}|${heading.location.label ?? ''}|${index}|${sha256(body)}`).slice(0, 24)}`;
    sections.push({
      sectionId, parentSectionId: parents.at(-1)?.id ?? null, level: heading.level,
      ordinal: sections.length, title: heading.title, role: null, summary: '', concepts: [], claims: [],
      pageStart: heading.location.label, pageEnd: endLocation.label,
      sourceRef: heading.location.sourceRef ?? endLocation.sourceRef,
      pageStartNumber: heading.location.pageNumber, pageEndNumber: endLocation.pageNumber,
      charStart: heading.index, charEnd: end,
      contentHash: sha256(body), body,
    });
    parents.push({ level: heading.level, id: sectionId });
  }
  return sections;
}

function splitAnalysisParts(body: string): string[] {
  return chunksWithOffsets(body, ANALYSIS_WORDS).map((chunk) => chunk.body);
}

function providerShapeFailure(error: unknown): boolean {
  return (error instanceof AiError && !error.retriable && !error.config && /json|esquema/i.test(error.message))
    || error instanceof SyntaxError;
}

function literalSectionFallback(evidence: string, title: string): SectionAnalysis {
  const quote = clean(evidence, 900);
  const claims: RawClaim[] = quote ? [{
    text: quote,
    support_quote: quote,
    page: null,
    confidence: DIRECT_SUPPORT_CONFIDENCE_FLOOR,
  }] : [];
  return { title, summary: quote, role: '', concepts: [], claims };
}

async function auditSectionAnalysis(
  evidence: string,
  candidate: SectionAnalysis,
  fallbackTitle: string,
  options: RunDocumentProfileOptions,
): Promise<SectionAnalysis> {
  let current = { ...candidate, claims: candidate.claims.filter((claim) => quoteOffset(evidence, claim.support_quote) >= 0) };
  const literalClaims = new Map(current.claims.map((claim) => [claim.support_quote, claim]));
  let issues: string[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let response: SectionAuditResponse;
    try {
      response = normalizeSectionAuditResponse(await completeJson<SectionAuditResponse>({
        system: SECTION_AUDIT_SYSTEM,
        user: JSON.stringify({ fragment: evidence, analysis: current, prior_issues: issues }),
        temperature: 0, maxTokens: 5_000, signal: options.signal,
      }, isSectionAuditResponse, options.auditorModel), fallbackTitle);
    } catch (error) {
      if (!providerShapeFailure(error)) throw error;
      break;
    }
    issues = response.issues;
    if (response.passed) return normalizeDirectSupportConfidence(current);
    if (!response.analysis) break;
    current = {
      ...response.analysis,
      claims: response.analysis.claims.filter((claim) => quoteOffset(evidence, claim.support_quote) >= 0),
    };
    for (const claim of current.claims) literalClaims.set(claim.support_quote, claim);
  }
  // A provider verdict must never force us to publish a disputed paraphrase, but
  // it also should not make a readable document permanently unindexable. Fall
  // back to an extractive representation whose prose is itself literal evidence;
  // the independent document-level audit still decides whether the resulting
  // macro profile is complete enough to publish.
  const sourceClaims = literalClaims.size
    ? [...literalClaims.values()]
    : literalSectionFallback(evidence, fallbackTitle).claims;
  const claims = sourceClaims.slice(0, 12).map((claim) => ({
    ...claim,
    text: claim.support_quote,
    confidence: DIRECT_SUPPORT_CONFIDENCE_FLOOR,
  }));
  return {
    title: fallbackTitle,
    summary: claims.slice(0, 3).map((claim) => claim.support_quote).join(' '),
    role: '',
    concepts: [],
    claims,
  };
}

async function analyzeSection(section: DerivedDocumentSection, options: RunDocumentProfileOptions): Promise<SectionAnalysis> {
  const parts = splitAnalysisParts(section.body);
  const analyses: SectionAnalysis[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const key = `section:${section.sectionId}:part:${index}`;
    const hash = sha256(parts[index]);
    const cached = readDocumentCheckpoint<SectionAnalysis>(options.jobId, key, hash);
    let candidate = cached;
    if (!candidate) {
      try {
        candidate = normalizeSectionAnalysis(await completeJson<SectionAnalysis>({
          system: SECTION_SYSTEM,
          user: JSON.stringify({ section_title: section.title, page_start: section.pageStart, fragment: parts[index] }),
          temperature: 0, maxTokens: 4_000, signal: options.signal,
        }, isSectionAnalysis, options.generatorModel), section.title);
      } catch (error) {
        if (!providerShapeFailure(error)) throw error;
        candidate = literalSectionFallback(parts[index], section.title);
      }
    }
    const literal = { ...candidate, claims: candidate.claims.filter((claim) => quoteOffset(parts[index], claim.support_quote) >= 0) };
    const value = await auditSectionAnalysis(parts[index], literal, section.title, options);
    if (!cached) saveDocumentCheckpoint(options.jobId, key, hash, value);
    analyses.push(value);
  }
  if (analyses.length === 1) return analyses[0];
  const reduceHash = sha256(JSON.stringify(analyses));
  const cached = readDocumentCheckpoint<SectionAnalysis>(options.jobId, `section:${section.sectionId}:reduced`, reduceHash);
  if (cached) return cached;
  let candidate: SectionAnalysis;
  try {
    candidate = normalizeSectionAnalysis(await completeJson<SectionAnalysis>({
      system: SECTION_REDUCE_SYSTEM, user: JSON.stringify({ title: section.title, analyses }),
      temperature: 0, maxTokens: 5_000, signal: options.signal,
    }, isSectionAnalysis, options.generatorModel), section.title);
  } catch (error) {
    if (!providerShapeFailure(error)) throw error;
    candidate = literalSectionFallback(section.body, section.title);
  }
  const literal = { ...candidate, claims: candidate.claims.filter((claim) => quoteOffset(section.body, claim.support_quote) >= 0) };
  const reduced = await auditSectionAnalysis(section.body, literal, section.title, options);
  saveDocumentCheckpoint(options.jobId, `section:${section.sectionId}:reduced`, reduceHash, reduced);
  return reduced;
}

function collapsedLiteralText(value: string): { text: string; offsets: number[] } {
  let text = '';
  const offsets: number[] = [];
  let inWhitespace = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (/\s/u.test(character)) {
      if (!inWhitespace) {
        text += ' ';
        offsets.push(index);
        inWhitespace = true;
      }
      continue;
    }
    const normalized = character.normalize('NFKC').toLocaleLowerCase();
    text += normalized;
    for (let emitted = 0; emitted < normalized.length; emitted += 1) offsets.push(index);
    inWhitespace = false;
  }
  return { text, offsets };
}

function quoteOffset(text: string, quote: string): number {
  const direct = text.toLocaleLowerCase().indexOf(quote.toLocaleLowerCase());
  if (direct >= 0) return direct;
  const haystack = collapsedLiteralText(text);
  const needle = collapsedLiteralText(quote).text.trim();
  if (!needle) return -1;
  const normalizedOffset = haystack.text.indexOf(needle);
  return normalizedOffset >= 0 ? (haystack.offsets[normalizedOffset] ?? -1) : -1;
}

function passageForQuote(nodusId: string, quote: string, candidate: PreparedPassages | null): string | null {
  const terms = quote.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 4).slice(0, 8);
  if (!terms.length) return null;
  const rows = candidate
    ? candidate.rows.map((row, index) => ({ passage_id: `${nodusId}#${index}`, text: row.text }))
    : getDb().prepare('SELECT passage_id,text FROM passages WHERE nodus_id=?').all(nodusId) as { passage_id: string; text: string }[];
  let best: { id: string; score: number } | null = null;
  for (const row of rows) {
    const haystack = row.text.toLocaleLowerCase();
    const score = terms.filter((term) => haystack.includes(term)).length / terms.length;
    if (!best || score > best.score) best = { id: row.passage_id, score };
  }
  return best && best.score >= 0.45 ? best.id : null;
}

function supportForQuote(input: {
  nodusId: string; text: string; quote: string; targetKind: 'field' | 'section'; targetId: string;
  sections: DerivedDocumentSection[]; confidence: number;
  candidatePassages: PreparedPassages | null;
  sourceMap: Record<string, string>;
}): DocumentProfileSupport | null {
  const offset = quoteOffset(input.text, input.quote);
  if (offset < 0) return null;
  const section = input.sections.find((candidate) =>
    candidate.charStart != null && candidate.charEnd != null && offset >= candidate.charStart && offset <= candidate.charEnd
  ) ?? null;
  const location = parseSourceLocationAt(input.text, offset, input.sourceMap);
  return {
    supportId: randomUUID(), targetKind: input.targetKind, targetId: input.targetId,
    sectionId: section?.sectionId ?? null, passageId: passageForQuote(input.nodusId, input.quote, input.candidatePassages),
    // A provider-supplied page label is never sufficient provenance. The quote's
    // literal offset must resolve against an extracted marker or the page stays null.
    pageStart: location.label, pageEnd: location.label,
    sourceRef: location.sourceRef, pageStartNumber: location.pageNumber, pageEndNumber: location.pageNumber,
    quote: input.quote, supportKind: 'direct', confidence: input.confidence, validationStatus: 'valid',
  };
}

async function preparePassages(
  work: Work,
  text: string,
  options: RunDocumentProfileOptions,
  sourceMap: Record<string, string> = {},
): Promise<PreparedPassages | null> {
  options.signal?.throwIfAborted();
  const contentHash = sha1(text);
  const current = getDb().prepare(
    'SELECT COUNT(*) count, MIN(content_hash) hash FROM passages WHERE nodus_id=?'
  ).get(work.nodus_id) as { count: number; hash: string | null };
  if (current.count > 0 && current.hash === contentHash) return null;
  const chunks = planRetrievalChunks(text, { sourceMap });
  const embeddingConfig = currentEmbeddingConfig();
  const embeddings = await embedMany(chunks.map((chunk) => chunk.text), options.signal);
  options.signal?.throwIfAborted();
  return {
    contentHash,
    embeddingProvider: embeddingConfig.provider,
    embeddingModel: embeddingConfig.model,
    rows: chunks.map((chunk, index) => ({
    ...chunk, embedding: embeddings[index]?.length ? embeddings[index] : null,
    })),
  };
}

function synthesisPayload(
  work: Work,
  sections: DerivedDocumentSection[],
  analyses: Map<string, SectionAnalysis>,
  abstract: string | null
): Record<string, unknown> {
  return {
    metadata: {
      title: work.title, authors: (() => { try { return JSON.parse(work.authors_json || '[]'); } catch { return []; } })(),
      year: work.year, item_type: work.item_type, original_abstract: abstract,
    },
    sections: sections.map((section) => ({
      id: section.sectionId, title: section.title, level: section.level, role: section.role,
      summary: section.summary, concepts: section.concepts,
      claims: analyses.get(section.sectionId)?.claims ?? section.claims.map((text) => ({ text })),
      page_start: section.pageStart, page_end: section.pageEnd,
    })),
  };
}

function deterministicAudit(text: string, sections: DerivedDocumentSection[], profile: ProfileSynthesis): {
  supportCoverage: number; structureCoverage: number; supportedFields: RawProfileField[];
} {
  const supportedFields = profile.fields.filter((field) => quoteOffset(text, field.support_quote) >= 0);
  const covered = sections.reduce((total, section) => total + Math.max(0, (section.charEnd ?? 0) - (section.charStart ?? 0)), 0);
  return {
    supportCoverage: profile.fields.length ? supportedFields.length / profile.fields.length : 0,
    structureCoverage: text.length ? Math.min(1, covered / text.length) : 0,
    supportedFields,
  };
}

function retainLiterallySupportedFields(text: string, profile: ProfileSynthesis): ProfileSynthesis {
  return {
    ...profile,
    fields: profile.fields
      .filter((field) => quoteOffset(text, field.support_quote) >= 0)
      .map((field) => ({
        ...field,
        confidence: Math.max(DIRECT_SUPPORT_CONFIDENCE_FLOOR, field.confidence),
      })),
  };
}

function evenlySample<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  return Array.from({ length: limit }, (_, index) => values[Math.floor((index * values.length) / limit)]);
}

/**
 * Last-resort profile for a readable work whose semantic synthesis remains
 * disputed after repair. It deliberately makes every field equal to literal
 * source text. This is less expressive than a thesis/method synthesis, but it
 * is safe for routing and prevents a large background campaign from acquiring
 * permanent holes because an auditor dislikes a paraphrase or a date boundary.
 */
function buildExtractiveProfileFallback(
  work: Work,
  sections: DerivedDocumentSection[],
  analyses: Map<string, SectionAnalysis>,
  sourceLanguage: string,
): ProfileSynthesis {
  const representatives: Array<{ quote: string; page: string | null }> = [];
  for (const section of sections) {
    const previous = analyses.get(section.sectionId);
    let claims = (previous?.claims ?? [])
      .filter((claim) => quoteOffset(section.body, claim.support_quote) >= 0)
      .map((claim) => ({
        ...claim,
        text: claim.support_quote,
        confidence: DIRECT_SUPPORT_CONFIDENCE_FLOOR,
      }));
    if (!claims.length) {
      const literal = clean(section.body, 900);
      if (literal) claims = [{
        text: literal,
        support_quote: literal,
        page: section.pageStart,
        confidence: DIRECT_SUPPORT_CONFIDENCE_FLOOR,
      }];
    }
    const safe = claims.slice(0, 3);
    const summary = safe.slice(0, 2).map((claim) => claim.support_quote).join(' ');
    analyses.set(section.sectionId, {
      title: section.title,
      summary,
      role: '',
      concepts: [],
      claims: safe,
    });
    section.role = null;
    section.summary = summary;
    section.concepts = [];
    section.claims = safe.map((claim) => claim.text);
    if (safe[0]) representatives.push({ quote: safe[0].support_quote, page: safe[0].page ?? section.pageStart });
  }
  const sampled = evenlySample(representatives, 12);
  if (!sampled.length) throw new Error('El documento no contiene ningún fragmento literal utilizable.');
  return {
    source_language: sourceLanguage || 'und',
    overview: clean(`${work.title}. ${sampled.slice(0, 4).map((item) => item.quote).join(' ')}`, 5_000),
    fields: sampled.map((item, index) => ({
      kind: 'argument',
      text: item.quote,
      confidence: DIRECT_SUPPORT_CONFIDENCE_FLOOR,
      centrality: index === 0 ? 0.7 : 0.6,
      support_quote: item.quote,
      page: item.page,
    })),
  };
}

function alignIdeas(nodusId: string, vectors: Array<{ sourceId: string; kind: string; embedding: number[] | null }>): DocumentIdeaLink[] {
  const ideas = getDb().prepare(
    `SELECT i.global_id,i.embedding FROM ideas i JOIN idea_occurrences io ON io.global_id=i.global_id
      WHERE io.nodus_id=? AND i.embedding IS NOT NULL`
  ).all(nodusId) as { global_id: string; embedding: Buffer }[];
  const links: DocumentIdeaLink[] = [];
  for (const idea of ideas) {
    const ideaVector = decodeEmbedding(idea.embedding);
    let best: { target: typeof vectors[number]; score: number } | null = null;
    for (const vector of vectors) {
      if (!vector.embedding?.length) continue;
      const score = cosineSimilarity(ideaVector, vector.embedding);
      if (!best || score > best.score) best = { target: vector, score };
    }
    if (best && best.score >= 0.34) links.push({
      globalId: idea.global_id,
      targetKind: best.target.kind === 'section' ? 'section' : 'field',
      targetId: best.target.sourceId,
      role: best.score >= 0.62 ? 'principal' : best.score >= 0.48 ? 'supporting' : 'development',
      score: best.score,
    });
  }
  return links;
}

function emit(options: RunDocumentProfileOptions, phase: DocumentProfileScanProgress['phase'], progress: number, message: string): void {
  options.onProgress?.({ phase, progress, message });
  const state = phase === 'analyzing_sections' ? 'analyzing'
    : phase === 'synthesizing' ? 'synthesizing'
    : phase === 'auditing' || phase === 'repairing' ? 'auditing'
    : phase === 'embedding' ? 'embedding'
    : phase === 'aligning' ? 'aligning'
    : phase === 'structuring' ? 'structuring'
    : phase === 'waiting_source' ? 'waiting_source' : null;
  if (!advanceRunningDocumentIndexJob(options.jobId, phase, progress, state)) {
    throw new Error('DOCUMENT_INDEX_CANCELLED');
  }
}

/** Full-text, hierarchical, audited document scan. */
export async function runDocumentProfileScan(work: Work, options: RunDocumentProfileOptions): Promise<string> {
  options.signal?.throwIfAborted();
  const settings = getSettings();
  const userId = settings.zoteroUserId || LOCAL_USER_ID;
  emit(options, 'waiting_source', 0.01, 'Resolviendo el texto completo…');
  const item = await getItem(userId, work.zotero_key).catch(() => null);
  const document = await resolveWorkText(
    userId, work.zotero_key, settings.zoteroStoragePath, item?.abstract ?? null, work.doi,
    {
      unpaywallEmail: settings.unpaywallEmail,
      preferZoteroFulltext: settings.preferZoteroFulltext,
      ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages },
      signal: options.signal,
    },
    work.item_type
  );
  setResolvedTextState(work.nodus_id, resolvedTextStateFromDoc(document));
  options.signal?.throwIfAborted();
  if (!document.text.trim() || document.sourceType === 'none' || document.sourceType === 'abstract_only') {
    setDocumentProfileState(work.nodus_id, 'unavailable', { error: document.notes ?? 'No hay texto completo legible.' });
    throw new Error(document.notes ?? 'No hay texto completo legible.');
  }
  const sourceFingerprint = sha256(document.text);
  const sourceMap = Object.fromEntries((document.segments ?? []).map((segment) => [segment.marker, segment.sourceRef]));
  // `deep_hash` identifies the text representation consumed by the last idea scan;
  // it is not a revision lock for this independent document profile. In particular,
  // historical deep hashes predate the durable [[src:sN]] markers now added by the
  // resolver, so comparing the two made every stable legacy PDF look as if it were
  // changing forever. The publication-boundary re-resolution below is the real
  // source-change guard: it compares this exact resolved text before publishing.
  updateDocumentIndexJob(options.jobId, { sourceFingerprint });
  emit(options, 'structuring', 0.04, 'Reconstruyendo la estructura…');
  const sections = deriveDocumentStructure(document.text, work.title, sourceMap);
  if (!sections.length) throw new Error('El documento no contiene texto estructurable.');

  emit(options, 'embedding', 0.05, 'Indexando los pasajes del texto completo…');
  const preparedPassages = await preparePassages(
    work,
    document.text,
    options,
    sourceMap,
  );
  const sectionAnalyses = new Map<string, SectionAnalysis>();
  for (let index = 0; index < sections.length; index += 1) {
    emit(options, 'analyzing_sections', 0.08 + (index / sections.length) * 0.54, `Analizando sección ${index + 1} de ${sections.length}…`);
    const analysis = await analyzeSection(sections[index], options);
    sectionAnalyses.set(sections[index].sectionId, analysis);
    sections[index] = {
      ...sections[index], title: sections[index].title.startsWith('Sección ') ? analysis.title : sections[index].title,
      role: analysis.role || null, summary: analysis.summary, concepts: analysis.concepts,
      claims: analysis.claims.map((claim) => claim.text),
    };
  }

  const synthesisInput = synthesisPayload(work, sections, sectionAnalyses, item?.abstract ?? null);
  const synthesisHash = sha256(JSON.stringify(synthesisInput));
  emit(options, 'synthesizing', 0.64, 'Sintetizando la obra completa…');
  let profile = readDocumentCheckpoint<ProfileSynthesis>(options.jobId, 'profile:synthesis', synthesisHash);
  let extractiveFallback = false;
  let repaired = false;
  if (!profile) {
    try {
      profile = normalizeProfile(await completeJson<ProfileSynthesis>({
        system: PROFILE_SYSTEM, user: JSON.stringify(synthesisInput), temperature: 0, maxTokens: 8_000, signal: options.signal,
      }, isProfileSynthesis, options.generatorModel));
    } catch (error) {
      if (!providerShapeFailure(error)) throw error;
      profile = buildExtractiveProfileFallback(work, sections, sectionAnalyses, 'und');
      extractiveFallback = true;
      repaired = true;
    }
    saveDocumentCheckpoint(options.jobId, 'profile:synthesis', synthesisHash, profile);
  }
  if (!profile.overview || !profile.fields.length) {
    profile = buildExtractiveProfileFallback(work, sections, sectionAnalyses, profile.source_language);
    extractiveFallback = true;
    repaired = true;
  }
  const initialFieldCount = profile.fields.length;
  profile = retainLiterallySupportedFields(document.text, profile);
  if (!profile.fields.length) {
    profile = buildExtractiveProfileFallback(work, sections, sectionAnalyses, profile.source_language);
    extractiveFallback = true;
    repaired = true;
  }
  repaired = repaired || profile.fields.length !== initialFieldCount;

  let auditor: AuditResponse | null = null;
  let deterministic = deterministicAudit(document.text, sections, profile);
  for (let attempt = 0; !extractiveFallback && attempt < 3; attempt += 1) {
    emit(options, attempt === 0 ? 'auditing' : 'repairing', 0.7 + attempt * 0.05,
      attempt === 0 ? 'Auditando la ficha contra el texto…' : `Reparando la ficha (${attempt}/2)…`);
    try {
      auditor = normalizeDocumentProfileAuditResponse(await completeJson<AuditResponse>({
        system: AUDIT_SYSTEM,
        user: JSON.stringify({ profile, sections: synthesisInput.sections, deterministic: {
          support_coverage: deterministic.supportCoverage, structure_coverage: deterministic.structureCoverage,
        } }),
        temperature: 0, maxTokens: 5_000, signal: options.signal,
      }, isAuditResponse, options.auditorModel));
    } catch (error) {
      if (!providerShapeFailure(error)) throw error;
      break;
    }
    if (auditor.passed && auditor.field_fixes?.length) {
      for (const fix of auditor.field_fixes) {
        const target = profile.fields[Math.trunc(Number(fix.index))];
        if (!target) continue;
        const fixedText = clean(fix.text, 3_000);
        const fixedQuote = clean(fix.support_quote, 1_200);
        if (fixedQuote && quoteOffset(document.text, fixedQuote) < 0) continue;
        if (fixedText) target.text = fixedText;
        // A semantic auditor may suggest a polished/paraphrased quote even when
        // its verdict is positive. Never let such a suggestion cross the
        // deterministic literal-support boundary.
        if (fixedQuote) target.support_quote = fixedQuote;
      }
      if (clean(auditor.overview, 5_000)) profile.overview = clean(auditor.overview, 5_000);
      profile = retainLiterallySupportedFields(document.text, profile);
      repaired = true;
      deterministic = deterministicAudit(document.text, sections, profile);
    }
    if (auditor.passed && auditor.score >= 0.8 && deterministic.supportCoverage >= 0.95 && deterministic.structureCoverage >= 0.95) break;
    if (attempt >= 2) break;
    try {
      profile = normalizeProfile(await completeJson<ProfileSynthesis>({
        system: REPAIR_SYSTEM,
        user: JSON.stringify({ profile, audit: auditor, sections: synthesisInput.sections }),
        temperature: 0, maxTokens: 8_000, signal: options.signal,
      }, isProfileSynthesis, options.generatorModel));
    } catch (error) {
      if (!providerShapeFailure(error)) throw error;
      break;
    }
    const repairedFieldCount = profile.fields.length;
    profile = retainLiterallySupportedFields(document.text, profile);
    repaired = true;
    if (!profile.fields.length) break;
    if (profile.fields.length !== repairedFieldCount) repaired = true;
    deterministic = deterministicAudit(document.text, sections, profile);
  }
  let passed = Boolean(auditor?.passed && (auditor?.score ?? 0) >= 0.8 && deterministic.supportCoverage >= 0.95 && deterministic.structureCoverage >= 0.95);
  if (!passed) {
    const semanticIssues = strings(auditor?.issues, 20);
    profile = buildExtractiveProfileFallback(work, sections, sectionAnalyses, profile.source_language);
    deterministic = deterministicAudit(document.text, sections, profile);
    extractiveFallback = true;
    repaired = true;
    auditor = {
      passed: true,
      score: DIRECT_SUPPORT_CONFIDENCE_FLOOR,
      issues: ['fallback_extractivo_determinista', ...semanticIssues],
      field_fixes: [],
      overview: profile.overview,
    };
    passed = deterministic.supportCoverage === 1 && deterministic.structureCoverage >= 0.95;
  }
  const audit: DocumentProfileAudit = {
    passed, score: number01(auditor?.score), supportCoverage: deterministic.supportCoverage,
    structureCoverage: deterministic.structureCoverage, issues: strings(auditor?.issues, 50),
    repaired: repaired || Boolean(auditor && (auditor.field_fixes?.length || auditor.overview)),
  };
  if (!passed) {
    const error = auditFailureMessage(audit);
    setDocumentProfileState(work.nodus_id, 'failed', { sourceFingerprint, pipelineVersion: DOCUMENT_PROFILE_PIPELINE_VERSION, error });
    throw new Error(error);
  }

  const fields = deterministic.supportedFields.map((field, index) => ({
    fieldId: `field-${sha256(`${sourceFingerprint}|${field.kind}|${index}|${field.text}`).slice(0, 24)}`,
    kind: field.kind, ordinal: deterministic.supportedFields.slice(0, index).filter((prior) => prior.kind === field.kind).length,
    text: field.text, confidence: field.confidence, centrality: CENTRAL_FIELD_KINDS.has(field.kind) ? Math.max(0.75, field.centrality) : field.centrality,
  }));
  const supports: DocumentProfileSupport[] = [];
  deterministic.supportedFields.forEach((field, index) => {
    const support = supportForQuote({
      nodusId: work.nodus_id, text: document.text, quote: field.support_quote, targetKind: 'field',
      targetId: fields[index].fieldId, sections, confidence: field.confidence,
      candidatePassages: preparedPassages, sourceMap,
    });
    if (support) supports.push(support);
  });
  for (const section of sections) {
    const analysis = sectionAnalyses.get(section.sectionId);
    const quote = analysis?.claims?.[0]?.support_quote;
    if (!quote) continue;
    const support = supportForQuote({
      nodusId: work.nodus_id, text: document.text, quote, targetKind: 'section', targetId: section.sectionId,
      sections, confidence: analysis.claims[0].confidence,
      candidatePassages: preparedPassages, sourceMap,
    });
    if (support) supports.push(support);
  }

  emit(options, 'embedding', 0.87, 'Creando los vectores documentales…');
  const vectorSources = [
    { kind: 'overview', sourceId: 'overview', text: profile.overview, weight: 1 },
    ...fields.map((field) => ({ kind: field.kind, sourceId: field.fieldId, text: field.text, weight: field.centrality || 0.5 })),
    ...sections.map((section) => ({ kind: 'section', sourceId: section.sectionId, text: `${section.title}\n${section.summary}`, weight: 0.75 })),
  ].filter((source) => source.text.trim());
  const vectorEmbeddingConfig = currentEmbeddingConfig();
  const embeddings = await embedMany(vectorSources.map((source) => source.text), options.signal);
  options.signal?.throwIfAborted();
  const vectors = vectorSources.map((source, index) => ({
    ...source,
    embedding: embeddings[index]?.length ? embeddings[index] : null,
    embeddingProvider: vectorEmbeddingConfig.provider,
    embeddingModel: vectorEmbeddingConfig.model,
  }));

  emit(options, 'aligning', 0.94, 'Alineando la estructura con las ideas…');
  const ideaLinks: DocumentIdeaLink[] = alignIdeas(work.nodus_id, vectors);
  emit(options, 'publishing', 0.98, 'Publicando la versión auditada…');
  options.signal?.throwIfAborted();
  // Re-resolve the source at the publication boundary. Database revision guards
  // catch normal Zotero/sync changes; this additionally catches a file replaced
  // externally while a long analysis is running, even before deep_hash changes.
  const latestDocument = await resolveWorkText(
    userId, work.zotero_key, settings.zoteroStoragePath, item?.abstract ?? null, work.doi,
    {
      unpaywallEmail: settings.unpaywallEmail,
      preferZoteroFulltext: settings.preferZoteroFulltext,
      ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages },
      signal: options.signal,
    },
    work.item_type,
  );
  options.signal?.throwIfAborted();
  if (latestDocument.sourceType === 'none'
    || latestDocument.sourceType === 'abstract_only'
    || sha256(latestDocument.text) !== sourceFingerprint) {
    throw new Error('DOCUMENT_SOURCE_CHANGED');
  }
  const versionId = publishDocumentProfile({
    nodusId: work.nodus_id, sourceFingerprint, pipelineVersion: DOCUMENT_PROFILE_PIPELINE_VERSION,
    schemaVersion: DOCUMENT_PROFILE_SCHEMA_VERSION, sourceLanguage: profile.source_language,
    presentationLanguage: settings.promptLanguage, overview: profile.overview,
    profile: { ...profile, metadata: synthesisInput.metadata, fallbackMode: extractiveFallback ? 'extractive' : null }, fields,
    sections: sections.map(({ body: _body, ...section }) => section), supports, ideaLinks,
    vectors, generatorModel: options.generatorModel, auditorModel: options.auditorModel,
    promptHash: sha256(`${SECTION_SYSTEM}|${SECTION_REDUCE_SYSTEM}|${SECTION_AUDIT_SYSTEM}|${PROFILE_SYSTEM}|${AUDIT_SYSTEM}|${REPAIR_SYSTEM}`), audit,
    qualityScore: Math.min(audit.score, audit.supportCoverage, audit.structureCoverage),
    expectedWorkRevision: {
      zoteroKey: work.zotero_key,
      zoteroVersion: work.zotero_version,
      title: work.title,
      authorsJson: work.authors_json,
      year: work.year,
      itemType: work.item_type,
      doi: work.doi,
      deepHash: work.deep_hash,
    },
    passages: preparedPassages,
  });
  upsertLibraryAnalysisProvenance({
    workId: work.nodus_id,
    component: 'documentProfile',
    // Provenance follows the exact text this profile analysed, not the possibly
    // older representation used by the independent idea/deep scan.
    documentFingerprint: sourceFingerprint,
    libraryItemId: null,
    libraryRevisionFingerprint: null,
    pipelineVersion: DOCUMENT_PROFILE_PIPELINE_VERSION,
    modelFingerprint: analysisModelFingerprint('documentProfile', settings),
    outputFingerprint: analysisFingerprint({ versionId, sourceFingerprint, audit, overview: profile.overview }),
    sourceVaultId: null,
    sourceWorkId: null,
    updatedAt: new Date().toISOString(),
  });
  clearDocumentCheckpoints(options.jobId);
  return versionId;
}
