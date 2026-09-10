export const CAPABILITY_API_VERSION = 1 as const;
export const BUILTIN_CAPABILITY_IDS = [
  'nodus:svg',
  'nodus:chemistry',
  'nodus:image',
  'nodus:genomics',
  'nodus:legal',
] as const;

export type BuiltinCapabilityId = typeof BUILTIN_CAPABILITY_IDS[number];
export type CapabilityId = BuiltinCapabilityId | `self:${string}` | `${string}:${string}`;
export type CapabilityResultKind = 'text' | 'json' | 'table' | 'svg' | 'image' | 'file';

const LEGACY_CAPABILITIES: Record<string, BuiltinCapabilityId> = {
  svg: 'nodus:svg', chemistry: 'nodus:chemistry', image: 'nodus:image',
  genomics: 'nodus:genomics', legal: 'nodus:legal',
};

export function normalizeCapabilityId(id: string): string {
  return LEGACY_CAPABILITIES[id] ?? id;
}

export function legacyCapabilityId(id: string): string {
  const found = Object.entries(LEGACY_CAPABILITIES).find(([, canonical]) => canonical === id);
  return found?.[0] ?? id;
}

export function isCapabilityReference(value: unknown): value is CapabilityId {
  if (typeof value !== 'string' || value.length > 160) return false;
  if (value in LEGACY_CAPABILITIES || BUILTIN_CAPABILITY_IDS.includes(value as BuiltinCapabilityId)) return true;
  return /^self:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    || /^[a-z0-9]+(?:[./-][a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export interface JsonSchema {
  type?: 'null' | 'boolean' | 'number' | 'integer' | 'string' | 'array' | 'object';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number | boolean | null>;
  additionalProperties?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

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
  | { kind: 'file'; mimeType: string; data: string; name: string; title?: string };

export type CapabilityChatResult =
  | Exclude<CapabilityResult, { kind: 'image' | 'file' }>
  | { kind: 'image'; source: string; title: string; alt: string }
  | { kind: 'file'; source: string; mimeType: string; name: string; title?: string };

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

export interface CapabilityRegistryEntry {
  id: string;
  version: string;
  description: string;
  source: 'builtin' | 'plugin';
  pluginId?: string;
  tools: Array<{ id: string; description: string }>;
}

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semver = /^\d+\.\d+\.\d+$/;
// eslint-disable-next-line no-control-regex -- plugin manifests are hostile input
const plain = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
const exactKeys = (value: object, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));

function validateJsonSchema(schema: unknown, depth = 0): asserts schema is JsonSchema {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 8) throw new Error('Invalid capability JSON schema.');
  const value = schema as JsonSchema;
  if (!exactKeys(value, ['type','properties','required','items','enum','additionalProperties','minLength','maxLength','minimum','maximum'])) throw new Error('Invalid capability JSON schema.');
  if (value.type && !['null','boolean','number','integer','string','array','object'].includes(value.type)) throw new Error('Invalid capability JSON schema type.');
  if (value.properties) {
    if (value.type !== 'object' || Object.keys(value.properties).length > 64) throw new Error('Invalid capability object schema.');
    for (const [key, child] of Object.entries(value.properties)) { if (!slug.test(key)) throw new Error('Invalid capability schema property.'); validateJsonSchema(child, depth + 1); }
  }
  if (value.required && (!Array.isArray(value.required) || value.required.some(key => typeof key !== 'string' || !value.properties?.[key]))) throw new Error('Invalid capability required properties.');
  if (value.items) { if (value.type !== 'array') throw new Error('Invalid capability array schema.'); validateJsonSchema(value.items, depth + 1); }
  if (value.enum && (!Array.isArray(value.enum) || value.enum.length > 100)) throw new Error('Invalid capability enum.');
}

export function validateCapabilityManifest(input: unknown): CapabilityManifestV1 {
  const value = input as CapabilityManifestV1;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !exactKeys(value, ['schemaVersion','id','version','description','runtime','entry','tools','permissions'])
    || value.schemaVersion !== 1 || !slug.test(value.id) || !semver.test(value.version)
    || !plain(value.description, 500) || value.runtime !== 'javascript-sandbox-v1' || value.entry !== 'runtime.js'
    || !Array.isArray(value.tools) || !value.tools.length || value.tools.length > 12
    || !value.permissions || typeof value.permissions !== 'object' || Array.isArray(value.permissions)
    || !exactKeys(value.permissions, ['network','secrets','storage'])) throw new Error('Invalid capability.json.');
  const ids = new Set<string>();
  for (const tool of value.tools) {
    if (!tool || !exactKeys(tool, ['id','description','inputSchema','resultKinds']) || !slug.test(tool.id) || ids.has(tool.id)
      || !plain(tool.description, 500) || !Array.isArray(tool.resultKinds) || !tool.resultKinds.length
      || tool.resultKinds.some(kind => !['text','json','table','svg','image','file'].includes(kind))) throw new Error('Invalid capability tool.');
    validateJsonSchema(tool.inputSchema); ids.add(tool.id);
  }
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

export function compareSemver(a: string, b: string): number {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export function jsonSchemaMatches(schema: JsonSchema, value: unknown): boolean {
  if (schema.enum && !schema.enum.some(item => Object.is(item, value))) return false;
  if (!schema.type) return true;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'string') return typeof value === 'string' && (schema.minLength === undefined || value.length >= schema.minLength) && (schema.maxLength === undefined || value.length <= schema.maxLength);
  if (schema.type === 'number' || schema.type === 'integer') return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isInteger(value)) && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
  if (schema.type === 'array') return Array.isArray(value) && (!schema.items || value.every(item => jsonSchemaMatches(schema.items!, item)));
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (schema.required?.some(key => !(key in record))) return false;
    if (schema.additionalProperties === false && Object.keys(record).some(key => !schema.properties?.[key])) return false;
    return Object.entries(schema.properties ?? {}).every(([key, child]) => !(key in record) || jsonSchemaMatches(child, record[key]));
  }
  return false;
}
