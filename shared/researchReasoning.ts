import type { ModelInfo, ModelRef } from './types';

/** Research Assistant only. Never persisted into chatReasoning or ModelRef. */
export type ResearchEffort = 'standard' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | 'on';
export type NativeResearchEffort = Exclude<ResearchEffort, 'standard'> | 'none' | 'off';
export interface ResearchReasoningProfile {
  levels: NativeResearchEffort[];
  mode: 'none' | 'effort' | 'gemini-budget' | 'gemini-level' | 'anthropic-adaptive' | 'anthropic-budget' | 'toggle' | 'local';
}
const ordered: NativeResearchEffort[] = ['none', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'on'];
const profile = (mode: ResearchReasoningProfile['mode'], ...levels: NativeResearchEffort[]): ResearchReasoningProfile => ({ mode, levels });
const unknown = () => profile('none');

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
    if (/v4|deepseek-chat|deepseek-reasoner/.test(id)) return profile('toggle', 'none', 'low', 'high', 'max');
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
    if (/^deepseek-v4/.test(id)) return profile('effort', 'low', 'high', 'max');
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
