import { serializeChatVisualPart, skillHasCapability, type ChatSkill } from '../../shared/chatSkills';
import { METERED_CALL_LIMIT, SANDBOXED_CALL_LIMIT, capabilityIsMetered, normalizeCapabilityId, type CapabilityChatResult, type CapabilityInvocation } from '../contracts';
import { resolveInstalledCapability } from '../../electron/skillPlugins';
import { chatAssetVersion, storeCapabilityFile, storeChatImage } from '../../electron/chatAssets';
import { runCapabilitySandbox } from '../sandbox/runtime';
import type { ChatCallBudget, ChatSkillExecution } from '../registry/types';

export function externalCapabilityPrompt(skills: ChatSkill[]): string[] {
  const lines: string[] = [];
  for (const skill of skills) for (const raw of skill.capabilities ?? []) {
    const id = normalizeCapabilityId(raw); if (id.startsWith('nodus:')) continue;
    const runtime = resolveInstalledCapability(id); if (!runtime) continue;
    for (const tool of runtime.manifest.tools) lines.push(`Capability tool ${JSON.stringify({ skillId: skill.id, capabilityId: id, toolId: tool.id, description: tool.description, inputSchema: tool.inputSchema, resultKinds: tool.resultKinds })}`);
  }
  if (lines.length) lines.unshift('EXTERNAL CAPABILITY TOOLS: Invoke one with a fenced nodus-capability JSON block containing skillId, capabilityId, toolId and input. Only listed identifiers are available. The application executes it in an isolated sandbox and renders its validated result. Never claim the result before execution.');
  return lines;
}

export async function executeExternalCapability(content: string, complete: boolean, execution: ChatSkillExecution, budget: ChatCallBudget, signal?: AbortSignal): Promise<string> {
  try {
    if (!complete) throw new Error('The capability request was interrupted. Retry the response.');
    if (content.length > 64_000) throw new Error('Capability request is too large.');
    const invocation = JSON.parse(content) as CapabilityInvocation;
    if (!invocation || typeof invocation.skillId !== 'string' || typeof invocation.capabilityId !== 'string' || typeof invocation.toolId !== 'string' || !('input' in invocation)) throw new Error('Invalid capability request.');
    const skill = execution.skills.find(item => item.id === invocation.skillId), capabilityId = normalizeCapabilityId(invocation.capabilityId);
    if (!skill || capabilityId.startsWith('nodus:') || !skillHasCapability(skill, capabilityId)) throw new Error('This capability is not enabled for this reply.');
    const runtime = resolveInstalledCapability(capabilityId, skill.plugin ? { version: skill.plugin.version, digest: skill.plugin.digest } : undefined); if (!runtime) throw new Error('The capability runtime is unavailable.');
    // The lane is chosen from what this capability actually declared, not from the request.
    if (capabilityIsMetered(runtime.manifest.permissions)) {
      if (++budget.metered > METERED_CALL_LIMIT) throw new Error(`At most ${METERED_CALL_LIMIT} capability calls that use the network, secrets or storage are allowed per reply.`);
    } else if (++budget.sandboxed > SANDBOXED_CALL_LIMIT) throw new Error(`At most ${SANDBOXED_CALL_LIMIT} sandboxed tool and capability calls are allowed per reply.`);
    const result = await runCapabilitySandbox(runtime, { ...invocation, capabilityId }, signal);
    signal?.throwIfAborted();
    if (!execution.isCurrent() || execution.owner && chatAssetVersion(execution.owner) !== execution.version) throw new DOMException('The chat was deleted or changed.', 'AbortError');
    let chatResult: CapabilityChatResult;
    if (result.kind === 'image') {
      if (!execution.owner) throw new Error('Start a saved chat before creating capability assets.');
      const source = storeChatImage(execution.owner, { bytes: Buffer.from(result.data, 'base64'), mimeType: result.mimeType }, { title: result.title, alt: result.alt, provider: runtime.pluginId, model: runtime.manifest.id, createdAt: new Date().toISOString() });
      chatResult = { kind: 'image', source, title: result.title, alt: result.alt };
    } else if (result.kind === 'file') {
      if (!execution.owner) throw new Error('Start a saved chat before creating capability assets.');
      const source = storeCapabilityFile(execution.owner, { bytes: Buffer.from(result.data, 'base64'), mimeType: result.mimeType, name: result.name, title: result.title });
      chatResult = { kind: 'file', source, mimeType: result.mimeType, name: result.name, title: result.title };
    } else chatResult = result;
    return serializeChatVisualPart({ kind: 'capability-result', content: JSON.stringify({ capabilityId, pluginId: runtime.pluginId, result: chatResult }), complete: true });
  } catch (error) {
    if (signal?.aborted || error instanceof Error && error.name === 'AbortError') throw error;
    return `\n\nCapability error: ${String(error instanceof Error ? error.message : error).replace(/[\r\n`*<>[\]]/g, ' ').slice(0, 500)}\n\n`;
  }
}
