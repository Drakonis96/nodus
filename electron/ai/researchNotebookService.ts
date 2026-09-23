import type { ResearchNotebookInput, ResolvedResearchScope } from '@shared/researchCorpus';
import type { ResearchChatRequest } from '@shared/types';
import { RETRIEVAL_PRESETS, validateRetrievalSettings } from '@shared/researchCorpus';
import { getDb } from '../db/database';
import { getActiveVault } from '../vaults/vaultRegistry';
import * as notebooks from '../db/researchNotebooksRepo';
import { researchCorpusInventory } from './researchCorpusInventory';
import { researchFingerprint, resolveNotebookScope, selectResearchDocuments } from './researchCorpusScope';
import { resolveResearchSourceScope } from './researchSourceScope';

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
export function resolveAcademicResearchScope(filter?: ResearchChatRequest['selection']['sourceFilter']): ResolvedResearchScope {
  const vault = getActiveVault();
  const allowed = filter?.enabled ? resolveResearchSourceScope(filter, true) : null;
  const documents = researchCorpusInventory().documents.filter(document => document.workId && (!allowed || allowed.workIds.has(document.workId))).sort((a, b) => a.id.localeCompare(b.id));
  const permissionFingerprint = researchFingerprint(documents.map(document => [document.id, document.permissionRevision]));
  const scope: ResolvedResearchScope = { id: researchFingerprint([vault.id, documents, permissionFingerprint]), vaultId: vault.id,
    notebookId: null, notebookRevision: null, documents, permissionFingerprint, resolvedAt: new Date().toISOString(), changes: { added: [], removed: [] } };
  notebooks.recordResearchScope(scope);
  return scope;
}
export function authorizeNotebookRequest(input: ResearchChatRequest): ScopedRequest {
  if (!input.selection.notebookId && getActiveVault().type !== 'academic') return input;
  const prior = (input as ScopedRequest)[pinnedScope];
  const scope = prior ?? (input.selection.notebookId ? resolveResearchNotebook(input.selection.notebookId) : resolveAcademicResearchScope(input.selection.sourceFilter));
  const notebook = input.selection.notebookId ? notebooks.getResearchNotebook(input.selection.notebookId) : null;
  if (scope.vaultId !== getActiveVault().id || (notebook && notebook.revision !== scope.notebookRevision)) throw new Error('research_scope_changed');
  if (notebook && input.conversationId) notebooks.associateNotebookConversation(notebook.id, input.conversationId);
  return { ...input, [pinnedScope]: scope, attachmentIds: [],
    ...(notebook?.conversationSettings ?? {}),
    messages: authorizedNotebookHistory(input, scope),
    selection: { ...input.selection, documents: false, passages: true, retrieval: validateRetrievalSettings(notebook?.settings ?? input.selection.retrieval ?? RETRIEVAL_PRESETS.balanced),
      sourceFilter: { enabled: true, authorIds: [], workIds: scope.documents.flatMap(document => document.workId ? [document.workId] : []) } } };
}
export function validateNotebookRequest(input: ResearchChatRequest): void {
  const scope = (input as ScopedRequest)[pinnedScope];
  if (!scope) return;
  if (getActiveVault().id !== scope.vaultId) throw new Error('research_scope_changed');
  const current = scope.notebookId ? resolveResearchNotebook(scope.notebookId) : resolveAcademicResearchScope(input.selection.sourceFilter);
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
  if (!scope) return answer;
  validateNotebookRequest(input);
  if (!input.conversationId) return answer;
  const user = input.messages.filter(message => message.role === 'user').at(-1);
  const insert = getDb().prepare(`INSERT OR IGNORE INTO research_conversation_provenance(conversation_id,scope_id,role,content_hash,created_at) VALUES (?,?,?,?,?)`);
  getDb().transaction(() => {
    for (const [role, content] of [['user', user?.content], ['assistant', answer]]) if (content) insert.run(input.conversationId, scope.id, role, researchFingerprint(content), new Date().toISOString());
  })();
  return answer;
}
