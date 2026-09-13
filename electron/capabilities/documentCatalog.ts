import { listChatSkills, deriveCapabilityTools } from '../chatSkills';
import { skillHasCapability } from '../../shared/chatSkills';
import { normalizeCapabilityId } from '../../skill-capabilities/contracts';
import { installedCapabilityAvailable } from '../skillPlugins';
import type { DocumentSkillOption, SkillBilling } from '../../shared/documentSkills';

/** Describes installed resources; never mutates the assistant's activation settings. */
export function listDocumentSkills(): DocumentSkillOption[] {
  return listChatSkills().flatMap(original => {
    if (!original.capabilities?.length && !['svg', 'image'].includes(original.builtin ?? '')) return [];
    const skill = { ...original, capabilityTools: deriveCapabilityTools(original) };
    const available = (skill.capabilities ?? []).every(id => installedCapabilityAvailable(normalizeCapabilityId(id)));
    // Image Atelier is the only document Skill billed per generated resource. Every other
    // Skill keeps the optional ceiling of SVG Studio, whatever its capability tools declare.
    const billing: SkillBilling = skillHasCapability(skill, 'image') ? 'per-call' : 'none';
    return [{ skill, available, billing, ...(!available ? { reason: 'This skill is unavailable.' } : {}) }];
  });
}
