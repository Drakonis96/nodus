/**
 * Vault types — a vault's "mode". Each type is a bundle of configuration layered
 * over the same engine: which sidebar sections show by default, and a prompt-pack
 * persona appended to AI system prompts. The type is stored in the vault registry
 * (vaults.json / manifest.json), NOT in the vault database, so it needs no schema
 * migration and is visible without opening the DB.
 *
 * Adding a type here is deliberately cheap. `available: false` keeps a type defined
 * but hidden from the picker until its dedicated views/ontology ship (primary
 * sources → phase B, genealogy → phase C). View ids are kept as plain strings to
 * avoid importing the renderer-only `View` union into shared code; they mirror the
 * canonical nav list in src/navigation.ts.
 */

export type VaultType = 'academic' | 'estudio' | 'primary_sources' | 'genealogy';

/** Existing vaults (and anything unrecognised) resolve to this type. */
export const DEFAULT_VAULT_TYPE: VaultType = 'academic';

export interface VaultTypeDef {
  id: VaultType;
  /** Whether the type can currently be selected in the UI. */
  available: boolean;
  /**
   * View ids hidden by default for this type. Empty = show the full sidebar.
   * These are DEFAULTS: once the user customises the sidebar the preset no longer
   * applies (see effectiveSidebarHidden).
   */
  defaultHiddenViews: string[];
  /**
   * Persona/context directive appended to AI system prompts for this vault type.
   * Empty for `academic` — the base prompts are already authored for it. Applied
   * the same way as the output-language directive: appended, never a find/replace
   * over the hand-tuned base prompts.
   */
  promptPack: string;
}

/**
 * Canonical registry. Order here is the order shown in the picker. `academic`
 * stays first and is the default for every pre-existing vault.
 */
export const VAULT_TYPES: VaultTypeDef[] = [
  {
    id: 'academic',
    available: true,
    defaultHiddenViews: [],
    promptPack: '',
  },
  {
    id: 'estudio',
    available: true,
    // A learner doesn't need the research-debate and authoring surfaces; keep
    // search, library, graph, ideas, study, immersion, coverage (self-testing),
    // reading path, writing and notes. Everything stays reachable from Settings.
    defaultHiddenViews: ['argument', 'authors', 'gaps', 'debate', 'hypothesis', 'deepResearch', 'projects'],
    promptPack: `

═══ CONTEXTO DEL VAULT — MODO ESTUDIO ═══
Este vault se usa para APRENDER y ESTUDIAR, no para investigación original. Prioriza la claridad didáctica sobre la exhaustividad: explica los conceptos con precisión pero de forma accesible, define los términos técnicos la primera vez que aparecen, y cuando sea útil sugiere cómo autoevaluar la comprensión. No inventes datos ni fuentes que no estén en el corpus.`,
  },
  // primary_sources (phase B) and genealogy (phase C) are declared so the taxonomy
  // is stable, but stay unavailable until their dedicated views/ontology land. Their
  // presets and prompt packs are filled in by those phases.
  {
    id: 'primary_sources',
    available: false,
    defaultHiddenViews: [],
    promptPack: '',
  },
  {
    id: 'genealogy',
    available: false,
    defaultHiddenViews: [],
    promptPack: '',
  },
];

/**
 * Views that exist ONLY for specific vault types. A view listed here shows only
 * when the active vault type is in its list; any view absent from this map is
 * universal (shows for every type, subject to the user's sidebar preferences).
 * The records views (Personas, Timeline, Archivo) belong to the primary-source and
 * genealogy modes — an academic vault never shows them. The genealogy tree is added
 * by phase C.
 */
export const VAULT_TYPE_SCOPED_VIEWS: Record<string, VaultType[]> = {
  persons: ['primary_sources', 'genealogy'],
  timeline: ['primary_sources', 'genealogy'],
  archive: ['primary_sources', 'genealogy'],
};

const BY_ID = new Map<VaultType, VaultTypeDef>(VAULT_TYPES.map((def) => [def.id, def]));

export function isVaultType(value: unknown): value is VaultType {
  return typeof value === 'string' && BY_ID.has(value as VaultType);
}

/** Coerce any stored/legacy value into a valid VaultType, defaulting to academic. */
export function normalizeVaultType(value: unknown): VaultType {
  return isVaultType(value) ? value : DEFAULT_VAULT_TYPE;
}

/** Definition for a type id; always resolves (unknown ids fall back to academic). */
export function getVaultTypeDef(value: unknown): VaultTypeDef {
  return BY_ID.get(normalizeVaultType(value))!;
}

/** Types offered in the picker, in registry order. */
export function availableVaultTypes(): VaultTypeDef[] {
  return VAULT_TYPES.filter((def) => def.available);
}

export function defaultHiddenViewsForType(value: unknown): string[] {
  return [...getVaultTypeDef(value).defaultHiddenViews];
}

export function vaultTypePromptPack(value: unknown): string {
  return getVaultTypeDef(value).promptPack;
}

/**
 * The sidebar sections to hide for a vault. The vault type provides the default
 * hidden set; once the user has customised the sidebar (`customized`), their
 * explicit choice wins and the preset no longer applies. This keeps a single,
 * unambiguous source of truth without seeding the database.
 */
export function effectiveSidebarHidden(userHidden: string[], customized: boolean, type: unknown): string[] {
  if (customized) return [...userHidden];
  return defaultHiddenViewsForType(type);
}

/** Whether a view may appear for the given vault type (universal views always may). */
export function isViewAllowedForVaultType(viewId: string, type: unknown): boolean {
  const allowed = VAULT_TYPE_SCOPED_VIEWS[viewId];
  return allowed ? allowed.includes(normalizeVaultType(type)) : true;
}

/** The subset of the given view ids that do NOT apply to this vault type. */
export function viewsDisallowedForType(allViewIds: string[], type: unknown): string[] {
  return allViewIds.filter((id) => !isViewAllowedForVaultType(id, type));
}
