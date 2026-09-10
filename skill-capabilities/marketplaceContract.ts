// Public, environment-independent contract exported verbatim to marketplace CI.
export {
  DEFAULT_SKILL_SOURCE,
  SKILL_CAPABILITIES,
  SUPPORTED_SKILL_CAPABILITIES,
  assertSkillCapabilitiesSupported,
  normalizeSkillSource,
  skillSlug,
  unsupportedSkillCapabilities,
  validateManifest,
  validateSkillPackage,
} from '../shared/skillMarketplace';
export {
  BUILTIN_CAPABILITY_IDS,
  CAPABILITY_API_VERSION,
  compareSemver,
  isCapabilityReference,
  jsonSchemaMatches,
  normalizeCapabilityId,
  validateCapabilityManifest,
  validatePluginManifest,
} from './contracts';
export {
  canonicalPluginCapabilityId,
  mergedPluginPermissions,
  permissionsExpand,
  resolvePluginCapabilityReference,
  validatePluginPackage,
} from './pluginPackage';
