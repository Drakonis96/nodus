/**
 * "Extensión orientativa de cada sección" — how long each Deep Research section
 * should aim to be, in WORDS PER SECTION.
 *
 * This is one editorial steer shared by every Deep Research variant (Academic v1/v2
 * and its specialized approaches, Study, Teaching/Unit design, Genealogy, Database,
 * the MCP client kit and Server Web), so normalization, validation, the option list
 * and the continuation arithmetic are defined once here rather than re-derived per
 * surface — which is how `sectionLimit` ended up meaning a minimum in one pipeline
 * and a maximum in another.
 *
 * Three invariants the rest of the stack depends on:
 *   • it counts WORDS, never tokens and never words of the whole report;
 *   • it is guidance, not a quota: no writer may pad, repeat, invent or drop
 *     evidence to reach it, and every pipeline stops as soon as the supported
 *     material is exhausted;
 *   • an absent/unknown value is `'auto'`, so historical requests, persisted queue
 *     jobs and MCP callers that never heard of it keep today's behaviour exactly.
 */

/** `'auto'` leaves the length to the model/heuristic; a number is words per section. */
export type DeepResearchSectionLength = 'auto' | number;

/** The fixed choices offered by every composer, in words per section. */
export const DEEP_RESEARCH_SECTION_LENGTH_PRESETS = [2_500, 5_000, 10_000, 15_000, 20_000] as const;

/** Below this a "section" is a paragraph, and the guidance stops meaning anything. */
export const DEEP_RESEARCH_SECTION_LENGTH_MIN = 250;
/**
 * Above this no corpus section is editorially defensible and the continuation loop
 * would spend dozens of provider calls padding. Rejected in the UI and clamped
 * everywhere else, so a hostile MCP payload cannot buy an unbounded run.
 */
export const DEEP_RESEARCH_SECTION_LENGTH_MAX = 40_000;

/** Option identities for the composer dropdowns. `custom` reveals the number field. */
export type DeepResearchSectionLengthChoice = 'auto' | 'custom' | number;

export interface DeepResearchSectionLengthOption {
  value: DeepResearchSectionLengthChoice;
  /** Spanish source string; the renderer passes it through t(). */
  label: string;
}

/**
 * Rendered as `t(option.label)` by every composer, which is why the labels live in
 * shared code and are registered as an indirect i18n key source.
 */
export const DEEP_RESEARCH_SECTION_LENGTH_OPTIONS: readonly DeepResearchSectionLengthOption[] = [
  { value: 'auto', label: 'Auto (decide la IA)' },
  { value: 2_500, label: '2.500 palabras' },
  { value: 5_000, label: '5.000 palabras' },
  { value: 10_000, label: '10.000 palabras' },
  { value: 15_000, label: '15.000 palabras' },
  { value: 20_000, label: '20.000 palabras' },
  { value: 'custom', label: 'Personalizada' },
];

/**
 * Accept anything — a legacy job, an MCP payload, a persisted draft — and return a
 * value the pipelines can trust. Everything that is not a usable positive integer
 * becomes `'auto'`; a usable but out-of-range number is clamped rather than dropped,
 * so "I asked for 90.000 words" degrades to the maximum instead of silently to auto.
 */
export function normalizeDeepResearchSectionLength(value: unknown): DeepResearchSectionLength {
  if (value === 'auto' || value === null || value === undefined) return 'auto';
  const raw = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 'auto';
  const rounded = Math.round(raw);
  if (rounded < DEEP_RESEARCH_SECTION_LENGTH_MIN) return DEEP_RESEARCH_SECTION_LENGTH_MIN;
  return Math.min(rounded, DEEP_RESEARCH_SECTION_LENGTH_MAX);
}

/** Words per section, or `null` in auto mode (no guidance is sent to the model). */
export function deepResearchSectionLengthWords(value: unknown): number | null {
  const normalized = normalizeDeepResearchSectionLength(value);
  return normalized === 'auto' ? null : normalized;
}

/** Which dropdown entry a stored value corresponds to when a composer reopens. */
export function deepResearchSectionLengthChoice(value: unknown): DeepResearchSectionLengthChoice {
  const normalized = normalizeDeepResearchSectionLength(value);
  if (normalized === 'auto') return 'auto';
  return (DEEP_RESEARCH_SECTION_LENGTH_PRESETS as readonly number[]).includes(normalized) ? normalized : 'custom';
}

/** Why a typed custom length was refused. The UI maps these to localized copy. */
export type DeepResearchSectionLengthError = 'empty' | 'not-a-number' | 'not-an-integer' | 'too-small' | 'too-large';

export type DeepResearchSectionLengthValidation =
  | { ok: true; value: number }
  | { ok: false; error: DeepResearchSectionLengthError; message: string };

/** Spanish source messages, rendered through t() like the option labels. */
export const DEEP_RESEARCH_SECTION_LENGTH_MESSAGES: Record<DeepResearchSectionLengthError, string> = {
  empty: 'Escribe cuántas palabras debe tener cada sección.',
  'not-a-number': 'Introduce un número de palabras válido.',
  'not-an-integer': 'Usa un número entero de palabras, sin decimales.',
  'too-small': 'El mínimo son {min} palabras por sección.',
  'too-large': 'El máximo son {max} palabras por sección.',
};

/**
 * Validate what the user typed into the Custom field. Deliberately strict — empty,
 * negative, zero, decimal, non-numeric and out-of-range are each their own error so
 * the composer can explain the problem instead of silently snapping the value.
 */
export function validateDeepResearchSectionLength(raw: string | number): DeepResearchSectionLengthValidation {
  const text = typeof raw === 'number' ? String(raw) : raw.trim();
  if (!text) return { ok: false, error: 'empty', message: DEEP_RESEARCH_SECTION_LENGTH_MESSAGES.empty };
  if (!/^[+-]?\d+(?:[.,]\d+)?$/u.test(text)) {
    return { ok: false, error: 'not-a-number', message: DEEP_RESEARCH_SECTION_LENGTH_MESSAGES['not-a-number'] };
  }
  const parsed = Number(text.replace(',', '.'));
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: 'not-a-number', message: DEEP_RESEARCH_SECTION_LENGTH_MESSAGES['not-a-number'] };
  }
  if (!Number.isInteger(parsed)) {
    return { ok: false, error: 'not-an-integer', message: DEEP_RESEARCH_SECTION_LENGTH_MESSAGES['not-an-integer'] };
  }
  if (parsed < DEEP_RESEARCH_SECTION_LENGTH_MIN) {
    return { ok: false, error: 'too-small', message: DEEP_RESEARCH_SECTION_LENGTH_MESSAGES['too-small'] };
  }
  if (parsed > DEEP_RESEARCH_SECTION_LENGTH_MAX) {
    return { ok: false, error: 'too-large', message: DEEP_RESEARCH_SECTION_LENGTH_MESSAGES['too-large'] };
  }
  return { ok: true, value: parsed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Turning a word target into bounded provider calls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * No section writer may ask one response for more than this. Every provider — the
 * hosted ones and the local llama/Ollama runtimes, whose context window is far
 * smaller — answers a request this size reliably; raising `maxTokens` until a
 * 20.000-word section "fits" is exactly the failure this avoids.
 */
export const DEEP_RESEARCH_SECTION_PASS_MIN_WORDS = 900;
export const DEEP_RESEARCH_SECTION_PASS_MAX_WORDS = 2_000;
/** Hard ceiling on continuation calls per section, so one report cannot loop. */
export const DEEP_RESEARCH_SECTION_MAX_PASSES = 24;
/** A continuation shorter than this means the evidence is exhausted: stop. */
export const DEEP_RESEARCH_SECTION_MIN_CONTINUATION_WORDS = 60;

export interface DeepResearchSectionLengthPlan {
  /** Words per section the user asked for; `null` in auto mode. */
  targetWords: number | null;
  /** How many bounded generation calls this section may spend. 1 in auto mode. */
  maxPasses: number;
  /** What each of those calls should aim to produce. */
  wordsPerPass: number;
  /** Output budget for one pass, derived from `wordsPerPass`, never unbounded. */
  maxTokensPerPass: number;
  /**
   * Roughly how many distinct evidence-bearing paragraphs the target implies. The
   * academic pipeline plans evidence per paragraph, so this — not a token budget —
   * is how a longer section is actually produced there.
   */
  paragraphTarget: number;
}

/** Words → a safe output budget for one call. Deliberately capped. */
export function deepResearchSectionPassMaxTokens(words: number): number {
  // ~2,4 tokens per word covers the most token-hungry supported languages
  // (Turkish, German compounds) plus the nodus:// citation links.
  return Math.max(1_200, Math.min(6_000, Math.round(words * 2.4) + 400));
}

/** Average words of one evidence-bearing paragraph in a Nodus report. */
export const DEEP_RESEARCH_WORDS_PER_PARAGRAPH = 180;

/**
 * Split a word target into bounded passes. Auto mode returns a single pass with no
 * target, which is byte-for-byte today's behaviour for every caller.
 */
export function planDeepResearchSectionLength(value: unknown): DeepResearchSectionLengthPlan {
  const targetWords = deepResearchSectionLengthWords(value);
  if (targetWords === null) {
    return {
      targetWords: null,
      maxPasses: 1,
      wordsPerPass: DEEP_RESEARCH_SECTION_PASS_MAX_WORDS,
      maxTokensPerPass: deepResearchSectionPassMaxTokens(DEEP_RESEARCH_SECTION_PASS_MAX_WORDS),
      paragraphTarget: 0,
    };
  }
  const wordsPerPass = Math.max(
    DEEP_RESEARCH_SECTION_PASS_MIN_WORDS,
    Math.min(
      DEEP_RESEARCH_SECTION_PASS_MAX_WORDS,
      Math.ceil(targetWords / DEEP_RESEARCH_SECTION_MAX_PASSES),
    ),
  );
  return {
    targetWords,
    maxPasses: Math.max(1, Math.min(DEEP_RESEARCH_SECTION_MAX_PASSES, Math.ceil(targetWords / wordsPerPass))),
    wordsPerPass,
    maxTokensPerPass: deepResearchSectionPassMaxTokens(wordsPerPass),
    paragraphTarget: Math.max(1, Math.round(targetWords / DEEP_RESEARCH_WORDS_PER_PARAGRAPH)),
  };
}

/** Same word count the report meta uses, so guidance and accounting agree. */
export function countDeepResearchWords(text: string): number {
  return (text ?? '').split(/\s+/u).filter(Boolean).length;
}

/** Why a section stopped growing. Recorded so a short section is explainable. */
export type DeepResearchSectionLengthStop = 'auto' | 'target' | 'exhausted' | 'passes';

export interface DeepResearchSectionLengthOutcome {
  markdown: string;
  words: number;
  /** Generation calls actually spent, including the first one. */
  passes: number;
  stop: DeepResearchSectionLengthStop;
}

export interface DeepResearchSectionContinuationContext {
  /** Everything written for this section so far. */
  produced: string;
  wordsSoFar: number;
  /** How many words the target still misses; always ≥ 1 when a pass runs. */
  remainingWords: number;
  /** How many words THIS pass should aim for. */
  passWords: number;
  /** 2-based: pass 1 is the initial draft the caller already produced. */
  pass: number;
  maxPasses: number;
}

/**
 * Grow one section towards its word target with bounded continuation calls instead
 * of one oversized request.
 *
 * The loop is the safety mechanism, not the prompt: it stops the moment a
 * continuation adds nothing substantial, which is what keeps a long target from
 * turning into repetition or invented content. `signal` is checked before every
 * pass, so cancelling a report mid-continuation aborts on the next boundary rather
 * than after the whole section, and `onPass` lets the caller keep progress moving.
 */
export async function extendDeepResearchSection(options: {
  plan: DeepResearchSectionLengthPlan;
  initial: string;
  writeContinuation(context: DeepResearchSectionContinuationContext): Promise<string>;
  onPass?(context: DeepResearchSectionContinuationContext & { added: number }): void;
  signal?: AbortSignal;
  /** Injected so a pipeline with its own definition of a word stays consistent. */
  countWords?: (text: string) => number;
  join?: (produced: string, addition: string) => string;
}): Promise<DeepResearchSectionLengthOutcome> {
  const count = options.countWords ?? countDeepResearchWords;
  const join = options.join ?? ((produced, addition) => `${produced.trimEnd()}\n\n${addition.trim()}`);
  const { plan } = options;
  let markdown = options.initial;
  let words = count(markdown);
  if (plan.targetWords === null) return { markdown, words, passes: 1, stop: 'auto' };
  // 92% of the target is "reached": asking a writer to close the last handful of
  // words is precisely how padding sentences appear.
  const enough = Math.round(plan.targetWords * 0.92);
  let pass = 1;
  let stop: DeepResearchSectionLengthStop = 'target';
  while (words < enough && pass < plan.maxPasses) {
    options.signal?.throwIfAborted();
    pass += 1;
    const context: DeepResearchSectionContinuationContext = {
      produced: markdown,
      wordsSoFar: words,
      remainingWords: Math.max(1, plan.targetWords - words),
      passWords: Math.min(plan.wordsPerPass, Math.max(1, plan.targetWords - words)),
      pass,
      maxPasses: plan.maxPasses,
    };
    let addition = '';
    try {
      addition = (await options.writeContinuation(context)).trim();
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // A provider hiccup on a continuation must not lose the section already
      // written: keep the supported prose and stop growing it.
      stop = 'exhausted';
      break;
    }
    const added = addition ? count(addition) : 0;
    options.onPass?.({ ...context, added });
    if (added < DEEP_RESEARCH_SECTION_MIN_CONTINUATION_WORDS) {
      stop = 'exhausted';
      break;
    }
    markdown = join(markdown, addition);
    words = count(markdown);
  }
  if (words < enough && stop === 'target') stop = 'passes';
  return { markdown, words, passes: pass, stop };
}
