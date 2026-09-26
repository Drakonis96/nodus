import type { ModelInfo, ModelRef } from './types';

/** Every level the Research composer can ask for, off through the largest budget. A runtime
 *  list as well as a type so a stored choice can be validated when it is read back. */
export const RESEARCH_EFFORTS = ['standard', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'on'] as const;

/** Research Assistant only. Never persisted into chatReasoning or ModelRef; the level the
 *  composer last used for a model lives in its own settings key (`researchEffortByModel`). */
export type ResearchEffort = (typeof RESEARCH_EFFORTS)[number];
export type NativeResearchEffort = Exclude<ResearchEffort, 'standard'> | 'none' | 'off';

export function isResearchEffort(value: unknown): value is ResearchEffort {
  return typeof value === 'string' && (RESEARCH_EFFORTS as readonly string[]).includes(value);
}
export interface ResearchReasoningProfile {
  levels: NativeResearchEffort[];
  mode: 'none' | 'effort' | 'gemini-budget' | 'gemini-level' | 'anthropic-adaptive' | 'anthropic-budget' | 'toggle' | 'local';
}
const ordered: NativeResearchEffort[] = ['none', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'on'];
const profile = (mode: ResearchReasoningProfile['mode'], ...levels: NativeResearchEffort[]): ResearchReasoningProfile => ({ mode, levels });
const unknown = () => profile('none');

/**
 * Providers whose ladder arrives with the live model catalogue instead of the profile
 * tables below. Until that catalogue is fetched their profile advertises no levels at all,
 * so nothing may read «no levels» as «this model offers none».
 */
export function researchReasoningNeedsCatalog(ref: ModelRef | null | undefined): boolean {
  return ['codex', 'github-copilot', 'lmstudio', 'openrouter'].includes(ref?.provider ?? '');
}

/** Explicit, documented families only. Runtime catalogues take precedence for
 * subscriptions and LM Studio. See docs/research-assistant-reasoning.md. */
export function researchReasoningProfile(ref: ModelRef | null | undefined, info?: ModelInfo): ResearchReasoningProfile {
  if (!ref) return unknown();
  const id = ref.model.toLowerCase();
  if (ref.provider === 'codex' || ref.provider === 'github-copilot') {
    const advertised = info?.supportedReasoningEfforts?.map(x => x.reasoningEffort) ?? [];
    return profile('effort', ...ordered.filter(x => advertised.some(effort => effort === x)));
  }
  if (ref.provider === 'lmstudio') return profile('local', ...ordered.filter(x => info?.researchReasoningLevels?.includes(x)));
  if (ref.provider === 'ollama') {
    if (/gpt-oss/.test(id)) return profile('local', 'low', 'medium', 'high');
    if (/qwen3(?!.*(?:instruct|coder))|deepseek-r1|deepseek-v3[.-][12]|magistral/.test(id)) return profile('local', 'off', 'on');
    return unknown();
  }
  if (ref.provider === 'nodus') return unknown();
  if (ref.provider === 'openai' || ref.provider === 'custom') {
    if (/gpt-oss/.test(id)) return profile('effort', 'low', 'medium', 'high');
    if (/^gpt-6(?:[.-]|$)/.test(id)) return profile('effort', 'low', 'medium', 'high', 'xhigh', 'max');
    if (/chat|^gpt-4|^o1-(?:mini|preview)/.test(id)) return unknown();
    if (/^gpt-5.*-pro/.test(id)) return /^gpt-5-pro/.test(id) ? profile('effort', 'high') : profile('effort', 'medium', 'high', 'xhigh');
    if (/^gpt-5.*codex/.test(id)) return profile('effort', 'low', 'medium', 'high', ...(/^gpt-5[.-](?:codex|1-codex(?!-max))/.test(id) ? [] : ['xhigh' as const]));
    if (/^gpt-5\.6/.test(id)) return profile('effort', 'none', 'low', 'medium', 'high', 'xhigh', 'max');
    if (/^gpt-5\.[2-5]/.test(id)) return profile('effort', 'none', 'low', 'medium', 'high', 'xhigh');
    if (/^gpt-5\.1/.test(id)) return profile('effort', 'none', 'low', 'medium', 'high');
    if (/^gpt-5(?:-|$)/.test(id)) return profile('effort', 'minimal', 'low', 'medium', 'high');
    if (/^o[134](?:-|$)/.test(id)) return /-pro/.test(id) ? profile('effort', 'high') : profile('effort', 'low', 'medium', 'high');
    return unknown();
  }
  if (ref.provider === 'gemini') {
    if (/^gemini-3/.test(id)) {
      if (/^gemini-3-pro/.test(id)) return profile('gemini-level', 'low', 'high');
      if (/pro|^gemini-3\.[78]-flash/.test(id)) return profile('gemini-level', 'low', 'medium', 'high');
      return profile('gemini-level', 'minimal', 'low', 'medium', 'high');
    }
    if (/^gemini-2\.5/.test(id)) return profile('gemini-budget', ...(/pro/.test(id) ? [] : ['none' as const]), 'low', 'medium', 'high');
    return unknown();
  }
  if (ref.provider === 'anthropic') {
    if (/mythos|fable/.test(id)) return profile('anthropic-adaptive', 'low', 'medium', 'high', ...(/preview/.test(id) ? [] : ['xhigh' as const]), 'max');
    if (/claude-(?:opus|sonnet)-(?:4[.-][6-9]|5)/.test(id)) return profile('anthropic-adaptive', 'none', 'low', 'medium', 'high', ...(/4[.-]6/.test(id) ? [] : ['xhigh' as const]), 'max');
    if (/claude-(?:3[.-]7|(?:opus|sonnet|haiku)-4)|claude-3-7/.test(id)) return profile('anthropic-budget', 'none', 'low', 'medium', 'high');
    return unknown();
  }
  if (ref.provider === 'deepseek') {
    // DeepSeek's current ids are unversioned (`deepseek-flash`, `deepseek-pro`) alongside the
    // pinned `deepseek-v4-*` names; both default to thinking-on, so both need the same toggle
    // and budget. Matching only `/v4/` silently left the unversioned ids unmanaged.
    if (/v4|deepseek-chat|deepseek-reasoner|deepseek-(?:flash|pro)(?:-|$)/.test(id)) return profile('toggle', 'none', 'low', 'high', 'max');
    return unknown();
  }
  if (ref.provider === 'xiaomi') return /mimo/.test(id) ? profile('toggle', 'none', 'on') : unknown();
  if (ref.provider === 'groq' || ref.provider === 'cerebras') {
    if (/gpt-oss/.test(id)) return profile('effort', 'low', 'medium', 'high');
    if (/qwen[/-]?3\.8|gemma-4/.test(id)) return profile('effort', 'none', 'low', 'medium', 'high');
    if (ref.provider === 'groq' && /qwen3(?:\.6)?-/.test(id)) return profile('toggle', 'none', 'on');
    return unknown();
  }
  if (ref.provider === 'openrouter') {
    if (info?.reasoning === false) return unknown();
    if (/deepseek\/deepseek-r1|kimi-k2-thinking|minimax.*(?:m2|m3)/.test(id)) return profile('effort', 'low', 'medium', 'high');
    if (/z-ai\/glm-5\.3-flash/.test(id)) return profile('effort', 'low', 'medium', 'high', 'max');
    const [provider, ...rest] = id.split('/');
    const nativeProvider = ({ google: 'gemini', 'z-ai': 'opencode-go' } as Record<string, string>)[provider] ?? provider;
    if (['openai', 'anthropic', 'gemini', 'deepseek', 'xiaomi'].includes(nativeProvider)) {
      const native = researchReasoningProfile({ provider: nativeProvider as ModelRef['provider'], model: rest.join('/') });
      if (native.levels.length) return { ...native, mode: 'effort' };
    }
    return info?.reasoning ? profile('effort', 'low', 'medium', 'high', 'xhigh', 'max') : unknown();
  }
  if (ref.provider === 'opencode-go') {
    if (/^gpt-/.test(id)) return researchReasoningProfile({ provider: 'openai', model: id });
    // The unversioned `deepseek-flash`/`deepseek-pro` ids are the same served family as the
    // pinned `deepseek-v4-*` names, so they take the route's level contract instead of
    // falling through to `unknown()` and leaving the model with no effort control at all.
    if (/^deepseek-(?:v4|flash|pro)/.test(id)) return profile('effort', 'low', 'high', 'max');
    if (/^qwen/.test(id)) return profile('toggle', 'none', 'on');
    if (/^glm-5\.3-flash/.test(id)) return profile('effort', 'low', 'medium', 'high', 'max');
    if (/^glm-5/.test(id)) return profile('toggle', 'none', 'on');
    // MiniMax and Kimi reasoning is mandatory and exposes no graded control.
    return unknown();
  }
  return unknown();
}

export function researchEffortChoices(p: ResearchReasoningProfile): ResearchEffort[] {
  return ['standard', ...p.levels.slice(1).filter((x): x is Exclude<ResearchEffort, 'standard'> => x !== 'none' && x !== 'off')];
}

export function resolveResearchEffort(p: ResearchReasoningProfile, requested: unknown): NativeResearchEffort | undefined {
  return researchEffortChoices(p).includes(requested as ResearchEffort) && requested !== 'standard'
    ? requested as NativeResearchEffort : p.levels[0];
}

/**
 * The settings key one selection's remembered level lives under. Provider ids never
 * contain a colon and model ids may contain slashes (OpenRouter's `vendor/model`), so
 * `provider:model` names one selection unambiguously.
 */
export function researchEffortMemoryKey(ref: ModelRef | null | undefined): string | null {
  return ref?.provider && ref.model ? `${ref.provider}:${ref.model}` : null;
}

/** How deep each level reasons, for finding the one nearest the middle. `on` is a switch,
 *  not a depth, so it has no rank and is never a default. */
const depth: Partial<Record<NativeResearchEffort, number>> = { none: 0, off: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6, ultra: 7 };

/**
 * The level a model starts on when the user never chose one for it: the middle of what it
 * publishes. Medium where the model offers it; otherwise the level nearest to medium, the
 * lighter one on a tie (DeepSeek's low/high ladder starts on low). «Standard» stands for
 * the model's own first level, so a ladder that starts at low (Gemini 3 Pro: low, high)
 * starts there. A plain on/off switch has no middle and stays on Standard.
 */
export function researchDefaultEffort(p: ResearchReasoningProfile): ResearchEffort {
  const choices = researchEffortChoices(p);
  if (choices.includes('medium')) return 'medium';
  const rank = (choice: ResearchEffort) => depth[choice === 'standard' ? p.levels[0] ?? 'none' : choice];
  let best: ResearchEffort = 'standard';
  let distance = Infinity;
  for (const choice of choices) {
    const value = rank(choice);
    if (value === undefined) continue;
    if (Math.abs(value - depth.medium!) < distance) { best = choice; distance = Math.abs(value - depth.medium!); }
  }
  return best;
}

/**
 * The writer for the per provider+model memory the Research composer owns. Every level
 * the user picks is stored, Standard included: a model with no entry opens on its middle
 * level, so Standard is a choice like any other.
 */
export function withResearchEffort(
  current: Record<string, ResearchEffort> | undefined,
  ref: ModelRef | null | undefined,
  effort: ResearchEffort
): Record<string, ResearchEffort> {
  const key = researchEffortMemoryKey(ref);
  const next = { ...(current ?? {}) };
  if (key) next[key] = effort;
  return next;
}

/** The level remembered for one selection, if the user ever picked one. A value that is
 *  not a level at all (a hand-edited preferences file) counts as no choice. */
export function rememberedResearchEffort(
  remembered: Record<string, ResearchEffort> | undefined,
  ref: ModelRef | null | undefined
): ResearchEffort | undefined {
  const key = researchEffortMemoryKey(ref);
  const stored = key ? remembered?.[key] : undefined;
  return isResearchEffort(stored) ? stored : undefined;
}

/**
 * The level a picker opens on for one selection: the level last chosen for that same
 * provider+model, or the model's middle level when nothing was chosen for it.
 *
 * A remembered level the model no longer publishes gives way to the middle level too, once
 * the ladder is known. A provider whose ladder comes with its live catalogue has no ladder
 * until `info` arrives, so its remembered level stands until then; the request path
 * (`resolveResearchEffort`) floors anything the model rejects in any case.
 */
export function researchEffortFor(
  remembered: Record<string, ResearchEffort> | undefined,
  ref: ModelRef | null | undefined,
  info?: ModelInfo
): ResearchEffort {
  const p = researchReasoningProfile(ref, info);
  const stored = rememberedResearchEffort(remembered, ref);
  if (stored && (researchEffortChoices(p).includes(stored) || (researchReasoningNeedsCatalog(ref) && !info))) return stored;
  return researchDefaultEffort(p);
}

/** Additional allowance for reasoning, preserving room for the visible answer.
 * Local windows are fitted separately and never expanded by this helper. */
export function researchThinkingAllowance(effort: NativeResearchEffort | undefined): number {
  return ({ minimal: 512, low: 1024, medium: 4096, high: 8192, xhigh: 16384, max: 32768, ultra: 32768, on: 8192 } as Partial<Record<NativeResearchEffort, number>>)[effort ?? 'none'] ?? 0;
}

export function researchReasoningBody(ref: ModelRef, requested: ResearchEffort, maxTokens: number, info?: ModelInfo): Record<string, unknown> {
  const p = researchReasoningProfile(ref, info);
  const effort = resolveResearchEffort(p, requested);
  if (!effort) return {};
  const off = effort === 'none' || effort === 'off';
  if (ref.provider === 'openrouter') return { reasoning: off ? { enabled: false } : effort === 'on' ? { enabled: true } : { effort } };
  if (p.mode === 'gemini-level' || p.mode === 'gemini-budget') return {
    extra_body: { google: { thinking_config: p.mode === 'gemini-level'
      ? { thinking_level: effort }
      : { thinking_budget: off ? 0 : Math.min(researchThinkingAllowance(effort), Math.max(128, maxTokens - 1024)) } } },
  };
  if (p.mode === 'anthropic-adaptive') return { thinking: { type: off ? 'disabled' : 'adaptive' }, output_config: { effort: off ? 'low' : effort } };
  if (p.mode === 'anthropic-budget') return { thinking: off ? { type: 'disabled' } : { type: 'enabled', budget_tokens: Math.min(researchThinkingAllowance(effort), Math.max(1024, maxTokens - 1024)) } };
  if (p.mode === 'toggle') {
    if (ref.provider === 'groq') return { reasoning_effort: off ? 'none' : 'default' };
    return { thinking: { type: off ? 'disabled' : 'enabled' }, ...(ref.provider === 'deepseek' && !off ? { reasoning_effort: effort } : {}) };
  }
  if (p.mode === 'local') return ref.provider === 'ollama' ? { think: off ? false : effort === 'on' ? true : effort } : { reasoning: effort };
  return { reasoning_effort: effort };
}

/** Thinking-enabled Claude and OpenAI reasoning models reject sampling knobs. */
export function researchOmitsTemperature(ref: ModelRef, effort: ResearchEffort, info?: ModelInfo): boolean {
  const p = researchReasoningProfile(ref, info);
  const native = resolveResearchEffort(p, effort);
  return (ref.provider === 'anthropic' && !!native && native !== 'none') ||
    (['openai', 'custom', 'opencode-go'].includes(ref.provider) && /^(?:gpt-[56]|o[134])/.test(ref.model) && native !== 'none');
}
