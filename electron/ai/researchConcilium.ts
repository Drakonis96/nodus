import { validateConcilium, type ConciliumConfig, type ConciliumResult } from '@shared/researchConcilium';
import type { ModelRef } from '@shared/types';

type Delta = (delta: string, kind?: 'content' | 'reasoning') => void;
/** No tools are exposed here. The research driver explicitly gives skills only to synthesize. */
export async function runConcilium<T extends { answer: string; aborted?: boolean }>(
  config: ConciliumConfig,
  assess: (model: ModelRef, delta: Delta) => Promise<{ answer: string }>,
  synthesize: (model: ModelRef, result: ConciliumResult) => Promise<T>,
  onUpdate?: (result: ConciliumResult) => void,
  signal?: AbortSignal,
): Promise<{ response?: T; concilium: ConciliumResult }> {
  const checked = validateConcilium(config);
  const result: ConciliumResult = { chairman: checked.chairman, status: 'deliberating', members: checked.models.map(model => ({ model, status: 'waiting', answer: '' })) };
  const emit = () => onUpdate?.(structuredClone(result));
  emit();
  await Promise.all(result.members.map(async member => {
    if (signal?.aborted) { member.status = 'cancelled'; emit(); return; }
    member.status = 'thinking'; emit();
    try {
      const response = await assess(member.model, (delta, kind) => {
        if (signal?.aborted) return;
        if (kind === 'reasoning') member.reasoning = (member.reasoning ?? '') + delta;
        else member.answer += delta;
        emit();
      });
      member.answer = response.answer.trim();
      member.status = signal?.aborted ? 'cancelled' : member.answer ? 'complete' : 'error';
      if (member.status === 'error') member.error = 'The model returned an empty response.';
    } catch (error) {
      member.status = signal?.aborted ? 'cancelled' : 'error';
      member.error = signal?.aborted ? undefined : error instanceof Error ? error.message : String(error);
    }
    emit();
  }));
  if (signal?.aborted) { result.status = 'cancelled'; emit(); return { concilium: result }; }
  if (!result.members.some(member => member.status === 'complete')) {
    result.status = 'error'; emit(); return { concilium: result };
  }
  result.status = 'synthesizing'; emit();
  try {
    const response = await synthesize(checked.models[checked.chairman], result);
    result.status = signal?.aborted || response.aborted ? 'cancelled' : 'complete';
    emit(); return { response, concilium: result };
  } catch (error) {
    result.status = signal?.aborted ? 'cancelled' : 'error'; emit(); throw error;
  }
}
