import { chatAssetVersion } from '../../electron/chatAssets';
import { runSkillTool } from '../../electron/skillToolSandbox';
import { serializeChatVisualPart, serializeChemistryNotice, splitChatVisuals, type ChatVisualPart } from '../../shared/chatSkills';
import { executeChemistryPlan, prepareChemistry } from '../builtins/chemistry/main';
import { recordChemistryOutcome } from '../../electron/chemistryFailureLog';
import { executeGenomics } from '../builtins/genomics/main';
import { executeImageRequest } from '../builtins/image/main';
import { executeLegal } from '../builtins/legal/main';
import { refineSvg, rescueChemistryWithSvg } from '../builtins/svg/main';
import { executeExternalCapability } from '../external/main';
import { SANDBOXED_CALL_LIMIT } from '../contracts';
import type { ChatCallBudget, ChatSkillExecution } from './types';

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
  const notices = [...chemistry.notices];
  answer = chemistry.answer;

  // Deterministic sandboxed work and work that can leave the machine are budgeted apart:
  // a permissionless capability costs the same as a JavaScript tool, and only a capability
  // that declares network, secrets or storage is charged to the strict lane.
  const budget: ChatCallBudget = { sandboxed: 0, metered: 0 };
  const toolPattern = /```nodus-tool[ \t]*\r?\n([\s\S]*?)\r?\n```/g;
  let cursor = 0, processed = '';
  for (const match of answer.matchAll(toolPattern)) {
    processed += answer.slice(cursor, match.index);
    try {
      current();
      if (++budget.sandboxed > SANDBOXED_CALL_LIMIT) throw new Error(`At most ${SANDBOXED_CALL_LIMIT} sandboxed tool and capability calls are allowed per reply.`);
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
  let imageRequested = false, chemistryRequested = false, chemistryDrawn = false;
  // Two passes: the chemistry document decides whether competing visuals are
  // redundant (drop them) or the only remaining drawing (keep them). Prose is
  // never dropped in either case.
  const result: Array<{ part: ChatVisualPart['kind']; text: string }> = [];
  for (const part of parts) {
    if (part.kind === 'chemistry-plan') {
      if (process.env.NODUS_CHEMFIG_QA_LOG === '1') console.log('[chemistry-plan]', part.content);
      if (chemistryRequested) { notices.push({ code: 'one-plan-per-reply' }); continue; }
      chemistryRequested = true;
      const outcome = await executeChemistryPlan(part.content, part.complete, execution, current, signal);
      notices.push(...outcome.notices);
      if (outcome.rendered) { chemistryDrawn = true; result.push({ part: 'chemistry-document', text: outcome.rendered }); }
      continue;
    }
    if (['chemfig', 'smiles', 'lewis', 'chemistry-document'].includes(part.kind)) {
      notices.push({ code: 'legacy-format' });
      continue;
    }
    if (part.kind === 'capability-result') {
      result.push({ part: part.kind, text: '\n\nCapability error: model-authored capability results are not accepted.\n\n' });
      continue;
    }
    if (part.kind === 'capability-request') {
      result.push({ part: part.kind, text: await executeExternalCapability(part.content, part.complete, execution, budget, signal) });
      continue;
    }
    if (part.kind === 'image-request') {
      if (imageRequested) result.push({ part: part.kind, text: '\n\n```nodus-image-error\n{"message":"Only one image can be generated per reply. Send another message to create a variation."}\n```\n\n' });
      else { imageRequested = true; result.push({ part: part.kind, text: await executeImageRequest(part.content, part.complete, execution, signal) }); }
      continue;
    }
    result.push({ part: part.kind, text: serializeChatVisualPart(part) });
  }
  current();
  // Last step of the cascade: the verified lane abstained and no drawing of any kind
  // survived, so ask once more in SVG rather than leave the user with only a notice.
  const drewSomething = chemistryDrawn || result.some(item => item.part === 'svg');
  if (!drewSomething && (chemistry.needsFallback || chemistryRequested && !chemistryDrawn)) {
    const reason = notices.find(notice => notice.code === 'not-drawn')?.detail ?? 'No verified identity, projection or mechanism was produced.';
    const rescued = await rescueChemistryWithSvg(reason, execution, signal);
    current();
    if (rescued) {
      result.push({ part: 'svg', text: rescued });
      // Replace the abstention with the weaker claim the drawing actually carries.
      const index = notices.findIndex(notice => notice.code === 'not-drawn');
      if (index >= 0) notices.splice(index, 1);
      notices.push({ code: 'unverified-svg', detail: reason });
    }
  }
  // A verified drawing supersedes a competing model-authored one; a failed drawing
  // does not, because then that visual is the only thing the user has left.
  const kept = result.filter(item => !(hasChemistryIntent && chemistryDrawn && item.part === 'svg'));
  const body = kept.map(item => item.text).join('');
  recordChemistryOutcome(execution.question ?? '', notices);
  return notices.map(serializeChemistryNotice).join('') + body;
}

export type { ChatSkillExecution } from './types';
