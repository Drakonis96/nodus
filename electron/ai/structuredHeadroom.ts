import type { ModelRef } from '@shared/types';
import { AiError, completeJson, type CallOpts } from './aiClient';
import { VALIDATION_RETRY_MAX_TOKENS } from './localRequestPlanner';

/**
 * One structured call, with a cut-off answer retried once with more room.
 *
 * A model that reasons before answering spends part of the output budget on its trace, so a
 * budget sized for the JSON alone stops mid-object — or, when the trace fills it, comes back
 * with no content at all. The batch calls that share `localTaskOutputTokens` (theme
 * assignment, relation validation, semantic bridges, chapter typing and idea extraction) all
 * size their budget from the item count, and a one-item batch cannot buy room the way a
 * many-item one does: `adaptiveStructuredBatch` splits candidates, but a single candidate has
 * nothing to split, and its fallback clips the input text, which is not what ran out.
 *
 * Fusion and the work summaries already answer a cut-off reply with one retry at a larger
 * ceiling; this is the same recovery for the calls that had none. The retry asks for twice
 * the budget, capped, so a batch that was already at the ceiling is left to the splitter
 * instead of repeating an identical request.
 */
export async function completeJsonWithHeadroom<T>(
  request: CallOpts,
  guard: (value: unknown) => value is T,
  model?: ModelRef | null,
  retryCeiling = VALIDATION_RETRY_MAX_TOKENS,
): Promise<T> {
  try {
    return await completeJson<T>(request, guard, model);
  } catch (error) {
    // Only a cut-off answer is worth more room: a schema miss or an unparseable reply would
    // repeat with the same budget, and a transport failure has its own retry layer.
    if (!(error instanceof AiError && error.code === 'output_truncated')) throw error;
    const base = request.maxTokens ?? 0;
    const retryBudget = Math.min(retryCeiling, base * 2);
    if (retryBudget <= base) throw error;
    return completeJson<T>({ ...request, maxTokens: retryBudget }, guard, model);
  }
}
