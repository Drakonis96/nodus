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

/** Every layer a research turn can consult, in the order the flow consults them. */
export const RESEARCH_ACTIVITY_LAYER_ORDER: readonly ResearchActivityLayer[] = ['scope', 'profiles', 'ideas', 'nodus', 'context', 'graph', 'zotero', 'attachments', 'tools', 'response'];
/** idle: not consulted yet. empty: consulted without results, so the flow relied on another layer. */
export type ResearchActivityLayerState = 'idle' | 'active' | 'completed' | 'empty' | 'failed' | 'cancelled';
export interface ResearchActivityLayerSummary {
  layer: ResearchActivityLayer;
  state: ResearchActivityLayerState;
  operation?: ResearchActivityOperation;
  count?: number;
  subject?: string;
  attempts: number;
}

/** One row per layer for the current request: running while any of its operations runs,
 * decisive once any returned something, failed when its attempts only failed, and
 * empty when it answered with nothing. */
export function summarizeResearchActivity(activities: ResearchActivity[]): ResearchActivityLayerSummary[] {
  return RESEARCH_ACTIVITY_LAYER_ORDER.map(layer => {
    const events = activities.filter(item => item.layer === layer);
    const running = events.filter(item => item.status === 'active');
    const state: ResearchActivityLayerState = !events.length ? 'idle'
      : running.length ? 'active'
        : events.some(item => item.status === 'completed' && item.count !== 0) ? 'completed'
          : events.some(item => item.status === 'failed') ? 'failed'
            : events.some(item => item.status === 'completed') ? 'empty' : 'cancelled';
    const shown = running.at(-1) ?? events.at(-1);
    return { layer, state, attempts: events.length,
      ...(shown ? { operation: shown.operation } : {}),
      ...(shown?.count !== undefined ? { count: shown.count } : {}),
      ...(shown?.subject ? { subject: shown.subject } : {}) };
  });
}
