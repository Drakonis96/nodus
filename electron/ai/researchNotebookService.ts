import type { ResearchNotebookInput, ResolvedResearchScope } from '@shared/researchCorpus';
import type { ResearchChatRequest } from '@shared/types';
import { RETRIEVAL_PRESETS, validateRetrievalSettings } from '@shared/researchCorpus';
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
    // Until individual history turns have backend-owned provenance, never reuse
    // old unscoped assistant claims or conversational attachments as sources.
    messages: input.messages.filter(message => message.role === 'user').slice(-1).map(({ role, content }) => ({ role, content })),
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
