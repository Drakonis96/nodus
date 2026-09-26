import { validateResearchDocumentRead, type ResearchDocumentRead } from './researchCorpus';

/** Closed action vocabulary. Source text and free-form model prose never execute. */
export type ResearchAction =
  | { action: 'finish' }
  | { action: 'search'; query: string }
  | { action: 'read'; documentId: string; operation: ResearchDocumentRead }
  | { action: 'original'; documentId: string; from: number; to?: number; attachmentId?: string }
  | { action: 'web'; queries: string[]; intent: ResearchWebIntent };

/** Why the supervisor leaves the library: more coverage, a counter-position,
 * newer information than the corpus holds, or the user asked for the web. */
export type ResearchWebIntent = 'expand' | 'contrast' | 'update' | 'explicit';
const WEB_INTENTS: readonly string[] = ['expand', 'contrast', 'update', 'explicit'];

/** The web action exists only for runs that were granted it (Research Chat with web
 * search on); every other caller keeps the library-only vocabulary. */
export function validResearchAction(value: unknown, allowWeb = false): value is ResearchAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  const allowed = input.action === 'finish' ? ['action'] : input.action === 'search' ? ['action', 'query']
    : input.action === 'read' ? ['action', 'documentId', 'operation'] : input.action === 'original' ? ['action', 'documentId', 'from', 'to', 'attachmentId']
      : input.action === 'web' && allowWeb ? ['action', 'queries', 'intent'] : [];
  if (!allowed.length || keys.some(key => !allowed.includes(key))) return false;
  if (input.action === 'finish') return true;
  if (input.action === 'web') {
    return Array.isArray(input.queries) && input.queries.length >= 1 && input.queries.length <= 4
      && input.queries.every(query => typeof query === 'string' && query.trim().length >= 2 && query.length <= 200)
      && typeof input.intent === 'string' && WEB_INTENTS.includes(input.intent);
  }
  if (input.action === 'search') return typeof input.query === 'string' && input.query.trim().length > 0 && input.query.length <= 1000;
  if (typeof input.documentId !== 'string' || !input.documentId || input.documentId.length > 512) return false;
  try {
    const operation = input.action === 'read' ? input.operation : { kind: 'pages', from: input.from, to: input.to, attachmentId: input.attachmentId };
    validateResearchDocumentRead(operation as ResearchDocumentRead);
    if (input.action === 'read') {
      const read = operation as ResearchDocumentRead;
      const permitted = { search: ['kind', 'query'], pages: ['kind', 'from', 'to', 'attachmentId'], context: ['kind', 'passageId', 'radius'], references: ['kind', 'query'] }[read.kind];
      if (Object.keys(read).some(key => !permitted.includes(key))) return false;
    }
    return true;
  } catch { return false; }
}
