/** Constants the host, the plugins and the marketplace CI must all agree on.
 *  Changing any number here is a contract change: bump the SDK major version. */

export const CAPABILITY_API_V2 = 2 as const;
export const TRUSTED_RUNTIME = 'nodus-trusted-worker-v1' as const;
export const TRUSTED_PROTOCOL = 1 as const;
export const TRUSTED_PUBLISHER = 'NodusResearch' as const;

/** Capabilities the core owns outright. A plugin may depend on these; none may provide them. */
export const CORE_CAPABILITY_IDS = ['nodus:svg', 'nodus:image', 'nodus:3d'] as const;
/** `nodus:*` identifiers a signed NodusResearch package may claim, and nobody else. */
export const RESERVED_CAPABILITY_IDS = ['nodus:chemistry', 'nodus:legal', 'nodus:genomics'] as const;

export type CoreCapabilityId = typeof CORE_CAPABILITY_IDS[number];
export type ReservedCapabilityId = typeof RESERVED_CAPABILITY_IDS[number];

export const LIMITS = {
  /** Tool timeouts are declared per tool and clamped to this window. */
  toolTimeoutMsMin: 1_000,
  toolTimeoutMsMax: 300_000,
  toolsPerCapability: 24,
  /** Grace period between "please stop" and killing the utility process. */
  cancelGraceMs: 2_000,

  /** Package extraction. A staged archive that exceeds any of these is rejected whole. */
  packageCompressedBytes: 128 * 1024 * 1024,
  packageExpandedBytes: 512 * 1024 * 1024,
  packageEntries: 25_000,

  /** Interactive 3D models. One asset, stored like any other attachment and rendered by
   *  the core viewer; a capability never ships a renderer of its own. */
  modelBytes: 64 * 1024 * 1024,
  modelJsonBytes: 16 * 1024 * 1024,
  modelNodes: 200_000,

  /** Declarative views. */
  viewNodes: 512,
  viewDepth: 8,
  viewTextChars: 20_000,
  viewSvgChars: 2 * 1024 * 1024,
  viewTableRows: 2_000,
  viewTableColumns: 40,

  /** What a capability may hand back to the model as history. */
  projectionBytes: 500 * 1024,
  artifactSummaryChars: 500,

  /** Chat protocol. */
  chatFenceMaxPerReply: 8,
  chatMutationsPerHook: 64,
  chatPriorityMin: 1,
  chatPriorityMax: 1_000,
} as const;

/** Calls already charged in a reply, split by lane. Mirrors the v1 budget. */
export interface CapabilityCallBudget { sandboxed: number; metered: number }
