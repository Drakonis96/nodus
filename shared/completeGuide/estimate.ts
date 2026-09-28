/**
 * Pre-flight estimate for a complete study guide: how many calls, tokens, dollars
 * and minutes reading the selection in full is likely to take. It is shown before
 * the job is queued so a student can narrow a selection that is too large. The
 * figures are ranges built from the frozen snapshot, never promises.
 */
import type { ModelRef } from '../types';
import type { ResearchEffort } from '../researchReasoning';
import type { CompleteGuideSnapshot } from './snapshot';
import { COMPLETE_GUIDE_CHARS_PER_TOKEN } from './snapshot';
import type { CompleteGuideVerification } from './types';

export type CompleteGuideStage = 'recon' | 'extract' | 'plan' | 'write' | 'verify' | 'finalize' | 'web' | 'embed';

export interface CompleteGuideStageEstimate {
  stage: CompleteGuideStage;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface CompleteGuideEstimate {
  stages: CompleteGuideStageEstimate[];
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Null when the model's price is unknown: only tokens are shown. */
  usd: { min: number; max: number } | null;
  minutes: { min: number; max: number };
  /** Share of the reading passes expected to come from the cache (0–1). */
  cachedShare: number;
  expected: { items: number; sections: number; units: number };
  warnings: CompleteGuideEstimateWarning[];
}

export type CompleteGuideEstimateWarning =
  | { code: 'several_subjects'; count: number }
  | { code: 'large_selection'; pages: number; tokens: number }
  | { code: 'unavailable_sources'; count: number }
  | { code: 'pages_without_text'; sources: number }
  | { code: 'unknown_price' };

/** USD per million tokens. Only list prices we can source; unknown models get tokens only. */
export interface CompleteGuidePrice { input: number; output: number }
export const COMPLETE_GUIDE_KNOWN_PRICES: Array<{ match: RegExp; price: CompleteGuidePrice }> = [
  // DeepSeek list price used by the research cost ledger (scripts/research-provider-proxy.mjs).
  { match: /(^|\/)deepseek-(v4-)?flash$/i, price: { input: 0.3, output: 1.2 } },
];
export const COMPLETE_GUIDE_EMBEDDING_PRICE_PER_M = 0.01; // OpenRouter baai/bge-m3

export function completeGuidePrice(model: ModelRef | null | undefined): CompleteGuidePrice | null {
  if (!model?.model) return null;
  return COMPLETE_GUIDE_KNOWN_PRICES.find((entry) => entry.match.test(model.model))?.price ?? null;
}

export const COMPLETE_GUIDE_LARGE_PAGES = 400;
const LARGE_TOKENS = 350_000;
/** Context-sized reading units; small enough for a 32k window with room for output. */
const RECON_WINDOW_TOKENS = 20_000;
const EXTRACT_WINDOW_TOKENS = 8_000;
/**
 * Measured against the live campaign (`scripts/verify-complete-guide-live.mjs`, DeepSeek
 * Flash, 2026-09-28; the run's own numbers are in
 * `docs/verification/complete-guide-live-metrics.json`): a selection of thirteen dense
 * passages yielded 29 items and 160 written blocks, the planner made a section per ~2
 * items, and 18 of those blocks were audited — one in nine — at ~4 calls and ~36,000
 * output tokens each.
 *
 * The premise audit is 76 % of what a guide costs (it re-reads every audited block and
 * answers with one atomic-premise verdict per sentence), so it is modelled on its own
 * rather than as a footnote of the writing. The constants that preceded these — 120 tokens
 * per item, 8 sentences per audit call, 1,800 output tokens per call — under-promised that
 * same run five times over ($0.23 estimated against $1.08 spent).
 */
const TOKENS_PER_ITEM = 22;
const ITEMS_PER_SECTION = 2;
const BLOCKS_PER_ITEM = 5.5;
const AUDITED_BLOCK_SHARE = 0.12;
const AUDIT_CALLS_PER_BLOCK = 4;
const AUDIT_INPUT_PER_CALL = 8_000;
const AUDIT_OUTPUT_PER_CALL = 9_000;

function effortMultiplier(effort: ResearchEffort | null | undefined): number {
  if (!effort || effort === 'standard' || effort === 'none' || effort === 'off' || effort === 'minimal' || effort === 'low') return 1;
  if (effort === 'medium' || effort === 'on') return 1.3;
  if (effort === 'high') return 1.6;
  return 2.5; // xhigh, max, ultra
}

export interface CompleteGuideEstimateInput {
  snapshot: Pick<CompleteGuideSnapshot, 'sources' | 'passages' | 'totals' | 'issues'>;
  model?: ModelRef | null;
  effort?: ResearchEffort | null;
  verification?: CompleteGuideVerification;
  webText?: boolean;
  /** Characters of readable passages whose reading passes are already cached. */
  cachedChars?: number;
  unavailableSources?: number;
  subjectCount?: number;
  /** Distinct units (topics) in the selection; at least one chapter is always written. */
  unitCount?: number;
}

export function estimateCompleteGuide(input: CompleteGuideEstimateInput): CompleteGuideEstimate {
  const { snapshot } = input;
  const totalTokens = snapshot.totals.estimatedTokens;
  const cachedShare = snapshot.totals.chars > 0 ? Math.min(1, Math.max(0, (input.cachedChars ?? 0) / snapshot.totals.chars)) : 0;
  const uncached = totalTokens * (1 - cachedShare);
  const readableChars = new Map<string, number>();
  for (const passage of snapshot.passages) {
    if (passage.duplicateOf) continue;
    readableChars.set(passage.sourceKey, (readableChars.get(passage.sourceKey) ?? 0) + passage.chars);
  }
  const sourceTokens = [...readableChars.values()].map((chars) => chars / COMPLETE_GUIDE_CHARS_PER_TOKEN);
  const reconCalls = Math.ceil(sourceTokens.reduce((sum, tokens) => sum + Math.max(1, Math.ceil(tokens / RECON_WINDOW_TOKENS)), 0) * (1 - cachedShare));
  const extractCalls = Math.ceil(sourceTokens.reduce((sum, tokens) => sum + Math.max(1, Math.ceil(tokens / EXTRACT_WINDOW_TOKENS)), 0) * (1 - cachedShare));
  const items = Math.max(1, Math.round(totalTokens / TOKENS_PER_ITEM));
  const units = Math.max(1, input.unitCount ?? 1);
  const sections = Math.max(units, Math.ceil(items / ITEMS_PER_SECTION));
  const multiplier = effortMultiplier(input.effort);
  const writeCalls = Math.ceil(sections * 2);
  const writeOutput = Math.round(sections * 5_000 * multiplier);
  const sentences = writeOutput / 25;
  const auditedBlocks = Math.ceil(Math.max(1, Math.round(items * BLOCKS_PER_ITEM)) * (input.verification === 'exhaustive' ? 1 : AUDITED_BLOCK_SHARE));
  const auditCalls = auditedBlocks * AUDIT_CALLS_PER_BLOCK;
  const auditInput = Math.round(auditCalls * AUDIT_INPUT_PER_CALL * multiplier);
  const auditOutput = Math.round(auditCalls * AUDIT_OUTPUT_PER_CALL * multiplier);

  const stages: CompleteGuideStageEstimate[] = [
    { stage: 'recon', calls: reconCalls, inputTokens: Math.round(uncached * 1.1 + reconCalls * 1_500), outputTokens: Math.round(uncached * 0.04 + reconCalls * 600) },
    { stage: 'extract', calls: extractCalls, inputTokens: Math.round(uncached + extractCalls * 2_500), outputTokens: Math.round(uncached * 0.35) },
    { stage: 'plan', calls: units * 2, inputTokens: Math.round(items * 45 + units * 4_000), outputTokens: units * 3_000 },
    { stage: 'write', calls: writeCalls, inputTokens: writeCalls * 4_000, outputTokens: writeOutput },
    { stage: 'verify', calls: sections * 3 + auditCalls, inputTokens: sections * 3 * 8_000 + auditInput, outputTokens: Math.round(sentences * 12 + auditOutput) },
    { stage: 'finalize', calls: units + 4, inputTokens: (units + 4) * 6_000, outputTokens: (units + 4) * 1_500 },
  ];
  // One web step per chapter (plan, pick, rate: ~6 calls), web passages in each writer
  // call and one audit of the web blocks per section.
  if (input.webText) stages.push({ stage: 'web', calls: units * 6 + sections, inputTokens: units * 6 * 3_000 + sections * 6_000, outputTokens: units * 6 * 500 + sections * 1_500 });
  stages.push({ stage: 'embed', calls: Math.ceil(items / 64), inputTokens: items * 40, outputTokens: 0 });

  const chatStages = stages.filter((stage) => stage.stage !== 'embed');
  const inputTokens = chatStages.reduce((sum, stage) => sum + stage.inputTokens, 0);
  const outputTokens = chatStages.reduce((sum, stage) => sum + stage.outputTokens, 0);
  const calls = stages.reduce((sum, stage) => sum + stage.calls, 0);
  const price = completeGuidePrice(input.model);
  const embedCost = (items * 40 * COMPLETE_GUIDE_EMBEDDING_PRICE_PER_M) / 1e6;
  const base = price ? (inputTokens * price.input + outputTokens * price.output) / 1e6 + embedCost : null;
  // Latency: output-bound generation at ~45 tok/s plus per-call overhead, spread over
  // the background concurrency the engine uses (about three calls in flight).
  const seconds = (outputTokens / 45 + calls * 2) / 3;
  const warnings: CompleteGuideEstimateWarning[] = [];
  if ((input.subjectCount ?? 0) > 1) warnings.push({ code: 'several_subjects', count: input.subjectCount! });
  if (snapshot.totals.pages > COMPLETE_GUIDE_LARGE_PAGES || totalTokens > LARGE_TOKENS) warnings.push({ code: 'large_selection', pages: snapshot.totals.pages, tokens: totalTokens });
  if (input.unavailableSources) warnings.push({ code: 'unavailable_sources', count: input.unavailableSources });
  const withEmptyPages = snapshot.issues.filter((issue) => issue.code === 'pages_without_text').length;
  if (withEmptyPages) warnings.push({ code: 'pages_without_text', sources: withEmptyPages });
  if (!price) warnings.push({ code: 'unknown_price' });
  return {
    stages,
    calls,
    inputTokens,
    outputTokens,
    usd: base === null ? null : { min: round(base * 0.7), max: round(base * 1.5) },
    minutes: { min: Math.max(1, Math.round((seconds * 0.7) / 60)), max: Math.max(2, Math.round((seconds * 1.6) / 60)) },
    cachedShare,
    expected: { items, sections, units },
    warnings,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
