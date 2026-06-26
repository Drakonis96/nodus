import type { ResearchContextSelection } from '@shared/types';

export type View = 'home' | 'library' | 'graph' | 'argument' | 'ideas' | 'gaps' | 'debate' | 'research' | 'reading' | 'writing' | 'notes' | 'settings';

export type GraphPresetId = 'overview' | 'contradictions' | 'gaps' | 'reading' | 'unread' | 'authors';

export interface NavItem {
  id: View;
  label: string;
  icon: string;
}

// Canonical sidebar sections in their default order. Home is always rendered
// first and cannot be moved; the rest can be reordered from Settings.
export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Inicio', icon: 'home' },
  { id: 'graph', label: 'Grafo', icon: 'layers' },
  { id: 'argument', label: 'Mapa de argumentos', icon: 'map' },
  { id: 'ideas', label: 'Ideas', icon: 'bulb' },
  { id: 'library', label: 'Biblioteca', icon: 'book' },
  { id: 'gaps', label: 'Huecos', icon: 'gap' },
  { id: 'debate', label: 'Debates', icon: 'scale' },
  { id: 'research', label: 'Cobertura', icon: 'compass' },
  { id: 'reading', label: 'Ruta de lectura', icon: 'route' },
  { id: 'writing', label: 'Escritura', icon: 'edit' },
  { id: 'notes', label: 'Notas', icon: 'notebook' },
  { id: 'settings', label: 'Ajustes', icon: 'settings' },
];

/**
 * Resolve the sidebar items for a user-defined order. Home is pinned first and
 * is never part of the saved order. Any sections missing from `sidebarOrder`
 * (e.g. a view added in a newer version) are appended in their default order so
 * the list always stays complete.
 */
export function orderedNav(sidebarOrder: string[]): NavItem[] {
  const home = NAV_ITEMS.find((n) => n.id === 'home');
  const rest = NAV_ITEMS.filter((n) => n.id !== 'home');
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
  return home ? [home, ...ordered] : ordered;
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

export type PendingGraphNavigationTarget = Omit<GraphNavigationTarget, 'nonce'>;
export type PendingAssistantNavigationTarget = Omit<AssistantNavigationTarget, 'nonce'>;

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
