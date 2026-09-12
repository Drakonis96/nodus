import { listChatSkills, deriveCapabilityTools } from '../chatSkills';
import { skillHasCapability } from '../../shared/chatSkills';
import { normalizeCapabilityId } from '../../skill-capabilities/contracts';
import { installedCapabilityAvailable } from '../skillPlugins';
import { capabilityRegistry } from './registry';
import type { DocumentSkillOption, SkillBilling } from '../../shared/documentSkills';

/** Describes installed resources; never mutates the assistant's activation settings. */
export function listDocumentSkills(): DocumentSkillOption[] {
  const registry = capabilityRegistry();
  return listChatSkills().flatMap(original => {
    if (!original.capabilities?.length && !['svg', 'image'].includes(original.builtin ?? '')) return [];
    const skill = { ...original, capabilityTools: deriveCapabilityTools(original) };
    const available = (skill.capabilities ?? []).every(id => installedCapabilityAvailable(normalizeCapabilityId(id)));
    let billing: SkillBilling = 'unknown';
    if (skillHasCapability(skill, 'image')) billing = 'per-call';
    else if (skill.builtin === 'svg') billing = 'none';
    else {
      const tools = (skill.capabilities ?? []).flatMap(id => registry.providers.get(normalizeCapabilityId(id))?.tools ?? []);
      if (tools.length) billing = tools.some(tool => tool.billing === 'per-call') ? 'per-call' : tools.every(tool => tool.billing === 'none') ? 'none' : 'unknown';
    }
    return [{ skill, available, billing, ...(!available ? { reason: 'This skill is unavailable.' } : {}) }];
  });
}
