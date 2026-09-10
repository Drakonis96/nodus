import { splitChatVisuals, serializeChatVisualPart, skillHasCapability } from '../../../shared/chatSkills';
import { parseGenomicsPlan } from '../../../shared/genomics';
import { predictGenomics } from '../../../electron/genomics';
import { storeGenomicsResult } from '../../../electron/chatAssets';
import type { ChatSkillExecution } from '../../registry/types';

export async function executeGenomics(answer: string, execution: ChatSkillExecution, current: () => void, signal?: AbortSignal): Promise<string | null> {
  const parts = splitChatVisuals(answer).filter(part => part.kind === 'genomics-plan' || part.kind === 'genomics-result');
  if (parts.length) {
    try {
      if (!execution.skills.some(skill => skillHasCapability(skill, 'nodus:genomics'))) throw new Error('AlphaGenome: enable the skill first.');
      if (parts.length !== 1 || parts[0].kind !== 'genomics-plan' || !parts[0].complete) throw new Error('AlphaGenome: one complete prediction request is required; model-authored results are not accepted.');
      if (!execution.owner) throw new Error('AlphaGenome: start a saved conversation first.');
      const prediction = await predictGenomics(parseGenomicsPlan(parts[0].content, execution.question ?? ''), signal); current();
      return serializeChatVisualPart({ kind: 'genomics-result', content: storeGenomicsResult(execution.owner, prediction), complete: true });
    } catch (error) {
      if (signal?.aborted || error instanceof Error && error.name === 'AbortError') throw error;
      return error instanceof Error ? error.message : 'AlphaGenome: prediction failed.';
    }
  }
  if (execution.skills.some(skill => skillHasCapability(skill, 'nodus:genomics')) && /alphagenome/i.test(execution.question ?? '')
    && /chr(?:\d+|X|Y):\d+:[ACGT]:[ACGT]/.test(execution.question ?? '')
    && splitChatVisuals(answer).some(part => part.kind !== 'markdown')) return 'AlphaGenome: no validated prediction request was returned. SVG, images and model-authored values cannot replace an AlphaGenome query.';
  return null;
}
