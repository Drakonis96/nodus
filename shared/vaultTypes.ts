/**
 * Vault types — a vault's "mode". Each type is a bundle of configuration layered
 * over the same engine: which sidebar sections show by default, and a prompt-pack
 * persona appended to AI system prompts. The type is stored in the vault registry
 * (vaults.json / manifest.json), NOT in the vault database, so it needs no schema
 * migration and is visible without opening the DB.
 *
 * Adding a type here is deliberately cheap. `available: false` marks a type NOT
 * selectable for this release — the picker still lists it (greyed out, "coming
 * soon") so users see the full roadmap, but it can't be chosen for a new vault or
 * set on an existing one until a release flips it to `true`. A type can be fully
 * built (views, ontology, prompt pack all working) and still be `available: false`
 * if it just isn't being shipped to users yet. View ids are kept as plain strings to
 * avoid importing the renderer-only `View` union into shared code; they mirror the
 * canonical nav list in src/navigation.ts.
 */

export type VaultType =
  | 'academic'
  | 'estudio'
  | 'primary_sources'
  | 'genealogy'
  | 'databases'
  | 'testimonios'
  | 'worldbuilding'
  | 'docencia';

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
 * Canonical registry. Order here is the order shown in the picker: the two shipped
 * types first (`academic`, `genealogy`), then the announced-but-not-yet-shipped ones
 * in the order they were promised publicly. `academic` stays first and is the
 * default for every pre-existing vault.
 */
export const VAULT_TYPES: VaultTypeDef[] = [
  {
    id: 'academic',
    available: true,
    defaultHiddenViews: [],
    promptPack: '',
  },
  {
    id: 'genealogy',
    available: true,
    // Genealogy is record- and kinship-focused; hide the argumentative surfaces, the
    // idea graph and the coverage/gaps analysis. Deep Research STAYS: it has its own
    // genealogy pipeline that writes a family-history report over the embedding-indexed
    // archive + library. The Writing workshop and Projects remain hidden by default —
    // they are idea-graph + Zotero-citation authoring tools with no genealogy data
    // source — but stay re-enableable from the sidebar for mixed corpora. The
    // tree/persons/timeline/archive/map come in via scoping.
    defaultHiddenViews: [
      'argument',
      'debate',
      'ideas',
      'authors',
      'graph',
      'immersion',
      'hypothesis',
      'reading',
      'research',
      'gaps',
      'writing',
      'projects',
    ],
    promptPack: `

═══ CONTEXTO DEL VAULT — MODO GENEALOGÍA ═══
Este vault reconstruye historia familiar a partir de fuentes primarias (censos, padrones, partidas de bautismo/matrimonio/defunción, actas, correspondencia). Tu tarea es ayudar a IDENTIFICAR personas, reconstruir su biografía y trazar vínculos de parentesco y su rastro a través del corpus. Trata la identidad y el parentesco como HIPÓTESIS que se prueban con evidencia, siguiendo el estándar de prueba genealógico: nunca afirmes que dos registros son la misma persona, ni un vínculo de parentesco, sin apoyo documental; cita la evidencia y su localización, y señala cuando un dato es incierto o contradictorio. Copia los nombres y fechas tal como constan en época; no modernices ortografías ni normalices fechas inciertas. Cuando falte un dato, dilo y sugiere qué fuente podría aportarlo.`,
  },
  // Study mode ships as a first-class local workspace. primary_sources remains
  // declared but gated until its own product surface is complete.
  {
    id: 'estudio',
    available: true,
    // The dedicated study surfaces replace the research and authoring workspace in
    // this mode. Users can still opt universal sections back in from Settings.
    defaultHiddenViews: [
      'search',
      'library',
      'graph',
      'argument',
      'ideas',
      'authors',
      'immersion',
      'gaps',
      'debate',
      'research',
      'hypothesis',
      'reading',
      'deepResearch',
      'writing',
      'projects',
      'notes',
    ],
    promptPack: `

═══ CONTEXTO DEL VAULT — MODO ESTUDIO ═══
Este vault se usa para APRENDER y ESTUDIAR, no para investigación original. Prioriza la claridad didáctica sobre la exhaustividad: explica los conceptos con precisión pero de forma accesible, define los términos técnicos la primera vez que aparecen, y cuando sea útil sugiere cómo autoevaluar la comprensión. No inventes datos ni fuentes que no estén en el corpus.`,
  },
  {
    id: 'primary_sources',
    available: false,
    // A primary-source corpus mixes secondary literature (ideas/authors stay) with
    // archival records (persons/timeline/archive come in via scoping). Hide the
    // argument and debate surfaces that don't fit source/record work; keep
    // gaps/coverage/deep-research (reframed by the prompt pack).
    defaultHiddenViews: ['argument', 'debate', 'immersion', 'hypothesis', 'reading'],
    promptPack: `

═══ CONTEXTO DEL VAULT — MODO FUENTES PRIMARIAS ═══
Este vault trabaja con FUENTES PRIMARIAS y documentos de archivo (censos, padrones, actas, partidas, prensa histórica, correspondencia), no solo con literatura secundaria. Prioriza la fidelidad al documento: extrae hechos, personas, lugares, fechas y eventos tal como constan, cita siempre de forma literal y con su localización, y aplica crítica de fuentes (distingue lo que la fuente afirma de lo que se infiere). No deduzcas parentescos, identidades ni fechas que la fuente no sostenga; si un dato es incierto, dilo. Respeta la ortografía y los nombres de época.`,
  },
  {
    id: 'databases',
    available: true,
    // A structured-data workspace: a Notion-like manager of typed tables. None of the
    // argumentative/records surfaces apply — the sidebar shows the user's databases
    // (rendered dynamically) plus the fixed Analysis and Chat sections, and keeps
    // Notes. Everything else is hidden by default (re-enableable for mixed corpora).
    // The records views (persons/timeline/tree/…) are already excluded by scoping.
    defaultHiddenViews: [
      'search',
      'library',
      'graph',
      'argument',
      'ideas',
      'authors',
      'immersion',
      'gaps',
      'debate',
      'research',
      'hypothesis',
      'reading',
      'deepResearch',
      'writing',
      'projects',
    ],
    promptPack: `

═══ CONTEXTO DEL VAULT — MODO BASES DE DATOS ═══
Este vault es un gestor de bases de datos estructuradas (tablas con columnas tipadas: texto, número, fecha, selección, adjuntos, etc.). Tu tarea es ayudar a ANALIZAR, RESUMIR, CLASIFICAR y CONSULTAR datos tabulares. Sé riguroso con números y categorías: no inventes valores, filas ni columnas que no estén en los datos; cuando falte un dato o el conjunto no permita responder, dilo. Cuando produzcas análisis o gráficos, básate únicamente en los datos proporcionados y explica de forma reproducible qué cálculo o criterio has aplicado (para qué columnas, con qué filtro), de modo que el usuario pueda verificarlo.`,
  },
  {
    id: 'testimonios',
    available: false,
    defaultHiddenViews: [],
    promptPack: '',
  },
  {
    id: 'worldbuilding',
    available: true,
    defaultHiddenViews: [],
    promptPack: '',
  },
  {
    id: 'docencia',
    available: true,
    // Teaching reuses the study organisation surfaces (courses & subjects, schedule,
    // calendar, materials, recordings). Like the study mode it hides the
    // research/authoring universals, leaving a focused teaching workspace. The user
    // can re-enable any universal section from Settings.
    defaultHiddenViews: [
      'search',
      'library',
      'graph',
      'argument',
      'ideas',
      'authors',
      'immersion',
      'gaps',
      'debate',
      'research',
      'hypothesis',
      'reading',
      'deepResearch',
      'writing',
      'projects',
      'notes',
    ],
    promptPack: `

═══ CONTEXTO DEL VAULT — MODO DOCENCIA ═══
Este vault es el espacio de trabajo de un DOCENTE: preparación de clases, materiales, evaluación y organización académica (cursos, asignaturas, horarios, calendario y grabaciones de clase). Ayuda con un enfoque didáctico y práctico: adapta el nivel al alumnado, propón objetivos y criterios de evaluación claros, y sugiere actividades, recursos y formas de evaluar concretos. No inventes datos, citas ni normativa que no estén en el corpus; cuando falte información, dilo.`,
  },
];

/**
 * The accent colour of each vault type — the single source of truth for every surface
 * that paints a vault in its own colour: the switcher badges and creation grid, the
 * dock icon, and Nodi's orb when its colour follows the active vault. Keep these in
 * step with the app logos; a type added above must be added here too.
 */
export const VAULT_TYPE_COLORS: Record<VaultType, string> = {
  academic: '#6366f1',
  estudio: '#0f766e',
  primary_sources: '#6366f1',
  genealogy: '#ca8a04',
  databases: '#b30333',
  testimonios: '#0891b2',
  worldbuilding: '#7c3aed',
  docencia: '#ea580c',
};

/** Accent colour for a vault type; unknown/absent types fall back to the academic indigo. */
export function vaultTypeColor(value: unknown): string {
  return VAULT_TYPE_COLORS[normalizeVaultType(value)];
}

/** Selectable shells whose product sections are visible but intentionally inert. */
export const PREVIEW_VAULT_TYPES: VaultType[] = ['worldbuilding'];

export function isPreviewVaultType(value: unknown): boolean {
  return PREVIEW_VAULT_TYPES.includes(normalizeVaultType(value));
}

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
  map: ['primary_sources', 'genealogy'],
  tree: ['genealogy'],
  // The social-relations graph is independent from the kinship tree but needs the
  // same Person entities, so it's available wherever persons/timeline/archive are.
  relations: ['primary_sources', 'genealogy'],
  // Databases mode: the table workspace and its Analysis + Chat sections only exist
  // in a 'databases' vault.
  databases: ['databases'],
  dbSearch: ['databases'],
  dbAnalysis: ['databases'],
  dbChat: ['databases'],
  // Study mode owns its academic organisation, materials and question bank.
  // They must never leak into research/records/database vaults. The teaching
  // ('docencia') mode reuses the shared organisation surfaces — courses & subjects,
  // schedule, calendar, materials and recordings — so those five are scoped to both.
  // The study-only surfaces (search, chat, ideas, graph, question bank, review,
  // deep research) stay exclusive to 'estudio'.
  studyCourses: ['estudio', 'docencia'],
  studySchedule: ['estudio', 'docencia'],
  studyCalendar: ['estudio', 'docencia'],
  studySearch: ['estudio'],
  studyLibrary: ['estudio', 'docencia'],
  studyRecordings: ['estudio', 'docencia'],
  studyChat: ['estudio'],
  studyIdeas: ['estudio'],
  studyGraph: ['estudio'],
  // The question bank is shared with teaching (its Evaluación section).
  studyQuestions: ['estudio', 'docencia'],
  studyReview: ['estudio'],
  studyDeepResearch: ['estudio'],
  // Student rosters, the exam paper builder and rubrics belong to teaching only.
  teachingGroups: ['docencia'],
  teachingExams: ['docencia'],
  teachingRubrics: ['docencia'],
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

/** A style modifier appended to generated decorative-image prompts, by vault type. */
export function vaultTypeImagePrompt(value: unknown): string {
  switch (normalizeVaultType(value)) {
    case 'genealogy':
      return 'in the atmosphere of a historical family archive, period-authentic heritage aesthetic, aged paper and restrained sepia tones';
    case 'primary_sources':
      return 'archival and documentary atmosphere, period-authentic, aged materials';
    default:
      return '';
  }
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
  if (isPreviewVaultType(type)) return viewId === 'home';
  const allowed = VAULT_TYPE_SCOPED_VIEWS[viewId];
  return allowed ? allowed.includes(normalizeVaultType(type)) : true;
}

/** The subset of the given view ids that do NOT apply to this vault type. */
export function viewsDisallowedForType(allViewIds: string[], type: unknown): string[] {
  return allViewIds.filter((id) => !isViewAllowedForVaultType(id, type));
}
