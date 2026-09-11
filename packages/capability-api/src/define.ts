import { validateCapabilityManifestV2, type CapabilityManifestV2 } from './manifest';
import type { CapabilityWorkerFactory } from './worker';

/** Authoring helpers. They add types and one early validation pass; they are not part of
 *  the runtime contract, and nothing in a shipped bundle depends on this package. */

export function defineCapability(factory: CapabilityWorkerFactory): CapabilityWorkerFactory {
  return factory;
}

/** Validates a manifest at author time so a typo fails `npm test`, not an install. */
export function defineCapabilityManifest(manifest: CapabilityManifestV2): CapabilityManifestV2 {
  return validateCapabilityManifestV2(manifest);
}

/** Small helper for the common "one paragraph" view a tool returns on abstention. */
export function noticeView(summary: string, text: string, tone: 'info' | 'warning' | 'danger' = 'info') {
  return { schemaVersion: 1 as const, summary, nodes: [{ kind: 'notice' as const, tone, spans: [{ text }] }] };
}
