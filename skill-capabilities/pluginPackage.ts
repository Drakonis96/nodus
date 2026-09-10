import { validateManifest, validateSkillPackage, type SkillPackage } from '../shared/skillMarketplace';
import {
  BUILTIN_CAPABILITY_IDS,
  normalizeCapabilityId,
  validateCapabilityManifest,
  validatePluginManifest,
  type CapabilityManifestV1,
  type CapabilityPermissionSet,
  type PluginPackage,
} from './contracts';

export interface ValidatedPluginPackage {
  manifest: PluginPackage['manifest'];
  files: Record<string, string>;
  skills: Array<{ path: string; package: SkillPackage }>;
  capabilities: Array<{ path: string; manifest: CapabilityManifestV1; source: string }>;
}

const hasUnsafePath = (file: string) => file.includes('\\') || file.startsWith('/') || file.split('/').some(part => !part || part === '.' || part === '..');

export function canonicalPluginCapabilityId(pluginId: string, localId: string): string {
  return `${pluginId}:${localId}`;
}

export function resolvePluginCapabilityReference(pluginId: string, reference: string): string {
  const normalized = normalizeCapabilityId(reference);
  return normalized.startsWith('self:') ? canonicalPluginCapabilityId(pluginId, normalized.slice(5)) : normalized;
}

export function validatePluginPackage(input: PluginPackage): ValidatedPluginPackage {
  const manifest = validatePluginManifest(input?.manifest);
  if (!input.files || typeof input.files !== 'object' || Array.isArray(input.files)) throw new Error('Missing plugin files.');
  if (Object.keys(input.files).some(hasUnsafePath)) throw new Error('Unsafe plugin path.');
  const expected = new Set(['plugin.json']);
  const capabilities: ValidatedPluginPackage['capabilities'] = [];
  const capabilityIds = new Set<string>();
  for (const manifestPath of manifest.capabilities) {
    expected.add(manifestPath);
    const directory = manifestPath.slice(0, -'/capability.json'.length);
    const raw = input.files[manifestPath];
    if (typeof raw !== 'string' || raw.length > 64_000) throw new Error(`Missing or oversized ${manifestPath}.`);
    const capability = validateCapabilityManifest(JSON.parse(raw));
    if (directory.split('/').at(-1) !== capability.id || capabilityIds.has(capability.id)) throw new Error('Capability directory and id must match and be unique.');
    if (capability.version !== manifest.version) throw new Error('Capability versions must match the plugin version.');
    capabilityIds.add(capability.id);
    const entry = `${directory}/${capability.entry}`;
    expected.add(entry);
    const source = input.files[entry];
    if (typeof source !== 'string' || !source.trim() || source.length > 256_000) throw new Error(`Missing or oversized ${entry}.`);
    capabilities.push({ path: manifestPath, manifest: capability, source });
  }
  const skills: ValidatedPluginPackage['skills'] = [];
  for (const manifestPath of manifest.skills) {
    expected.add(manifestPath);
    const directory = manifestPath.slice(0, -'/skill.json'.length);
    const raw = input.files[manifestPath];
    if (typeof raw !== 'string' || raw.length > 64_000) throw new Error(`Missing or oversized ${manifestPath}.`);
    const skillManifest = validateManifest(JSON.parse(raw));
    if (directory.split('/').at(-1) !== skillManifest.id) throw new Error('Skill directory and id must match.');
    if (skillManifest.version !== manifest.version) throw new Error('Skill versions must match the plugin version.');
    const files: Record<string, string> = {};
    for (const relative of ['SKILL.md', ...skillManifest.tools.map(tool => tool.entry)]) {
      const path = `${directory}/${relative}`; expected.add(path);
      if (typeof input.files[path] !== 'string') throw new Error(`Missing ${path}.`);
      files[relative] = input.files[path];
    }
    const localCapabilities = skillManifest.capabilities.filter(capability => normalizeCapabilityId(capability).startsWith('self:'));
    if (localCapabilities.some(capability => !capabilityIds.has(normalizeCapabilityId(capability).slice(5)))) throw new Error('Skill references a capability not supplied by its plugin.');
    if (skillManifest.capabilities.some(capability => {
      const normalized = normalizeCapabilityId(capability);
      return !normalized.startsWith('self:') && !BUILTIN_CAPABILITY_IDS.includes(normalized as typeof BUILTIN_CAPABILITY_IDS[number]);
    })) throw new Error('Plugin v1 cannot depend on another plugin.');
    skills.push({ path: manifestPath, package: validateSkillPackage({ manifest: skillManifest, files }) });
  }
  const actual = Object.keys(input.files);
  if (actual.some(file => !expected.has(file)) || [...expected].some(file => file !== 'plugin.json' && !(file in input.files))) throw new Error('Unexpected or missing plugin file.');
  return { manifest, files: structuredClone(input.files), skills, capabilities };
}

export function mergedPluginPermissions(pkg: ValidatedPluginPackage): CapabilityPermissionSet {
  return {
    network: pkg.capabilities.flatMap(capability => capability.manifest.permissions.network ?? []),
    secrets: pkg.capabilities.flatMap(capability => capability.manifest.permissions.secrets ?? []),
    ...(pkg.capabilities.some(capability => capability.manifest.permissions.storage)
      ? { storage: { maxBytes: pkg.capabilities.reduce((sum, capability) => sum + (capability.manifest.permissions.storage?.maxBytes ?? 0), 0) } }
      : {}),
  };
}

export function permissionsExpand(previous: CapabilityPermissionSet, next: CapabilityPermissionSet): boolean {
  const priorNetworks = new Set((previous.network ?? []).flatMap(endpoint => endpoint.methods.flatMap(method => endpoint.pathPrefixes.map(path => `${endpoint.id}|${endpoint.origin}|${method}|${path}`))));
  const nextNetworks = (next.network ?? []).flatMap(endpoint => endpoint.methods.flatMap(method => endpoint.pathPrefixes.map(path => `${endpoint.id}|${endpoint.origin}|${method}|${path}`)));
  if (nextNetworks.some(permission => !priorNetworks.has(permission))) return true;
  const priorSecrets = new Set((previous.secrets ?? []).map(secret => `${secret.id}|${secret.endpointId}|${secret.header}|${secret.prefix ?? ''}`));
  if ((next.secrets ?? []).some(secret => !priorSecrets.has(`${secret.id}|${secret.endpointId}|${secret.header}|${secret.prefix ?? ''}`))) return true;
  return (next.storage?.maxBytes ?? 0) > (previous.storage?.maxBytes ?? 0);
}
