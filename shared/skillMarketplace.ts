/** Versioned package contract shared by local authors, repository scanning and installation. */
import { isCapabilityReference, normalizeCapabilityId, type BuiltinCapabilityId, type PluginPackage } from '../skill-capabilities/contracts';
import { REGISTERED_BUILTIN_CAPABILITY_IDS } from '../skill-capabilities/registry/catalog';
export const DEFAULT_SKILL_SOURCE = 'https://github.com/NodusResearch/nodus-research-skill-marketplace';
export const SKILL_CAPABILITIES = ['svg', 'chemistry', 'image', 'genomics', 'legal'] as const;
export type SkillCapability = string;
/** @deprecated UI compatibility. Runtime support is resolved by the capability registry. */
export const SUPPORTED_SKILL_CAPABILITIES: readonly SkillCapability[] = REGISTERED_BUILTIN_CAPABILITY_IDS;
export const unsupportedSkillCapabilities = (capabilities: readonly SkillCapability[]) => capabilities.filter(c => !REGISTERED_BUILTIN_CAPABILITY_IDS.includes(normalizeCapabilityId(c) as BuiltinCapabilityId));
export function assertSkillCapabilitiesSupported(capabilities: readonly SkillCapability[]) {
  const missing = unsupportedSkillCapabilities(capabilities);
  if (missing.length) throw new Error(`This Nodus build does not support these native capabilities: ${missing.join(', ')}. A compatible Nodus build is required.`);
}
export interface SkillTool { id: string; description: string; source: string }
export interface SkillManifest {
  schemaVersion: 1; id: string; name: string; version: string; author: string;
  description: string; category: string; license: string; instructions: 'SKILL.md';
  capabilities: SkillCapability[];
  tools: { id: string; description: string; entry: string; runtime: 'javascript-sandbox' }[];
}
export interface SkillPackage { manifest: SkillManifest; files: Record<string, string> }
export interface MarketplaceEntry { path: string; package: SkillPackage }
export interface PluginMarketplaceEntry { path: string; package: PluginPackage }
export interface SkillSource { id: string; url: string; commit?: string; updatedAt?: string; entries: MarketplaceEntry[]; plugins?: PluginMarketplaceEntry[]; errors: string[] }
export interface SkillMarketplace { version: 1; sources: SkillSource[] }
export const skillSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'my-skill';
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Reject control characters in package text while allowing tabs and line breaks.
// eslint-disable-next-line no-control-regex
const plain = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
export function validateManifest(value: unknown): SkillManifest {
  const m = value as SkillManifest;
  if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).some(k => !['schemaVersion','id','name','version','author','description','category','license','instructions','capabilities','tools'].includes(k))
    || m.schemaVersion !== 1 || !plain(m.id, 64) || !slug.test(m.id) || !plain(m.name, 80)
    || !plain(m.description, 500) || !plain(m.category, 60) || !plain(m.license, 80)
    || !plain(m.author, 39) || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(m.author)
    || !/^\d+\.\d+\.\d+$/.test(m.version) || m.instructions !== 'SKILL.md'
    || !Array.isArray(m.capabilities) || m.capabilities.some(c => !isCapabilityReference(c)) || new Set(m.capabilities.map(normalizeCapabilityId)).size !== m.capabilities.length
    || !Array.isArray(m.tools) || m.tools.length > 12) throw new Error('Invalid skill.json: use the Nodus skill package v1 format.');
  const ids = new Set<string>();
  for (const tool of m.tools) {
    if (!tool || Object.keys(tool).some(k => !['id','description','entry','runtime'].includes(k)) || !plain(tool.id, 64) || !slug.test(tool.id) || ids.has(tool.id)
      || !plain(tool.description, 500) || tool.runtime !== 'javascript-sandbox' || tool.entry !== `tools/${tool.id}.js`) throw new Error('Invalid tool: use a unique id and tools/<id>.js with javascript-sandbox runtime.');
    ids.add(tool.id);
  }
  return structuredClone(m);
}
export function validateSkillPackage(value: SkillPackage): SkillPackage {
  const manifest = validateManifest(value?.manifest);
  if (!value.files || typeof value.files !== 'object' || Array.isArray(value.files)) throw new Error('Missing skill files.');
  const expected = ['SKILL.md', ...manifest.tools.map(t => t.entry)];
  if (Object.keys(value.files).some(f => !expected.includes(f))) throw new Error('Unexpected package file.');
  const files: Record<string, string> = {};
  for (const file of expected) {
    const source = value.files[file];
    if (!plain(source, file === 'SKILL.md' ? 16000 : 64000)) throw new Error(`Missing or oversized ${file}.`);
    files[file] = source;
  }
  return { manifest, files };
}
export function normalizeSkillSource(input: string): { id: string; url: string; owner: string; repo: string } {
  const url = new URL(input.trim());
  const match = /^\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9_.-]+)\/?$/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || !match) throw new Error('Enter a GitHub repository URL: https://github.com/owner/repository');
  const owner = match[1], repo = match[2].replace(/\.git$/, '');
  if (repo === '.' || repo === '..') throw new Error('Invalid repository.');
  return { id: `${owner}/${repo}`.toLowerCase(), url: `https://github.com/${owner}/${repo}`, owner, repo };
}
