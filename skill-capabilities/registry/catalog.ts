import type { CoreCapabilityId } from '../../packages/capability-api/src/limits';
import type { CapabilityRegistryEntry } from '../contracts';

/** The capabilities the application provides itself. Everything else a build can offer
 *  arrives as an installed package and is listed by the capability registry, not here. */
export const BUILTIN_CAPABILITY_REGISTRY = [
  { id: 'nodus:svg', version: '1.0.0', description: 'Sanitized SVG rendering and quality review.', source: 'builtin', tools: [{ id: 'render', description: 'Render a self-contained SVG.' }] },
  { id: 'nodus:image', version: '1.0.0', description: 'Image generation using the configured provider.', source: 'builtin', tools: [{ id: 'generate', description: 'Generate and persist one image.' }] },
] as const satisfies readonly CapabilityRegistryEntry[];

export const REGISTERED_BUILTIN_CAPABILITY_IDS = BUILTIN_CAPABILITY_REGISTRY.map(entry => entry.id) as CoreCapabilityId[];
