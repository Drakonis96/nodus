import { validateRetrievalSettings, type RetrievalSettings } from './researchCorpus';

/** A run-owned budget, passed to every probe and section, never reset per query.
 * UTF-8 bytes conservatively bound tokenizer output without guessing a language's
 * characters/token ratio. The presets are initial operating limits, not calibrated. */
export class ResearchRetrievalBudget {
  readonly settings: RetrievalSettings;
  usedEvidenceTokens = 0;
  rounds = 0;
  decisionTokens = 0;
  candidates = 0;
  partial = false;
  readonly visited = new Set<string>();
  /** Supervisor decisions are separate provider calls: they have their own allowance, of
   * the same size as the evidence one, instead of taking evidence the answer needs. */
  constructor(settings: RetrievalSettings, public evidenceTokenLimit = settings.evidenceTokens, public decisionTokenLimit = settings.evidenceTokens) {
    this.settings = validateRetrievalSettings(settings);
  }
  constrainToWindow(window: number, reservedTokens: number): void {
    const limit = Math.max(0, Math.floor(window - reservedTokens));
    if (limit < this.evidenceTokenLimit) { this.evidenceTokenLimit = limit; this.partial = true; }
  }
  reserveDecision(system: string, user: string, output: number): boolean {
    const bound = new TextEncoder().encode(system + user).length + output + 1024;
    if (this.decisionTokens + bound > this.decisionTokenLimit) { this.partial = true; return false; }
    this.decisionTokens += bound;
    return true;
  }
  nextRound(explicit = false): boolean {
    const allowed = explicit || this.settings.autoExpand ? this.settings.rounds : 1;
    if (this.rounds >= allowed || this.usedEvidenceTokens >= this.evidenceTokenLimit) { this.partial = true; return false; }
    this.rounds++;
    return true;
  }
  accept(id: string, text: string): boolean {
    if (this.visited.has(id)) return false;
    const tokens = new TextEncoder().encode(text).length;
    if (this.usedEvidenceTokens + tokens > this.evidenceTokenLimit) { this.partial = true; return false; }
    this.visited.add(id);
    this.usedEvidenceTokens += tokens;
    return true;
  }
}

/** Output tokens for one Research Chat answer. A turn with skills writes artefacts (an SVG,
 * a figure brief) on top of its prose and gets the larger allowance; a known window caps
 * either at 30% of what remains after a 5% margin, never below 320 tokens. */
export function researchAnswerTokens(window: number | null | undefined, withSkills: boolean): number {
  const allowance = withSkills ? 10_000 : 6000;
  if (window == null) return allowance;
  const margin = Math.max(96, Math.round(window * 0.05));
  return Math.min(allowance, Math.max(320, Math.floor((window - margin) * 0.3)));
}
