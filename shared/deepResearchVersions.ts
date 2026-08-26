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

/** New requests use the lower-cost retrieval engine unless the user opts into v2. */
export function normalizeDeepResearchRequestVersion(value: unknown): DeepResearchVersion {
  return typeof value === 'string' && VERSION_SET.has(value)
    ? value as DeepResearchVersion
    : 'v1';
}

/** Public request boundary: omission is backwards-compatible, an explicit typo is not. */
export function parseDeepResearchRequestVersion(value: unknown): DeepResearchVersion {
  if (value == null || value === '') return 'v1';
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
    ?? DEEP_RESEARCH_VERSION_OPTIONS[0];
}

/** Spanish source strings are translation keys in the renderer. */
export const DEEP_RESEARCH_VERSION_OPTIONS: ReadonlyArray<{
  id: DeepResearchVersion;
  label: string;
  description: string;
}> = [
  {
    id: 'v1',
    label: 'v1 · Recuperación sencilla (por defecto)',
    description: 'Usa las ideas y los pasajes ya extraídos del corpus y no inicia el análisis de documentos completos. Es la opción recomendada para consultas sencillas y normalmente consume menos tokens.',
  },
  {
    id: 'v2',
    label: 'v2 · Análisis ampliado (más tokens)',
    description: 'Consume más tokens. En vaults académicos, parte de ideas y relaciones y puede analizar hasta 8 documentos completos relevantes: analiza los que aún no tienen un perfil completo, regenera los desactualizados y reutiliza los que ya están al día. La primera ejecución puede tener un coste notable.',
  },
] as const;
