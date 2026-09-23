import { validateResearchDocumentRead, type ResearchDocumentRead } from './researchCorpus';

/** Closed action vocabulary. Source text and free-form model prose never execute. */
export type ResearchAction =
  | { action: 'finish' }
  | { action: 'search'; query: string }
  | { action: 'read'; documentId: string; operation: ResearchDocumentRead }
  | { action: 'original'; documentId: string; from: number; to?: number; attachmentId?: string };

export function validResearchAction(value: unknown): value is ResearchAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  const allowed = input.action === 'finish' ? ['action'] : input.action === 'search' ? ['action', 'query']
    : input.action === 'read' ? ['action', 'documentId', 'operation'] : input.action === 'original' ? ['action', 'documentId', 'from', 'to', 'attachmentId'] : [];
  if (!allowed.length || keys.some(key => !allowed.includes(key))) return false;
  if (input.action === 'finish') return true;
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
