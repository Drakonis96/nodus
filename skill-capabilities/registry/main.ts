import { chatAssetVersion } from '../../electron/chatAssets';
import { runSkillTool } from '../../electron/skillToolSandbox';
import { serializeChatVisualPart, splitChatVisuals } from '../../shared/chatSkills';
import { executeChemistryPlan, prepareChemistry } from '../builtins/chemistry/main';
import { executeGenomics } from '../builtins/genomics/main';
import { executeImageRequest } from '../builtins/image/main';
import { executeLegal } from '../builtins/legal/main';
import { refineSvg } from '../builtins/svg/main';
import { executeExternalCapability } from '../external/main';
import type { ChatSkillExecution } from './types';

const MAX_EXTENSIBILITY_CALLS = 4;

export function assertChatSkillSession(execution: ChatSkillExecution, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  if (!execution.isCurrent() || (execution.owner && chatAssetVersion(execution.owner) !== execution.version)) {
    throw new DOMException('The chat was deleted or changed.', 'AbortError');
  }
}

/** Provider-independent registry dispatcher shared by every chat surface. */
export async function executeRegisteredChatSkills(answer: string, execution: ChatSkillExecution, signal?: AbortSignal): Promise<string> {
  const current = () => assertChatSkillSession(execution, signal);
  current();
  const legal = await executeLegal(answer, execution, signal);
  if (legal !== null) { current(); return legal; }
  const genomics = await executeGenomics(answer, execution, current, signal);
  if (genomics !== null) { current(); return genomics; }

  const chemistry = prepareChemistry(answer, execution);
  if (chemistry.terminal) return chemistry.terminal;
  answer = chemistry.answer;

  // JavaScript tools and external capabilities intentionally share one budget.
  let extensibilityCalls = 0;
  const toolPattern = /```nodus-tool[ \t]*\r?\n([\s\S]*?)\r?\n```/g;
  let cursor = 0, processed = '';
  for (const match of answer.matchAll(toolPattern)) {
    processed += answer.slice(cursor, match.index);
    try {
      current();
      if (++extensibilityCalls > MAX_EXTENSIBILITY_CALLS) throw new Error('At most four tool and capability calls are allowed per reply.');
      if (match[1].length > 64_000) throw new Error('Tool request is too large.');
      const request = JSON.parse(match[1]);
      const skill = execution.skills.find(item => item.id === request.skillId);
      const tool = skill?.tools?.find(item => item.id === request.toolId);
      if (!tool) throw new Error('This tool is not enabled for this reply.');
      const output = await runSkillTool(tool, request.input, signal);
      current();
      // Output is inert escaped data and is never reparsed as a protocol block.
      processed += '\n\nTool result (' + tool.id + '):\n\n    ' + output.replace(/`/g, '\\u0060').replace(/</g, '\\u003c').replace(/>/g, '\\u003e') + '\n\n';
    } catch (error) {
      if (signal?.aborted || error instanceof Error && error.name === 'AbortError') throw error;
      processed += '\n\nTool error: ' + String(error instanceof Error ? error.message : error).replace(/[\r\n`*<>[\]]/g, ' ').slice(0, 500) + '\n\n';
    }
    cursor = match.index! + match[0].length;
  }
  answer = processed + answer.slice(cursor);

  if (!chemistry.initialIntent) answer = await refineSvg(answer, execution, signal);
  const parts = splitChatVisuals(answer);
  const hasChemistryIntent = parts.some(part => part.kind === 'chemistry-plan');
  let imageRequested = false, chemistryRequested = false;
  const result: string[] = [];
  for (const part of parts) {
    if (hasChemistryIntent && part.kind !== 'chemistry-plan') continue;
    if (part.kind === 'chemistry-plan') {
      if (process.env.NODUS_CHEMFIG_QA_LOG === '1') console.log('[chemistry-plan]', part.content);
      if (chemistryRequested) result.push('\n\n**Chemistry Studio:** Only one chemistry plan can be compiled per reply.\n\n');
      else { chemistryRequested = true; result.push(await executeChemistryPlan(part.content, part.complete, execution, current, signal)); }
      continue;
    }
    if (['chemfig', 'smiles', 'lewis', 'chemistry-document'].includes(part.kind)) {
      result.push('\n\nChemistry Studio: las nuevas estructuras requieren un plan de identidad de versión 2. Los dibujos antiguos siguen siendo visibles, pero no se consideran verificados.\n\n');
      continue;
    }
    if (part.kind === 'capability-result') {
      result.push('\n\nCapability error: model-authored capability results are not accepted.\n\n');
      continue;
    }
    if (part.kind === 'capability-request') {
      if (++extensibilityCalls > MAX_EXTENSIBILITY_CALLS) result.push('\n\nCapability error: At most four tool and capability calls are allowed per reply.\n\n');
      else result.push(await executeExternalCapability(part.content, part.complete, execution, signal));
      continue;
    }
    if (part.kind === 'image-request') {
      if (imageRequested) result.push('\n\n```nodus-image-error\n{"message":"Only one image can be generated per reply. Send another message to create a variation."}\n```\n\n');
      else { imageRequested = true; result.push(await executeImageRequest(part.content, part.complete, execution, signal)); }
      continue;
    }
    result.push(serializeChatVisualPart(part));
  }
  current();
  if (chemistry.unverifiedSvg) result.unshift('> **Chemistry Studio — unverified drawing:** no validated identity, projection or mechanism was produced. This model-authored SVG was not checked by the chemistry resolver; verify structures, charges, products and curved arrows against a trusted source.\n\n');
  return result.join('');
}

export type { ChatSkillExecution } from './types';
