export interface StudySynonymRequest {
  documentId: string;
  subjectId?: string | null;
  sentence: string;
  selectedText: string;
  selectionFrom: number;
  selectionTo: number;
  previousAlternatives?: string[];
  model?: { provider: string; model: string } | null;
}

export interface StudySynonymAlternative {
  /** Exact source fragment inside `sentence`. It always contains the selection. */
  target: string;
  replacement: string;
  /** Replacement range relative to `sentence`. */
  from: number;
  to: number;
}

export interface StudySynonymResult {
  alternatives: StudySynonymAlternative[];
  modelProvider: string;
  modelName: string;
}

export interface StudySentenceContext {
  sentence: string;
  sentenceFrom: number;
  sentenceTo: number;
  selectionFrom: number;
  selectionTo: number;
}

const SENTENCE_END = /[.!?…。！？]/u;

/**
 * Extract the complete sentence around a Markdown-source selection. Newlines are
 * treated as hard sentence boundaries; ordinary whitespace after terminal
 * punctuation belongs to neither neighbouring sentence.
 */
export function studySentenceContext(source: string, from: number, to: number): StudySentenceContext {
  const safeFrom = Math.max(0, Math.min(source.length, Math.trunc(from)));
  const safeTo = Math.max(safeFrom, Math.min(source.length, Math.trunc(to)));
  let sentenceFrom = 0;
  for (let index = safeFrom - 1; index >= 0; index -= 1) {
    const value = source[index];
    if (value === '\n' || (SENTENCE_END.test(value) && /\s/u.test(source[index + 1] ?? ''))) {
      sentenceFrom = index + 1;
      break;
    }
  }
  while (sentenceFrom < safeFrom && /\s/u.test(source[sentenceFrom] ?? '')) sentenceFrom += 1;

  let sentenceTo = source.length;
  for (let index = safeTo; index < source.length; index += 1) {
    const value = source[index];
    if (value === '\n') { sentenceTo = index; break; }
    if (SENTENCE_END.test(value)) { sentenceTo = index + 1; break; }
  }
  while (sentenceTo > safeTo && /\s/u.test(source[sentenceTo - 1] ?? '')) sentenceTo -= 1;

  return {
    sentence: source.slice(sentenceFrom, sentenceTo),
    sentenceFrom,
    sentenceTo,
    selectionFrom: safeFrom - sentenceFrom,
    selectionTo: safeTo - sentenceFrom,
  };
}

/** Resolve an AI-supplied exact target to the occurrence that contains the selection. */
export function resolveStudySynonymTarget(
  sentence: string,
  target: string,
  selectionFrom: number,
  selectionTo: number,
): { from: number; to: number } | null {
  if (!target || target.length > sentence.length) return null;
  let from = sentence.indexOf(target);
  while (from >= 0) {
    const to = from + target.length;
    if (from <= selectionFrom && to >= selectionTo) return { from, to };
    from = sentence.indexOf(target, from + 1);
  }
  return null;
}
