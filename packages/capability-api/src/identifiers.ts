import { CORE_CAPABILITY_IDS, RESERVED_CAPABILITY_IDS, type CoreCapabilityId, type ReservedCapabilityId } from './limits';

/** Every `nodus:*` identifier the platform knows about, whoever ends up providing it. */
export const NODUS_CAPABILITY_IDS = [...CORE_CAPABILITY_IDS, ...RESERVED_CAPABILITY_IDS] as const;
export type NodusCapabilityId = CoreCapabilityId | ReservedCapabilityId;
export type CapabilityId = NodusCapabilityId | `self:${string}` | `${string}:${string}`;

/** Short names authored before the `nodus:` prefix existed. They still normalize, but
 *  normalizing is not resolving: a reserved id only works while a provider is active. */
const LEGACY: Record<string, NodusCapabilityId> = {
  svg: 'nodus:svg', image: 'nodus:image', '3d': 'nodus:3d',
  chemistry: 'nodus:chemistry', legal: 'nodus:legal', genomics: 'nodus:genomics',
};

export function normalizeCapabilityId(id: string): string {
  return LEGACY[id] ?? id;
}

export function legacyCapabilityId(id: string): string {
  return Object.entries(LEGACY).find(([, canonical]) => canonical === id)?.[0] ?? id;
}

export const isCoreCapabilityId = (id: string): id is CoreCapabilityId => (CORE_CAPABILITY_IDS as readonly string[]).includes(id);
export const isReservedCapabilityId = (id: string): id is ReservedCapabilityId => (RESERVED_CAPABILITY_IDS as readonly string[]).includes(id);
export const isNodusCapabilityId = (id: string): id is NodusCapabilityId => isCoreCapabilityId(id) || isReservedCapabilityId(id);

export function isCapabilityReference(value: unknown): value is CapabilityId {
  if (typeof value !== 'string' || value.length > 160) return false;
  if (value in LEGACY || isNodusCapabilityId(value)) return true;
  return /^self:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    || /^[a-z0-9]+(?:[./-][a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/** A community capability is namespaced by its own plugin and can never be a `nodus:` id. */
export const canonicalPluginCapabilityId = (pluginId: string, localId: string): string => `${pluginId}:${localId}`;
