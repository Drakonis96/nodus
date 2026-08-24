/**
 * Versioned Deep Research engines.
 *
 * This is deliberately separate from `DeepResearchApproach`: an approach says
 * what kind of investigation to do, while a version says which orchestration
 * engine executes it. The renderer can send this metadata before the shared
 * request type and the main-process dispatcher learn about it.
 */
export const DEEP_RESEARCH_VERSIONS = ['v1', 'v2'] as const;

export type DeepResearchVersion = (typeof DEEP_RESEARCH_VERSIONS)[number];
export type DeepResearchEnginePath = 'v1-general' | 'v1-specialized' | 'v2-general' | 'v2-specialized';

const VERSION_SET = new Set<string>(DEEP_RESEARCH_VERSIONS);

/** New requests use the current engine unless the user explicitly chooses v1. */
export function normalizeDeepResearchRequestVersion(value: unknown): DeepResearchVersion {
  return typeof value === 'string' && VERSION_SET.has(value)
    ? value as DeepResearchVersion
    : 'v2';
}

/** Public request boundary: omission is backwards-compatible, an explicit typo is not. */
export function parseDeepResearchRequestVersion(value: unknown): DeepResearchVersion {
  if (value == null || value === '') return 'v2';
  if (typeof value === 'string' && VERSION_SET.has(value)) return value as DeepResearchVersion;
  throw new Error(`Unsupported Deep Research version: ${String(value)}`);
}

/** Pure characterization seam used by every entry point and by router tests. */
export function deepResearchEnginePath(versionValue: unknown, specialized: boolean): DeepResearchEnginePath {
  const version = parseDeepResearchRequestVersion(versionValue);
  return `${version}-${specialized ? 'specialized' : 'general'}`;
}

/** Missing metadata belongs to reports created before versioning existed. */
export function normalizeDeepResearchMetadataVersion(value: unknown): DeepResearchVersion {
  return typeof value === 'string' && VERSION_SET.has(value)
    ? value as DeepResearchVersion
    : 'v1';
}

export function deepResearchVersionOption(value: unknown): {
  id: DeepResearchVersion;
  label: string;
  description: string;
} {
  const version = normalizeDeepResearchRequestVersion(value);
  return DEEP_RESEARCH_VERSION_OPTIONS.find((option) => option.id === version)
    ?? DEEP_RESEARCH_VERSION_OPTIONS[1];
}

/** Spanish source strings are translation keys in the renderer. */
export const DEEP_RESEARCH_VERSION_OPTIONS: ReadonlyArray<{
  id: DeepResearchVersion;
  label: string;
  description: string;
}> = [
  {
    id: 'v1',
    label: 'v1 · Deep Research histórico',
    description: 'Usa el sistema anterior de Deep Research, conservado para comparar resultados y mantener compatibilidad con el flujo histórico.',
  },
  {
    id: 'v2',
    label: 'v2 · Ideas primero y documentos completos',
    description: 'Primero reconstruye ideas, relaciones, debates y huecos. Después amplía la recuperación con los textos completos que pueden aportar evidencia relevante.',
  },
] as const;
