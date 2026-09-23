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
  constructor(settings: RetrievalSettings, public evidenceTokenLimit = settings.evidenceTokens) {
    this.settings = validateRetrievalSettings(settings);
  }
  constrainToWindow(window: number, reservedTokens: number): void {
    const limit = Math.max(0, Math.floor(window - reservedTokens));
    if (limit < this.evidenceTokenLimit) { this.evidenceTokenLimit = limit; this.partial = true; }
  }
  reserveDecision(system: string, user: string, output: number): boolean {
    const bound = new TextEncoder().encode(system + user).length + output + 1024;
    if (this.usedEvidenceTokens + bound > this.evidenceTokenLimit) { this.partial = true; return false; }
    this.decisionTokens += bound;
    this.evidenceTokenLimit -= bound;
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
