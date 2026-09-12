import { createChatVisionSession } from '../../electron/capabilities/vision/adapter';
import type { VisionSession } from '../../electron/capabilities/vision/service';
import { executeVisionCapability } from '../builtins/vision/main';
import { chatAssetVersion } from '../../electron/chatAssets';
import { runSkillTool } from '../../electron/skillToolSandbox';
import { serializeChatVisualPart, splitChatVisuals, type ChatVisualPart } from '../../shared/chatSkills';
import { executeImageRequest } from '../builtins/image/main';
import { refineSvg } from '../builtins/svg/main';
import { createChatMapService, executeMapCapability } from '../builtins/maps/main';
import { executeExternalCapability } from '../external/main';
import { SANDBOXED_CALL_LIMIT } from '../contracts';
import { capabilityRegistry, pinCapabilitiesForTurn } from '../../electron/capabilities/registry';
import { runTrustedChatPipeline } from '../../electron/capabilities/chatPipeline';
import { createTrustedCapabilityRunner } from '../../electron/capabilities/runner';
import type { ChatCallBudget, ChatSkillExecution } from './types';

export function assertChatSkillSession(execution: ChatSkillExecution, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  if (!execution.isCurrent() || (execution.owner && chatAssetVersion(execution.owner) !== execution.version)) {
    throw new DOMException('The chat was deleted or changed.', 'AbortError');
  }
}

/** Provider-independent registry dispatcher shared by every chat surface.
 *
 *  What the core still does itself is what belongs to no discipline: JavaScript tools,
 *  sandboxed community capabilities, image generation and the general SVG lane. Chemistry,
 *  law and genomics are installed packages now and reach a reply through the protocols
 *  they declare — this file does not know their names. */
export async function executeRegisteredChatSkills(answer: string, execution: ChatSkillExecution, signal?: AbortSignal): Promise<string> {
  // Only execution can create result envelopes. This gate runs before any trusted
  // hook or core tool, so their genuine outputs are not mistaken for authored claims.
  answer = splitChatVisuals(answer).map(part => ['capability-result','capability-view','capability-artifact'].includes(part.kind)
    ? '\n\nCapability error: model-authored capability results are not accepted.\n\n'
    : serializeChatVisualPart(part)).join('');
  const registry = execution.registry ?? capabilityRegistry();
  const vision = createChatVisionSession({...execution,signal,current:()=>assertChatSkillSession(execution,signal)});
  if (!registry.chatOrder.length) {
    try { return await runCoreChatStages(answer, execution, { suppressSvgRefinement: false }, signal, vision); }
    finally { vision.dispose(); }
  }
  const runner = createTrustedCapabilityRunner({
    vision,
    owner: execution.owner,
    question: execution.question,
    locale: execution.locale ?? 'en',
    model: execution.model,
    pins: execution.pins ?? pinCapabilitiesForTurn(),
    beforeInvoke: execution.beforeInvoke,
    beforePaidCall: execution.beforePaidCall,
    beforeRepair: execution.beforeRepair,
    renderStoredArtifacts: execution.renderStoredArtifacts,
    signal,
    runCoreStages: (text, options) => runCoreChatStages(text, execution, options, signal, vision),
  });
  try { return await runTrustedChatPipeline(answer, registry, runner, { signal }); }
  finally { vision.dispose(); await runner.dispose?.(); }
}

/** The stages the application owns. Nothing here is specific to a field of study. */
export async function runCoreChatStages(answer: string, execution: ChatSkillExecution, options: { suppressSvgRefinement: boolean }, signal?: AbortSignal, vision?: VisionSession): Promise<string> {
  const current = () => assertChatSkillSession(execution, signal);
  current();

  // Deterministic sandboxed work and work that can leave the machine are budgeted apart:
  // a permissionless capability costs the same as a JavaScript tool, and only a capability
  // that declares network, secrets or storage is charged to the strict lane.
  const budget: ChatCallBudget = { sandboxed: 0, metered: 0 };
  const maps = createChatMapService(budget);
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
      execution.beforeInvoke?.();
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

  // Skipped only when an installed provider said it has taken the drawing lane for this
  // reply, so the core does not second-guess a package that is already drawing.
  if (!options.suppressSvgRefinement) answer = await refineSvg(answer, execution, signal);

  const result: Array<{ part: ChatVisualPart['kind']; text: string }> = [];
  let imageRequested = false;
  for (const part of splitChatVisuals(answer)) {
    if (part.kind === 'capability-result') {
      result.push({ part: part.kind, text: '\n\nCapability error: model-authored capability results are not accepted.\n\n' });
      continue;
    }
    if (part.kind === 'capability-request') {
      let visionRequest = false;
      try { visionRequest = JSON.parse(part.content)?.capabilityId === 'nodus:vision'; } catch { /* normal validation below */ }
      if (visionRequest && vision) {
        result.push({part:part.kind,text:await executeVisionCapability(part.content,part.complete,execution,vision,signal)});
        continue;
      }
      let mapsRequest = false;
      try { mapsRequest = JSON.parse(part.content)?.capabilityId === 'nodus:maps'; } catch { /* normal validation reports malformed requests */ }
      result.push({ part: part.kind, text: mapsRequest ? await executeMapCapability(part.content, part.complete, execution, budget, maps, signal) : await executeExternalCapability(part.content, part.complete, execution, budget, signal) });
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
  return result.map(item => item.text).join('');
}

export type { ChatSkillExecution } from './types';
