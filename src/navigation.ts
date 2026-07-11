import type { CorpusHealthBucketId, ResearchContextSelection } from '@shared/types';

export type View = 'home' | 'search' | 'library' | 'graph' | 'argument' | 'ideas' | 'authors' | 'study' | 'immersion' | 'gaps' | 'debate' | 'research' | 'hypothesis' | 'reading' | 'writing' | 'deepResearch' | 'projects' | 'notes' | 'settings';

export type GraphPresetId = 'overview' | 'contradictions' | 'gaps' | 'reading' | 'unread' | 'authors';

/** Sidebar section groups, in render order. Home and Settings are pinned outside
 * any group (first/last); every other section belongs to exactly one group.
 * Reordering (in Settings) happens within a group. */
export type NavGroupId = 'explore' | 'analyze' | 'create';

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
  // Analizar — superficies derivadas del grafo y síntesis.
  { id: 'study', label: 'Estudio', icon: 'compass', group: 'analyze' },
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
  { id: 'settings', label: 'Ajustes', icon: 'settings' },
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
