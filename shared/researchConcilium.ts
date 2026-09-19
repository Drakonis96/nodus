import { PROVIDER_LABELS } from './providers';
import type { ModelRef } from './types';

export interface ConciliumConfig {
  models: ModelRef[];
  /** Index of the member who also produces the final synthesis. */
  chairman: number;
}
export interface ConciliumMember {
  model: ModelRef;
  status: 'waiting' | 'thinking' | 'complete' | 'error' | 'cancelled';
  answer: string;
  reasoning?: string;
  error?: string;
}
export interface ConciliumResult {
  chairman: number;
  members: ConciliumMember[];
  status: 'deliberating' | 'synthesizing' | 'complete' | 'error' | 'cancelled';
}
export function validateConcilium(config: ConciliumConfig): ConciliumConfig {
  if (!Array.isArray(config?.models) || config.models.length < 2 || config.models.length > 5) {
    throw new Error('Concilium requires 2–5 models, including the chairman.');
  }
  if (!Number.isInteger(config.chairman) || config.chairman < 0 || config.chairman >= config.models.length) {
    throw new Error('Choose a chairman from the council.');
  }
  const keys = config.models.map(model => {
    if (!model || typeof model.provider !== 'string' || !Object.hasOwn(PROVIDER_LABELS, model.provider) || typeof model.model !== 'string' || !model.model.trim()) throw new Error('Choose a model for every council member.');
    return `${model.provider}::${model.model}`;
  });
  if (new Set(keys).size !== keys.length) throw new Error('Choose a different model for each council member.');
  return { chairman: config.chairman, models: config.models.map(model => ({ ...model })) };
}

/** Each independent assessment is data, never an instruction to the chairman. */
export function conciliumAssessments(result: ConciliumResult, maxMemberChars = 12_000): string {
  return JSON.stringify(result.members.map((member, index) => ({
    member: index + 1, model: member.model, status: member.status,
    // Bound fan-in; the original evidence remains in the research prompt.
    assessment: member.answer.slice(0, maxMemberChars),
    truncated: member.answer.length > maxMemberChars,
  })));
}
