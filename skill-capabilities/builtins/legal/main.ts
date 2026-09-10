import { splitChatVisuals, serializeChatVisualPart, skillHasCapability } from '../../../shared/chatSkills';
import { parseLegalPlan } from '../../../shared/legalize';
import { retrieveLegalize } from '../../../electron/legalize';
import type { ChatSkillExecution } from '../../registry/types';

export async function executeLegal(answer: string, execution: ChatSkillExecution, signal?: AbortSignal): Promise<string | null> {
  const parts = splitChatVisuals(answer).filter(part => part.kind === 'legal-plan' || part.kind === 'legal-result');
  if (!parts.length) return null;
  try {
    if (!execution.skills.some(skill => skillHasCapability(skill, 'nodus:legal'))) throw Error('Legalize: activa la skill antes de consultar legislación.');
    if (parts.length !== 1 || parts[0].kind !== 'legal-plan' || !parts[0].complete) throw Error('Legalize: se necesita una única solicitud completa; no se aceptan resultados inventados por el modelo.');
    const result = await retrieveLegalize(parseLegalPlan(parts[0].content, execution.question ?? ''), signal);
    return serializeChatVisualPart({ kind: 'legal-result', content: JSON.stringify(result), complete: true });
  } catch (error) {
    if (signal?.aborted || error instanceof Error && error.name === 'AbortError') throw error;
    return error instanceof Error ? error.message : 'Legalize: no se pudo consultar la legislación.';
  }
}
