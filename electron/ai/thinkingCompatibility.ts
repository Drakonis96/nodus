import type { ModelInfo, ModelRef } from '@shared/types';
import { minimumReasoningEffort, openRouterReasoningMandatory, researchAdvertisedEfforts, researchReasoningProfile } from '@shared/researchReasoning';
import { rejectsTemperatureParameter, rejectsThinkingOff, thinkingEffortReplacement, thinkingOffReplacement } from './providerErrors';
import { rememberTemperatureUnsupported, temperatureUnsupported } from './samplingSupport';

type Body = Record<string, any>;
type Contract = { thinkingType?: string; effort?: string };
const learned = new Map<string, Contract>();
const catalogues = new Map<string, ModelInfo>();
const modelKey = (model: ModelRef, endpoint?: string | null) => `${model.provider}:${model.model}${['custom', 'lmstudio', 'ollama'].includes(model.provider) ? `:${endpoint ?? ''}` : ''}`;
const offEffort = (effort: unknown) => effort === 'none' || effort === 'off';

export function rememberThinkingCatalog(provider: ModelRef['provider'], models: ModelInfo[], endpoint?: string | null): void {
  for (const model of models) catalogues.set(modelKey({ provider, model: model.id }, endpoint), model);
}

export function thinkingCatalogFor(model: ModelRef, endpoint?: string | null): ModelInfo | undefined {
  return catalogues.get(modelKey(model, endpoint));
}

function sendsThinkingOff(body: Body): boolean {
  return body.thinking?.type === 'disabled' || body.thinking?.type === 'between_tools'
    || body.reasoning?.enabled === false || offEffort(body.reasoning?.effort) || offEffort(body.reasoning_effort);
}

function minimumEffort(model: ModelRef, info?: ModelInfo): string {
  const advertised = researchAdvertisedEfforts(info);
  if (model.provider === 'groq' && researchReasoningProfile(model, info).mode === 'toggle') return 'default';
  return minimumReasoningEffort(advertised.length ? advertised : researchReasoningProfile(model).levels) ?? 'low';
}

function applyContract(model: ModelRef, body: Body, contract: Contract, info?: ModelInfo): Body {
  if (!sendsThinkingOff(body)) return body;
  const effort = contract.effort ?? minimumEffort(model, info);
  if (body.thinking?.type === 'disabled' || body.thinking?.type === 'between_tools') {
    const thinkingType = contract.thinkingType ?? (model.provider === 'anthropic' ? 'adaptive' : 'enabled');
    return {
      ...body, thinking: { type: thinkingType },
      ...(thinkingType === 'adaptive' ? { output_config: { ...body.output_config, effort } } : {}),
      ...(model.provider === 'deepseek' && thinkingType === 'enabled' ? { reasoning_effort: effort } : {}),
    };
  }
  if (body.reasoning) {
    const { enabled: _enabled, max_tokens: _budget, ...rest } = body.reasoning;
    return { ...body, reasoning: { ...rest, effort } };
  }
  return { ...body, reasoning_effort: effort };
}

/** Keep opt-outs on models that accept them; mandatory models receive their
 * own minimum, without changing an explicitly enabled reasoning request. */
export function compatibleThinkingBody(model: ModelRef, body: Body, info?: ModelInfo, endpoint?: string | null): Body {
  if (temperatureUnsupported(model) && 'temperature' in body) {
    const { temperature: _removed, ...rest } = body;
    body = rest;
  }
  const metadata = info ?? thinkingCatalogFor(model, endpoint);
  const contract = learned.get(modelKey(model, endpoint));
  if (contract) return applyContract(model, body, contract, metadata);
  if (metadata?.reasoningMandatory ?? (model.provider === 'openrouter' && openRouterReasoningMandatory(model.model))) {
    return applyContract(model, body, {}, metadata);
  }
  return body;
}

/** Recover only an explicit refusal before generation. Each independent field
 * gets one correction, so temperature and thinking can both be refused without
 * an unbounded retry or a change to the prompt/output budget. */
export async function withThinkingCompatibility<T>(
  model: ModelRef,
  body: Body,
  make: (body: Body) => Promise<T>,
  options: { info?: ModelInfo; endpoint?: string | null; noRetry?: boolean; signal?: AbortSignal; canReplay?: () => boolean; isSuccess?: (result: T) => boolean } = {},
): Promise<T> {
  let request = compatibleThinkingBody(model, body, options.info, options.endpoint);
  let pending: Contract | undefined;
  let temperatureRecovered = false;
  for (;;) {
    try {
      const result = await make(request);
      if (pending && (options.isSuccess?.(result) ?? true)) learned.set(modelKey(model, options.endpoint), pending);
      return result;
    } catch (error) {
      if (options.noRetry || options.signal?.aborted || options.canReplay?.() === false) throw error;
      if (!temperatureRecovered && 'temperature' in request && rejectsTemperatureParameter(error)) {
        const { temperature: _removed, ...rest } = request;
        request = rest;
        temperatureRecovered = true;
        rememberTemperatureUnsupported(model);
        continue;
      }
      if (!pending && sendsThinkingOff(request) && rejectsThinkingOff(error)) {
        pending = {
          thinkingType: thinkingOffReplacement(error) ?? (model.provider === 'anthropic' ? 'adaptive' : 'enabled'),
          effort: thinkingEffortReplacement(error) ?? minimumEffort(model, options.info ?? thinkingCatalogFor(model, options.endpoint)),
        };
        const replay = applyContract(model, request, pending, options.info ?? thinkingCatalogFor(model, options.endpoint));
        if (JSON.stringify(replay) === JSON.stringify(request)) throw error;
        request = replay;
        continue;
      }
      throw error;
    }
  }
}
