import type { CorpusHealthBucketId, ResearchContextSelection } from '@shared/types';

export type View = 'home' | 'search' | 'library' | 'graph' | 'argument' | 'ideas' | 'authors' | 'persons' | 'timeline' | 'tree' | 'relations' | 'map' | 'archive' | 'databases' | 'dbSearch' | 'dbAnalysis' | 'dbChat' | 'studyCourses' | 'studySchedule' | 'studyCalendar' | 'studySearch' | 'studyLibrary' | 'studyRecordings' | 'studyChat' | 'studyIdeas' | 'studyGraph' | 'studyQuestions' | 'studyReview' | 'studyDeepResearch' | 'teachingGroups' | 'teachingGrades' | 'teachingExams' | 'teachingRubrics' | 'immersion' | 'gaps' | 'debate' | 'research' | 'hypothesis' | 'reading' | 'writing' | 'deepResearch' | 'projects' | 'notes' | 'toolkit' | 'settings';

export type GraphPresetId = 'overview' | 'contradictions' | 'gaps' | 'reading' | 'unread' | 'authors';

/** Sidebar section groups, in render order. Home and Settings are pinned outside
 * any group (first/last); every other section belongs to exactly one group.
 * Reordering (in Settings) happens within a group. */
export type NavGroupId = 'explore' | 'analyze' | 'create' | 'tools';

export interface NavItem {
  id: View;
  label: string;
  icon: string;
  /** Pinned sections (home, settings) have no group. */
  group?: NavGroupId;
}

export interface NavGroupDef {
  id: NavGroupId;
  label: string;
}

export const NAV_GROUPS: NavGroupDef[] = [
  { id: 'explore', label: 'Explorar' },
  { id: 'analyze', label: 'Analizar' },
  { id: 'create', label: 'Escribir' },
  { id: 'tools', label: 'Herramientas' },
];

// Canonical sidebar sections in their default order, grouped. Home is always
// rendered first and Settings always last; neither can be moved or hidden. The
// rest can be reordered (within their group) and shown/hidden from Settings.
// Every icon is unique so sections stay distinguishable when the sidebar is
// collapsed to icons.
export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Inicio', icon: 'home' },
  // Explorar — recorrer el corpus, el grafo y sus ideas/autores.
  { id: 'search', label: 'Buscar', icon: 'search', group: 'explore' },
  { id: 'library', label: 'Biblioteca', icon: 'book', group: 'explore' },
  { id: 'graph', label: 'Grafo', icon: 'layers', group: 'explore' },
  { id: 'argument', label: 'Mapa de argumentos', icon: 'map', group: 'explore' },
  { id: 'ideas', label: 'Ideas', icon: 'bulb', group: 'explore' },
  { id: 'authors', label: 'Autores', icon: 'graduation', group: 'explore' },
  // Records views — shown only for primary-source / genealogy vaults (see VAULT_TYPE_SCOPED_VIEWS).
  { id: 'persons', label: 'Personas', icon: 'users', group: 'explore' },
  { id: 'timeline', label: 'Línea temporal', icon: 'clock', group: 'explore' },
  { id: 'tree', label: 'Árbol genealógico', icon: 'tree', group: 'explore' },
  { id: 'relations', label: 'Relaciones sociales', icon: 'network', group: 'explore' },
  { id: 'map', label: 'Mapa', icon: 'map', group: 'explore' },
  { id: 'archive', label: 'Archivo', icon: 'archive', group: 'explore' },
  // Databases mode — shown only for the 'databases' vault type (see VAULT_TYPE_SCOPED_VIEWS).
  // The database list itself is rendered dynamically in the sidebar; these two are the
  // fixed Analysis and Chat sections. The table workspace ('databases' view) is reached
  // by clicking a database in the list, so it is not a nav button.
  { id: 'dbSearch', label: 'Buscar', icon: 'search', group: 'explore' },
  { id: 'dbAnalysis', label: 'Análisis', icon: 'chartBar', group: 'analyze' },
  { id: 'dbChat', label: 'Chat de datos', icon: 'chat', group: 'analyze' },
  // Study mode — scoped to the 'estudio' vault type.
  { id: 'studyCourses', label: 'Cursos y asignaturas', icon: 'graduation', group: 'explore' },
  { id: 'studySchedule', label: 'Horarios', icon: 'clock', group: 'explore' },
  { id: 'studyCalendar', label: 'Calendario', icon: 'calendar', group: 'explore' },
  { id: 'studySearch', label: 'Buscar en el estudio', icon: 'search', group: 'explore' },
  { id: 'studyLibrary', label: 'Materiales de estudio', icon: 'book', group: 'explore' },
  { id: 'studyRecordings', label: 'Grabaciones', icon: 'microphone', group: 'explore' },
  { id: 'studyChat', label: 'Chat de estudio', icon: 'chat', group: 'analyze' },
  { id: 'studyIdeas', label: 'Ideas de estudio', icon: 'bulb', group: 'analyze' },
  { id: 'studyGraph', label: 'Grafo de estudio', icon: 'layers', group: 'analyze' },
  { id: 'studyQuestions', label: 'Banco de preguntas', icon: 'help', group: 'analyze' },
  { id: 'studyReview', label: 'Revisión', icon: 'flashcards', group: 'analyze' },
  { id: 'studyDeepResearch', label: 'Investigación de estudio', icon: 'network', group: 'analyze' },
  // Teaching mode — surfaces scoped to the 'docencia' vault type.
  { id: 'teachingGroups', label: 'Grupos', icon: 'users', group: 'explore' },
  { id: 'teachingGrades', label: 'Calificaciones', icon: 'chartBar', group: 'analyze' },
  { id: 'teachingExams', label: 'Exámenes', icon: 'notebook', group: 'analyze' },
  { id: 'teachingRubrics', label: 'Rúbricas', icon: 'table', group: 'analyze' },
  // Analizar — superficies derivadas del grafo y síntesis.
  { id: 'immersion', label: 'Inmersión', icon: 'target', group: 'analyze' },
  { id: 'gaps', label: 'Huecos', icon: 'gap', group: 'analyze' },
  { id: 'debate', label: 'Debates', icon: 'scale', group: 'analyze' },
  { id: 'research', label: 'Cobertura', icon: 'help', group: 'analyze' },
  { id: 'hypothesis', label: 'Hipótesis', icon: 'flask', group: 'analyze' },
  { id: 'reading', label: 'Ruta de lectura', icon: 'route', group: 'analyze' },
  { id: 'deepResearch', label: 'Deep Research', icon: 'network', group: 'analyze' },
  // Escribir — producir salidas con citas.
  { id: 'writing', label: 'Escritura', icon: 'edit', group: 'create' },
  { id: 'projects', label: 'Proyectos', icon: 'folder', group: 'create' },
  { id: 'notes', label: 'Notas', icon: 'notebook', group: 'create' },
  // Herramientas — el hub del Nodus Toolkit (conversión y proceso de archivos).
  // Vista universal: disponible en todos los tipos de vault.
  { id: 'toolkit', label: 'Nodus Toolkit', icon: 'tools', group: 'tools' },
  { id: 'settings', label: 'Ajustes', icon: 'settings' },
];

/** Pages inside the Herramientas section. The toolkit keeps a SINGLE entry in the
 * View union — its tools are addressed by this id instead — so that adding a tool
 * never turns into a new top-level view (and never leaks into sidebarOrder, the
 * per-vault-type allow-lists or the reordering UI). The sidebar nests one button
 * per tool under the section, and 'home' is the catalogue. */
export type ToolkitPage = 'home' | 'convert' | 'protect' | 'presenter' | 'ocr';

export interface ToolkitToolDef {
  page: Exclude<ToolkitPage, 'home'>;
  /** Marca de la herramienta; NO se traduce. */
  name: string;
  /** Etiqueta del botón anidado del sidebar: la marca sin el prefijo que ya
   * aporta la sección, porque el nombre completo no cabe en el ancho por
   * defecto y se cortaba («Nodus Con…»). El nombre completo sigue en el title
   * y en la tarjeta del catálogo. */
  shortName: string;
  /** Clave i18n (español) de la descripción de la tarjeta. */
  description: string;
  icon: string;
  /** 'wip' = navegable pero en construcción; 'soon' = todavía no existe. */
  state: 'wip' | 'soon';
  /** Sufijo de los data-testid (tarjeta del hub y botón del sidebar). */
  testid: string;
}

/** Single source of truth for the toolkit catalogue: the hub cards and the nested
 * sidebar buttons render from this list, so they can never drift apart. */
export const TOOLKIT_TOOLS: ToolkitToolDef[] = [
  {
    page: 'convert',
    name: 'Nodus Convert',
    shortName: 'Convert',
    description: 'Convierte documentos, PDF e imágenes, con OCR ligero y utilidades de texto, de uno en uno o en lote.',
    icon: 'swap',
    state: 'wip',
    testid: 'convert',
  },
  {
    page: 'protect',
    name: 'Nodus Protect',
    shortName: 'Protect',
    description: 'Oculta datos, añade marcas de agua y crea o verifica copias trazables, siempre mediante procesamiento local.',
    icon: 'shield',
    state: 'wip',
    testid: 'protect',
  },
  {
    page: 'presenter',
    name: 'PDF Presenter',
    shortName: 'Presenter',
    description: 'Presenta PDFs como diapositivas, con vista del presentador, notas del orador y anotaciones en directo.',
    icon: 'presentation',
    state: 'soon',
    testid: 'presenter',
  },
  {
    page: 'ocr',
    name: 'OCR Workspace',
    shortName: 'OCR',
    description: 'OCR asistido por IA para escaneados difíciles, con revisión página a página e integración con tus bóvedas.',
    icon: 'scanText',
    state: 'wip',
    testid: 'aiocr',
  },
];

/**
 * Resolve the sidebar items for a user-defined order. Home is pinned first and
 * Settings is pinned last; neither is ever part of the saved order. Any sections
 * missing from `sidebarOrder` (e.g. a view added in a newer version) are appended
 * in their default order so the list always stays complete.
 */
export function orderedNav(sidebarOrder: string[]): NavItem[] {
  const home = NAV_ITEMS.find((n) => n.id === 'home');
  const settings = NAV_ITEMS.find((n) => n.id === 'settings');
  const rest = NAV_ITEMS.filter((n) => n.id !== 'home' && n.id !== 'settings');
  const remaining = new Map(rest.map((n) => [n.id, n] as const));
  const ordered: NavItem[] = [];
  for (const id of sidebarOrder) {
    const item = remaining.get(id as View);
    if (item) {
      ordered.push(item);
      remaining.delete(id as View);
    }
  }
  for (const n of rest) if (remaining.has(n.id)) ordered.push(n);
  return [...(home ? [home] : []), ...ordered, ...(settings ? [settings] : [])];
}

export interface NavGroup extends NavGroupDef {
  items: NavItem[];
}

/**
 * Group the (visible, ordered) sidebar sections for rendering. Groups appear in
 * {@link NAV_GROUPS} order; within each group the items keep the user's saved
 * order. Home and Settings are pinned outside groups and are not returned here.
 * Empty groups (all sections hidden) are dropped.
 */
export function groupedNav(sidebarOrder: string[], sidebarHidden: string[]): NavGroup[] {
  const hidden = new Set(sidebarHidden);
  const ordered = orderedNav(sidebarOrder).filter(
    (n) => n.id !== 'home' && n.id !== 'settings' && !hidden.has(n.id),
  );
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: ordered.filter((n) => n.group === g.id),
  })).filter((g) => g.items.length > 0);
}

export interface GraphNavigationTarget {
  nonce: number;
  preset?: GraphPresetId;
  nodeId?: string;
  edgeId?: string;
  workId?: string;
  workTitle?: string;
  zoteroKey?: string;
  theme?: string;
  search?: string;
  openTutor?: boolean;
  label?: string;
}

export interface AssistantNavigationTarget {
  nonce: number;
  prompt?: string;
  title?: string;
  selection?: ResearchContextSelection;
}

/** Navigation into the Library that pre-applies a filter (e.g. a corpus-health bucket). */
export interface LibraryNavigationTarget {
  nonce: number;
  healthBucket?: CorpusHealthBucketId;
}

export type PendingGraphNavigationTarget = Omit<GraphNavigationTarget, 'nonce'>;
export type PendingAssistantNavigationTarget = Omit<AssistantNavigationTarget, 'nonce'>;
export type PendingLibraryNavigationTarget = Omit<LibraryNavigationTarget, 'nonce'>;

export const ASSISTANT_CONTEXTS: Record<'idea' | 'gap' | 'contradiction' | 'reading', ResearchContextSelection> = {
  idea: {
    ideas: true,
    themes: true,
    contradictions: false,
    gaps: false,
    readingPath: false,
    authors: false,
    documents: false,
    passages: true,
    graph: true,
    graphParts: {
      ideaNodes: true,
      themeNodes: true,
      ideaEdges: true,
      authorGraph: false,
    },
  },
  gap: {
    ideas: true,
    themes: true,
    contradictions: false,
    gaps: true,
    readingPath: true,
    authors: false,
    documents: false,
    passages: true,
    graph: true,
    graphParts: {
      ideaNodes: true,
      themeNodes: true,
      ideaEdges: true,
      authorGraph: false,
    },
  },
  contradiction: {
    ideas: true,
    themes: true,
    contradictions: true,
    gaps: true,
    readingPath: false,
    authors: false,
    documents: true,
    passages: true,
    graph: true,
    graphParts: {
      ideaNodes: true,
      themeNodes: true,
      ideaEdges: true,
      authorGraph: false,
    },
  },
  reading: {
    ideas: true,
    themes: true,
    contradictions: true,
    gaps: true,
    readingPath: true,
    authors: true,
    documents: true,
    passages: true,
    graph: true,
    graphParts: {
      ideaNodes: true,
      themeNodes: true,
      ideaEdges: true,
      authorGraph: true,
    },
  },
};
