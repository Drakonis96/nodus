/**
 * Citation collection and the scheduling decision behind verifying them.
 *
 * Extracted from Markdown.tsx so the streaming behaviour is testable without a
 * DOM: the cost of getting this wrong is a main-process stall for the whole
 * duration of every cited AI answer, which is not something a render test would
 * catch.
 */
import type { CitationRef } from '@shared/types';

/**
 * How long the content must stay unchanged before citations are verified.
 * Long enough to swallow an entire token stream, short enough that a settled
 * answer flags its broken citations without a visible wait.
 */
export const VERIFY_DEBOUNCE_MS = 400;

const CITATION_RE = /nodus:\/\/(idea|work|gap|contradiction|passage)\/([^\s)"'<>]+)/g;

/** Every distinct `nodus://` citation in render order. */
export function collectCitations(content: string): CitationRef[] {
  const refs: CitationRef[] = [];
  const seen = new Set<string>();
  // Exec loops over a shared regex are stateful; use a local copy so concurrent
  // callers cannot interleave through `lastIndex`.
  const re = new RegExp(CITATION_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const kind = match[1] as CitationRef['kind'];
    const id = decodeURIComponent(match[2]);
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ kind, id });
  }
  return refs;
}

/**
 * Identity of a reference list. Two contents with the same key need the same
 * verification result, so the second one can reuse the first one's answer.
 */
export function citationKey(refs: CitationRef[]): string {
  return refs.map((ref) => `${ref.kind}:${ref.id}`).join('|');
}

export type VerifyPlan =
  | { action: 'clear' }
  | { action: 'skip' }
  | { action: 'verify'; refs: CitationRef[]; key: string };

/**
 * Decide what verifying this content should do, given what was last verified.
 *
 * `clear` — no citations present, drop any stale flags.
 * `skip`  — the same references were already verified; no IPC needed. This is
 *           what collapses a token stream into a single call, since the
 *           reference list stops changing long before the text does.
 * `verify` — new or changed references; schedule a call after the debounce.
 */
export function planCitationVerification(content: string, lastVerifiedKey: string): VerifyPlan {
  const refs = collectCitations(content);
  if (refs.length === 0) return { action: 'clear' };
  const key = citationKey(refs);
  if (key === lastVerifiedKey) return { action: 'skip' };
  return { action: 'verify', refs, key };
}
