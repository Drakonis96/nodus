export const CAPABILITY_API_VERSION = 1 as const;

// Identifiers and the JSON Schema subset live in the capability SDK: v1 and v2 must agree
// about what a capability id is and what a tool may declare, so there is one implementation.
export {
  NODUS_CAPABILITY_IDS as BUILTIN_CAPABILITY_IDS,
  normalizeCapabilityId,
  legacyCapabilityId,
  isCapabilityReference,
} from '../packages/capability-api/src/identifiers';
export type { NodusCapabilityId as BuiltinCapabilityId, CapabilityId } from '../packages/capability-api/src/identifiers';
export { jsonSchemaMatches, compareSemver } from '../packages/capability-api/src/json';
export type { JsonSchema } from '../packages/capability-api/src/json';

import { validatePluginAssets } from '../packages/capability-api/src/pluginAssets';
import { SEMVER as semver, SLUG as slug, exactKeys, plainText, validateJsonSchema, type JsonSchema } from '../packages/capability-api/src/json';

export type CapabilityResultKind = 'text' | 'json' | 'table' | 'svg' | 'image' | 'file' | 'model';
export type { PluginAsset } from '../packages/capability-api/src/pluginAssets';

export interface CapabilityNetworkPermission {
  id: string;
  origin: string;
  pathPrefixes: string[];
  methods: Array<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>;
}

export interface CapabilitySecretPermission {
  id: string;
  label: string;
  required: boolean;
  endpointId: string;
  header: string;
  prefix?: string;
}

export interface CapabilityPermissionSet {
  network?: CapabilityNetworkPermission[];
  secrets?: CapabilitySecretPermission[];
  storage?: { maxBytes: number };
}

export interface CapabilityToolManifest {
  id: string;
  description: string;
  inputSchema: JsonSchema;
  resultKinds: CapabilityResultKind[];
}

export interface CapabilityManifestV1 {
  schemaVersion: 1;
  id: string;
  version: string;
  description: string;
  runtime: 'javascript-sandbox-v1';
  entry: 'runtime.js';
  tools: CapabilityToolManifest[];
  permissions: CapabilityPermissionSet;
  assets?: import('../packages/capability-api/src/pluginAssets').PluginAsset[];
}

export interface PluginManifestV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  license: string;
  compatibility: { capabilityApi: 1; minNodusVersion: string };
  skills: string[];
  capabilities: string[];
}

export interface PluginPackage {
  manifest: PluginManifestV1;
  files: Record<string, string>;
}

export interface CapabilityInvocation {
  skillId: string;
  capabilityId: string;
  toolId: string;
  input: unknown;
}

export type CapabilityResult =
  | { kind: 'text'; text: string }
  | { kind: 'json'; value: unknown }
  | { kind: 'table'; columns: string[]; rows: Array<Array<string | number | boolean | null>> }
  | { kind: 'svg'; svg: string; title?: string }
  | { kind: 'image'; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string; title: string; alt: string }
  | { kind: 'file'; mimeType: string; data: string; name: string; title?: string }
  | { kind: 'model'; panels: Array<{ assetId: string; nodeIds: string[]; title: string; alt: string }>; metadata: unknown };

export type CapabilityChatResult =
  | Exclude<CapabilityResult, { kind: 'image' | 'file' | 'model' }>
  | { kind: 'image'; source: string; title: string; alt: string }
  | { kind: 'file'; source: string; mimeType: string; name: string; title?: string }
  | { kind: 'model'; panels: Array<{ source: string; title: string; alt: string; bytes: number; name: string; mimeType: 'model/gltf+json' | 'model/gltf-binary' }>; metadata: unknown };

export interface InstalledPluginState {
  id: string;
  sourceId: string;
  sourcePath?: string;
  sourceCommit?: string;
  activeVersion: string;
  activeDigest: string;
  previousVersion?: string;
  previousDigest?: string;
  autoUpdate: boolean;
  approvedPermissions: CapabilityPermissionSet;
  pendingVersion?: string;
  pendingDigest?: string;
  pendingReason?: 'permissions' | 'incompatible' | 'invalid';
  installedAt: string;
  updatedAt: string;
}

export interface InstalledPluginSummary extends InstalledPluginState {
  name: string;
  description: string;
  skills: string[];
  capabilities: string[];
  secrets: Array<{ capabilityId: string; id: string; label: string; required: boolean; configured: boolean }>;
}

export interface InboxPluginSummary {
  directory: string;
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  skills: number;
  capabilities: number;
  /** Already installed under this id, so approving it is an update rather than a new install. */
  installed: boolean;
  permissions: CapabilityPermissionSet;
}

/** Two lanes, because two very different costs were sharing one number. A JavaScript tool
 *  and a capability that declares no permissions are deterministic, local and free: they
 *  cannot reach the network, read a secret or persist anything, so the only thing a caller
 *  spends is CPU. A capability that declares any permission can leave the machine, spend the
 *  user's API quota and touch stored state, so it keeps the strict budget. */
export const SANDBOXED_CALL_LIMIT = 16;
export const METERED_CALL_LIMIT = 4;

/** A capability is metered when it declares anything that reaches beyond its own sandbox. */
export function capabilityIsMetered(permissions: CapabilityPermissionSet): boolean {
  return Boolean(permissions.network?.length || permissions.secrets?.length || permissions.storage);
}

export interface CapabilityRegistryEntry {
  id: string;
  version: string;
  description: string;
  source: 'builtin' | 'plugin';
  pluginId?: string;
  tools: Array<{ id: string; description: string }>;
}

const plain = (value: unknown, max: number) => plainText(value, max);

export function validateCapabilityManifest(input: unknown): CapabilityManifestV1 {
  const value = input as CapabilityManifestV1;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !exactKeys(value, ['schemaVersion','id','version','description','runtime','entry','tools','permissions','assets'])
    || value.schemaVersion !== 1 || !slug.test(value.id) || !semver.test(value.version)
    || !plain(value.description, 500) || value.runtime !== 'javascript-sandbox-v1' || value.entry !== 'runtime.js'
    || !Array.isArray(value.tools) || !value.tools.length || value.tools.length > 12
    || !value.permissions || typeof value.permissions !== 'object' || Array.isArray(value.permissions)
    || !exactKeys(value.permissions, ['network','secrets','storage'])) throw new Error('Invalid capability.json.');
  const ids = new Set<string>();
  for (const tool of value.tools) {
    if (!tool || !exactKeys(tool, ['id','description','inputSchema','resultKinds']) || !slug.test(tool.id) || ids.has(tool.id)
      || !plain(tool.description, 500) || !Array.isArray(tool.resultKinds) || !tool.resultKinds.length
      || tool.resultKinds.some(kind => !['text','json','table','svg','image','file','model'].includes(kind))) throw new Error('Invalid capability tool.');
    validateJsonSchema(tool.inputSchema); ids.add(tool.id);
  }
  validatePluginAssets(value.assets);
  for (const endpoint of value.permissions.network ?? []) {
    let url: URL; try { url = new URL(endpoint.origin); } catch { throw new Error('Invalid capability network origin.'); }
    if (!slug.test(endpoint.id) || url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password
      || !Array.isArray(endpoint.pathPrefixes) || !endpoint.pathPrefixes.length || endpoint.pathPrefixes.some(prefix => !prefix.startsWith('/') || prefix.includes('..'))
      || !Array.isArray(endpoint.methods) || !endpoint.methods.length || endpoint.methods.some(method => !['GET','POST','PUT','PATCH','DELETE'].includes(method))) throw new Error('Invalid capability network permission.');
  }
  for (const secret of value.permissions.secrets ?? []) {
    if (!slug.test(secret.id) || !plain(secret.label, 80) || typeof secret.required !== 'boolean' || !slug.test(secret.endpointId)
      || !/^[A-Za-z0-9-]{1,80}$/.test(secret.header) || (secret.prefix !== undefined && typeof secret.prefix !== 'string')) throw new Error('Invalid capability secret permission.');
    if (!(value.permissions.network ?? []).some(endpoint => endpoint.id === secret.endpointId)) throw new Error('Capability secret references an unknown endpoint.');
  }
  if (value.permissions.storage && (!Number.isInteger(value.permissions.storage.maxBytes) || value.permissions.storage.maxBytes < 1024 || value.permissions.storage.maxBytes > 5_000_000)) throw new Error('Invalid capability storage quota.');
  return structuredClone(value);
}

export function validatePluginManifest(input: unknown): PluginManifestV1 {
  const value = input as PluginManifestV1;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !exactKeys(value, ['schemaVersion','id','name','version','author','description','license','compatibility','skills','capabilities'])
    || value.schemaVersion !== 1 || !slug.test(value.id) || !plain(value.name, 80) || !semver.test(value.version)
    || !plain(value.author, 80) || !plain(value.description, 500) || !plain(value.license, 80)
    || !value.compatibility || value.compatibility.capabilityApi !== CAPABILITY_API_VERSION || !semver.test(value.compatibility.minNodusVersion)
    || !Array.isArray(value.skills) || !value.skills.length || value.skills.length > 40
    || !Array.isArray(value.capabilities) || value.capabilities.length > 20) throw new Error('Invalid plugin.json.');
  const expectedSkills = new Set<string>(), expectedCapabilities = new Set<string>();
  for (const file of value.skills) {
    const match = /^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/skill\.json$/.exec(file);
    if (!match || expectedSkills.has(file)) throw new Error('Invalid plugin skill path.'); expectedSkills.add(file);
  }
  for (const file of value.capabilities) {
    const match = /^capabilities\/([a-z0-9]+(?:-[a-z0-9]+)*)\/capability\.json$/.exec(file);
    if (!match || expectedCapabilities.has(file)) throw new Error('Invalid plugin capability path.'); expectedCapabilities.add(file);
  }
  return structuredClone(value);
}
