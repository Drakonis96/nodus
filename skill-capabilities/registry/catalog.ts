import type { BuiltinCapabilityId, CapabilityRegistryEntry } from '../contracts';

export const BUILTIN_CAPABILITY_REGISTRY = [
  { id: 'nodus:svg', version: '1.0.0', description: 'Sanitized SVG rendering and quality review.', source: 'builtin', tools: [{ id: 'render', description: 'Render a self-contained SVG.' }] },
  { id: 'nodus:image', version: '1.0.0', description: 'Image generation using the configured provider.', source: 'builtin', tools: [{ id: 'generate', description: 'Generate and persist one image.' }] },
  { id: 'nodus:chemistry', version: '1.0.0', description: 'Verified chemistry identity, drawing and export.', source: 'builtin', tools: [{ id: 'compile', description: 'Resolve and compile one chemistry plan.' }] },
  { id: 'nodus:genomics', version: '1.0.0', description: 'AlphaGenome prediction and local result persistence.', source: 'builtin', tools: [{ id: 'predict', description: 'Run one validated genomic prediction.' }] },
  { id: 'nodus:legal', version: '1.0.0', description: 'Legalize legislation retrieval.', source: 'builtin', tools: [{ id: 'retrieve', description: 'Retrieve one validated legal query.' }] },
] as const satisfies readonly CapabilityRegistryEntry[];

export const REGISTERED_BUILTIN_CAPABILITY_IDS = BUILTIN_CAPABILITY_REGISTRY.map(entry => entry.id) as BuiltinCapabilityId[];
