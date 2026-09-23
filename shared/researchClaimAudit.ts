export type ResearchPremiseType = 'fact' | 'attribution' | 'absence' | 'relation' | 'inference';
export interface ResearchClaimPremise { text: string; type: ResearchPremiseType; entailed: boolean }
export interface ResearchClaimRecord {
  sentence: string;
  kind: 'fact' | 'attributed' | 'inference' | 'nonfactual';
  status: 'supported' | 'removed' | 'unverified';
  evidence: Array<{ id: string; quote: string }>;
  reason: string;
  /** Deterministic cause of a removal. The judge's prose reason is diagnostic
   * only and never decides acceptance. */
  failure?: ResearchClaimFailure;
  premises?: ResearchClaimPremise[];
}
export type ResearchClaimFailure = 'judge_rejected' | 'no_premises' | 'premise_not_entailed' | 'premise_without_literal_evidence'
  | 'inference_without_supported_premises' | 'unqualified_inference' | 'unsupported_parts' | 'inconsistent_verdict'
  | 'nonfactual_with_content' | 'restates_rejected_claim' | 'internal_contradiction';
export interface ResearchProseAudit { markdown: string; claims: ResearchClaimRecord[] }
export interface ResearchAuditSource { id: string; text: string; label: string; citation: string }
interface Premise { text: string; type: ResearchPremiseType; entailed: boolean; evidence: Array<{ id: string; quote: string }>; from: number[] }
interface Verdict {
  index: number; kind: ResearchClaimRecord['kind']; premises: Premise[]; unsupportedParts: string[];
  explicitInference: boolean; supported: boolean; reason: string;
}
export interface ResearchProseVerdicts { claims: Verdict[] }
export const RESEARCH_AUDIT_BATCH = 8;
const PREMISE_TYPES: ResearchPremiseType[] = ['fact', 'attribution', 'absence', 'relation', 'inference'];
const validEvidence = (evidence: unknown): evidence is { id: string; quote: string } => !!evidence && typeof evidence === 'object'
  && typeof (evidence as { id: unknown }).id === 'string' && (evidence as { id: string }).id.length <= 512
  && typeof (evidence as { quote: unknown }).quote === 'string' && (evidence as { quote: string }).quote.length >= 12 && (evidence as { quote: string }).quote.length <= 1500;
function validPremise(premise: unknown, position: number): premise is Premise {
  if (!premise || typeof premise !== 'object') return false;
  const item = premise as Premise;
  return typeof item.text === 'string' && item.text.length > 0 && item.text.length <= 500 && PREMISE_TYPES.includes(item.type)
    && typeof item.entailed === 'boolean' && Array.isArray(item.evidence) && item.evidence.length <= 6 && item.evidence.every(validEvidence)
    // Inferences may only rest on earlier premises: no cycles, no self-support.
    && Array.isArray(item.from) && item.from.length <= 10 && item.from.every(index => Number.isInteger(index) && index >= 0 && index < position);
}
export function validResearchProseVerdicts(input: unknown): input is ResearchProseVerdicts {
  if (!input || typeof input !== 'object' || !Array.isArray((input as ResearchProseVerdicts).claims)) return false;
  const claims = (input as ResearchProseVerdicts).claims;
  return claims.length <= RESEARCH_AUDIT_BATCH && new Set(claims.map(item => item?.index)).size === claims.length && claims.every(item => item
    && Number.isInteger(item.index) && item.index >= 0 && item.index < RESEARCH_AUDIT_BATCH && ['fact', 'attributed', 'inference', 'nonfactual'].includes(item.kind)
    && typeof item.supported === 'boolean' && typeof item.explicitInference === 'boolean' && typeof item.reason === 'string' && item.reason.length <= 600
    && Array.isArray(item.premises) && item.premises.length <= 12 && item.premises.every((premise, position) => validPremise(premise, position))
    && Array.isArray(item.unsupportedParts) && item.unsupportedParts.length <= 12 && item.unsupportedParts.every(part => typeof part === 'string' && part.length <= 500));
}
const CITATION = /\[[^\]]*\]\(nodus:\/\/[^)]+\)/gu;
const PARENTHESIZED_CITATIONS = new RegExp(`[ \\t]*\\(\\s*(?:${CITATION.source})(?:\\s*[,;]?\\s*(?:${CITATION.source}))*\\s*\\)`, 'gu');
/** Same-length masking protects author initials and URL punctuation. A sentence
 * boundary may sit after citations appended to the sentence's final punctuation,
 * so audited prose can be segmented again exactly like freshly written prose. */
export function researchProseSpans(markdown: string): Array<{ start: number; end: number; text: string }> {
  const spans: Array<{ start: number; end: number; text: string }> = [];
  const masked = markdown.replace(CITATION, match => '·'.repeat(match.length));
  const split = /\n+|(?<=[.!?。！？](?:[ \t]*·+)*)[ \t]+(?=[\p{Lu}¿¡“«])/gu;
  let start = 0;
  for (const match of [...masked.matchAll(split), { index: masked.length, 0: '' }]) {
    const end = match.index!;
    const text = markdown.slice(start, end);
    if (text.trim()) spans.push({ start, end, text });
    start = end + match[0].length;
  }
  return spans;
}
const normalize = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
/** Prose without citation links or the empty wrappers they leave. */
export function researchPlainSentence(text: string): string {
  return normalize(text.replace(PARENTHESIZED_CITATIONS, '').replace(CITATION, '').replace(/\(\s*\)/gu, '').replace(/^#{1,6}\s+/u, '').replace(/^\s*[-*+]\s+/u, ''));
}
const tokens = (text: string) => new Set(researchPlainSentence(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .match(/[\p{L}\p{N}]+/gu)?.filter(token => token.length >= 3 || /\p{N}/u.test(token)) ?? []);
export const researchSentenceKey = (text: string) => [...tokens(text)].join(' ');
/** Language-neutral backstop for the judge's own rejected-claim instruction: a
 * sentence that carries nearly every content token of a rejected sentence restates
 * it, whatever connective or citation was added. Short transitions are exempt
 * because they carry too little content to identify a proposition. */
export function restatesRejectedClaim(sentence: string, rejected: readonly string[]): boolean {
  const own = tokens(sentence);
  if (!own.size) return false;
  return rejected.some(item => {
    const other = tokens(item);
    if (other.size < 5) return false;
    let shared = 0;
    for (const token of other) if (own.has(token)) shared++;
    return shared / other.size >= 0.8 && shared / own.size >= 0.6;
  });
}
function tidy(markdown: string): string {
  return markdown.replace(/\(\s*\)/gu, '').replace(/(?<=\S)[ \t]{2,}(?=\S)/gu, ' ').replace(/[ \t]+$/gmu, '')
    .replace(/^[ \t]+(?=[^\s\-*+>|\d])/gmu, '').replace(/\n{3,}/g, '\n\n').trim();
}
/** Removes whole sentences (with the citations attached to them). */
export function dropResearchSentences(markdown: string, drop: (plain: string) => boolean): { markdown: string; dropped: string[] } {
  const dropped: string[] = [];
  let result = markdown;
  for (const span of researchProseSpans(markdown).reverse()) {
    const plain = researchPlainSentence(span.text);
    if (!plain || !drop(plain)) continue;
    dropped.push(plain);
    result = result.slice(0, span.start) + result.slice(span.end);
  }
  return { markdown: tidy(result), dropped: dropped.reverse() };
}
const HAS_CONTENT_MARKER = /\p{N}|nodus:\/\//u;
/** The acceptance decision is derived here from the judge's atomic premises. Its
 * `supported` boolean, its unsupported parts and its premises must all agree:
 * a verdict whose parts disagree is not a reliable approval and fails closed. */
export function decideResearchVerdict(span: string, verdict: Verdict, sources: ResearchAuditSource[]): {
  valid: boolean; failure?: ResearchClaimFailure; evidence: Array<{ id: string; quote: string }>;
} {
  const literal = (evidence: { id: string; quote: string }) => sources.some(source => source.id === evidence.id && normalize(source.text).includes(normalize(evidence.quote)));
  if (verdict.kind === 'nonfactual') {
    if (verdict.premises.length || verdict.unsupportedParts.length || HAS_CONTENT_MARKER.test(span)) return { valid: false, failure: 'nonfactual_with_content', evidence: [] };
    return verdict.supported ? { valid: true, evidence: [] } : { valid: false, failure: 'judge_rejected', evidence: [] };
  }
  if (!verdict.premises.length) return { valid: false, failure: 'no_premises', evidence: [] };
  const premiseValid: boolean[] = [];
  let failure: ResearchClaimFailure | undefined;
  for (const premise of verdict.premises) {
    let ok = premise.entailed;
    if (!ok) failure ??= 'premise_not_entailed';
    else if (premise.type === 'inference') {
      ok = premise.from.length > 0 && premise.from.every(index => premiseValid[index]);
      if (!ok) failure ??= 'inference_without_supported_premises';
    } else {
      // An absence, like any fact, needs a source that states it: silence is not a quote.
      ok = premise.evidence.length > 0 && premise.evidence.every(literal);
      if (!ok) failure ??= 'premise_without_literal_evidence';
    }
    premiseValid.push(ok);
  }
  const inferred = verdict.premises.some(premise => premise.type === 'inference');
  if (!failure && inferred && (verdict.kind !== 'inference' || !verdict.explicitInference)) failure = 'unqualified_inference';
  if (!failure && verdict.kind === 'inference' && !verdict.explicitInference) failure = 'unqualified_inference';
  if (!failure && verdict.unsupportedParts.some(part => part.trim())) failure = 'unsupported_parts';
  const derived = !failure;
  if (derived !== verdict.supported) failure = derived ? 'inconsistent_verdict' : failure;
  if (failure) return { valid: false, failure: !verdict.supported && failure === 'inconsistent_verdict' ? 'judge_rejected' : failure, evidence: [] };
  const seen = new Set<string>();
  const evidence = verdict.premises.flatMap(premise => premise.evidence).filter(item => {
    const key = `${item.id}\u0000${normalize(item.quote)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return { valid: true, evidence };
}
/** Existence of an evidence ID and literal supporting text are separate gates
 * from the semantic judgement. Neither gate alone constitutes quality acceptance. */
export function applyResearchProseVerdicts(markdown: string, sources: ResearchAuditSource[], verdicts: Array<Verdict | undefined>, rejected: readonly string[] = []): ResearchProseAudit {
  const spans = researchProseSpans(markdown);
  const claims: ResearchClaimRecord[] = [];
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index], verdict = verdicts[index];
    if (!verdict) {
      claims.push({ sentence: span.text, kind: 'fact', status: 'unverified', evidence: [], reason: 'verification_unavailable' });
      edits.push({ ...span, text: '' });
      continue;
    }
    let decision = decideResearchVerdict(span.text, verdict, sources);
    if (decision.valid && verdict.kind !== 'nonfactual' && restatesRejectedClaim(span.text, rejected)) decision = { valid: false, failure: 'restates_rejected_claim', evidence: [] };
    claims.push({ sentence: span.text, kind: verdict.kind, status: decision.valid ? 'supported' : 'removed', evidence: decision.evidence, reason: verdict.reason,
      ...(decision.failure ? { failure: decision.failure } : {}),
      premises: verdict.premises.map(premise => ({ text: premise.text, type: premise.type, entailed: premise.entailed })) });
    if (!decision.valid) { edits.push({ ...span, text: '' }); continue; }
    if (verdict.kind === 'nonfactual') continue;
    // A source-less factual sentence may be repaired only with verified literal
    // anchors to authorized evidence. Existing unsupported citation links go away.
    const sourceIds = new Set(decision.evidence.map(evidence => evidence.id));
    const cited = sources.filter(source => sourceIds.has(source.id));
    const text = span.text.replace(PARENTHESIZED_CITATIONS, '').replace(CITATION, '').trimEnd();
    // Headings keep their evidence in the ledger; links would make them body text.
    const links = /^\s*#{1,6}\s/u.test(span.text) ? '' : cited.map(source => `[${source.label.replace(/[[\]\\]/g, '')}](${source.citation})`).join(' ');
    edits.push({ ...span, text: links ? `${text} ${links}` : text });
  }
  let result = markdown;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return { markdown: tidy(result), claims };
}

export interface ResearchReportParts { sections: string[]; abstract: string; limitations: string[]; nextSteps: string[] }
export interface ResearchConflict { a: number; b: number; reason: string }
export function validResearchConflicts(input: unknown): input is { conflicts: ResearchConflict[] } {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { conflicts?: unknown }).conflicts)) return false;
  return (input as { conflicts: unknown[] }).conflicts.length <= 40 && (input as { conflicts: ResearchConflict[] }).conflicts.every(item => item
    && Number.isInteger(item.a) && Number.isInteger(item.b) && item.a >= 0 && item.b >= 0 && item.a !== item.b && typeof item.reason === 'string' && item.reason.length <= 600);
}
/**
 * Whole-report reconciliation after every part has been audited separately.
 * 1. A proposition rejected anywhere cannot survive elsewhere: the removal wins
 *    over a later or earlier favourable verdict on a restatement.
 * 2. Statements that cannot both hold (including asserting what another statement
 *    says cannot be established) are removed together, leaving a shorter coherent
 *    answer rather than choosing one side without evidence.
 */
export async function reconcileResearchReport(parts: ResearchReportParts, ledger: ResearchClaimRecord[],
  findConflicts?: (statements: string[]) => Promise<ResearchConflict[]>): Promise<{ parts: ResearchReportParts; removed: number; conflicts: number; consistencyChecked: boolean }> {
  const bearsContent = (claim: ResearchClaimRecord) => claim.kind !== 'nonfactual' || claim.failure === 'nonfactual_with_content';
  const rejected = ledger.filter(claim => claim.status !== 'supported' && bearsContent(claim)).map(claim => claim.sentence);
  const byKey = new Map<string, ResearchClaimRecord[]>();
  for (const claim of ledger) {
    const key = researchSentenceKey(claim.sentence);
    byKey.set(key, [...(byKey.get(key) ?? []), claim]);
  }
  const retire = (plain: string, failure: ResearchClaimFailure) => {
    for (const claim of byKey.get(researchSentenceKey(plain)) ?? []) if (claim.status === 'supported') { claim.status = 'removed'; claim.failure = failure; claim.evidence = []; }
  };
  let removed = 0;
  const map = (drop: (plain: string) => boolean, failure: ResearchClaimFailure) => {
    const apply = (text: string) => {
      const result = dropResearchSentences(text, drop);
      result.dropped.forEach(plain => { removed++; retire(plain, failure); });
      return result.markdown;
    };
    parts = { sections: parts.sections.map(apply), abstract: apply(parts.abstract),
      limitations: parts.limitations.map(apply).filter(Boolean), nextSteps: parts.nextSteps.map(apply).filter(Boolean) };
  };
  map(plain => {
    const own = byKey.get(researchSentenceKey(plain));
    // The same sentence judged both ways: the unfavourable verdict wins.
    if (own?.some(claim => claim.status !== 'supported' && bearsContent(claim))) return true;
    return restatesRejectedClaim(plain, rejected.filter(sentence => researchSentenceKey(sentence) !== researchSentenceKey(plain)));
  }, 'restates_rejected_claim');
  if (!findConflicts) return { parts, removed, conflicts: 0, consistencyChecked: false };
  const statements: string[] = [];
  const seen = new Set<string>();
  for (const text of [...parts.sections, parts.abstract, ...parts.limitations, ...parts.nextSteps]) {
    for (const span of researchProseSpans(text)) {
      const plain = researchPlainSentence(span.text), key = researchSentenceKey(plain);
      if (tokens(plain).size < 3 || seen.has(key)) continue;
      seen.add(key); statements.push(plain);
    }
  }
  if (statements.length < 2) return { parts, removed, conflicts: 0, consistencyChecked: true };
  let conflicts: ResearchConflict[];
  try { conflicts = (await findConflicts(statements.slice(0, 160))).filter(item => item.a < statements.length && item.b < statements.length); }
  catch { return { parts, removed, conflicts: 0, consistencyChecked: false }; }
  const conflicting = new Set(conflicts.flatMap(item => [researchSentenceKey(statements[item.a]), researchSentenceKey(statements[item.b])]));
  if (conflicting.size) map(plain => conflicting.has(researchSentenceKey(plain)), 'internal_contradiction');
  return { parts, removed, conflicts: conflicts.length, consistencyChecked: true };
}
