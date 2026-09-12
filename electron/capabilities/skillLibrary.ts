import { randomUUID } from 'node:crypto';
import type { ChatSkill } from '@shared/chatSkills';
import { normalizeCapabilityId } from '../../skill-capabilities/contracts';
import { listChatSkills, replaceChatSkills } from '../chatSkills';
import { readTrustedPluginSkills } from './bundledSkills';

/** Installing a signed v2 package adds every bundled workflow to My skills. Legacy
 * migration is a separate operation; new packages must not depend on having an old
 * built-in to adopt. The library is written only after the entire package validates. */
export function materializeTrustedPluginSkills(pluginId: string): ChatSkill[] {
  const library = listChatSkills();
  const trusted = readTrustedPluginSkills(pluginId);
  if (!trusted) return library;
  const { state, pkg, packaged } = trusted;
  const next = [...library];
  for (const item of packaged) {
    const m = item.manifest;
    // Older adopted disciplines had no per-Skill package id. A single-workflow
    // package can adopt that record without duplicating it or losing edited text.
    const existing = next.find(skill => skill.plugin?.id === pluginId && skill.origin?.packageId === m.id)
      ?? (packaged.length === 1 ? next.find(skill => skill.plugin?.id === pluginId && !skill.origin?.packageId) : undefined);
    const capabilities = m.capabilities.map(reference => {
      if (!reference.startsWith('self:')) return normalizeCapabilityId(reference);
      const own = pkg.capabilities.find(capability => capability.manifest.id === reference.slice(5));
      if (!own) throw new Error('Bundled Skill requires an undeclared package capability.');
      return own.manifest.provides;
    });
    const overlay = existing?.overrides ?? {};
    const skill: ChatSkill = {
      id: existing?.id ?? randomUUID(), name: overlay.name ?? m.name,
      description: overlay.description ?? m.description, instructions: overlay.instructions ?? item.files['SKILL.md'],
      author: m.author, category: m.category, version: m.version, license: m.license, capabilities,
      tools: m.tools.map(tool => ({ id: tool.id, description: tool.description, source: item.files[tool.entry] })),
      enabled: existing?.enabled ?? { assistant: false, nodi: false },
      plugin: { id: pluginId, version: state.active!.version, digest: state.active!.digest },
      origin: { sourceId: state.source.id, path: state.source.path, commit: state.source.commit, packageId: m.id, version: m.version, digest: state.active!.digest },
      ...(Object.keys(overlay).length ? { overrides: overlay } : {}),
    };
    const index = next.findIndex(candidate => candidate.id === skill.id);
    if (index < 0) next.push(skill); else next[index] = skill;
  }
  return replaceChatSkills(next);
}
