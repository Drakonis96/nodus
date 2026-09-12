import { CAPABILITY_API_V2, LIMITS, TRUSTED_PROTOCOL, TRUSTED_PUBLISHER, TRUSTED_RUNTIME } from './limits';
import { SEMVER, SLUG, exactKeys, plainText, validateJsonSchema, type JsonSchema } from './json';
import { isCoreCapabilityId, isNodusCapabilityId, isReservedCapabilityId, type CapabilityId } from './identifiers';
import { validateTrustedPermissions, type TrustedPermissionSetV2 } from './permissions';
import { validateChatContract, type AnswerMode, type CapabilityChatContractV2 } from './chat';
import { validateArtifactTypeManifest, type ArtifactTypeManifestV1 } from './artifacts';
import { validateSettingsManifest, type SettingsManifestV1 } from './settings';

export type PluginPlatform = 'darwin' | 'win32' | 'linux';
export type PluginArch = 'x64' | 'arm64';
/** `any` is a pure-JavaScript bundle; everything else ships native or runtime-specific bytes. */
export type PluginTarget = 'any' | `${PluginPlatform}-${PluginArch}`;

export interface CapabilityToolV2 {
  id: string;
  description: string;
  inputSchema: JsonSchema;
  /** Artifact types this tool is allowed to produce. An undeclared type is rejected. */
  artifactTypes: string[];
  timeoutMs: number;
  /** How many invocations of this tool may run at once inside one worker. */
  concurrency: number;
  maxPerReply: number;
  answerMode: AnswerMode;
  /** True when the tool can reach the network or spend the conversation's model quota. */
  metered: boolean;
}

export interface CapabilityManifestV2 {
  schemaVersion: 2;
  id: string;
  provides: CapabilityId;
  version: string;
  description: string;
  runtime: { kind: typeof TRUSTED_RUNTIME; protocol: typeof TRUSTED_PROTOCOL; entry: string };
  requires: Array<{ id: CapabilityId; minVersion: string; maxVersionExclusive: string }>;
  tools: CapabilityToolV2[];
  chat?: CapabilityChatContractV2;
  artifacts: ArtifactTypeManifestV1[];
  settings?: SettingsManifestV1;
  permissions: TrustedPermissionSetV2;
}

export interface PluginManifestV2 {
  schemaVersion: 2;
  id: string;
  name: string;
  version: string;
  author: typeof TRUSTED_PUBLISHER;
  description: string;
  license: string;
  publisher: { id: typeof TRUSTED_PUBLISHER; keyId: string };
  compatibility: { capabilityApi: typeof CAPABILITY_API_V2; minNodusVersion: string; targets: PluginTarget[] };
  /** Built-in skill ids this package takes over from. The migration uses this list. */
  replacesSkills: string[];
  skills: string[];
  capabilities: string[];
  migrations: string[];
}

const TARGET = /^(?:any|(?:darwin|win32|linux)-(?:x64|arm64))$/;
const ENTRY = /^[a-z0-9][a-z0-9./-]{0,120}\.(?:js|cjs|mjs)$/;
const KEY_ID = /^[a-z0-9]{4,32}$/;

export function validateCapabilityManifestV2(input: unknown): CapabilityManifestV2 {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !exactKeys(input, ['schemaVersion', 'id', 'provides', 'version', 'description', 'runtime', 'requires', 'tools', 'chat', 'artifacts', 'settings', 'permissions'])
    && !exactKeys(input, ['schemaVersion', 'id', 'provides', 'version', 'description', 'runtime', 'requires', 'tools', 'artifacts', 'permissions'])
    && !exactKeys(input, ['schemaVersion', 'id', 'provides', 'version', 'description', 'runtime', 'requires', 'tools', 'chat', 'artifacts', 'permissions'])
    && !exactKeys(input, ['schemaVersion', 'id', 'provides', 'version', 'description', 'runtime', 'requires', 'tools', 'artifacts', 'settings', 'permissions'])) throw new Error('Invalid capability.json.');
  const value = input as CapabilityManifestV2;
  if (value.schemaVersion !== 2 || !SLUG.test(value.id) || !SEMVER.test(value.version) || !plainText(value.description, 500)) throw new Error('Invalid capability.json.');

  // A capability provides either one of the three reserved ids or its own plugin-namespaced
  // one. `nodus:svg` and `nodus:image` belong to the core and can only ever be depended on.
  if (typeof value.provides !== 'string' || isCoreCapabilityId(value.provides)) throw new Error('A plugin cannot provide a core capability.');
  // `nodus:` is a reserved namespace, so an unknown id in it is a mistake or a squat,
  // never a community capability that happens to be called that.
  if (!isReservedCapabilityId(value.provides)
    && (value.provides.startsWith('nodus:') || !/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.provides))) throw new Error('Invalid capability provides identifier.');

  if (!value.runtime || !exactKeys(value.runtime, ['kind', 'protocol', 'entry'])
    || value.runtime.kind !== TRUSTED_RUNTIME || value.runtime.protocol !== TRUSTED_PROTOCOL
    || typeof value.runtime.entry !== 'string' || !ENTRY.test(value.runtime.entry) || value.runtime.entry.includes('..')) throw new Error('Invalid capability runtime.');

  if (!Array.isArray(value.requires) || value.requires.length > 8) throw new Error('Invalid capability requirements.');
  const required = new Set<string>();
  for (const requirement of value.requires) {
    if (!requirement || !exactKeys(requirement, ['id', 'minVersion', 'maxVersionExclusive'])
      || typeof requirement.id !== 'string' || required.has(requirement.id)
      || !SEMVER.test(requirement.minVersion) || !SEMVER.test(requirement.maxVersionExclusive)) throw new Error('Invalid capability requirement.');
    if (requirement.id === value.provides) throw new Error('A capability cannot require itself.');
    required.add(requirement.id);
  }

  const artifacts = (Array.isArray(value.artifacts) ? value.artifacts : []).map(validateArtifactTypeManifest);
  if (!Array.isArray(value.artifacts) || artifacts.length > 24) throw new Error('Invalid capability artifact types.');
  const artifactTypes = new Set(artifacts.map(artifact => artifact.type));
  if (artifactTypes.size !== artifacts.length) throw new Error('Duplicate capability artifact type.');

  if (!Array.isArray(value.tools) || !value.tools.length || value.tools.length > LIMITS.toolsPerCapability) throw new Error('Invalid capability tools.');
  const toolIds = new Set<string>();
  const tools = value.tools.map(tool => {
    if (!tool || !exactKeys(tool, ['id', 'description', 'inputSchema', 'artifactTypes', 'timeoutMs', 'concurrency', 'maxPerReply', 'answerMode', 'metered'])
      || !SLUG.test(tool.id) || toolIds.has(tool.id) || !plainText(tool.description, 500)
      || !Array.isArray(tool.artifactTypes) || tool.artifactTypes.some(type => !artifactTypes.has(type))
      || !Number.isInteger(tool.timeoutMs) || tool.timeoutMs < LIMITS.toolTimeoutMsMin || tool.timeoutMs > LIMITS.toolTimeoutMsMax
      || !Number.isInteger(tool.concurrency) || tool.concurrency < 1 || tool.concurrency > 8
      || !Number.isInteger(tool.maxPerReply) || tool.maxPerReply < 1 || tool.maxPerReply > LIMITS.chatFenceMaxPerReply
      || !['replace-block', 'replace-answer'].includes(tool.answerMode)
      || typeof tool.metered !== 'boolean') throw new Error('Invalid capability tool.');
    validateJsonSchema(tool.inputSchema);
    toolIds.add(tool.id);
    return structuredClone(tool);
  });

  const permissions = validateTrustedPermissions(value.permissions);
  const chat = value.chat === undefined ? undefined : validateChatContract(value.chat);
  if (chat) {
    for (const protocol of chat.requestProtocols) {
      const tool = tools.find(candidate => candidate.id === protocol.toolId);
      if (!tool) throw new Error(`Chat protocol ${protocol.fence} names an unknown tool.`);
      // One fence, one behaviour: the declared answer mode must agree in both places, or
      // the pipeline stage a request runs in would depend on which file you read.
      if (tool.answerMode !== protocol.answerMode) throw new Error(`Chat protocol ${protocol.fence} disagrees with its tool's answer mode.`);
      if (protocol.maxPerReply > tool.maxPerReply) throw new Error(`Chat protocol ${protocol.fence} exceeds its tool's per-reply limit.`);
    }
    for (const legacy of chat.legacyResults) {
      if (!artifactTypes.has(legacy.artifactType)) throw new Error(`Legacy result ${legacy.fence} names an undeclared artifact type.`);
    }
  }
  const settings = value.settings === undefined ? undefined : validateSettingsManifest(value.settings);
  if (settings) {
    const declaredSecrets = new Set((permissions.secrets ?? []).map(secret => secret.id));
    for (const field of settings.fields) {
      if (field.kind === 'secret' && !declaredSecrets.has(field.id)) throw new Error(`Settings secret ${field.id} is not a declared permission.`);
    }
  }

  return {
    schemaVersion: 2, id: value.id, provides: value.provides, version: value.version, description: value.description,
    runtime: { ...value.runtime }, requires: structuredClone(value.requires), tools, ...(chat ? { chat } : {}),
    artifacts, ...(settings ? { settings } : {}), permissions,
  };
}

export function validatePluginManifestV2(input: unknown): PluginManifestV2 {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !exactKeys(input, ['schemaVersion', 'id', 'name', 'version', 'author', 'description', 'license', 'publisher', 'compatibility', 'replacesSkills', 'skills', 'capabilities', 'migrations'])) throw new Error('Invalid plugin.json.');
  const value = input as PluginManifestV2;
  if (value.schemaVersion !== 2 || !SLUG.test(value.id) || !plainText(value.name, 80) || !SEMVER.test(value.version)
    || value.author !== TRUSTED_PUBLISHER || !plainText(value.description, 500) || !plainText(value.license, 80)) throw new Error('Invalid plugin.json.');

  // The publisher is not a label the package chooses for itself: it is the identity the
  // signature must verify against. A mismatch here is what stops a fake NodusResearch.
  if (!value.publisher || !exactKeys(value.publisher, ['id', 'keyId'])
    || value.publisher.id !== TRUSTED_PUBLISHER || !KEY_ID.test(String(value.publisher.keyId))) throw new Error('Invalid plugin publisher.');

  if (!value.compatibility || !exactKeys(value.compatibility, ['capabilityApi', 'minNodusVersion', 'targets'])
    || value.compatibility.capabilityApi !== CAPABILITY_API_V2 || !SEMVER.test(value.compatibility.minNodusVersion)
    || !Array.isArray(value.compatibility.targets) || !value.compatibility.targets.length || value.compatibility.targets.length > 8
    || value.compatibility.targets.some(target => !TARGET.test(String(target)))
    || new Set(value.compatibility.targets).size !== value.compatibility.targets.length) throw new Error('Invalid plugin compatibility.');
  if (value.compatibility.targets.includes('any') && value.compatibility.targets.length > 1) throw new Error('A portable plugin cannot also declare platform targets.');

  if (!Array.isArray(value.replacesSkills) || value.replacesSkills.length > 8
    || value.replacesSkills.some(id => !/^[a-z0-9-]{1,64}$/.test(String(id)))
    || new Set(value.replacesSkills).size !== value.replacesSkills.length) throw new Error('Invalid replacesSkills list.');

  assertPaths(value.skills, /^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/skill\.json$/, 40, 'skill');
  assertPaths(value.capabilities, /^capabilities\/([a-z0-9]+(?:-[a-z0-9]+)*)\/capability\.json$/, 20, 'capability');
  // `.cjs`, not `.js`: a migration is loaded by `require` from wherever the package was
  // extracted, and a bare `.js` means CommonJS or ESM depending on a package.json that may
  // or may not be beside it. The extension is the one place that ambiguity can be settled
  // once, for the archive and for the repository the package is authored in alike.
  assertPaths(value.migrations, /^migrations\/(\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.cjs$/, 40, 'migration', false);
  // The list is the data version ladder: the nth script is what takes a profile from
  // data version n-1 to n. Numbering that skips, repeats or runs out of order would make
  // "this profile is at version 3" mean different things in two installs, so it is
  // rejected here rather than discovered halfway through a migration.
  value.migrations.forEach((entry, index) => {
    if (Number(/^migrations\/(\d{3})-/.exec(entry)![1]) !== index + 1) throw new Error('Plugin migrations must be numbered 001, 002, … in order.');
  });

  return structuredClone(value);
}

function assertPaths(list: unknown, pattern: RegExp, max: number, what: string, required = true): void {
  if (!Array.isArray(list) || list.length > max || (required && !list.length)) throw new Error(`Invalid plugin ${what} list.`);
  const seen = new Set<string>();
  for (const entry of list) {
    if (typeof entry !== 'string' || !pattern.test(entry) || seen.has(entry) || entry.includes('..')) throw new Error(`Invalid plugin ${what} path.`);
    seen.add(entry);
  }
}

/** The target this Nodus build would install, or undefined when the package has none. */
export function resolvePluginTarget(targets: readonly PluginTarget[], platform: string, arch: string): PluginTarget | undefined {
  const exact = `${platform}-${arch}` as PluginTarget;
  return targets.includes(exact) ? exact : targets.includes('any') ? 'any' : undefined;
}

/** Only a signed NodusResearch package may claim a reserved `nodus:` id. The signature
 *  check happens elsewhere; this is the manifest-level half of the same rule. */
export function assertMayProvide(manifest: PluginManifestV2, provides: string): void {
  if (isCoreCapabilityId(provides)) throw new Error('A plugin cannot provide a core capability.');
  if (isReservedCapabilityId(provides)) {
    if (manifest.publisher.id !== TRUSTED_PUBLISHER) throw new Error(`Only NodusResearch may provide ${provides}.`);
    return;
  }
  if (isNodusCapabilityId(provides)) throw new Error(`Unknown reserved capability: ${provides}.`);
  if (!provides.startsWith(`${manifest.id}:`)) throw new Error('A capability must be namespaced by its own plugin.');
}
