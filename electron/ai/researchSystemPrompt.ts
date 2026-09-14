import { composeResearchSystemPrompt } from '@shared/researchSystemPrompts';
import { resolveResearchSystemPrompt } from '../db/researchSystemPromptsRepo';
export function withResearchSystemPrompt(base: string, id?: string | null): string {
  return composeResearchSystemPrompt(base, resolveResearchSystemPrompt(id));
}
