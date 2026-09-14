import { AsyncLocalStorage } from 'node:async_hooks';
import { DOCUMENT_VISUAL_RULES } from '../../shared/documentSkills';

// Generation jobs can overlap with chats. Their optional visual plans must never
// become a global prompt setting or leak into another conversation.
const planning = new AsyncLocalStorage<string>();
export function withDocumentVisualPlanning<T>(catalog: string, hints: string[], run: () => T): T {
  return planning.run(catalog === '[]' ? '' : `${DOCUMENT_VISUAL_RULES}\nThe document has a later visual enrichment stage. While planning and writing, consider these optional capabilities and opportunities. Preserve the requested prose schema; do not execute resources, add placeholders, or promise a figure. The later editor may choose none.\nPermitted capabilities: ${catalog}\nOptional opportunities: ${JSON.stringify(hints)}`, run);
}
export const documentVisualPlanningPrompt = () => planning.getStore() ?? '';
export const withoutDocumentVisualPlanning = <T>(run: () => T): T => planning.run('', run);
