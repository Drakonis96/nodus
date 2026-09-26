/** Observable operations, not model reasoning or predicted progress. */
export type ResearchActivityLayer = 'scope' | 'ideas' | 'profiles' | 'nodus' | 'zotero' | 'context' | 'graph' | 'attachments' | 'response' | 'tools' | 'web';
export type ResearchActivityOperation = 'resolve' | 'embed' | 'lexical' | 'semantic' | 'search' | 'expand' | 'pages' | 'references' | 'metadata' | 'fulltext' | 'read' | 'write' | 'citations' | 'execute'
  | 'plan' | 'query' | 'results' | 'fetch' | 'reformulate' | 'select' | 'finish';
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
  /** Web step only: what a search found or which page is being read. Titles and
   * URLs of public results, never page text. */
  web?: ResearchWebActivityDetail;
}
export type ResearchWebPageOutcome = 'read' | 'empty' | 'blocked' | 'timeout' | 'too_large' | 'unsupported' | 'not_found' | 'failed' | 'cancelled';
export interface ResearchWebActivityDetail {
  round?: number;
  url?: string;
  domain?: string;
  /** Why a page could not be read, or that it was read without useful text. */
  outcome?: ResearchWebPageOutcome;
  /** A few of the results a search returned: found, not yet read. */
  found?: Array<{ title: string; domain: string; url: string }>;
  /** Distinct pages the selected evidence comes from. */
  sources?: number;
  /** Why the step ended: enough evidence, limits reached, nothing found, disabled. */
  reason?: 'sufficient' | 'limits' | 'deadline' | 'exhausted' | 'not_needed' | 'unavailable' | 'disabled';
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
export const RESEARCH_ACTIVITY_LAYER_ORDER: readonly ResearchActivityLayer[] = ['scope', 'profiles', 'ideas', 'nodus', 'context', 'graph', 'zotero', 'attachments', 'tools', 'web', 'response'];
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

export interface ResearchWebQueryView { query: string; status: ResearchActivityStatus; results?: number }
export interface ResearchWebPageView { title: string; url: string; domain: string; status: ResearchActivityStatus; outcome?: ResearchWebPageOutcome; blocks?: number }
export interface ResearchWebRoundView {
  round: number;
  queries: ResearchWebQueryView[];
  /** Unique results after merging this round's queries; found, not read. */
  found?: number;
  foundItems: Array<{ title: string; domain: string; url: string }>;
  reformulating?: ResearchActivityStatus;
  pages: ResearchWebPageView[];
  evidence?: { passages: number; sources: number; status: ResearchActivityStatus };
}
export interface ResearchWebView {
  planning?: ResearchActivityStatus;
  rounds: ResearchWebRoundView[];
  finished?: { status: ResearchActivityStatus; reason?: ResearchWebActivityDetail['reason']; passages?: number; sources?: number };
  /** Distinct pages actually opened, against distinct results found. */
  consulted: number;
  found: number;
}

/** The web step as the activity section shows it: per round, what was searched,
 * what was found (not read), which pages were opened and what came of each, which
 * evidence was kept, and how the step ended. Rebuilt from events alone. */
export function summarizeWebActivity(activities: ResearchActivity[]): ResearchWebView | null {
  const events = activities.filter(item => item.layer === 'web');
  if (!events.length) return null;
  const rounds = new Map<number, ResearchWebRoundView>();
  const round = (number = 1) => {
    let view = rounds.get(number);
    if (!view) { view = { round: number, queries: [], foundItems: [], pages: [] }; rounds.set(number, view); }
    return view;
  };
  const view: ResearchWebView = { rounds: [], consulted: 0, found: 0 };
  for (const event of events) {
    const number = event.web?.round ?? 1;
    switch (event.operation) {
      case 'plan': view.planning = event.status; break;
      case 'query': round(number).queries.push({ query: event.subject ?? '', status: event.status, ...(event.count !== undefined ? { results: event.count } : {}) }); break;
      case 'results': {
        const target = round(number);
        if (event.count !== undefined) target.found = event.count;
        if (event.web?.found) target.foundItems = event.web.found;
        break;
      }
      case 'reformulate': round(number).reformulating = event.status; break;
      case 'fetch': round(number).pages.push({ title: event.subject ?? event.web?.domain ?? '', url: event.web?.url ?? '', domain: event.web?.domain ?? '', status: event.status,
        ...(event.web?.outcome ? { outcome: event.web.outcome } : {}), ...(event.count !== undefined ? { blocks: event.count } : {}) }); break;
      case 'select': round(number).evidence = { passages: event.count ?? 0, sources: event.web?.sources ?? 0, status: event.status }; break;
      case 'finish': view.finished = { status: event.status, ...(event.web?.reason ? { reason: event.web.reason } : {}), ...(event.count !== undefined ? { passages: event.count } : {}),
        ...(event.web?.sources !== undefined ? { sources: event.web.sources } : {}) }; break;
      default: break;
    }
  }
  view.rounds = [...rounds.values()].sort((a, b) => a.round - b.round);
  const opened = new Set(view.rounds.flatMap(item => item.pages.map(page => page.url)));
  view.consulted = opened.size;
  view.found = Math.max(0, ...view.rounds.map(item => item.found ?? 0));
  return view;
}
