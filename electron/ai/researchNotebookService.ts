import type { ResearchNotebookInput, ResolvedResearchScope } from '@shared/researchCorpus';
import type { ResearchChatRequest } from '@shared/types';
import { RETRIEVAL_PRESETS, validateRetrievalSettings } from '@shared/researchCorpus';
import { getDb } from '../db/database';
import { getActiveVault } from '../vaults/vaultRegistry';
import * as notebooks from '../db/researchNotebooksRepo';
import { researchCorpusInventory } from './researchCorpusInventory';
import { researchFingerprint, resolveNotebookScope, selectResearchDocuments } from './researchCorpusScope';

const active = new Map<string, Set<AbortController>>();
const key = (id: string) => `${getActiveVault().id}:${id}`;
export function listResearchNotebooks() {
  if (getActiveVault().type !== 'academic') return [];
  return notebooks.listResearchNotebooks();
}
export function saveResearchNotebook(input: ResearchNotebookInput) {
  const inventory = researchCorpusInventory();
  const old = input.id ? notebooks.getResearchNotebook(input.id) : null;
  const unchangedSelection = old?.mode === input.mode && researchFingerprint([old.sources, old.exclusions]) === researchFingerprint([input.sources, input.exclusions]);
  const ids = input.mode === 'fixed' && unchangedSelection ? old!.resolvedDocumentIds
    : selectResearchDocuments(input.sources, input.exclusions, inventory.documents, inventory.collections);
  const result = notebooks.saveResearchNotebook(input, ids);
  for (const controller of active.get(key(result.id)) ?? []) controller.abort();
  return result;
}
export function deleteResearchNotebook(id: string) {
  if (getActiveVault().type !== 'academic') throw new Error('Research notebooks require an academic vault');
  notebooks.deleteResearchNotebook(id);
  for (const controller of active.get(key(id)) ?? []) controller.abort();
}
export function resolveResearchNotebook(id: string): ResolvedResearchScope {
  const inventory = researchCorpusInventory();
  const notebook = notebooks.getResearchNotebook(id);
  if (!notebook) throw new Error('Notebook not found');
  const scope = resolveNotebookScope(getActiveVault().id, notebook, inventory.documents, inventory.collections);
  notebooks.recordResearchScope(scope);
  return scope;
}
export function registerNotebookRun(id: string, controller: AbortController): () => void {
  const runKey = key(id);
  const controllers = active.get(runKey) ?? new Set<AbortController>();
  controllers.add(controller);
  active.set(runKey, controllers);
  return () => { controllers.delete(controller); if (!controllers.size) active.delete(runKey); };
}

const pinnedScope = Symbol('backendResearchScope');
type ScopedRequest = ResearchChatRequest & { [pinnedScope]?: ResolvedResearchScope };
export function requestNotebookScope(input: ResearchChatRequest): ResolvedResearchScope | null { return (input as ScopedRequest)[pinnedScope] ?? null; }
export function authorizeNotebookRequest(input: ResearchChatRequest): ScopedRequest {
  if (!input.selection.notebookId) return input;
  const prior = (input as ScopedRequest)[pinnedScope];
  const scope = prior ?? resolveResearchNotebook(input.selection.notebookId);
  const notebook = notebooks.getResearchNotebook(input.selection.notebookId)!;
  if (scope.vaultId !== getActiveVault().id || notebook.revision !== scope.notebookRevision) throw new Error('research_scope_changed');
  if (input.conversationId) notebooks.associateNotebookConversation(notebook.id, input.conversationId);
  return { ...input, [pinnedScope]: scope, attachmentIds: [],
    messages: authorizedNotebookHistory(input, scope),
    selection: { ...input.selection, documents: false, passages: true, retrieval: validateRetrievalSettings(notebook.settings ?? input.selection.retrieval ?? RETRIEVAL_PRESETS.balanced),
      sourceFilter: { enabled: true, authorIds: [], workIds: scope.documents.flatMap(document => document.workId ? [document.workId] : []) } } };
}
export function validateNotebookRequest(input: ResearchChatRequest): void {
  const scope = (input as ScopedRequest)[pinnedScope];
  if (!scope) return;
  if (getActiveVault().id !== scope.vaultId) throw new Error('research_scope_changed');
  const current = resolveResearchNotebook(scope.notebookId!);
  if (current.id !== scope.id) throw new Error('research_scope_changed');
}

function authorizedNotebookHistory(input: ResearchChatRequest, scope: ResolvedResearchScope): ResearchChatRequest['messages'] {
  let lastUser = -1;
  input.messages.forEach((message, index) => { if (message.role === 'user') lastUser = index; });
  const known = input.conversationId ? getDb().prepare(`SELECT role,content_hash FROM research_conversation_provenance WHERE conversation_id=? AND scope_id=?`)
    .all(input.conversationId, scope.id) as { role: string; content_hash: string }[] : [];
  const trusted = new Set(known.map(row => `${row.role}:${row.content_hash}`));
  return input.messages.filter((message, index) => index === lastUser || trusted.has(`${message.role}:${researchFingerprint(message.content)}`))
    .map(({ role, content }) => ({ role, content }));
}

/** Only provider results that passed scope validation can authorize later reuse.
 * Renderer-supplied history metadata and manually saved assistant text cannot. */
export function rememberNotebookTurn(input: ResearchChatRequest, answer: string): string {
  const scope = requestNotebookScope(input);
  if (!scope || !input.conversationId) return answer;
  validateNotebookRequest(input);
  const user = input.messages.filter(message => message.role === 'user').at(-1);
  const insert = getDb().prepare(`INSERT OR IGNORE INTO research_conversation_provenance(conversation_id,scope_id,role,content_hash,created_at) VALUES (?,?,?,?,?)`);
  getDb().transaction(() => {
    for (const [role, content] of [['user', user?.content], ['assistant', answer]]) if (content) insert.run(input.conversationId, scope.id, role, researchFingerprint(content), new Date().toISOString());
  })();
  return answer;
}
