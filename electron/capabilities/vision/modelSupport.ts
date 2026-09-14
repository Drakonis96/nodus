import type { ModelInfo, ModelRef } from '../../../shared/types';

const boundedProviders = new Set(['openai','anthropic','gemini','openrouter','groq','cerebras','deepseek','xiaomi','ollama','lmstudio','custom','nodus']);
// Only documented families on their actual provider. A live negative always wins.
// These aliases/snapshots still have to exist in the provider's live catalog.
const documented: Record<string, RegExp> = {
  openai: /^(?:gpt-4o(?:-mini)?|gpt-4\.1(?:-mini|-nano)?|gpt-5(?:-mini|-nano)?)(?:-\d{4}-\d{2}-\d{2})?$/,
  anthropic: /^claude-(?:3-(?:opus|sonnet|haiku)|3-5-(?:sonnet|haiku)|3-7-sonnet|sonnet-4(?:-5|-6)?|opus-4(?:-1|-5|-6)?|haiku-4-5|opus-5|fable-5-1)(?:-\d{8}|-latest)?$/,
  gemini: /^(?:gemini-2\.5-(?:flash|flash-lite|pro)|gemini-3\.1-flash-lite)$/,
};
export function visionModelSupport(model: Pick<ModelRef,'provider'|'model'>, info?: Pick<ModelInfo,'id'|'vision'>): {supported:boolean;reason:string} {
  if(!boundedProviders.has(model.provider)) return {supported:false,reason:'This provider has no bounded single-call vision transport.'};
  if(!info || info.id!==model.model) return {supported:false,reason:'The selected model could not be verified in its provider catalog.'};
  if(typeof info.vision==='boolean') return {supported:info.vision,reason:info.vision?'The provider advertises image input.':'The selected model is text-only.'};
  const supported = documented[model.provider]?.test(model.model) ?? false;
  return {supported,reason:supported?'Documented image support for this available model.':'Image support is unknown; use metadata ranking.'};
}
export const boundedVisionProvider = (provider:string) => boundedProviders.has(provider);
