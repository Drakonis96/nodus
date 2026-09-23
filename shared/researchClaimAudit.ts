export interface ResearchClaimRecord {
  sentence: string;
  kind: 'fact' | 'attributed' | 'inference' | 'nonfactual';
  status: 'supported' | 'removed' | 'unverified';
  evidence: Array<{ id: string; quote: string }>;
  reason: string;
}
export interface ResearchProseAudit { markdown: string; claims: ResearchClaimRecord[] }
export interface ResearchAuditSource { id: string; text: string; label: string; citation: string }
interface Verdict { index: number; kind: ResearchClaimRecord['kind']; supported: boolean; explicitInference: boolean; evidence: Array<{ id: string; quote: string }>; reason: string }
export interface ResearchProseVerdicts { claims: Verdict[] }
export function validResearchProseVerdicts(input: unknown): input is ResearchProseVerdicts {
  if (!input || typeof input !== 'object' || !Array.isArray((input as ResearchProseVerdicts).claims)) return false;
  const claims = (input as ResearchProseVerdicts).claims;
  return claims.length <= 8 && new Set(claims.map(item => item?.index)).size === claims.length && claims.every(item => item
    && Number.isInteger(item.index) && item.index >= 0 && item.index < 8 && ['fact', 'attributed', 'inference', 'nonfactual'].includes(item.kind)
    && typeof item.supported === 'boolean' && typeof item.explicitInference === 'boolean' && typeof item.reason === 'string' && item.reason.length <= 500
    && Array.isArray(item.evidence) && item.evidence.length <= 8 && item.evidence.every(evidence => evidence && typeof evidence.id === 'string'
      && evidence.id.length <= 512 && typeof evidence.quote === 'string' && evidence.quote.length >= 12 && evidence.quote.length <= 1500));
}
const CITATION = /\[[^\]]*\]\(nodus:\/\/[^)]+\)/gu;
/** Same-length masking protects author initials and URL punctuation. */
export function researchProseSpans(markdown: string): Array<{ start: number; end: number; text: string }> {
  const spans: Array<{ start: number; end: number; text: string }> = [];
  const masked = markdown.replace(CITATION, match => '·'.repeat(match.length));
  const split = /\n+|(?<=[.!?。！？])\s+(?=[\p{Lu}¿¡“«])/gu;
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
/** Existence of an evidence ID and literal supporting text are separate gates
 * from the semantic judgement. Neither gate alone constitutes quality acceptance. */
export function applyResearchProseVerdicts(markdown: string, sources: ResearchAuditSource[], verdicts: Array<Verdict | undefined>): ResearchProseAudit {
  const spans = researchProseSpans(markdown);
  const claims: ResearchClaimRecord[] = [];
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index], verdict = verdicts[index];
    const quotes = verdict?.evidence.filter(evidence => sources.some(source => source.id === evidence.id && normalize(source.text).includes(normalize(evidence.quote)))) ?? [];
    const valid = !!verdict && verdict.supported && (verdict.kind === 'nonfactual' ? verdict.evidence.length === 0
      : verdict.supported && quotes.length > 0 && quotes.length === verdict.evidence.length && (verdict.kind !== 'inference' || verdict.explicitInference));
    const status = !verdict ? 'unverified' : valid ? 'supported' : 'removed';
    claims.push({ sentence: span.text, kind: verdict?.kind ?? 'fact', status, evidence: valid ? quotes : [], reason: verdict?.reason ?? 'verification_unavailable' });
    if (!valid) { edits.push({ ...span, text: '' }); continue; }
    if (verdict.kind === 'nonfactual') continue;
    // A source-less factual sentence may be repaired only with verified literal
    // anchors to authorized evidence. Existing unsupported citation links go away.
    const sourceIds = new Set(quotes.map(evidence => evidence.id));
    const cited = sources.filter(source => sourceIds.has(source.id));
    const text = span.text.replace(CITATION, '').trimEnd();
    const links = cited.map(source => `[${source.label.replace(/[[\]\\]/g, '')}](${source.citation})`).join(' ');
    edits.push({ ...span, text: `${text} ${links}` });
  }
  let result = markdown;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return { markdown: result.replace(/\n{3,}/g, '\n\n').trim(), claims };
}
