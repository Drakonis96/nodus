/** Observable operations, not model reasoning or predicted progress. */
export type ResearchActivityLayer = 'scope' | 'ideas' | 'profiles' | 'nodus' | 'zotero' | 'context' | 'graph' | 'attachments' | 'response' | 'tools';
export type ResearchActivityOperation = 'resolve' | 'embed' | 'lexical' | 'semantic' | 'search' | 'expand' | 'pages' | 'references' | 'metadata' | 'fulltext' | 'read' | 'write' | 'citations' | 'execute';
export type ResearchActivityStatus = 'active' | 'completed' | 'failed' | 'cancelled';
export interface ResearchActivity {
  id: string;
  layer: ResearchActivityLayer;
  operation: ResearchActivityOperation;
  status: ResearchActivityStatus;
  startedAt: number;
  finishedAt?: number;
  /** Authorized source title, bounded search query or participating model, never raw source text. */
  subject?: string;
  count?: number;
}

/** Immutable updates preserve start order while simultaneous operations settle. */
export function updateResearchActivities(current: ResearchActivity[], event: ResearchActivity): ResearchActivity[] {
  const index = current.findIndex(item => item.id === event.id);
  if (index >= 0) return current.map((item, position) => position === index ? event : item);
  const next = [...current, event];
  if (next.length > 120) {
    const removable = next.findIndex(item => item.status !== 'active');
    if (removable >= 0) next.splice(removable, 1);
  }
  return next;
}

/** Settle missing terminal events after IPC completion, without inventing success. */
export function settleResearchActivities(current: ResearchActivity[], outcome: Exclude<ResearchActivityStatus, 'active'>): ResearchActivity[] {
  return current.map(item => item.status === 'active' ? { ...item, status: outcome === 'cancelled' ? 'cancelled' : 'failed', finishedAt: Date.now() } : item);
}
